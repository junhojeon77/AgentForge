# M4 — Retries, pause/resume, persistence and the lead agent

M4 is built in four parts. The first two are implemented.

| Part | Status |
|---|---|
| Retries | Implemented (this document) |
| Pause/resume | Implemented (this document) |
| Persistence and recovery | Planned |
| Lead orchestration | Planned |

No new dependency was added for either part.

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

Which failures are retried:

| Failure | Retried |
|---|---|
| `WORKER_FAILURE`, `INVALID_RESULT`, `VALIDATION_REJECTED`, `EXECUTOR_EXCEPTION`, `WORKER_TIMEOUT` | Yes, while attempts remain |
| `VALIDATOR_EXCEPTION` | No. A check that cannot start is a setup problem, and a rerun would bill the worker again |
| Cancellation | No. A task cancelled while it waits for its retry stays cancelled, and the failed attempt keeps its record |

A task that passes on its second attempt goes through
`PENDING, READY, ASSIGNED, RUNNING, VALIDATING, READY, ASSIGNED, RUNNING, VALIDATING, COMPLETED`.
The task itself never shows `FAILED` between attempts; the failed attempt does.

## Delivered behavior: pause and resume

You can hold one task or the whole run, and later continue where it stopped.

| Command | Behavior |
|---|---|
| `await pause_task(task_id)` | Holds the task as `PAUSED`. Unknown ids raise `KeyError`; a finished or already paused task is left as it is, except that a task `pause_run` paused becomes paused by hand, so `resume_run` no longer resumes it |
| `await resume_task(task_id)` | Puts a paused task back in the queue |
| `await pause_run()` | Pauses every unfinished task |
| `await resume_run()` | Resumes the tasks that `pause_run` paused. A task you paused with `pause_task`, before or after `pause_run`, stays paused until `resume_task` |

What a pause does depends on where the task is:

- **Not started** (`PENDING` or `READY`, including a task waiting for its retry): it is held and
  not dispatched. Resume puts it back in the queue; a retry still starts as a new attempt.
- **Running:** the worker is stopped at once. For Claude Code the CLI process is killed. The
  worker is freed for other tasks, and the attempt, its worktree and its session id are kept.
  Resume continues **the same attempt**: same number, same worktree, same Claude session
  (`claude --resume <session id>`), on the same worker. It does not use up a retry.
- **Validating:** the running check is killed. Resume runs the checks again on the result the
  worker already returned; the worker is not called again.

`PAUSED` is not a final state. Tasks that depend on a paused task wait; they are not blocked.
`run()` does not return while any task is paused. A paused task can be cancelled.

If Claude Code has no saved session to resume (the pause came before it wrote anything), the
worker starts one fresh session in the same folder and is told that files from the interrupted
run may already be there. Any other failure of the resumed process is handled like a failure of
a normal one.

### Live check (2026-11-13, Claude Code CLI 2.1.323)

Three approved calls in a scratch folder, with the read-only flag set AgentForge uses:

- A session was killed right after its first tool result. No `result` event was written.
- `--resume <session id>` on that killed session, with `--json-schema`, `--tools`,
  `--restricted` and the other flags, finished the task. It kept the same session id, offered
  only `Read`, `Glob`, `Grep` and `StructuredOutput`, and returned a valid structured result. It
  reported a cost of $0.026.
- `--resume` with an id that was never used exits 1 with an error result
  (`error_during_execution`, $0) and `No conversation found with session ID: <id>` on stderr.
  It leaves no session file behind. The fallback above looks for that message.

Not confirmed live: resuming an edit-mode session, resuming a session killed in the middle of a
model reply or a file edit, and starting a session under an id whose resume just failed.

## Contract

