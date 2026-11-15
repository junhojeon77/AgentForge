import asyncio
import logging
import pathlib
import subprocess
import sys

import pytest
import sqlalchemy
from alembic import command
from alembic.config import Config
from sqlalchemy.exc import OperationalError
from test_scheduler import GatedExecutor, by_id, loop_turn, plan, task

from agentforge.domain import AgentConfig, TaskStatus
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
    tables = {"alembic_version", "runs", "tasks", "attempts", "transitions"}
    assert set(sqlalchemy.inspect(engine).get_table_names()) == tables
    assert f"run store opened: {path} (schema 0001)" in caplog.messages

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
