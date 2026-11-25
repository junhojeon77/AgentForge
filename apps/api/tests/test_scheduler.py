import asyncio
import collections
import logging
import uuid

import pytest
from pydantic import ValidationError

from agentforge.__main__ import main as demo_main
from agentforge.domain import (
    AgentConfig,
    FailureReason,
    RunPlan,
    RunReport,
    TaskSpec,
    TaskStatus,
    WorkerResult,
)
from agentforge.mocks import MockExecutor, MockValidator, register_default_workers
from agentforge.orchestration import Scheduler


def task(task_id, role="backend", dependencies=(), **kwargs):
    return TaskSpec(
        id=task_id, run_id="run", title=task_id, role=role, dependencies=dependencies, **kwargs
    )


def plan(*tasks):
    return RunPlan(id="run", tasks=tasks)


def scheduler(executor=None, validator=None, **kwargs):
    engine = Scheduler(validator=validator or MockValidator(), **kwargs)
    engine.register_worker(AgentConfig(id="worker", role="backend"), executor or MockExecutor())
    return engine


async def test_empty_plan():
    report = await Scheduler(validator=MockValidator()).run(plan())
    assert report.successful
    assert report.tasks == ()


@pytest.mark.parametrize(
    "tasks",
    [
        (task("a"), task("a")),
        (task("a", dependencies=("missing",)),),
        (task("a", dependencies=("a",)),),
        (task("a", dependencies=("b",)), task("b", dependencies=("a",))),
        (task("a", role="unknown"),),
        (task("a").model_copy(update={"run_id": "wrong"}),),
    ],
)
async def test_invalid_graph_dispatches_nothing(tasks):
    executor = MockExecutor()
    engine = scheduler(executor)
    with pytest.raises(ValueError):
        await engine.run(plan(*tasks))
    assert not executor.assignments


def test_registration_and_concurrency_validation():
    engine = scheduler()
    with pytest.raises(ValueError):
        engine.register_worker(AgentConfig(id="worker", role="backend"), MockExecutor())
    for cap in (0, 6, True):
        with pytest.raises(ValueError):
            Scheduler(validator=MockValidator(), max_concurrency=cap)


async def test_five_default_workers_run_concurrently():
    gate = asyncio.Event()
    executor = MockExecutor(gate=gate, expected_starts=5)
    engine = Scheduler(validator=MockValidator())
    register_default_workers(engine, executor)
    roles = ("backend", "frontend", "database", "qa", "integration")
    running = asyncio.create_task(engine.run(plan(*(task(role, role=role) for role in roles))))
    await asyncio.wait_for(executor.started.wait(), 2)
    assert len(executor.assignments) == 5
    busy = [w for w in engine.snapshot().workers if w.agent.role in roles]
    assert len(busy) == 5 and all(worker.task_id is not None for worker in busy)
    gate.set()
    report = await asyncio.wait_for(running, 2)
    assert report.successful
    assert len(report.attempts) == 5
    assert all(worker.task_id is None for worker in report.workers)


class DiffByTask(MockExecutor):
    def __init__(self, diffs):
        super().__init__()
        self.diffs = diffs

    async def execute(self, assignment):
        await super().execute(assignment)
        return WorkerResult(success=True, diff=self.diffs.get(assignment.task.id, ""))


async def test_a_task_is_given_the_diffs_of_the_tasks_it_waits_for(caplog):
    caplog.set_level(logging.DEBUG, logger="agentforge")
    executor = DiffByTask({"a": "+SECRET-DIFF-a"})
    report = await scheduler(executor).run(
        plan(task("a"), task("b"), task("c", dependencies=("a", "b")))
    )
    assert report.successful
    given = {x.task.id: x.dependency_diffs for x in executor.assignments}
    # b changed nothing, so only a's diff is handed on.
    assert given == {"a": (), "b": (), "c": (("a", "+SECRET-DIFF-a"),)}
    assert "run run task c gets the diffs of a" in caplog.messages
    assert "SECRET-DIFF" not in caplog.text


async def test_lower_cap_same_role_order_and_worker_selection():
    gate = asyncio.Event()
    executor = MockExecutor(gate=gate, expected_starts=2)
    engine = scheduler(executor, max_concurrency=2)
    engine.register_worker(AgentConfig(id="aaa", role="backend"), executor)
    engine.register_worker(AgentConfig(id="zzz", role="backend"), executor)
    running = asyncio.create_task(
        engine.run(plan(task("c"), task("b", priority=3), task("a", priority=3)))
    )
    await asyncio.wait_for(executor.started.wait(), 2)
    assert [(a.task.id, a.worker.id) for a in executor.assignments] == [
        ("a", "aaa"),
        ("b", "worker"),
    ]
    gate.set()
    report = await asyncio.wait_for(running, 2)
    assert report.successful
    assert len(executor.assignments) == 3
    assert len({a.task.id for a in executor.assignments}) == 3


async def test_unavailable_role_does_not_stall_other_work():
    executor = MockExecutor()
    engine = scheduler(executor)
    engine.register_worker(AgentConfig(id="front", role="frontend"), executor)
    report = await engine.run(plan(task("a"), task("b"), task("c", role="frontend")))
    assert report.successful
    assert [a.task.id for a in executor.assignments][:2] == ["a", "c"]


async def test_validation_gates_diamond_and_records_transitions():
    gate = asyncio.Event()
    validator = MockValidator(gate=gate)
    executor = MockExecutor()
    engine = scheduler(executor, validator)
    running = asyncio.create_task(
        engine.run(
            plan(
                task("a"),
                task("b", dependencies=("a",)),
                task("c", dependencies=("a",)),
                task("d", dependencies=("b", "c")),
            )
        )
    )
    await asyncio.wait_for(validator.started.wait(), 2)
    assert [a.task.id for a in executor.assignments] == ["a"]
    assert engine.snapshot().tasks[0].status == TaskStatus.VALIDATING
    gate.set()
    report = await asyncio.wait_for(running, 2)
    assert report.successful
    assert [a.task.id for a in executor.assignments] == ["a", "b", "c", "d"]
    assert [t.status for t in report.transitions if t.task_id == "a"] == [
        TaskStatus.PENDING,
        TaskStatus.READY,
        TaskStatus.ASSIGNED,
        TaskStatus.RUNNING,
        TaskStatus.VALIDATING,
        TaskStatus.COMPLETED,
    ]


