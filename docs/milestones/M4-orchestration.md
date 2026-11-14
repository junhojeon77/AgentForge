# M4 — Retries, pause/resume, persistence and the lead agent

M4 is built in four parts. Only the first is implemented.

| Part | Status |
|---|---|
| Retries | Implemented (this document) |
| Pause/resume | Planned |
| Persistence and recovery | Planned |
| Lead orchestration | Planned |

## Delivered behavior: retries

A task can ask for more than one attempt. When an attempt fails, the task is run again from a
clean start, and the new worker is told why the last attempt failed.

1. `TaskSpec.max_attempts` sets the limit: 1 to 5, default 1. With the default nothing changes.
2. A failed attempt with attempts left sends the task back to `READY`. It is dispatched again by
   the normal rules: priority, then id, on the lowest-id idle worker of its role.
3. The next `Assignment` carries `attempt_number` and `previous_failure`, the failed attempt's
   message. The Claude Code worker gets it in its prompt, marked as data, not instructions.
4. `WorktreeExecutor` gives every attempt its own worktree, so a retry starts from the base
   commit, not from the failed attempt's edits. Each attempt uses a new Claude session.
5. The task becomes `FAILED`, and blocks the tasks that depend on it, only when its attempts run
   out.

No new dependency was added.

## Contract

| Item | Behavior |
|---|---|
| `TaskSpec.max_attempts` | Strict integer 1–5, default 1. The cap bounds billed reruns |
| `Assignment.attempt_number` | 1 for the first attempt, then 2, 3, … |
| `Assignment.previous_failure` | The previous attempt's failure message; empty on the first attempt |
| `TaskState.attempt_number` | The latest attempt started; 0 before the first |
| `TaskAttempt.message` | Why this attempt failed; empty when it did not |
| `Transition.detail` | The retry decision, on the transition that follows a failed attempt |
| `RunReport.attempts` | Every attempt of every task, in dispatch order |
| `WorktreeExecutor` path | `root/<run_id>/<task_id>/<attempt>` (was `root/<run_id>/<task_id>` in M3) |

Which failures are retried:

| Failure | Retried |
|---|---|
| `WORKER_FAILURE`, `INVALID_RESULT`, `VALIDATION_REJECTED`, `EXECUTOR_EXCEPTION` | Yes, while attempts remain |
| `VALIDATOR_EXCEPTION` | No. A check that cannot start is a setup problem, and a rerun would bill the worker again |
| Cancellation | No. A task cancelled while it waits for its retry stays cancelled, and the failed attempt keeps its record |

A task that passes on its second attempt goes through
`PENDING, READY, ASSIGNED, RUNNING, VALIDATING, READY, ASSIGNED, RUNNING, VALIDATING, COMPLETED`.
The task itself never shows `FAILED` between attempts; the failed attempt does.

## How to debug a run

The report answers these after the run, with no logging set up:

| Question | Where the answer is |
|---|---|
| Why did attempt N fail? | `TaskAttempt.failure_reason` and `TaskAttempt.message`: the worker's message, the exception text, or the failed checks with the last 2,000 characters of their output |
| Was it retried, and why or why not? | `Transition.detail` on the transition after the failure: `attempt 1 of 3 failed (validation_rejected); retrying`, `attempt 3 of 3 failed (validation_rejected); no attempts left`, or `attempt 1 of 2 failed (validator_exception); not retried: validator errors are setup problems` |
| Where did attempt N run, and what did it change? | `TaskAttempt.result.workspace`, `.diff` and `.session_id` |
| What was the worker told on the retry? | `Assignment.previous_failure`, which equals the failed attempt's `message` |
| Why is the task in its final state? | `TaskState.failure_reason`, `message`, `blocked_by` and `attempt_number` |

The log follows a run as it happens. AgentForge uses the standard `logging` module and installs
no handler, so nothing is printed until you ask:

```python
import logging

logging.basicConfig(level=logging.DEBUG)
```

| Logger | Level | Event |
|---|---|---|
| `agentforge.orchestration` | DEBUG | Every transition: run, task, status, attempt number and worker |
| `agentforge.orchestration` | WARNING | A failed attempt, with the same text as `Transition.detail` |
| `agentforge.worktrees` | DEBUG | A worktree created (path and commit); a diff recorded (length only) |
| `agentforge.claude_code` | DEBUG | A Claude process started (task, attempt, session id, folder, tools) and finished (exit code, result subtype) |
| `agentforge.validation` | DEBUG | Each check: name, folder, and exit code or timeout |

Logs hold ids, statuses, reasons, paths and exit codes only. They never hold the prompt, the
persona, a diff, check output or a failure message, because those can contain secrets. Read
those in the report.

## Limits

- **A retry redoes the work.** It starts from the base commit with a new session, so it costs
  about as much as the first attempt. Each attempt has its own `max_budget_usd` cap.
- **No delay between attempts.** A failure caused by a rate limit is retried at once.
- **The failure text is untrusted.** Check output comes from code the worker wrote. It is passed
  to the next worker labelled as data, but a label is not a guarantee.
- **Failed attempts' worktrees are kept.** Nothing removes them automatically.
- An `"edit"` task run without `WorktreeExecutor` still edits `workspace_reference` in place, so
  its retry sees the failed attempt's edits.
- Retries have been tested only against the fake CLI and mock workers. No live call was made.

## Not implemented yet

| Deferred | Waits for |
|---|---|
| Pause/resume, including resuming a Claude session with `--resume` | M4, next part |
| Saving runs and recovering after a restart | M4, persistence part |
| The lead agent that turns a request into a `RunPlan` | M4, last part |
| A delay or backoff between attempts | When a real rate-limit failure shows the need |
| A manual "retry this task" command | M5, with the REST commands |
| A per-task timeout for the worker | Later runtime work |
| Removing worktrees automatically | M4 (recovery) |

## Acceptance checks

Run the pytest and Ruff commands in the root README. The retry tests cover:

- `test_scheduler.py`: a pass on the second attempt with the failure passed on, attempts running
  out and blocking descendants, each failure reason retried or not, cancelling a task that waits
  for its retry, the `Transition.detail` texts, and the log lines without the failure text.
- `test_contracts.py`: the bounds of `max_attempts`.
- `test_claude_code.py`: the retry prompt.
- `test_worktrees.py`: a full run in which a real check fails once and the second attempt runs
  in a fresh worktree, is told the check output and passes, with the check output kept out of
  the log.
