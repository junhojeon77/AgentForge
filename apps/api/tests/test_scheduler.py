import asyncio

import pytest
from pydantic import ValidationError

from agentforge.domain import (
    AgentConfig,
    FailureReason,
    RunPlan,
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
    assert all(worker.task_id is not None for worker in engine.snapshot().workers)
    gate.set()
    report = await asyncio.wait_for(running, 2)
    assert report.successful
    assert len(report.attempts) == 5
    assert all(worker.task_id is None for worker in report.workers)


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