@pytest.mark.parametrize(
    "executor,validator,reason",
    [
        (
            MockExecutor(result=WorkerResult(success=False, message="failure")),
            MockValidator(),
            FailureReason.WORKER_FAILURE,
        ),
        (
            MockExecutor(error=RuntimeError("boom")),
            MockValidator(),
            FailureReason.EXECUTOR_EXCEPTION,
        ),
        (MockExecutor(result={"invalid": True}), MockValidator(), FailureReason.INVALID_RESULT),
        (
            MockExecutor(result=WorkerResult.model_construct(success="yes")),
            MockValidator(),
            FailureReason.INVALID_RESULT,
        ),
        (MockExecutor(), MockValidator(reject=True), FailureReason.VALIDATION_REJECTED),
        (
            MockExecutor(),
            MockValidator(error=RuntimeError("invalid")),
            FailureReason.VALIDATOR_EXCEPTION,
        ),
    ],
)
async def test_failure_blocks_descendants_releases_worker_and_continues(
    executor, validator, reason
):
    engine = scheduler(executor, validator)
    report = await engine.run(
        plan(
            task("a"),
            task("b", dependencies=("a",)),
            task("c", dependencies=("b",)),
            task("z"),
        )
    )
    states = {t.task.id: t for t in report.tasks}
    assert states["a"].failure_reason == reason
    assert states["b"].status == states["c"].status == TaskStatus.BLOCKED
    assert states["c"].blocked_by == "a"
    assert [a.task.id for a in executor.assignments] == ["a", "z"]
    assert all(w.task_id is None for w in report.workers)
    assert all(a.number == 1 for a in report.attempts)
    why = "blocked by a, which is FAILED"
    assert states["b"].message == states["c"].message == why
    assert [t.detail for t in report.transitions if t.status == TaskStatus.BLOCKED] == [why, why]
    assert all(t.detail for t in report.transitions)


async def test_required_evidence_is_independently_validated():
    report = await scheduler().run(
        plan(
            task(
                "a",
                acceptance_criteria=("criterion",),
                expected_output=("artifact",),
                execution_constraints=("check:unit",),
            )
        )
    )
    assert report.tasks[0].failure_reason == FailureReason.VALIDATION_REJECTED
    evidence = WorkerResult(
        success=True,
        artifacts=("artifact",),
        passed_checks=("unit",),
        satisfied_criteria=("criterion",),
    )
    report = await scheduler(MockExecutor(result=evidence)).run(
        plan(
            task(
                "a",
                acceptance_criteria=("criterion",),
                expected_output=("artifact",),
                execution_constraints=("check:unit",),
            )
        )
    )
    assert report.successful


async def test_overlapping_run_and_registration_rejected_and_snapshots_copied():
    gate = asyncio.Event()
    executor = MockExecutor(gate=gate)
    engine = scheduler(executor)
    running = asyncio.create_task(engine.run(plan(task("a"))))
    await asyncio.wait_for(executor.started.wait(), 2)
    snapshot = engine.snapshot()
    with pytest.raises(ValueError):
        await engine.run(plan(task("other")))
    with pytest.raises(ValueError):
        engine.register_worker(AgentConfig(id="new", role="backend"), MockExecutor())
    with pytest.raises(ValidationError):
        snapshot.tasks[0].status = TaskStatus.COMPLETED
    gate.set()
    report = await asyncio.wait_for(running, 2)
    assert report.successful
    assert snapshot.tasks[0].status == TaskStatus.RUNNING


@pytest.mark.parametrize("during_validation", [False, True])
async def test_cancel_active_task_awaits_cleanup_and_blocks_descendants(during_validation):
    gate = asyncio.Event()
    executor = MockExecutor(gate=None if during_validation else gate)
    validator = MockValidator(gate=gate if during_validation else None)
    engine = scheduler(executor, validator)
    running = asyncio.create_task(
        engine.run(plan(task("a"), task("b", dependencies=("a",)), task("z")))
    )
    await asyncio.wait_for((validator if during_validation else executor).started.wait(), 2)
    await engine.cancel_task("a")
    await engine.cancel_task("a")
    gate.set()
    report = await asyncio.wait_for(running, 2)
    states = {t.task.id: t.status for t in report.tasks}
    assert states == {"a": TaskStatus.CANCELLED, "b": TaskStatus.BLOCKED, "z": TaskStatus.COMPLETED}
    assert all(w.task_id is None for w in report.workers)
    messages = {t.task.id: t.message for t in report.tasks}
    assert messages["a"] == report.attempts[0].message == "cancel_task was called"
    assert messages["b"] == "blocked by a, which is CANCELLED"
    assert [t.detail for t in report.transitions if t.status == TaskStatus.CANCELLED] == [
        "cancel_task was called"
    ]
    assert all(t.detail for t in report.transitions)


async def test_cancel_pending_task_and_entire_run():
    executor = MockExecutor(gate=asyncio.Event())
    engine = scheduler(executor)
    running = asyncio.create_task(
        engine.run(plan(task("a"), task("b"), task("c", dependencies=("b",))))
    )
    await asyncio.wait_for(executor.started.wait(), 2)
    await engine.cancel_task("b")
    assert {s.task.id: s.status for s in engine.snapshot().tasks}["c"] == TaskStatus.BLOCKED
    await engine.cancel_run()
    await engine.cancel_run()
    report = await asyncio.wait_for(running, 2)
    assert all(t.status in {TaskStatus.CANCELLED, TaskStatus.BLOCKED} for t in report.tasks)
    assert all(w.task_id is None for w in report.workers)
    assert len(report.attempts) == 1
    assert {t.task.id: t.message for t in report.tasks} == {
        "a": "cancel_run was called",
        "b": "cancel_task was called",
        "c": "blocked by b, which is CANCELLED",
    }
    assert all(t.detail for t in report.transitions)


async def test_caller_cancellation_cleans_active_work():
    executor = MockExecutor(gate=asyncio.Event())
    engine = scheduler(executor)
    running = asyncio.create_task(engine.run(plan(task("a"))))
    await asyncio.wait_for(executor.started.wait(), 2)
    running.cancel()
    with pytest.raises(asyncio.CancelledError):
        await running
    assert executor.finished.is_set()
    assert engine.snapshot().workers[0].task_id is None
    assert engine.snapshot().tasks[0].message == "run() stopped by CancelledError"
    assert engine.snapshot().transitions[-1].detail == "run() stopped by CancelledError"


async def test_worker_task_cancelled_from_outside_says_so():
    executor = MockExecutor(gate=asyncio.Event())
    engine = scheduler(executor)
    running = asyncio.create_task(engine.run(plan(task("a"))))
    await asyncio.wait_for(executor.started.wait(), 2)
    (worker_task,) = (t for t in asyncio.all_tasks() if t.get_name() == "agentforge:run:a")
    worker_task.cancel()
    report = await asyncio.wait_for(running, 2)
    assert report.tasks[0].status == TaskStatus.CANCELLED
    assert report.tasks[0].message == "worker task was cancelled"
    assert report.transitions[-1].detail == "worker task was cancelled"


