"""Single-event-loop scheduler with atomic, non-awaiting state transitions."""

import asyncio
import logging
import uuid
from collections.abc import Iterable
from typing import Protocol

from pydantic import ValidationError

from agentforge.domain import (
    TERMINAL,
    AgentConfig,
    Assignment,
    FailureReason,
    RunPlan,
    RunReport,
    TaskAttempt,
    TaskSpec,
    TaskState,
    TaskStatus,
    Transition,
    ValidationReport,
    WorkerResult,
    WorkerState,
)

logger = logging.getLogger(__name__)


class WorkerExecutor(Protocol):
    async def execute(self, assignment: Assignment) -> WorkerResult: ...


class ResultValidator(Protocol):
    async def validate(self, task: TaskSpec, result: WorkerResult) -> ValidationReport: ...


class Scheduler:
    """Run fixed DAGs sequentially; use all public methods on the same event loop.

    State mutation contains no awaits, so reservations and terminal decisions are
    atomic with respect to other coroutines. Executors/validators must cooperate
    with asyncio cancellation. This is not a process or thread scheduler.
    """

    def __init__(self, *, validator: ResultValidator, max_concurrency: int = 5):
        if type(max_concurrency) is not int or not 1 <= max_concurrency <= 5:
            raise ValueError("max_concurrency must be an integer from 1 to 5")
        self._validator = validator
        self._cap = max_concurrency
        self._workers: dict[str, WorkerState] = {}
        self._executors: dict[str, WorkerExecutor] = {}
        self._states: dict[str, TaskState] = {}
        self._dependents: dict[str, list[str]] = {}
        # Keyed by (task id, attempt number); insertion order is dispatch order.
        self._attempts: dict[tuple[str, int], TaskAttempt] = {}
        self._transitions: list[Transition] = []
        self._active: dict[str, asyncio.Task[None]] = {}
        # Tasks paused by pause_run, so resume_run leaves alone what pause_task paused.
        self._run_paused: set[str] = set()
        self._running = False
        self._run_id: str | None = None
        self._wake = asyncio.Event()

    def register_worker(self, agent: AgentConfig, executor: WorkerExecutor) -> None:
        if self._running:
            raise ValueError("workers cannot be registered during a run")
        agent = AgentConfig.model_validate(agent)
        if agent.id in self._workers:
            raise ValueError(f"duplicate worker: {agent.id}")
        self._workers[agent.id] = WorkerState(agent=agent)
        self._executors[agent.id] = executor

    def snapshot(self) -> RunReport:
        return RunReport(
            run_id=self._run_id,
            tasks=tuple(self._states[key] for key in sorted(self._states)),
            workers=tuple(self._workers[key] for key in sorted(self._workers)),
            attempts=tuple(self._attempts.values()),
            transitions=tuple(self._transitions),
        )

    def _validate_plan(self, plan: RunPlan) -> tuple[RunPlan, dict[str, list[str]]]:
        plan = RunPlan.model_validate(plan)
        tasks = {task.id: task for task in plan.tasks}
        if len(tasks) != len(plan.tasks):
            raise ValueError("duplicate task ID")
        roles = {worker.agent.role for worker in self._workers.values()}
        for task in tasks.values():
            if task.run_id != plan.id:
                raise ValueError(f"inconsistent run ID: {task.id}")
            if task.role not in roles:
                raise ValueError(f"no worker registered for role: {task.role}")
            if any(dependency not in tasks for dependency in task.dependencies):
                raise ValueError(f"missing dependency: {task.id}")
        # Kahn's algorithm avoids recursion limits on large valid chains.
        remaining = {key: set(task.dependencies) for key, task in tasks.items()}
        ready = [key for key, dependencies in remaining.items() if not dependencies]
        dependents: dict[str, list[str]] = {key: [] for key in tasks}
        for key, dependencies in remaining.items():
            for dependency in dependencies:
                dependents[dependency].append(key)
        visited = 0
        while ready:
            key = ready.pop()
            visited += 1
            for dependent in dependents[key]:
                remaining[dependent].remove(key)
                if not remaining[dependent]:
                    ready.append(dependent)
        if visited != len(tasks):
            raise ValueError("cyclic task dependencies")
        return plan, dependents

    async def run(self, plan: RunPlan) -> RunReport:
        if self._running or self._active:
            raise ValueError("a run is already active")
        plan, self._dependents = self._validate_plan(plan)
        self._running = True
        self._run_id = plan.id
        self._states = {task.id: TaskState(task=task) for task in plan.tasks}
        self._attempts = {}
        self._transitions = []
        self._run_paused = set()
        self._wake = asyncio.Event()
        for task in plan.tasks:
            self._record(task.id, TaskStatus.PENDING, "queued")
        try:
            while True:
                self._wake.clear()
                self._dispatch()
                if not self._active and all(s.status in TERMINAL for s in self._states.values()):
                    return self.snapshot()
                await self._wake.wait()
        except BaseException as error:
            # The type name only: the reason is logged, and an exception's text can hold anything.
            why = f"run() stopped by {type(error).__name__}"
            # Shielded so a repeated caller cancellation cannot interrupt worker cleanup.
            await asyncio.shield(self._cancel_all(why))
            raise
        finally:
            self._running = False

    def _record(self, task_id: str, status: TaskStatus, detail: str = "") -> None:
        self._transitions.append(
            Transition(
                sequence=len(self._transitions) + 1, task_id=task_id, status=status, detail=detail
            )
        )
        state = self._states[task_id]
        logger.debug(
            "run %s task %s: %s (attempt %d, worker %s): %s",
            self._run_id, task_id, status, state.attempt_number, state.worker_id, detail,
        )  # fmt: skip

    def _transition(self, task_id: str, status: TaskStatus, *, detail: str = "", **changes) -> bool:
        state = self._states[task_id]
        if state.status in TERMINAL:
            return False
        state = state.model_copy(update={"status": status, **changes})
        self._states[task_id] = state
        key = (task_id, state.attempt_number)
        # A failed attempt keeps its record when the task is cancelled while awaiting its retry.
        if key in self._attempts and self._attempts[key].status not in TERMINAL:
            self._attempts[key] = self._attempts[key].model_copy(
                update={
                    "status": status,
                    "failure_reason": changes.get("failure_reason"),
                    "message": changes.get("message", ""),
                }
            )
        self._record(task_id, status, detail)
        return True

    def _dispatch(self) -> None:
        for task_id, state in self._states.items():
            if state.status == TaskStatus.PENDING and all(
                self._states[dependency].status == TaskStatus.COMPLETED
                for dependency in state.task.dependencies
            ):
                self._transition(task_id, TaskStatus.READY, detail="no unfinished dependencies")
        candidates = sorted(
            (s for s in self._states.values() if s.status == TaskStatus.READY),
            key=lambda s: (-s.task.priority, s.task.id),
        )
        for state in candidates:
            if len(self._active) >= self._cap:
                break
            task_id = state.task.id
            if task_id in self._active:  # paused and resumed while its worker is still stopping
                continue
            number = state.attempt_number
            attempt = self._attempts.get((task_id, number))
            # An unfinished attempt was stopped by a pause: continue it instead of starting
            # another, and on the worker whose model and persona the session started with.
            resume = attempt is not None and attempt.status not in TERMINAL
            workers = sorted(
                (
                    w
                    for w in self._workers.values()
                    if w.task_id is None
                    and w.agent.role == state.task.role
                    and (not resume or w.agent.id == attempt.worker_id)
                ),
                key=lambda w: w.agent.id,
            )
            if not workers:
                continue
            worker = workers[0]
            self._workers[worker.agent.id] = worker.model_copy(update={"task_id": task_id})
            if not resume:
                number += 1
                attempt = TaskAttempt(
                    task_id=task_id,
                    worker_id=worker.agent.id,
                    number=number,
                    session_id=str(uuid.uuid4()),
                )
                self._attempts[task_id, number] = attempt
            previous_failure = self._attempts[task_id, number - 1].message if number > 1 else ""
            limit = state.task.max_attempts
            verb = "resumed on" if resume else "assigned to"
            self._transition(
                task_id,
                TaskStatus.ASSIGNED,
                detail=f"attempt {number} of {limit} {verb} worker {worker.agent.id}",
                worker_id=worker.agent.id,
                attempt_number=number,
            )
            assignment = Assignment(
                task=state.task,
                worker=worker.agent,
                attempt_number=number,
                previous_failure=previous_failure,
                session_id=attempt.session_id,
                resume=resume,
            )
            self._active[task_id] = asyncio.create_task(
                self._execute(assignment), name=f"agentforge:{self._run_id}:{task_id}"
            )

    async def _execute(self, assignment: Assignment) -> None:
        task_id, worker_id = assignment.task.id, assignment.worker.id
        attempt = (task_id, assignment.attempt_number)
        try:
            # A result already on the attempt means the pause came during validation: the
            # worker is done, so only the validation runs again.
            result = self._attempts[attempt].result
            detail = "validating again after a pause"
            if result is None:
                started = "worker resumed" if assignment.resume else "worker started"
                if not self._transition(task_id, TaskStatus.RUNNING, detail=started):
                    return
                try:
                    raw_result = await self._executors[worker_id].execute(assignment)
                except Exception as error:
                    self._fail(task_id, FailureReason.EXECUTOR_EXCEPTION, str(error))
                    return
                if self._states[task_id].status != TaskStatus.RUNNING:  # cancelled or paused
                    return
                try:
                    result = WorkerResult.model_validate(raw_result)
                except (ValidationError, TypeError, ValueError):
                    self._fail(task_id, FailureReason.INVALID_RESULT, "invalid worker result")
                    return
                self._attempts[attempt] = self._attempts[attempt].model_copy(
                    update={"result": result}
                )
                if not result.success:
                    self._fail(task_id, FailureReason.WORKER_FAILURE, result.message)
                    return
                detail = "worker reported success; validating"
            if not self._transition(task_id, TaskStatus.VALIDATING, detail=detail):
                return
            try:
                raw_validation = await self._validator.validate(assignment.task, result)
                validation = ValidationReport.model_validate(raw_validation)
            except Exception as error:
                self._fail(task_id, FailureReason.VALIDATOR_EXCEPTION, str(error))
                return
            if self._states[task_id].status != TaskStatus.VALIDATING:  # cancelled or paused
                return
            self._attempts[attempt] = self._attempts[attempt].model_copy(
                update={"validation": validation}
            )
            if validation.accepted:
                self._transition(task_id, TaskStatus.COMPLETED, detail="validation accepted")
            else:
                self._fail(task_id, FailureReason.VALIDATION_REJECTED, "; ".join(validation.issues))
        except asyncio.CancelledError:
            # After cancel_task or cancel_run the task is already terminal and this is a no-op.
            # A paused task was stopped on purpose and must stay paused.
            if self._states[task_id].status != TaskStatus.PAUSED:
                self._cancel(task_id, "worker task was cancelled")
            raise
        finally:
            # Still mid-flight here means a BaseException bypassed the handlers above. A task
            # already requeued for a retry is READY and must be left alone.
            status = self._states[task_id].status
            if status in (TaskStatus.RUNNING, TaskStatus.VALIDATING):
                reason = (
                    FailureReason.VALIDATOR_EXCEPTION
                    if status == TaskStatus.VALIDATING
                    else FailureReason.EXECUTOR_EXCEPTION
                )
                self._fail(task_id, reason, "worker stopped unexpectedly")
            self._workers[worker_id] = self._workers[worker_id].model_copy(update={"task_id": None})
            self._active.pop(task_id, None)
            self._wake.set()

    def _fail(self, task_id: str, reason: FailureReason, message: str) -> None:
        state = self._states[task_id]
        # Only work in flight can fail: a late error from a worker that was stopped by a pause
        # or a cancellation changes nothing.
        if state.status not in (TaskStatus.RUNNING, TaskStatus.VALIDATING):
            return
        number, limit = state.attempt_number, state.task.max_attempts
        # A validator that cannot run is a setup problem; a rerun would bill the worker again.
        retry = number < limit and reason != FailureReason.VALIDATOR_EXCEPTION
        if retry:
            outcome = "retrying"
        elif number < limit:
            outcome = "not retried: validator errors are setup problems"
        else:
            outcome = "no attempts left"
        detail = f"attempt {number} of {limit} failed ({reason}); {outcome}"
        # The reason only: the message can hold check output, which stays in the report.
        logger.warning("run %s task %s: %s", self._run_id, task_id, detail)
        if retry:
            self._attempts[task_id, number] = self._attempts[task_id, number].model_copy(
                update={"status": TaskStatus.FAILED, "failure_reason": reason, "message": message}
            )
            # READY, not FAILED: FAILED is terminal and would block the task's descendants.
            self._states[task_id] = state.model_copy(
                update={"status": TaskStatus.READY, "worker_id": None}
            )
            self._record(task_id, TaskStatus.READY, detail)
        elif self._transition(
            task_id, TaskStatus.FAILED, detail=detail, failure_reason=reason, message=message
        ):
            self._block_descendants(task_id)

    def _block_descendants(self, origin: str) -> None:
        why = f"blocked by {origin}, which is {self._states[origin].status}"
        queue = [origin]
        while queue:
            for task_id in self._dependents[queue.pop()]:
                if self._transition(
                    task_id, TaskStatus.BLOCKED, detail=why, message=why, blocked_by=origin
                ):
                    queue.append(task_id)

    def _cancel(self, task_id: str, why: str) -> None:
        if self._transition(task_id, TaskStatus.CANCELLED, detail=why, message=why):
            self._block_descendants(task_id)

    async def cancel_task(self, task_id: str) -> None:
        if task_id not in self._states:
            raise KeyError(task_id)
        self._cancel(task_id, "cancel_task was called")
        await self._stop([task_id])

    async def _stop(self, task_ids: Iterable[str]) -> None:
        """Stop these tasks' workers and wait for their cleanup."""
        active = [
            (task_id, self._active[task_id]) for task_id in task_ids if task_id in self._active
        ]
        for _, future in active:
            if not future.cancelling():
                future.cancel()
        if active:
            await asyncio.gather(*(future for _, future in active), return_exceptions=True)
            for task_id, future in active:
                # A coroutine cancelled before its first step does not run finally.
                self._release_unstarted(task_id, future)
        self._wake.set()

    def _release_unstarted(self, task_id: str, future: asyncio.Task[None]) -> None:
        if self._active.get(task_id) is not future:
            return
        self._active.pop(task_id)
        # From the attempt, not the task state: a paused task's state no longer names a worker.
        worker_id = self._attempts[task_id, self._states[task_id].attempt_number].worker_id
        self._workers[worker_id] = self._workers[worker_id].model_copy(update={"task_id": None})

    async def cancel_run(self) -> None:
        await self._cancel_all("cancel_run was called")

    async def _cancel_all(self, why: str) -> None:
        for task_id in self._states:
            self._transition(task_id, TaskStatus.CANCELLED, detail=why, message=why)
        await self._stop(tuple(self._active))

    def _hold(self, task_ids: Iterable[str], why: str) -> list[str]:
        """Mark these unfinished tasks PAUSED; returns the ones that changed."""
        held = []
        for task_id in task_ids:
            before = self._states[task_id].status
            if before in TERMINAL or before == TaskStatus.PAUSED:
                continue
            detail = f"{why} while {before}"
            self._transition(
                task_id, TaskStatus.PAUSED, detail=detail, message=detail, worker_id=None
            )
            held.append(task_id)
        return held

    def _paused(self, task_ids: Iterable[str]) -> list[str]:
        return [t for t in task_ids if self._states[t].status == TaskStatus.PAUSED]

    async def pause_task(self, task_id: str) -> None:
        """Hold a task. A running worker is stopped; resume continues the same attempt."""
        if task_id not in self._states:
            raise KeyError(task_id)
        self._hold([task_id], "pause_task was called")
        # Also when it was paused already: a repeated pause waits for the same cleanup.
        await self._stop(self._paused([task_id]))

    async def pause_run(self) -> None:
        """Hold every unfinished task. `run()` keeps waiting until they are resumed."""
        self._run_paused.update(self._hold(tuple(self._states), "pause_run was called"))
        await self._stop(self._paused(self._states))

    def _release(self, task_ids: Iterable[str], why: str) -> None:
        for task_id in task_ids:
            self._run_paused.discard(task_id)
            if self._states[task_id].status == TaskStatus.PAUSED:
                # PENDING, so dispatch checks the dependencies again like any waiting task.
                self._transition(task_id, TaskStatus.PENDING, detail=why, message="")
        self._wake.set()

    async def resume_task(self, task_id: str) -> None:
        if task_id not in self._states:
            raise KeyError(task_id)
        self._release([task_id], "resume_task was called")

    async def resume_run(self) -> None:
        """Resume what pause_run paused; a task paused by pause_task stays paused."""
        self._release(sorted(self._run_paused), "resume_run was called")