| Item | Behavior |
|---|---|
| `TaskSpec.max_attempts` | Strict integer 1–5, default 1. The cap bounds billed reruns |
| `Assignment.attempt_number` | 1 for the first attempt, then 2, 3, … A resumed attempt keeps its number |
| `Assignment.previous_failure` | The previous attempt's failure message; empty on the first attempt |
| `Assignment.session_id` | Chosen by the scheduler when the attempt starts (a UUID), because a worker stopped by a pause returns nothing. The Claude Code worker uses it as its session id |
| `Assignment.resume` | `True` when the attempt was stopped by a pause and is being continued |
| `TaskState.attempt_number` | The latest attempt started; 0 before the first |
| `TaskAttempt.message` | Why this attempt failed, was paused or was cancelled; empty otherwise |
| `TaskAttempt.session_id` | The attempt's session id, kept across a pause |
| `Transition.detail` | Why the transition happened. Never empty; the texts are listed under [How to debug a run](#how-to-debug-a-run) |
| `RunReport.attempts` | Every attempt of every task, in dispatch order. A paused and resumed attempt is one entry |
| `WorktreeExecutor` path | `root/<run_id>/<task_id>/<attempt>` (was `root/<run_id>/<task_id>` in M3). An existing path is reused only when `Assignment.resume` is set |

## How to debug a run

The report answers these after the run, with no logging set up:

| Question | Where the answer is |
|---|---|
| Why did attempt N fail? | `TaskAttempt.failure_reason` and `TaskAttempt.message`: the worker's message, the exception text, the failed checks with the last 2,000 characters of their output, or `worker timed out after 30s` (`worker_timeout`, from `TaskSpec.timeout_seconds`) |
| Was it retried, and why or why not? | `Transition.detail` on the transition after the failure: `attempt 1 of 3 failed (validation_rejected); retrying`, `attempt 3 of 3 failed (validation_rejected); no attempts left`, or `attempt 1 of 2 failed (validator_exception); not retried: validator errors are setup problems` |
| Where did attempt N run, and what did it change? | `TaskAttempt.result.workspace`, `.diff` and `.session_id` |
| What was the worker told on the retry? | `Assignment.previous_failure`, which equals the failed attempt's `message` |
| Who paused the task, and what was it doing? | `TaskState.message` while it is paused, and the `PAUSED` transition afterwards: `pause_task was called while RUNNING` |
| Was the attempt continued or started again? | The `ASSIGNED` transition says `resumed on worker …` or `assigned to worker …` |
| Why is the task in its final state? | `TaskState.message`: the failure message, `blocked by a, which is FAILED`, or who cancelled it. Also `failure_reason`, `blocked_by` and `attempt_number` |
| Why did the task change status? | `Transition.detail` on every transition; see the table below |

Every transition says why it happened:

| Status | `Transition.detail` |
|---|---|
| `PENDING` | `queued`, or after a pause `resume_task was called` / `resume_run was called` |
| `READY` | `no unfinished dependencies`, or after a failed attempt `attempt 1 of 3 failed (validation_rejected); retrying` |
| `ASSIGNED` | `attempt 1 of 3 assigned to worker backend`, or `attempt 1 of 3 resumed on worker backend` |
| `RUNNING` | `worker started` or `worker resumed` |
| `VALIDATING` | `worker reported success; validating`, or `validating again after a pause` |
| `COMPLETED` | `validation accepted` |
| `PAUSED` | `pause_task was called while RUNNING` or `pause_run was called while PENDING`: who paused it and the status it had. `pause_task was called while PAUSED`: a task held by `pause_run` was then paused by hand |
| `FAILED` | `attempt 3 of 3 failed (validation_rejected); no attempts left`, or `…; not retried: validator errors are setup problems` |
| `BLOCKED` | `blocked by a, which is FAILED` or `blocked by a, which is CANCELLED`. `a` is the task that failed or was cancelled, not necessarily a direct dependency |
| `CANCELLED` | `cancel_task was called`, `cancel_run was called`, `run() stopped by CancelledError` (the type of the error that ended `run()`), or `worker task was cancelled` (the asyncio task was cancelled from outside the scheduler) |

For `PAUSED`, `BLOCKED` and `CANCELLED` the same text is in `TaskState.message`, and a paused or
cancelled attempt has it in `TaskAttempt.message`. Both are cleared when the task is resumed.

The log follows a run as it happens. AgentForge uses the standard `logging` module and installs
no handler, so nothing is printed until you ask:

```python
import logging

logging.basicConfig(level=logging.DEBUG)
```

| Logger | Level | Event |
|---|---|---|
| `agentforge.orchestration` | DEBUG | Every transition: run, task, status, attempt number, worker and the `Transition.detail` text, e.g. `run r1 task a: PAUSED (attempt 1, worker None): pause_task was called while RUNNING` |
| `agentforge.orchestration` | WARNING | A failed attempt, with the same text as `Transition.detail` |
| `agentforge.worktrees` | DEBUG | A worktree created (path and commit) or reused for a resumed attempt; a diff recorded (length only) |
| `agentforge.claude_code` | DEBUG | A Claude process started or resumed (task, attempt, session id, folder, tools) and finished (exit code, result subtype) |
| `agentforge.claude_code` | WARNING | No saved session to resume, so a fresh one is started in the same folder. An output line that is not a JSON event was skipped (task id and length only) |
| `agentforge.validation` | DEBUG | Each check: name, folder, and exit code or timeout |

Ids, roles and titles cannot contain control characters or line separators (the contract rejects
them), so an id cannot forge a log line.

Logs hold ids, statuses, reasons, paths, exit codes and exception type names only. They never
hold the prompt, the persona, a diff, check output, a failure message or an exception's text,
because those can contain secrets. Read those in the report.

## Limits

- **A retry redoes the work.** It starts from the base commit with a new session, so it costs
  about as much as the first attempt. Each attempt has its own `max_budget_usd` cap.
- **No delay between attempts.** A failure caused by a rate limit is retried at once.
- **The failure text is untrusted.** Check output comes from code the worker wrote. It is passed
  to the next worker labelled as data, but a label is not a guarantee.
- **Failed attempts' worktrees are kept.** Nothing removes them automatically.
- An `"edit"` task run without `WorktreeExecutor` still edits `workspace_reference` in place, so
  its retry sees the failed attempt's edits.
- Retries have been tested only against the fake CLI and mock workers.
- **A pause kills the worker mid-step.** A file the worker was writing at that moment may be
  left half-written; the resumed session is not told. What was spent before the pause is spent.
- **Each resume has its own `max_budget_usd` cap**, so a task paused several times can spend
  more than one cap in total.
- **Resume depends on Claude Code's saved sessions**, which it keeps per working folder under
  your user profile. Deleting them, or moving the worktree, leaves nothing to resume; the worker
  then starts fresh in the same folder.
- **A pause during worktree creation** can leave an incomplete folder that the resumed attempt
  reuses. The attempt then fails as an `EXECUTOR_EXCEPTION` and follows the retry rules.
- **A resumed task waits for the worker that started it**, even when another worker of the role
  is free, because the session began under that worker's model and persona.
- **Pauses are lost when the process exits**, like all other state, until the persistence part.
- `resume_run` resumes tasks in id order; they are then dispatched by the normal rules.

## Not implemented yet

| Deferred | Waits for |
|---|---|
| Saving runs and recovering after a restart, including paused tasks | M4, persistence part |
| The lead agent that turns a request into a `RunPlan` | M4, last part |
| A pause that lets running work finish first | When wanted; today a pause always stops the worker |
| A delay or backoff between attempts | When a real rate-limit failure shows the need |
| A manual "retry this task" command | M5, with the REST commands |
| Removing worktrees automatically | M4 (recovery) |

## Acceptance checks

Run the pytest and Ruff commands in the root README. The M4 tests cover:

- `test_scheduler.py`, retries: a pass on the second attempt with the failure passed on,
  attempts running out and blocking descendants, each failure reason retried or not, cancelling
  a task that waits for its retry, the `Transition.detail` text of every status (including each
  way a task can be cancelled), and the log lines without the failure text.
- `test_scheduler.py`, pause/resume: a running task continuing the same attempt and session id,
  a waiting task held while its dependents wait, a pause during validation rerunning only the
  validation, `pause_run`/`resume_run` leaving a hand-paused task paused in both orders,
  resume on the worker
  that started the attempt, cancelling a paused task, pausing finished and unknown tasks, a late
  error from a stopped worker, a resume that arrives while the paused worker is still stopping,
  a pause while waiting for a retry, and the log lines.
- `test_contracts.py`: the bounds of `max_attempts`, ids, roles and titles rejecting control
  characters and line separators, and `AgentConfig` rejecting the removed `permissions`.
- `test_claude_code.py`: the retry prompt, the scheduler's session id, `--resume` with the same
  limits, the fresh-session fallback and its warning, no fallback for other failures, a rejected
  batch-file launcher, a CLI that exits before it reads its prompt, and a skipped non-JSON
  output line that is logged by length only.
- `test_worktrees.py`: a diff that includes files in ignored paths; a full run in which a real
  check fails once and the second attempt runs
  in a fresh worktree; a resumed attempt reusing its worktree; and a full run in which a paused
  fake Claude process is killed and then resumed in the same worktree with `--resume`.