async def test_every_transition_of_a_completed_task_says_why():
    report = await scheduler().run(plan(task("a", max_attempts=3)))
    assert [(t.status, t.detail) for t in report.transitions] == [
        (TaskStatus.PENDING, "queued"),
        (TaskStatus.READY, "no unfinished dependencies"),
        (TaskStatus.ASSIGNED, "attempt 1 of 3 assigned to worker worker"),
        (TaskStatus.RUNNING, "worker started"),
        (TaskStatus.VALIDATING, "worker reported success; validating"),
        (TaskStatus.COMPLETED, "validation accepted"),
    ]
    assert report.tasks[0].message == ""


async def test_completed_task_is_not_overwritten_by_cancellation():
    engine = scheduler()
    report = await engine.run(plan(task("a")))
    await engine.cancel_task("a")
    assert report.tasks[0].status == engine.snapshot().tasks[0].status == TaskStatus.COMPLETED


async def test_cancel_cleanup_does_not_release_reassigned_worker():
    first_gate, second_gate = asyncio.Event(), asyncio.Event()
    second_started = asyncio.Event()

    class Executor:
        async def execute(self, assignment):
            if assignment.task.id == "a":
                first_gate.set()
                await asyncio.Event().wait()
            else:
                second_started.set()
                await second_gate.wait()
            return WorkerResult(success=True)

    engine = scheduler(Executor())
    running = asyncio.create_task(engine.run(plan(task("a"), task("b"), task("c"))))
    await asyncio.wait_for(first_gate.wait(), 2)
    await engine.cancel_task("a")
    await asyncio.wait_for(second_started.wait(), 2)
    assert engine.snapshot().workers[0].task_id == "b"
    second_gate.set()
    await asyncio.wait_for(running, 2)


async def test_independent_branch_succeeds_after_failure():
    class Executor:
        async def execute(self, assignment):
            return WorkerResult(success=assignment.task.id != "a")

    report = await scheduler(Executor()).run(
        plan(task("a"), task("b", dependencies=("a",)), task("z"))
    )
    assert {state.task.id: state.status for state in report.tasks} == {
        "a": TaskStatus.FAILED,
        "b": TaskStatus.BLOCKED,
        "z": TaskStatus.COMPLETED,
    }


async def test_repeated_cancellation_awaits_cooperative_cleanup():
    started, cleaning, release = asyncio.Event(), asyncio.Event(), asyncio.Event()
    interrupted = []

    class Executor:
        async def execute(self, assignment):
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                cleaning.set()
                try:
                    await release.wait()
                except asyncio.CancelledError:
                    interrupted.append(True)
                    raise
            return WorkerResult(success=True)

    engine = scheduler(Executor())
    running = asyncio.create_task(engine.run(plan(task("a"))))
    await asyncio.wait_for(started.wait(), 2)
    first_cancel = asyncio.create_task(engine.cancel_task("a"))
    await asyncio.wait_for(cleaning.wait(), 2)
    second_cancel = asyncio.create_task(engine.cancel_task("a"))
    # Give the second cancellation a chance to run via a deterministic callback barrier.
    barrier = asyncio.Event()
    asyncio.get_running_loop().call_soon(barrier.set)
    await barrier.wait()
    assert not first_cancel.done()
    assert not second_cancel.done()
    release.set()
    await asyncio.wait_for(asyncio.gather(first_cancel, second_cancel, running), 2)
    assert not interrupted


@pytest.mark.parametrize("cancel", [False, True])
async def test_scheduler_reuse_after_failure_or_cancel_resets_history(cancel):
    gate = asyncio.Event()
    executor = MockExecutor(gate=gate, error=None if cancel else RuntimeError("failure"))
    engine = scheduler(executor)
    running = asyncio.create_task(engine.run(plan(task("a"))))
    await asyncio.wait_for(executor.started.wait(), 2)
    if cancel:
        await engine.cancel_run()
    gate.set()
    first = await asyncio.wait_for(running, 2)
    assert not first.successful
    executor.error = None
    second = await engine.run(plan(task("a")))
    assert second.successful
    assert len(second.attempts) == 1
    assert len(second.transitions) == 6
    assert second.transitions[0].sequence == 1
    assert first.tasks[0].status != TaskStatus.COMPLETED
    assert not [
        future for future in asyncio.all_tasks() if future.get_name().startswith("agentforge:")
    ]


async def test_late_success_cannot_override_cancellation():
    started = asyncio.Event()

    class Executor:
        async def execute(self, assignment):
            started.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                return WorkerResult(success=True)

    engine = scheduler(Executor())
    running = asyncio.create_task(engine.run(plan(task("a"))))
    await asyncio.wait_for(started.wait(), 2)
    await engine.cancel_task("a")
    report = await asyncio.wait_for(running, 2)
    assert report.tasks[0].status == TaskStatus.CANCELLED
    assert report.attempts[0].result is None
    assert all(worker.task_id is None for worker in report.workers)


async def test_non_exception_error_fails_task_instead_of_hanging():
    class Abort(BaseException):
        pass

    class Executor:
        async def execute(self, assignment):
            if assignment.task.id == "a":
                raise Abort
            return WorkerResult(success=True)

    engine = scheduler(Executor())
    report = await asyncio.wait_for(engine.run(plan(task("a"), task("z"))), 2)
    states = {t.task.id: t for t in report.tasks}
    assert states["a"].status == TaskStatus.FAILED
    assert states["a"].failure_reason == FailureReason.EXECUTOR_EXCEPTION
    assert states["z"].status == TaskStatus.COMPLETED
    assert all(worker.task_id is None for worker in report.workers)


async def test_second_run_cancellation_does_not_interrupt_cleanup_or_overlap_runs():
    started, cleaning, release, done = (asyncio.Event() for _ in range(4))
    interrupted = []

    class Executor:
        async def execute(self, assignment):
            if assignment.task.id == "next":
                return WorkerResult(success=True)
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                cleaning.set()
                try:
                    await release.wait()
                except asyncio.CancelledError:
                    interrupted.append(True)
                    raise
                finally:
                    done.set()

    engine = scheduler(Executor())
    running = asyncio.create_task(engine.run(plan(task("a"))))
    await asyncio.wait_for(started.wait(), 2)
    running.cancel()
    await asyncio.wait_for(cleaning.wait(), 2)
    running.cancel()
    with pytest.raises(asyncio.CancelledError):
        await running
    assert not interrupted
    with pytest.raises(ValueError):
        await engine.run(plan(task("next")))
    release.set()
    await asyncio.wait_for(done.wait(), 2)
    assert not interrupted
    report = await asyncio.wait_for(engine.run(plan(task("next"))), 2)
    assert report.successful


