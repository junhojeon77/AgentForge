import asyncio
import contextlib
import logging
import pathlib
import subprocess
import sys

import pytest
import sqlalchemy
from alembic import command
from alembic.config import Config
from sqlalchemy.exc import OperationalError
from test_scheduler import GatedExecutor, by_id, loop_turn, plan, task, wait_for

from agentforge.domain import AgentConfig, PlanRound, Proposal, TaskStatus, WorkerResult
from agentforge.mocks import MockExecutor, MockValidator
from agentforge.orchestration import Scheduler
from agentforge.store import RunStore

CRASH = pathlib.Path(__file__).parent / "crash_run.py"


def scheduler(store, executor=None):
    engine = Scheduler(validator=MockValidator(), store=store)
    engine.register_worker(AgentConfig(id="worker", role="backend"), executor or MockExecutor())
    return engine


def crash_mid_run(path):
    """Run crash_run.py until task b is running and saved, then kill it like a crash."""
    crashed = subprocess.Popen(
        [sys.executable, str(CRASH), str(path)], stdout=subprocess.PIPE, text=True
    )
    try:
        assert crashed.stdout.readline().strip() == "b started"
    finally:
        crashed.kill()
        crashed.wait()
        crashed.stdout.close()


def test_migrations_create_the_tables_and_downgrade_to_nothing(tmp_path, caplog):
    caplog.set_level(logging.DEBUG, logger="agentforge")
    path = tmp_path / "runs.db"
    RunStore(path)
    engine = sqlalchemy.create_engine(f"sqlite:///{path}")
    tables = {"alembic_version", "runs", "tasks", "attempts", "transitions", "proposals"}
    assert set(sqlalchemy.inspect(engine).get_table_names()) == tables
    assert f"run store opened: {path} (schema 0002)" in caplog.messages

    config = Config()
    config.set_main_option("script_location", "agentforge:migrations")
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.downgrade(config, "base")
    assert set(sqlalchemy.inspect(engine).get_table_names()) == {"alembic_version"}
    RunStore(path)  # upgrading again works
    assert set(sqlalchemy.inspect(engine).get_table_names()) == tables
    engine.dispose()


async def test_saved_run_loads_back_equal_to_the_report(tmp_path):
    path = tmp_path / "runs.db"
    saved_plan = plan(task("a", max_attempts=2), task("b", dependencies=("a",)))
    report = await scheduler(RunStore(path)).run(saved_plan)

    loaded_plan, loaded = RunStore(path).load("run")

    assert loaded_plan == saved_plan
    assert loaded == report.model_copy(update={"workers": ()})
    assert RunStore(path).load("other") is None


async def test_a_run_id_is_saved_once_and_unfinished_runs_are_listed(tmp_path):
    store = RunStore(tmp_path / "runs.db")
    await scheduler(store).run(plan(task("a")))
    with pytest.raises(ValueError, match="run run is already saved"):
        await scheduler(store).run(plan(task("a")))
    assert store.unfinished_runs() == []


def test_run_killed_mid_task_is_recovered_paused_and_continues_the_same_attempt(tmp_path, caplog):
    caplog.set_level(logging.DEBUG, logger="agentforge")
    path = tmp_path / "runs.db"
    crash_mid_run(path)
    assert RunStore(path).unfinished_runs() == ["run"]

    async def recover_and_resume():
        executor = GatedExecutor()
        engine = scheduler(RunStore(path), executor)
        recovering = asyncio.create_task(engine.recover("run"))
        await loop_turn()
        await loop_turn()

        held = by_id(engine.snapshot())
        assert held["a"].status == TaskStatus.COMPLETED
        assert held["b"].status == TaskStatus.PAUSED
        assert held["b"].message == "recovered after a restart while RUNNING"
        assert held["c"].status == TaskStatus.PENDING
        assert executor.assignments == []  # nothing billed until a person resumes

        executor.gates["b"].set()
        executor.gates["c"].set()
        await engine.resume_run()
        report = await asyncio.wait_for(recovering, 5)
        return executor, report

    executor, report = asyncio.run(recover_and_resume())

    assert report.successful
    resumed, fresh = executor.assignments
    (saved_b,) = [a for a in report.attempts if a.task_id == "b"]
    assert resumed.task.id == "b" and resumed.resume and resumed.attempt_number == 1
    assert resumed.session_id == saved_b.session_id
    assert fresh.task.id == "c" and not fresh.resume
    sequences = [t.sequence for t in report.transitions]
    assert sequences == list(range(1, len(sequences) + 1))
    assert RunStore(path).load("run")[1] == report.model_copy(update={"workers": ()})
    assert RunStore(path).unfinished_runs() == []
    assert (
        "run run task b: PAUSED (attempt 1, worker None): recovered after a restart while RUNNING"
        in caplog.messages
    )


