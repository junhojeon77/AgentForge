"""Immutable application contracts."""

from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt

Identifier = Annotated[str, Field(min_length=1, pattern=r"\S")]


class Contract(BaseModel):
    # Revalidation rejects instances built with model_construct or otherwise bypassing checks.
    model_config = ConfigDict(frozen=True, extra="forbid", revalidate_instances="always")


class TaskStatus(StrEnum):
    PENDING = "PENDING"
    READY = "READY"
    ASSIGNED = "ASSIGNED"
    RUNNING = "RUNNING"
    VALIDATING = "VALIDATING"
    COMPLETED = "COMPLETED"
    PAUSED = "PAUSED"
    BLOCKED = "BLOCKED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


TERMINAL = frozenset(
    {TaskStatus.COMPLETED, TaskStatus.BLOCKED, TaskStatus.FAILED, TaskStatus.CANCELLED}
)


class FailureReason(StrEnum):
    WORKER_FAILURE = "worker_failure"
    EXECUTOR_EXCEPTION = "executor_exception"
    INVALID_RESULT = "invalid_result"
    VALIDATION_REJECTED = "validation_rejected"
    VALIDATOR_EXCEPTION = "validator_exception"


class AgentConfig(Contract):
    id: Identifier
    role: Identifier
    model: str | None = None  # None: the runtime's default model
    reasoning: Literal["low", "medium", "high", "xhigh", "max"] = "medium"
    permissions: tuple[str, ...] = ()
    # Sent as a CLI argument; the cap keeps it far below Windows' 32,767-character command line.
    persona: str = Field("", max_length=10_000)


class TaskSpec(Contract):
    id: Identifier
    run_id: Identifier
    title: Identifier
    role: Identifier
    description: str = ""
    objective: str = ""
    priority: StrictInt = 0
    dependencies: tuple[Identifier, ...] = ()
    repository_reference: str = ""
    base_commit: str = ""
    workspace_reference: str | None = None
    acceptance_criteria: tuple[str, ...] = ()
    allowed_operations: tuple[str, ...] = ()
    execution_constraints: tuple[str, ...] = ()
    expected_output: tuple[str, ...] = ()


class RunPlan(Contract):
    id: Identifier
    tasks: tuple[TaskSpec, ...] = ()


class WorkerResult(Contract):
    success: bool = Field(strict=True)
    message: str = ""
    artifacts: tuple[str, ...] = ()
    passed_checks: tuple[str, ...] = ()
    satisfied_criteria: tuple[str, ...] = ()
    # Set by executors, never by the model.
    session_id: str | None = None
    workspace: str | None = None  # the folder the work happened in, e.g. the task's worktree
    diff: str = ""


class ValidationReport(Contract):
    accepted: bool = Field(strict=True)
    issues: tuple[str, ...] = ()


class Assignment(Contract):
    task: TaskSpec
    worker: AgentConfig
    attempt_number: int = 1


class TaskState(Contract):
    task: TaskSpec
    status: TaskStatus = TaskStatus.PENDING
    worker_id: str | None = None
    failure_reason: FailureReason | None = None
    message: str = ""
    blocked_by: str | None = None


class WorkerState(Contract):
    agent: AgentConfig
    task_id: str | None = None


class TaskAttempt(Contract):
    task_id: str
    worker_id: str
    number: int = 1
    status: TaskStatus = TaskStatus.ASSIGNED
    result: WorkerResult | None = None
    validation: ValidationReport | None = None
    failure_reason: FailureReason | None = None


class Transition(Contract):
    sequence: int
    task_id: str
    status: TaskStatus


class RunReport(Contract):
    run_id: str | None
    tasks: tuple[TaskState, ...] = ()
    workers: tuple[WorkerState, ...] = ()
    attempts: tuple[TaskAttempt, ...] = ()
    transitions: tuple[Transition, ...] = ()

    @property
    def successful(self) -> bool:
        return all(task.status == TaskStatus.COMPLETED for task in self.tasks)