async def test_cancel_before_task_coroutine_starts_releases_worker():
    executor = MockExecutor()
    engine = scheduler(executor)
    running = asyncio.create_task(engine.run(plan(task("a"))))
    await asyncio.sleep(0)  # run() dispatches "a"; its coroutine has not taken a step yet
    assert engine.snapshot().tasks[0].status == TaskStatus.ASSIGNED
    await engine.cancel_task("a")
    report = await asyncio.wait_for(running, 2)
    assert report.tasks[0].status == TaskStatus.CANCELLED
    assert not executor.assignments
    assert all(worker.task_id is None for worker in report.workers)


async def test_demo_completes_all_five_tasks(capsys):
    await asyncio.wait_for(demo_main(), 2)
    banner, report = capsys.readouterr().out.split("\n", 1)
    assert banner == "All five mock workers are executing concurrently."
    report = RunReport.model_validate_json(report)
    assert report.successful and len(report.tasks) == 5


class FlakyExecutor:
    """Fails task "a" on its first `failures` attempts; everything else succeeds."""

    def __init__(self, failures=1, message="flaky"):
        self.failures = failures
        self.message = message
        self.assignments = []

    async def execute(self, assignment):
        self.assignments.append(assignment)
        passed = assignment.task.id != "a" or assignment.attempt_number > self.failures
        return WorkerResult(success=passed, message=self.message)


async def test_failed_attempt_is_retried_with_the_failure_as_feedback():
    executor = FlakyExecutor()
    report = await scheduler(executor).run(
        plan(task("a", max_attempts=2), task("b", dependencies=("a",)))
    )
    assert report.successful
    first, second, _ = report.attempts
    assert (first.number, first.status, first.failure_reason, first.message) == (
        1,
        TaskStatus.FAILED,
        FailureReason.WORKER_FAILURE,
        "flaky",
    )
    assert (second.number, second.status, second.failure_reason) == (2, TaskStatus.COMPLETED, None)
    assert [(a.task.id, a.attempt_number, a.previous_failure) for a in executor.assignments] == [
        ("a", 1, ""),
        ("a", 2, "flaky"),
        ("b", 1, ""),
    ]
    state = report.tasks[0]
    assert (state.attempt_number, state.failure_reason, state.message) == (2, None, "")
    assert [t.status for t in report.transitions if t.task_id == "a"] == [
        TaskStatus.PENDING,
        TaskStatus.READY,
        TaskStatus.ASSIGNED,
        TaskStatus.RUNNING,
        TaskStatus.READY,
        TaskStatus.ASSIGNED,
        TaskStatus.RUNNING,
        TaskStatus.VALIDATING,
        TaskStatus.COMPLETED,
    ]
    assert all(worker.task_id is None for worker in report.workers)


async def test_task_fails_and_blocks_descendants_when_attempts_run_out():
    report = await scheduler(FlakyExecutor(failures=5)).run(
        plan(task("a", max_attempts=3), task("b", dependencies=("a",)))
    )
    states = {t.task.id: t for t in report.tasks}
    assert states["a"].status == TaskStatus.FAILED
    assert states["a"].failure_reason == FailureReason.WORKER_FAILURE
    assert (states["a"].attempt_number, states["a"].message) == (3, "flaky")
    assert states["b"].status == TaskStatus.BLOCKED
    assert [(a.number, a.status) for a in report.attempts] == [
        (number, TaskStatus.FAILED) for number in (1, 2, 3)
    ]
    assert [t.detail for t in report.transitions if "failed (" in t.detail] == [
        "attempt 1 of 3 failed (worker_failure); retrying",
        "attempt 2 of 3 failed (worker_failure); retrying",
        "attempt 3 of 3 failed (worker_failure); no attempts left",
    ]


@pytest.mark.parametrize(
    "executor,validator,reason,runs",
    [
        (
            MockExecutor(result=WorkerResult(success=False)),
            MockValidator(),
            FailureReason.WORKER_FAILURE,
            2,
        ),
        (
            MockExecutor(error=RuntimeError("boom")),
            MockValidator(),
            FailureReason.EXECUTOR_EXCEPTION,
            2,
        ),
        (MockExecutor(result={"invalid": True}), MockValidator(), FailureReason.INVALID_RESULT, 2),
        (MockExecutor(), MockValidator(reject=True), FailureReason.VALIDATION_REJECTED, 2),
        (
            MockExecutor(),
            MockValidator(error=RuntimeError("invalid")),
            FailureReason.VALIDATOR_EXCEPTION,
            1,
        ),
    ],
)
async def test_every_failure_except_a_validator_error_is_retried(executor, validator, reason, runs):
    report = await scheduler(executor, validator).run(plan(task("a", max_attempts=2)))
    assert report.tasks[0].status == TaskStatus.FAILED
    assert report.tasks[0].failure_reason == reason
    assert len(executor.assignments) == len(report.attempts) == runs
    assert all(a.failure_reason == reason for a in report.attempts)
    if runs == 1:
        assert report.transitions[-1].detail == (
            "attempt 1 of 2 failed (validator_exception); "
            "not retried: validator errors are setup problems"
        )


async def test_worker_past_its_timeout_is_stopped_and_fails(caplog):
    caplog.set_level(logging.DEBUG, logger="agentforge")
    executor = GatedExecutor()  # its gate never opens: only the timeout ends the attempt
    engine = scheduler(executor)

    report = await asyncio.wait_for(
        engine.run(plan(task("a", timeout_seconds=0.01), task("b", dependencies=("a",)))), 2
    )

    states, (attempt,) = by_id(report), report.attempts
    assert states["a"].status == TaskStatus.FAILED
    assert states["a"].failure_reason == attempt.failure_reason == FailureReason.WORKER_TIMEOUT
    assert states["a"].message == attempt.message == "worker timed out after 0.01s"
    assert states["b"].status == TaskStatus.BLOCKED
    assert executor.stopped == ["a"]
    assert all(worker.task_id is None for worker in report.workers)
    detail = "attempt 1 of 1 failed (worker_timeout); no attempts left"
    assert detail in [t.detail for t in report.transitions]
    warnings = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    assert warnings == [f"run run task a: {detail}"]


async def test_timed_out_attempt_is_retried():
    executor = GatedExecutor()
    report = await asyncio.wait_for(
        scheduler(executor).run(plan(task("a", timeout_seconds=0.01, max_attempts=2))), 2
    )
    assert [a.failure_reason for a in report.attempts] == [FailureReason.WORKER_TIMEOUT] * 2
    assert executor.stopped == ["a", "a"]


async def test_timeout_error_raised_by_the_worker_is_an_executor_exception():
    executor = MockExecutor(error=TimeoutError("the API was slow"))
    report = await scheduler(executor).run(plan(task("a", timeout_seconds=60)))
    assert report.tasks[0].failure_reason == FailureReason.EXECUTOR_EXCEPTION
    assert report.tasks[0].message == "the API was slow"


