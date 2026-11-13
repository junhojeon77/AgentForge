# M1 — Domain Models and Task Scheduler

## Delivered behavior

M1 is a Python library under `apps/api/src/agentforge`. It validates a fixed task dependency graph,
dispatches eligible tasks to compatible mock workers, independently validates returned evidence, and
returns an immutable report. Each scheduler executes one run at a time; sequential runs reset task
state and history while retaining registered workers.

Five defaults are provided by `register_default_workers`: backend, frontend, database, QA, and
integration. Roles are arbitrary nonempty strings. Multiple workers can share a role, and the lead
orchestrator is not registered as a worker. Model names, reasoning levels, permissions, repository
references, and workspace references are descriptive configuration only.

## Public contracts

All Pydantic contracts reject unknown fields, are frozen, and revalidate model instances (including
ones built with `model_construct`). Collections are tuples. Reports and snapshots are freshly built
frozen objects, so callers cannot change scheduler state through them.

`TaskSpec` contains `id`, `run_id`, `title`, `description`, `objective`, `role`, numeric `priority`,
`dependencies`, `repository_reference`, `base_commit`, optional `workspace_reference`,
`acceptance_criteria`, `allowed_operations`, `execution_constraints`, and `expected_output`.
The current status and worker ownership live separately in `TaskState`. IDs, title, and role must
contain a non-whitespace character. Descriptive fields default to empty strings/tuples; workspace
defaults to unassigned. Priorities are strict integers, with larger values dispatched first.

`RunPlan(id, tasks)` supplies the complete fixed graph. Before dispatch, the scheduler checks unique
task IDs, matching run IDs, existing dependency references, an acyclic graph, and compatible registered
roles. A rejected plan dispatches nothing and leaves the previous report intact.

| Interface | Contract |
|---|---|
| `Scheduler(validator=..., max_concurrency=5)` | Concurrency is an integer from 1 through 5 |
| `register_worker(agent, executor)` | Unique agent ID; registration is forbidden during a run |
| `await run(plan)` | Returns `RunReport`; overlapping invocations raise `ValueError` |
| `await cancel_task(task_id)` | Cancels unfinished work and awaits cleanup; unknown IDs raise `KeyError` |
| `await cancel_run()` | Cancels unfinished work and awaits cleanup; safe before/after a run |
| `snapshot()` | Copied tasks, worker availability, attempts, and transition history |
| `WorkerExecutor.execute(assignment)` | Async protocol returning a `WorkerResult` |
| `ResultValidator.validate(task, result)` | Async protocol returning a `ValidationReport` |

Executors receive an immutable `Assignment` containing the task, worker, and attempt number.
`WorkerResult` records success, message, artifact references, passed checks, and satisfied criteria.
`ValidationReport` records acceptance and explanatory issues. An invalid worker result is a failure;
invalid validator output is a validator failure. Exceptions become task failures while independent
work continues. An error outside `Exception` (a bare `BaseException` subclass) still fails the task
as an executor or validator exception instead of leaving it running. Task failure does not raise
from `run`; graph/contract errors do.

`RunReport.successful` is true only when every task completed, including an empty successful plan.
Each attempt stores its result, validation, final status, and failure reason. Transitions have a
monotonic sequence number within a run; snapshots list tasks/workers in ID order and attempts in
dispatch order.

## Scheduling and validation

Tasks follow `PENDING → READY → ASSIGNED → RUNNING → VALIDATING → COMPLETED`. Dependencies become
eligible only after completion, including validation. Ready tasks sort by descending priority and
ascending task ID; compatible idle workers sort by ascending worker ID. A busy role does not block
another role. Each worker remains reserved during validation, and the global concurrency cap is
independent of the number of registered workers.

The scheduler is designed for one asyncio event loop, with synchronous state mutations between
awaits. Task/worker reservation and terminal decisions are atomic within that loop. Dispatch is
deterministic for the same observed state; wall-clock completion order is not deterministic.

`MockValidator` independently requires every `expected_output` reference in result artifacts, every
acceptance criterion in satisfied criteria, and every constraint written as `check:<name>` in passed
checks. Other constraints remain descriptive. These are string-evidence checks only: no files or
test commands are inspected or executed. A worker's success flag alone never completes a task.

Failures distinguish worker-reported failure, executor exception, invalid worker result, validation
rejection, and validator exception. Failed/cancelled tasks recursively block descendants; `blocked_by`
records the originating task. The first blocking origin wins. Independent branches continue. Each
task has at most one attempt per run; no automatic or manual retry is exposed.

## Cancellation and lifecycle limits

Cancelling a pending task creates no attempt. Cancelling assigned/running/validating work first
records cancellation, then requests asyncio cancellation and awaits cleanup before returning. Its
descendants become blocked. Run cancellation stops future dispatch and cancels unfinished tasks,
preserving existing terminal outcomes. The first terminal transition wins, so late success cannot
overwrite cancellation. Repeated cancellation awaits ongoing cleanup without cancelling it again.
Cancelling the coroutine running `run` also awaits worker cleanup before propagating cancellation.
Cancelling it again stops `run` from waiting but does not interrupt that cleanup, and a new `run` is
refused with `ValueError` until the cleanup finishes.

Executors and validators must cooperate with asyncio cancellation. Cleanup that never finishes can
keep cancellation waiting; forced process termination and timeouts are future runtime concerns. Use
all scheduler methods from the same event loop, not arbitrary threads. Worker reservations are
released on every completed cleanup path, including cancellation before a coroutine starts.

`PAUSED` is reserved in the enum. Pause/resume, retries, reactivation of blocked tasks, durable
checkpoints, and restart recovery belong to M4. Duplicate prevention applies within a live run;
reusing a plan in a later run executes it again. There are no restart or exactly-once guarantees.

## Acceptance checks

Run the pytest and Ruff commands in the root README. Tests cover:

- Contract validation, immutable snapshots, role flexibility, and duplicate registrations.
- Duplicate task IDs, inconsistent runs, missing dependencies, self-cycles, and multi-task cycles.
- Five simultaneous workers, reduced concurrency, same-role serialization, ordering, and worker reuse.
- Chains and diamond graphs with validation-gated dependencies and no duplicate dispatch.
- Failed/malformed results (including `model_construct` bypasses), exceptions, non-`Exception`
  errors, rejected evidence, worker release, and independent branches.
- Pending/executing/validating cancellation, cancellation before a task coroutine starts, repeated
  cleanup, cancellation races, and single and repeated caller cancellation.
- Worker reassignment during cancellation cleanup, complete transition history, and empty plans.
- A smoke test of the `python -m agentforge` demonstration.

The executable `python -m agentforge` demonstrates all five workers concurrently with validated mock
evidence. No real commands, model calls, repository writes, SQLite database, FastAPI server, LangGraph
runtime, desktop UI, or production security sandbox is included.
