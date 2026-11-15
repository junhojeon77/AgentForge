"""Saved runs: SQLite through SQLAlchemy, with the schema kept by Alembic migrations.

Each row holds a frozen contract as JSON, checked again with Pydantic on load, so the contracts in
`domain.py` stay the one definition of a run. Transitions also get their own columns, because they
are what a reader lists and filters. The database holds everything the run report holds, diffs
and failure messages included, so it can hold secrets.
"""

import logging
from datetime import UTC, datetime
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from sqlalchemy import (
    Column,
    ForeignKey,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    create_engine,
    func,
    select,
)
from sqlalchemy.dialects.sqlite import insert

from agentforge.domain import (
    TERMINAL,
    RunPlan,
    RunReport,
    TaskAttempt,
    TaskState,
    Transition,
)
from agentforge.personas import default_folder

logger = logging.getLogger(__name__)

METADATA = MetaData()
RUNS = Table(
    "runs",
    METADATA,
    Column("id", String, primary_key=True),
    Column("plan", Text, nullable=False),
    Column("created_at", String, nullable=False),
    Column("updated_at", String, nullable=False),
)
TASKS = Table(
    "tasks",
    METADATA,
    Column("run_id", String, ForeignKey("runs.id"), primary_key=True),
    Column("task_id", String, primary_key=True),
    Column("status", String, nullable=False),
    Column("state", Text, nullable=False),
)
ATTEMPTS = Table(
    "attempts",
    METADATA,
    Column("run_id", String, ForeignKey("runs.id"), primary_key=True),
    Column("task_id", String, primary_key=True),
    Column("number", Integer, primary_key=True),
    Column("position", Integer, nullable=False),  # dispatch order, as in RunReport.attempts
    Column("attempt", Text, nullable=False),
)
TRANSITIONS = Table(
    "transitions",
    METADATA,
    Column("run_id", String, ForeignKey("runs.id"), primary_key=True),
    Column("sequence", Integer, primary_key=True),
    Column("task_id", String, nullable=False),
    Column("status", String, nullable=False),
    Column("detail", Text, nullable=False),
)


def default_path() -> Path:
    return default_folder().parent / "runs.db"


def _now() -> str:
    return datetime.now(UTC).isoformat()


class RunStore:
    """Saves runs to the SQLite file at `path`; opening it migrates the schema to the latest."""

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._engine = create_engine(f"sqlite:///{self.path}")
        config = Config()
        config.set_main_option("script_location", "agentforge:migrations")
        with self._engine.begin() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
            version = MigrationContext.configure(connection).get_current_revision()
        logger.debug("run store opened: %s (schema %s)", self.path, version)

    def start_run(self, plan: RunPlan) -> None:
        with self._engine.begin() as connection:
            if connection.scalar(select(RUNS.c.id).where(RUNS.c.id == plan.id)) is not None:
                raise ValueError(f"run {plan.id} is already saved; recover it or use a new run id")
            now = _now()
            connection.execute(
                RUNS.insert().values(
                    id=plan.id, plan=plan.model_dump_json(), created_at=now, updated_at=now
                )
            )

    def save(
        self,
        run_id: str,
        state: TaskState,
        attempt: TaskAttempt | None,
        transition: Transition,
    ) -> None:
        """Save one transition with the task's state and latest attempt, all or nothing."""
        with self._engine.begin() as connection:
            row = {"run_id": run_id, "task_id": state.task.id}
            values = {"status": state.status, "state": state.model_dump_json()}
            connection.execute(
                insert(TASKS)
                .values(**row, **values)
                .on_conflict_do_update(index_elements=["run_id", "task_id"], set_=values)
            )
            if attempt is not None:
                position = (
                    select(func.count())
                    .select_from(ATTEMPTS)
                    .where(ATTEMPTS.c.run_id == run_id)
                    .scalar_subquery()
                )
                connection.execute(
                    insert(ATTEMPTS)
                    .values(
                        **row,
                        number=attempt.number,
                        position=position,
                        attempt=attempt.model_dump_json(),
                    )
                    .on_conflict_do_update(
                        index_elements=["run_id", "task_id", "number"],
                        set_={"attempt": attempt.model_dump_json()},
                    )
                )
            connection.execute(
                TRANSITIONS.insert().values(
                    run_id=run_id,
                    sequence=transition.sequence,
                    task_id=transition.task_id,
                    status=transition.status,
                    detail=transition.detail,
                )
            )
            connection.execute(RUNS.update().where(RUNS.c.id == run_id).values(updated_at=_now()))

    def load(self, run_id: str) -> tuple[RunPlan, RunReport] | None:
        """The saved plan and report (without workers, which are not saved); None if unknown."""
        with self._engine.connect() as connection:
            plan = connection.scalar(select(RUNS.c.plan).where(RUNS.c.id == run_id))
            if plan is None:
                return None
            tasks = connection.scalars(
                select(TASKS.c.state).where(TASKS.c.run_id == run_id).order_by(TASKS.c.task_id)
            )
            attempts = connection.scalars(
                select(ATTEMPTS.c.attempt)
                .where(ATTEMPTS.c.run_id == run_id)
                .order_by(ATTEMPTS.c.position)
            )
            transitions = connection.execute(
                select(TRANSITIONS)
                .where(TRANSITIONS.c.run_id == run_id)
                .order_by(TRANSITIONS.c.sequence)
            )
            report = RunReport(
                run_id=run_id,
                tasks=tuple(TaskState.model_validate_json(state) for state in tasks),
                attempts=tuple(TaskAttempt.model_validate_json(a) for a in attempts),
                transitions=tuple(
                    Transition(
                        sequence=t.sequence, task_id=t.task_id, status=t.status, detail=t.detail
                    )
                    for t in transitions
                ),
            )
        return RunPlan.model_validate_json(plan), report

    def unfinished_runs(self) -> list[str]:
        """Ids of saved runs with a task that is not finished, oldest first."""
        with self._engine.connect() as connection:
            return list(
                connection.scalars(
                    select(RUNS.c.id)
                    .join(TASKS, TASKS.c.run_id == RUNS.c.id)
                    .where(TASKS.c.status.not_in([str(status) for status in TERMINAL]))
                    .group_by(RUNS.c.id)
                    .order_by(func.min(RUNS.c.created_at), RUNS.c.id)
                )
            )