async def test_retry_is_logged_without_the_failure_text(caplog):
    caplog.set_level(logging.DEBUG, logger="agentforge")
    await scheduler(FlakyExecutor(message="SECRET-TOKEN")).run(plan(task("a", max_attempts=2)))
    warnings = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    assert warnings == ["run run task a: attempt 1 of 2 failed (worker_failure); retrying"]
    debug = [r.getMessage() for r in caplog.records if r.levelno == logging.DEBUG]
    assert "run run task a: RUNNING (attempt 2, worker worker): worker started" in debug
    assert "run run task a: COMPLETED (attempt 2, worker worker): validation accepted" in debug
    assert "SECRET-TOKEN" not in caplog.text

    await scheduler(FlakyExecutor(message="SECRET-TOKEN")).run(
        plan(task("a"), task("b", dependencies=("a",)))
    )
    assert (
        "run run task b: BLOCKED (attempt 0, worker None): blocked by a, which is FAILED"
        in caplog.messages
    )
    assert "SECRET-TOKEN" not in caplog.text


class GatedExecutor:
    """Holds each task at its own gate and records assignments and stopped workers."""

    def __init__(self, *open_tasks, on_stop=None):
        self.assignments = []
        self.stopped = []
        self.on_stop = on_stop
        self.started = collections.defaultdict(asyncio.Event)
        self.gates = collections.defaultdict(asyncio.Event)
        for name in open_tasks:
            self.gates[name].set()

    async def execute(self, assignment):
        name = assignment.task.id
        self.assignments.append(assignment)
        self.started[name].set()
        try:
            await self.gates[name].wait()
        except asyncio.CancelledError:
            self.stopped.append(name)
            if self.on_stop is not None:
                raise self.on_stop from None
            raise
        return WorkerResult(success=True)


async def loop_turn():
    barrier = asyncio.Event()
    asyncio.get_running_loop().call_soon(barrier.set)
    await barrier.wait()


def by_id(report):
    return {state.task.id: state for state in report.tasks}


async def test_paused_running_task_continues_the_same_attempt_on_resume():
    executor = GatedExecutor("b")
    engine = scheduler(executor)
    running = asyncio.create_task(engine.run(plan(task("a"), task("b", dependencies=("a",)))))
    await asyncio.wait_for(executor.started["a"].wait(), 2)

    await engine.pause_task("a")
    await engine.pause_task("a")
    await loop_turn()

    paused = engine.snapshot()
    assert executor.stopped == ["a"]
    assert not running.done()
    assert by_id(paused)["a"].status == TaskStatus.PAUSED
    assert by_id(paused)["a"].message == "pause_task was called while RUNNING"
    assert by_id(paused)["a"].worker_id is None
    assert by_id(paused)["b"].status == TaskStatus.PENDING
    assert paused.attempts[0].status == TaskStatus.PAUSED
    assert all(worker.task_id is None for worker in paused.workers)

    executor.gates["a"].set()
    await engine.resume_task("a")
    report = await asyncio.wait_for(running, 2)

    assert report.successful
    first, again, _ = executor.assignments
    assert (first.task.id, first.attempt_number, first.resume) == ("a", 1, False)
    assert (again.task.id, again.attempt_number, again.resume) == ("a", 1, True)
    assert first.session_id == again.session_id == report.attempts[0].session_id
    uuid.UUID(first.session_id)
    assert [(a.task_id, a.number) for a in report.attempts] == [("a", 1), ("b", 1)]
    assert [(t.status, t.detail) for t in report.transitions if t.task_id == "a"] == [
        (TaskStatus.PENDING, "queued"),
        (TaskStatus.READY, "no unfinished dependencies"),
        (TaskStatus.ASSIGNED, "attempt 1 of 1 assigned to worker worker"),
        (TaskStatus.RUNNING, "worker started"),
        (TaskStatus.PAUSED, "pause_task was called while RUNNING"),
        (TaskStatus.PENDING, "resume_task was called"),
        (TaskStatus.READY, "no unfinished dependencies"),
        (TaskStatus.ASSIGNED, "attempt 1 of 1 resumed on worker worker"),
        (TaskStatus.RUNNING, "worker resumed"),
        (TaskStatus.VALIDATING, "worker reported success; validating"),
        (TaskStatus.COMPLETED, "validation accepted"),
    ]
    assert by_id(report)["a"].message == ""


async def test_an_attempt_keeps_when_it_started_and_when_it_last_stopped_working():
    executor = GatedExecutor()
    engine = scheduler(executor)
    running = asyncio.create_task(engine.run(plan(task("a"))))
    await asyncio.wait_for(executor.started["a"].wait(), 2)

    working = engine.snapshot().attempts[0]
    assert working.started_at is not None and working.stopped_at is None

    await engine.pause_task("a")
    await loop_turn()
    paused = engine.snapshot().attempts[0]
    assert paused.started_at == working.started_at
    assert paused.stopped_at is not None and paused.stopped_at >= paused.started_at

    await engine.resume_task("a")
    await wait_for(engine, "a", TaskStatus.RUNNING)
    assert engine.snapshot().attempts[0].stopped_at is None  # working again

    executor.gates["a"].set()
    report = await asyncio.wait_for(running, 2)
    done = report.attempts[0]
    assert done.started_at == working.started_at  # a resume continues the same attempt
    assert done.stopped_at >= paused.stopped_at


async def test_an_attempt_stops_its_clock_while_its_diff_waits_for_a_person():
    gate = asyncio.Event()
    engine = scheduler(validator=MockValidator(gate=gate), review_edits=True)
    running = asyncio.create_task(engine.run(plan(edit("a"))))
    await wait_for(engine, "a", TaskStatus.AWAITING_APPROVAL)
    assert engine.snapshot().attempts[0].stopped_at is not None

    await engine.approve_task("a")
    await wait_for(engine, "a", TaskStatus.VALIDATING)
    assert engine.snapshot().attempts[0].stopped_at is None

    gate.set()
    report = await asyncio.wait_for(running, 2)
    assert report.attempts[0].stopped_at is not None


async def test_paused_waiting_task_is_held_and_its_dependents_wait():
    executor = GatedExecutor("b", "c")
    engine = scheduler(executor)
    running = asyncio.create_task(
        engine.run(plan(task("a"), task("b"), task("c", dependencies=("b",))))
    )
    await asyncio.wait_for(executor.started["a"].wait(), 2)

    await engine.pause_task("b")
    executor.gates["a"].set()
    await loop_turn()
    await loop_turn()

    held = by_id(engine.snapshot())
    assert not running.done()
    assert held["a"].status == TaskStatus.COMPLETED
    assert (held["b"].status, held["b"].message) == (
        TaskStatus.PAUSED,
        "pause_task was called while READY",
    )
    assert (held["c"].status, held["c"].blocked_by) == (TaskStatus.PENDING, None)
    assert [a.task.id for a in executor.assignments] == ["a"]

    await engine.resume_task("b")
    report = await asyncio.wait_for(running, 2)

    assert report.successful
    assert [(a.task.id, a.resume) for a in executor.assignments] == [
        ("a", False),
        ("b", False),
        ("c", False),
    ]