def test_recover_needs_the_worker_that_started_the_attempt(tmp_path, caplog):
    path = tmp_path / "runs.db"
    crash_mid_run(path)
    engine = Scheduler(validator=MockValidator(), store=RunStore(path))
    engine.register_worker(AgentConfig(id="someone-else", role="backend"), MockExecutor())

    with pytest.raises(ValueError, match="needs worker worker, which is not registered"):
        asyncio.run(engine.recover("run"))

    warnings = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    assert warnings == [
        "run run: recovery refused: run run needs worker worker, which is not registered"
    ]


async def test_recover_refuses_unknown_finished_and_active_runs(tmp_path):
    store = RunStore(tmp_path / "runs.db")
    with pytest.raises(ValueError, match="needs a store"):
        await Scheduler(validator=MockValidator()).recover("run")
    executor = GatedExecutor()
    engine = scheduler(store, executor)
    with pytest.raises(ValueError, match="run nope is not saved"):
        await engine.recover("nope")

    running = asyncio.create_task(engine.run(plan(task("a"))))
    await loop_turn()
    with pytest.raises(ValueError, match="a run is already active"):
        await engine.recover("run")
    executor.gates["a"].set()
    await asyncio.wait_for(running, 2)

    with pytest.raises(ValueError, match="run run has finished"):
        await engine.recover("run")


class FailingStore(RunStore):
    """Fails to save the first transition to `status`, like a full or locked disk."""

    def __init__(self, path, status):
        super().__init__(path)
        self.status = status

    def save(self, run_id, state, attempt, transition):
        if transition.status == self.status:
            raise OperationalError("INSERT", {}, Exception("disk I/O error SECRET-TOKEN"))
        super().save(run_id, state, attempt, transition)


async def test_run_that_cannot_be_saved_is_stopped(tmp_path, caplog):
    caplog.set_level(logging.DEBUG, logger="agentforge")
    executor = GatedExecutor()  # never opens: the run must stop on its own
    engine = scheduler(FailingStore(tmp_path / "runs.db", TaskStatus.RUNNING), executor)

    with pytest.raises(OperationalError):
        await asyncio.wait_for(engine.run(plan(task("a"), task("b", dependencies=("a",)))), 2)

    states = by_id(engine.snapshot())
    assert executor.stopped == ["a"]
    assert {s.status for s in states.values()} == {TaskStatus.CANCELLED}
    assert states["a"].message == "saving the run failed (OperationalError)"
    warnings = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    assert warnings == ["run run: saving the run failed (OperationalError); stopping the run"]
    assert "SECRET-TOKEN" not in caplog.text


class FrozenStore(RunStore):
    """Stops saving once frozen, like a process that died."""

    frozen = False

    def save(self, run_id, state, attempt, transition):
        if not self.frozen:
            super().save(run_id, state, attempt, transition)


async def test_a_diff_waiting_for_approval_still_waits_after_a_restart(tmp_path):
    path = tmp_path / "runs.db"
    store = FrozenStore(path)
    first = Scheduler(validator=MockValidator(), store=store, review_edits=True)
    first.register_worker(AgentConfig(id="worker", role="backend"), MockExecutor())
    running = asyncio.create_task(first.run(plan(task("a", allowed_operations=("edit",)))))
    await wait_for(first, "a", TaskStatus.AWAITING_APPROVAL)
    store.frozen = True
    running.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await running

    second = Scheduler(validator=MockValidator(), store=RunStore(path), review_edits=True)
    second.register_worker(AgentConfig(id="worker", role="backend"), MockExecutor())
    recovering = asyncio.create_task(second.recover("run"))
    await wait_for(second, "a", TaskStatus.AWAITING_APPROVAL)
    await second.approve_task("a")
    report = await asyncio.wait_for(recovering, 2)

    assert report.successful
    assert len(report.attempts) == 1  # the approved diff was validated, not redone


