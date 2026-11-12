"""Controllable test doubles. Evidence is descriptive, never actual verification."""

import asyncio

from agentforge.domain import AgentConfig, Assignment, TaskSpec, ValidationReport, WorkerResult
from agentforge.orchestration import Scheduler

DEFAULT_ROLES = ("backend", "frontend", "database", "qa", "integration")


class MockExecutor:
    def __init__(
        self,
        *,
        result=None,
        error: Exception | None = None,
        gate: asyncio.Event | None = None,
        expected_starts: int = 1,
    ):
        self.result = WorkerResult(success=True) if result is None else result
        self.error = error
        self.gate = gate
        self.expected_starts = expected_starts
        self.assignments: list[Assignment] = []
        self.started = asyncio.Event()
        self.finished = asyncio.Event()

    async def execute(self, assignment: Assignment) -> WorkerResult:
        self.assignments.append(assignment)
        if len(self.assignments) >= self.expected_starts:
            self.started.set()
        try:
            if self.gate is not None:
                await self.gate.wait()
            if self.error is not None:
                raise self.error
            return self.result
        finally:
            self.finished.set()


class MockValidator:
    def __init__(
        self,
        *,
        reject: bool = False,
        error: Exception | None = None,
        gate: asyncio.Event | None = None,
    ):
        self.reject = reject
        self.error = error
        self.gate = gate
        self.started = asyncio.Event()

    async def validate(self, task: TaskSpec, result: WorkerResult) -> ValidationReport:
        self.started.set()
        if self.gate is not None:
            await self.gate.wait()
        if self.error is not None:
            raise self.error
        required_checks = {
            c.removeprefix("check:") for c in task.execution_constraints if c.startswith("check:")
        }
        issues = []
        if self.reject:
            issues.append("mock validation rejected")
        if not set(task.expected_output) <= set(result.artifacts):
            issues.append("missing required artifacts")
        if not required_checks <= set(result.passed_checks):
            issues.append("missing required checks")
        if not set(task.acceptance_criteria) <= set(result.satisfied_criteria):
            issues.append("unsatisfied acceptance criteria")
        return ValidationReport(accepted=not issues, issues=tuple(issues))


def register_default_workers(scheduler: Scheduler, executor: MockExecutor | None = None) -> None:
    for role in DEFAULT_ROLES:
        scheduler.register_worker(
            AgentConfig(
                id=role, role=role, reasoning="high" if role in {"qa", "integration"} else "medium"
            ),
            executor if executor is not None else MockExecutor(),
        )