async def test_task_paused_during_validation_reruns_only_the_validation():
    gate = asyncio.Event()
    validator = MockValidator(gate=gate)
    executor = MockExecutor()
    engine = scheduler(executor, validator)
    running = asyncio.create_task(engine.run(plan(task("a"))))
    await asyncio.wait_for(validator.started.wait(), 2)

    await engine.pause_task("a")
    assert engine.snapshot().tasks[0].message == "pause_task was called while VALIDATING"
    gate.set()
    await engine.resume_task("a")
    report = await asyncio.wait_for(running, 2)

    assert report.successful
    assert len(executor.assignments) == 1
    assert [t.detail for t in report.transitions][-4:] == [
        "no unfinished dependencies",
        "attempt 1 of 1 resumed on worker worker",
        "validating again after a pause",
        "validation accepted",
    ]


async def test_pause_run_stops_everything_and_resume_run_leaves_tasks_paused_by_hand():
    executor = GatedExecutor()
    engine = scheduler(executor)
    engine.register_worker(AgentConfig(id="front", role="frontend"), executor)
    running = asyncio.create_task(
        engine.run(
            plan(task("a"), task("b", role="frontend"), task("c"), task("d", dependencies=("a",)))
        )
    )
    await asyncio.wait_for(
        asyncio.gather(executor.started["a"].wait(), executor.started["b"].wait()), 2
    )

    await engine.pause_task("c")
    await engine.pause_run()
    await loop_turn()

    paused = engine.snapshot()
    assert not running.done()
    assert sorted(executor.stopped) == ["a", "b"]
    assert {s.task.id: s.message for s in paused.tasks} == {
        "a": "pause_run was called while RUNNING",
        "b": "pause_run was called while RUNNING",
        "c": "pause_task was called while READY",
        "d": "pause_run was called while PENDING",
    }
    assert all(s.status == TaskStatus.PAUSED for s in paused.tasks)
    assert all(worker.task_id is None for worker in paused.workers)

    for name in "abcd":
        executor.gates[name].set()
    await engine.resume_run()
    await asyncio.wait_for(executor.started["d"].wait(), 2)
    await loop_turn()
    await loop_turn()

    resumed = by_id(engine.snapshot())
    assert not running.done()
    assert resumed["c"].status == TaskStatus.PAUSED
    assert [resumed[name].status for name in "abd"] == [TaskStatus.COMPLETED] * 3

    await engine.resume_task("c")
    report = await asyncio.wait_for(running, 2)
    assert report.successful
    assert all(t.detail for t in report.transitions)


async def test_resume_run_leaves_a_task_paused_by_hand_after_pause_run(caplog):
    caplog.set_level(logging.DEBUG, logger="agentforge")
    executor = GatedExecutor()
    engine = scheduler(executor)
    running = asyncio.create_task(engine.run(plan(task("a"))))
    await asyncio.wait_for(executor.started["a"].wait(), 2)

    await engine.pause_run()
    await engine.pause_task("a")
    executor.gates["a"].set()
    await engine.resume_run()
    await loop_turn()
    await loop_turn()

    held = by_id(engine.snapshot())["a"]
    assert not running.done()
    assert held.status == TaskStatus.PAUSED
    assert held.message == "pause_task was called while PAUSED"
    assert (
        "run run task a: PAUSED (attempt 1, worker None): pause_task was called while PAUSED"
        in caplog.messages
    )

    await engine.resume_task("a")
    report = await asyncio.wait_for(running, 2)
    assert report.successful
    assert [t.detail for t in report.transitions if t.status == TaskStatus.PAUSED] == [
        "pause_run was called while RUNNING",
        "pause_task was called while PAUSED",
    ]


async def test_resumed_task_goes_back_to_the_worker_that_started_it():
    executor = GatedExecutor("b")
    engine = scheduler(executor)
    engine.register_worker(AgentConfig(id="aaa", role="backend"), executor)
    # b outranks a, so b takes the lowest-id worker and a starts on the other one.
    running = asyncio.create_task(engine.run(plan(task("a"), task("b", priority=9))))
    await asyncio.wait_for(executor.started["a"].wait(), 2)
    assert [(a.task.id, a.worker.id) for a in executor.assignments] == [
        ("b", "aaa"),
        ("a", "worker"),
    ]

    await engine.pause_task("a")
    executor.gates["a"].set()
    await engine.resume_task("a")
    report = await asyncio.wait_for(running, 2)

    assert report.successful
    assert (executor.assignments[-1].worker.id, executor.assignments[-1].resume) == ("worker", True)


async def test_paused_task_can_be_cancelled_and_then_blocks_its_dependents():
    executor = GatedExecutor()
    engine = scheduler(executor)
    running = asyncio.create_task(engine.run(plan(task("a"), task("b", dependencies=("a",)))))
    await asyncio.wait_for(executor.started["a"].wait(), 2)
    await engine.pause_task("a")
    await engine.cancel_task("a")
    await engine.resume_task("a")
    report = await asyncio.wait_for(running, 2)
    assert {s.task.id: (s.status, s.message) for s in report.tasks} == {
        "a": (TaskStatus.CANCELLED, "cancel_task was called"),
        "b": (TaskStatus.BLOCKED, "blocked by a, which is CANCELLED"),
    }
    assert report.attempts[0].status == TaskStatus.CANCELLED
    assert len(executor.assignments) == 1


async def test_pause_ignores_finished_tasks_and_rejects_unknown_ones():
    engine = scheduler()
    await engine.pause_run()
    await engine.resume_run()
    report = await engine.run(plan(task("a")))
    await engine.pause_task("a")
    await engine.pause_run()
    await engine.resume_task("a")
    assert engine.snapshot() == report
    for command in (engine.pause_task, engine.resume_task):
        with pytest.raises(KeyError):
            await command("missing")


async def test_late_error_from_a_stopped_worker_does_not_fail_a_paused_task():
    executor = GatedExecutor(on_stop=RuntimeError("killed"))
    engine = scheduler(executor)
    running = asyncio.create_task(engine.run(plan(task("a", max_attempts=2))))
    await asyncio.wait_for(executor.started["a"].wait(), 2)
    await engine.pause_task("a")
    await loop_turn()
    paused = engine.snapshot()
    assert paused.tasks[0].status == TaskStatus.PAUSED
    assert (paused.attempts[0].status, paused.attempts[0].failure_reason) == (
        TaskStatus.PAUSED,
        None,
    )
    executor.gates["a"].set()
    await engine.resume_task("a")
    report = await asyncio.wait_for(running, 2)
    assert report.successful and len(report.attempts) == 1