async def test_a_finished_run_is_reopened_to_retry_a_failed_task(tmp_path, caplog):
    path = tmp_path / "runs.db"
    failing = scheduler(RunStore(path), MockExecutor(result=WorkerResult(success=False)))
    failed = await failing.run(plan(task("a"), task("b", dependencies=("a",))))
    assert [s.status for s in failed.tasks] == [TaskStatus.FAILED, TaskStatus.BLOCKED]

    fixed = scheduler(RunStore(path))
    report = await fixed.recover("run", retry=["a"])

    assert report.successful
    assert by_id(report)["a"].attempt_number == 2
    details = [(t.task_id, t.detail) for t in report.transitions]
    assert ("a", "retry was called; attempt limit is 2") in details
    assert ("b", "unblocked: retry was called on a") in details
    with pytest.raises(ValueError, match="run run has no task nope"):
        await fixed.recover("run", retry=["nope"])
    with pytest.raises(ValueError, match="only a failed or cancelled task can be retried"):
        await fixed.recover("run", retry=["a"])
    warnings = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    assert any(w.startswith("run run task a: retry refused: task a is COMPLETED") for w in warnings)


def proposal(run_id="r1", **changes):
    values = {"id": run_id, "plan": plan_for(run_id), "source": "hand"}
    return Proposal(**(values | changes))


def plan_for(run_id):
    from agentforge.domain import RunPlan, TaskSpec

    return RunPlan(id=run_id, tasks=(TaskSpec(id="a", run_id=run_id, title="a", role="backend"),))


def test_a_plan_waits_as_a_proposal_until_a_person_decides(tmp_path, caplog):
    caplog.set_level(logging.DEBUG, logger="agentforge")
    store = RunStore(tmp_path / "runs.db")
    rounds = (PlanRound(revision=0, source="critique", issues=("SECRET-ISSUE",)),)
    store.propose(proposal(source="lead", rounds=rounds))

    saved = RunStore(tmp_path / "runs.db").get_proposal("r1")
    assert saved.status == "pending" and saved.source == "lead" and saved.rounds == rounds
    assert store.get_proposal("nope") is None

    approved_plan = plan_for("r1")
    agents = (AgentConfig(id="designer", role="design", persona="edited by a person"),)
    decided = store.decide_proposal("r1", "approved", plan=approved_plan, agents=agents)
    assert decided.status == "approved" and decided.plan == approved_plan
    assert store.get_proposal("r1").agents == agents
    with pytest.raises(ValueError, match="proposal r1 is approved, not pending"):
        store.decide_proposal("r1", "rejected", reason="too late")
    assert "proposal r1 saved (lead)" in caplog.messages
    assert "proposal r1 approved" in caplog.messages
    assert "SECRET-ISSUE" not in caplog.text


def test_a_rejected_proposal_keeps_its_reason_and_ids_are_used_once(tmp_path, caplog):
    caplog.set_level(logging.DEBUG, logger="agentforge")
    store = RunStore(tmp_path / "runs.db")
    store.propose(proposal())
    rejected = store.decide_proposal("r1", "rejected", reason="SECRET-REASON: split task a")
    assert rejected.reason == "SECRET-REASON: split task a"
    with pytest.raises(ValueError, match="proposal r1 already exists"):
        store.propose(proposal())
    store.start_run(plan_for("r2"))
    with pytest.raises(ValueError, match="run r2 is already saved"):
        store.propose(proposal("r2"))
    with pytest.raises(ValueError, match="no proposal nope"):
        store.decide_proposal("nope", "approved", plan=plan_for("nope"))
    assert "SECRET-REASON" not in caplog.text


def test_runs_and_proposals_are_listed_newest_first(tmp_path):
    store = RunStore(tmp_path / "runs.db")
    assert store.runs() == [] and store.proposals() == []
    for run_id in ("b", "c", "a"):  # not alphabetical, so the order must come from saving
        store.start_run(plan_for(run_id))
        store.propose(proposal(f"p-{run_id}"))
    store.decide_proposal("p-c", "rejected", reason="no")

    assert store.runs() == ["a", "c", "b"]
    proposals = RunStore(tmp_path / "runs.db").proposals()
    assert [p.id for p in proposals] == ["p-a", "p-c", "p-b"]
    assert proposals[1].status == "rejected" and proposals[1].reason == "no"
