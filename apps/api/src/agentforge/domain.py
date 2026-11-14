"""Immutable application contracts."""

from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt

# Ids, roles and titles are printed in logs and transition reasons, so a control character or
# line separator in one could forge a log line. At least one character must not be a space.
_UNSAFE = r"\x00-\x1f\x7f-\x9f  "
Identifier = Annotated[
    str, Field(min_length=1, pattern=rf"^[^{_UNSAFE}]*[^\s{_UNSAFE}][^{_UNSAFE}]*$")
]


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
    WORKER_TIMEOUT = "worker_timeout"
    INVALID_RESULT = "invalid_result"
    VALIDATION_REJECTED = "validation_rejected"
    VALIDATOR_EXCEPTION = "validator_exception"


class AgentConfig(Contract):
    id: Identifier
    role: Identifier
    model: str | None = None  # None: the runtime's default model
    reasoning: Literal["low", "medium", "high", "xhigh", "max"] = "medium"
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
    # Capped because every attempt of a Claude Code task is billed.
    max_attempts: int = Field(1, ge=1, le=5, strict=True)
    # Per attempt, for the worker only; None: no limit. Checks have their own timeout.
    timeout_seconds: float | None = Field(None, gt=0, strict=True, allow_inf_nan=False)


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
    previous_failure: str = ""  # why the last attempt failed; empty on the first
    # Chosen by the scheduler, so an attempt stopped by a pause can still be continued.
    session_id: str | None = None
    resume: bool = False  # continue this attempt's interrupted work instead of starting it


class TaskState(Contract):
    task: TaskSpec
    status: TaskStatus = TaskStatus.PENDING
    worker_id: str | None = None
    failure_reason: FailureReason | None = None
    message: str = ""
    blocked_by: str | None = None
    attempt_number: int = 0  # the latest attempt started; 0 before the first


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
    message: str = ""
    session_id: str | None = None


class Transition(Contract):
    sequence: int
    task_id: str
    status: TaskStatus
    detail: str = ""  # why, when the status alone does not say: the retry decision


class RunReport(Contract):
    run_id: str | None
    tasks: tuple[TaskState, ...] = ()
    workers: tuple[WorkerState, ...] = ()
    attempts: tuple[TaskAttempt, ...] = ()
    transitions: tuple[Transition, ...] = ()

    @property
    def successful(self) -> bool:
        return all(task.status == TaskStatus.COMPLETED for task in self.tasks)