async def test_resume_while_the_paused_worker_is_still_stopping_does_not_cancel_the_task():
    started, cleaning, release, gate = (asyncio.Event() for _ in range(4))
    assignments = []

    class SlowToStop:
        async def execute(self, assignment):
            assignments.append(assignment)
            started.set()
            try:
                await gate.wait()
            except asyncio.CancelledError:
                cleaning.set()
                await release.wait()  # like waiting for a killed process to exit
                raise
            return WorkerResult(success=True)

    engine = scheduler(SlowToStop())
    running = asyncio.create_task(engine.run(plan(task("a"))))
    await asyncio.wait_for(started.wait(), 2)
    pausing = asyncio.create_task(engine.pause_task("a"))
    await asyncio.wait_for(cleaning.wait(), 2)

    await engine.resume_task("a")
    gate.set()
    release.set()
    await asyncio.wait_for(pausing, 2)
    report = await asyncio.wait_for(running, 2)

    assert report.tasks[0].status == TaskStatus.COMPLETED, report.tasks[0].message
    assert [a.resume for a in assignments] == [False, True]
    assert len(report.attempts) == 1


async def run_until_a_waits_for_its_retry():
    """A run stopped where task a has failed once and waits, READY, for its retry.

    h outranks the retry and holds the only backend worker until its gate opens.
    """
    executor = GatedExecutor("g")
    fail_once = FlakyExecutor()

    class Executor:
        async def execute(self, assignment):
            await executor.execute(assignment)
            return await fail_once.execute(assignment)

    validating = asyncio.Event()
    validator = MockValidator(gate=validating)
    engine = scheduler(Executor(), validator)
    engine.register_worker(AgentConfig(id="front", role="frontend"), Executor())
    running = asyncio.create_task(
        engine.run(
            plan(
                task("a", max_attempts=2),
                task("g", role="frontend"),
                task("h", dependencies=("g",), priority=5),
            )
        )
    )
    await asyncio.wait_for(
        asyncio.gather(executor.started["a"].wait(), validator.started.wait()), 2
    )
    validating.set()
    executor.gates["a"].set()
    await asyncio.wait_for(executor.started["h"].wait(), 2)
    waiting = by_id(engine.snapshot())["a"]
    assert (waiting.status, waiting.attempt_number) == (TaskStatus.READY, 1)
    return engine, running, executor, fail_once


async def test_cancelling_a_task_waiting_for_its_retry_keeps_the_failed_attempt():
    engine, running, executor, _ = await run_until_a_waits_for_its_retry()

    await engine.cancel_task("a")
    executor.gates["h"].set()
    report = await asyncio.wait_for(running, 2)

    assert by_id(report)["a"].status == TaskStatus.CANCELLED
    (attempt,) = (a for a in report.attempts if a.task_id == "a")
    assert (attempt.status, attempt.failure_reason, attempt.message) == (
        TaskStatus.FAILED,
        FailureReason.WORKER_FAILURE,
        "flaky",
    )
    assert all(worker.task_id is None for worker in report.workers)


async def test_task_paused_while_waiting_for_its_retry_starts_a_new_attempt_on_resume():
    engine, running, executor, fail_once = await run_until_a_waits_for_its_retry()

    await engine.pause_task("a")
    executor.gates["h"].set()
    await engine.resume_task("a")
    report = await asyncio.wait_for(running, 2)

    assert report.successful
    retried = [a for a in fail_once.assignments if a.task.id == "a"]
    assert [(a.attempt_number, a.resume, a.previous_failure) for a in retried] == [
        (1, False, ""),
        (2, False, "flaky"),
    ]
    first, second = (a for a in report.attempts if a.task_id == "a")
    assert (first.status, second.status) == (TaskStatus.FAILED, TaskStatus.COMPLETED)
    assert first.session_id != second.session_id


async def test_pause_and_resume_are_logged(caplog):
    caplog.set_level(logging.DEBUG, logger="agentforge")
    executor = GatedExecutor()
    engine = scheduler(executor)
    running = asyncio.create_task(engine.run(plan(task("a"))))
    await asyncio.wait_for(executor.started["a"].wait(), 2)
    await engine.pause_task("a")
    executor.gates["a"].set()
    await engine.resume_task("a")
    await asyncio.wait_for(running, 2)
    for line in (
        "run run task a: PAUSED (attempt 1, worker None): pause_task was called while RUNNING",
        "run run task a: PENDING (attempt 1, worker None): resume_task was called",
        "run run task a: RUNNING (attempt 1, worker worker): worker resumed",
    ):
        assert line in caplog.messages


def edit(task_id, **kwargs):
    return task(task_id, allowed_operations=("edit",), **kwargs)


async def wait_for(engine, task_id, status):
    """Turn the loop until the task reaches `status`; a barrier, not a sleep."""
    for _ in range(100):
        state = by_id(engine.snapshot()).get(task_id)
        if state is not None and state.status == status:
            return
        await loop_turn()
    raise AssertionError(f"{task_id} never reached {status}")


async def test_edit_task_waits_for_a_person_to_approve_its_diff(caplog):
    caplog.set_level(logging.DEBUG, logger="agentforge")
    validator = MockValidator()
    engine = scheduler(validator=validator, review_edits=True)
    running = asyncio.create_task(engine.run(plan(edit("a"), task("b", dependencies=("a",)))))
    await wait_for(engine, "a", TaskStatus.AWAITING_APPROVAL)

    waiting = engine.snapshot()
    assert waiting.transitions[-1].detail == (
        "worker reported success; waiting for a person to approve the diff"
    )
    assert all(worker.task_id is None for worker in waiting.workers)  # nobody is held up
    assert not validator.started.is_set() and not running.done()

    await engine.approve_task("a")
    report = await asyncio.wait_for(running, 2)

    assert report.successful
    details = [(t.task_id, t.status, t.detail) for t in report.transitions]
    assert ("a", TaskStatus.PENDING, "approve_task was called") in details
    assert ("a", TaskStatus.VALIDATING, "the diff was approved; validating") in details
    assert len([a for a in report.attempts if a.task_id == "a"]) == 1  # approval adds no attempt
    assert (
        "run run task a: AWAITING_APPROVAL (attempt 1, worker None): "
        "worker reported success; waiting for a person to approve the diff" in caplog.messages
    )


async def test_rejected_diff_is_retried_with_the_reason_as_feedback(caplog):
    caplog.set_level(logging.DEBUG, logger="agentforge")
    executor = MockExecutor()
    engine = scheduler(executor, review_edits=True)
    running = asyncio.create_task(engine.run(plan(edit("a", max_attempts=2))))
    await wait_for(engine, "a", TaskStatus.AWAITING_APPROVAL)

    await engine.reject_task("a", "SECRET-REASON: rename the helper")
    await loop_turn()
    await wait_for(engine, "a", TaskStatus.AWAITING_APPROVAL)
    await engine.approve_task("a")
    report = await asyncio.wait_for(running, 2)

    assert report.successful
    first, second = report.attempts
    assert first.failure_reason == FailureReason.REVIEW_REJECTED
    assert first.message == "SECRET-REASON: rename the helper"
    assert executor.assignments[1].previous_failure == "SECRET-REASON: rename the helper"
    warnings = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    assert warnings == ["run run task a: attempt 1 of 2 failed (review_rejected); retrying"]
    assert "SECRET-REASON" not in caplog.text


async def test_rejected_diff_without_attempts_left_fails_and_blocks_dependents():
    engine = scheduler(review_edits=True)
    running = asyncio.create_task(engine.run(plan(edit("a"), task("b", dependencies=("a",)))))
    await wait_for(engine, "a", TaskStatus.AWAITING_APPROVAL)

    await engine.reject_task("a", "wrong file")
    report = await asyncio.wait_for(running, 2)

    states = by_id(report)
    assert states["a"].status == TaskStatus.FAILED
    assert states["a"].failure_reason == FailureReason.REVIEW_REJECTED
    assert states["b"].status == TaskStatus.BLOCKED


async def test_a_pause_never_skips_the_approval():
    validator = MockValidator()
    engine = scheduler(validator=validator, review_edits=True)
    running = asyncio.create_task(engine.run(plan(edit("a"))))
    await wait_for(engine, "a", TaskStatus.AWAITING_APPROVAL)

    await engine.pause_run()
    await engine.pause_task("a")
    await engine.resume_run()
    await engine.resume_task("a")
    await loop_turn()
    await loop_turn()

    assert by_id(engine.snapshot())["a"].status == TaskStatus.AWAITING_APPROVAL
    assert not validator.started.is_set()
    await engine.cancel_task("a")
    report = await asyncio.wait_for(running, 2)
    assert by_id(report)["a"].status == TaskStatus.CANCELLED


async def test_read_only_tasks_never_wait_and_approval_is_refused_when_not_waiting():
    engine = scheduler(review_edits=True)
    report = await engine.run(plan(task("a")))
    assert report.successful
    assert TaskStatus.AWAITING_APPROVAL not in {t.status for t in report.transitions}

    with pytest.raises(ValueError, match="is not waiting for approval"):
        await engine.approve_task("a")
    with pytest.raises(ValueError, match="is not waiting for approval"):
        await engine.reject_task("a", "no")
    with pytest.raises(KeyError):
        await engine.approve_task("nope")


async def test_a_failed_task_is_retried_by_hand_while_the_run_goes_on():
    gated = GatedExecutor()

    class FailsOnce:
        def __init__(self):
            self.assignments = []

        async def execute(self, assignment):
            self.assignments.append(assignment)
            if assignment.task.id == "a":
                return WorkerResult(success=assignment.attempt_number > 1, message="broken")
            return await gated.execute(assignment)

    executor = FailsOnce()
    engine = Scheduler(validator=MockValidator())
    engine.register_worker(AgentConfig(id="w1", role="backend"), executor)
    engine.register_worker(AgentConfig(id="w2", role="backend"), executor)
    running = asyncio.create_task(
        engine.run(plan(task("a"), task("b", dependencies=("a",)), task("c")))
    )
    await wait_for(engine, "b", TaskStatus.BLOCKED)

    await engine.retry_task("a")
    await wait_for(engine, "b", TaskStatus.RUNNING)
    gated.gates["b"].set()
    gated.gates["c"].set()
    report = await asyncio.wait_for(running, 2)

    assert report.successful
    states = by_id(report)
    assert states["a"].task.max_attempts == 2 and states["a"].attempt_number == 2
    (second_a,) = [a for a in executor.assignments if a.task.id == "a" and a.attempt_number == 2]
    assert second_a.previous_failure == "broken"
    details = [(t.task_id, t.status, t.detail) for t in report.transitions]
    assert ("a", TaskStatus.PENDING, "retry was called; attempt limit is 2") in details
    assert ("b", TaskStatus.PENDING, "unblocked: retry was called on a") in details


async def test_retry_is_refused_for_a_task_that_did_not_fail_and_at_the_cap(caplog):
    engine = scheduler()
    await engine.run(plan(task("a")))
    with pytest.raises(ValueError, match="only a failed or cancelled task can be retried"):
        await engine.retry_task("a")
    with pytest.raises(KeyError):
        await engine.retry_task("nope")

    capped = scheduler(MockExecutor(result=WorkerResult(success=False)))
    report = await capped.run(plan(task("a", max_attempts=5)))
    assert by_id(report)["a"].status == TaskStatus.FAILED
    with pytest.raises(ValueError, match="already used the maximum of 5 attempts"):
        await capped.retry_task("a")
    warnings = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    assert (
        "run run task a: retry refused: task a has already used the maximum of 5 attempts"
        in warnings
    )


async def test_retrying_one_failed_dependency_keeps_its_dependent_blocked_by_the_other(caplog):
    # c needs a and b; both fail; retrying a alone must not leave c waiting on failed b forever.
    caplog.set_level(logging.DEBUG, logger="agentforge.orchestration")
    failed, both_failed = set(), asyncio.Event()

    def seen(_run_id, transition):
        if transition.status == TaskStatus.FAILED:
            failed.add(transition.task_id)
            if failed >= {"a", "b"}:
                both_failed.set()

    class Executor:
        def __init__(self):
            self.gate = asyncio.Event()  # keeps the run active until the retry is made
            self.fixed = False

        async def execute(self, assignment):
            if assignment.task.id == "d":
                await self.gate.wait()
            elif assignment.task.id == "b" or not self.fixed:
                return WorkerResult(success=False, message="failed")
            return WorkerResult(success=True)

    executor = Executor()
    engine = scheduler(executor, on_transition=seen)
    engine.register_worker(AgentConfig(id="tester", role="qa"), executor)
    running = asyncio.create_task(
        engine.run(
            plan(task("a"), task("b"), task("c", dependencies=("a", "b")), task("d", role="qa"))
        )
    )
    await asyncio.wait_for(both_failed.wait(), 2)
    executor.fixed = True
    await engine.retry_task("a")
    executor.gate.set()
    report = await asyncio.wait_for(running, 2)

    states = {t.task.id: t for t in report.tasks}
    assert states["a"].status == TaskStatus.COMPLETED
    assert (states["c"].status, states["c"].blocked_by) == (TaskStatus.BLOCKED, "b")
    assert states["c"].message == "blocked by b, which is FAILED"
    details = [t.detail for t in report.transitions if t.task_id == "c"]
    assert details[-2:] == ["unblocked: retry was called on a", "blocked by b, which is FAILED"]
    assert "task c: BLOCKED (attempt 0, worker None): blocked by b, which is FAILED" in caplog.text
