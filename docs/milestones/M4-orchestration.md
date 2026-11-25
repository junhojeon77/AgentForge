# M4 — Retries, pause/resume, persistence and the lead agent

*AgentForge is for people who do not code as well as those who do; see
[Who it is for](../../README.md). This document covers the technical layer underneath.*

M4 is built in four parts. All four are implemented.

| Part | Status |
|---|---|
| Retries | Implemented (this document) |
| Pause/resume | Implemented (this document) |
| Persistence and recovery | Implemented (this document) |
| Lead orchestration | Implemented (this document) |

Retries and pause/resume added no dependency. Persistence added SQLAlchemy 2 and Alembic, as
the roadmap planned; SQLite itself is part of Python. The lead agent added LangGraph and
LangChain core. They are used only where they fit: the lead agent's reasoning workflow and the
Runnable interface to the Claude Code CLI. The scheduler, saved runs and recovery do not use them.

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

## Delivered behavior: persistence and recovery

A run can be saved as it happens and continued after the process stops, for example after a
crash or a restart. Saving is opt-in: without a store nothing changes.

```python
from agentforge.store import RunStore, default_path

scheduler = Scheduler(validator=..., store=RunStore(default_path()))  # %APPDATA%\AgentForge\runs.db
report = await scheduler.run(plan)          # every transition is saved as it happens
```

After a restart, register the same workers again and recover the run:

```python
store = RunStore(default_path())
print(store.unfinished_runs())              # e.g. ["r1"]
scheduler = Scheduler(validator=..., store=store)
...                                         # register_worker(...) as before
recovering = asyncio.create_task(scheduler.recover("r1"))
await scheduler.resume_run()                # nothing billed starts before this
report = await recovering
```

1. `RunStore(path)` opens a SQLite file and migrates it to the latest schema with Alembic.
2. Every transition is saved in one transaction with the task's state and its latest attempt,
   at the moment it happens, so the database always matches the report.
3. `recover(run_id)` loads the run. A task whose worker was in flight (`ASSIGNED`, `RUNNING` or
   `VALIDATING`) becomes `PAUSED` with the reason `recovered after a restart while RUNNING`;
   `READY` tasks go back to `PENDING`; finished tasks stay as they were.
4. `resume_run()` continues the recovered tasks exactly like a pause: the same attempt, on the
   same worker, in the same worktree, with `claude --resume` (or a fresh session in the same
   folder when none was saved). A task paused by hand before the restart stays paused until
   `resume_task`.
5. If a save fails, the run stops: every unfinished task is cancelled with the reason
   `saving the run failed (OperationalError)`, and `run()` raises the error. A run that cannot
   be recorded does not keep spending.

The crash test kills a real process in the middle of a task and recovers the run in a fresh
`Scheduler`.

## Delivered behavior: the lead agent

The lead agent turns a plain-English request into a checked `RunPlan`. It plans; it does not run
anything. Running the plan stays a separate step for a person.

```powershell
.\.venv\Scripts\python.exe -m agentforge plan "Add reverse(text) to utils.py and test it" --workspace C:\path\to\repo
```

```python
from agentforge.claude_code import ClaudeCodeRunner
from agentforge.lead import Planner, PlanRequest

lead = Planner(ClaudeCodeRunner(command=(CLAUDE,)), roles=("backend", "qa"), workspace=repo)
result = await lead.ainvoke(PlanRequest(request="...", run_id="r1"))  # result.plan is a RunPlan
```

It is a LangGraph workflow, and `Planner` is a LangChain Runnable:

```
draft -> check --(issues)--> revise -> check ...
           \--(none)--> critique --(issues)--> revise
                             \--(none)--> accepted
```

1. **draft:** one read-only Claude Code session in the repository writes a plan from the request
   and the registered roles, through a JSON schema. LangChain's `PydanticOutputParser` reads it.
2. **check:** plain code, no AI: the scheduler's own `validate_plan` (unique ids, known
   dependencies, registered roles, no cycles) plus the contract rules for ids and titles.
3. **critique:** one session reviews the plan against the request: missing work, wrong order,
   tasks too large, criteria nobody can check.
4. **revise:** one session gets the plan and the issues and returns a new plan, which is checked
   again.
5. The plan is accepted when the check passes and the critique finds nothing. When issues are left
   after `max_revisions` (default 2), `PlanRejected` is raised with every round's issues, and no
   plan is returned.

**The model cannot grant rights.** The plan schema has only `id`, `title`, `role`, `description`,
`objective`, `acceptance_criteria` and `dependencies`; a reply with any other field, such as
`allowed_operations`, fails the check. Edit and check rights, the repository, attempts and
timeouts come from the person through `task_defaults`, and default to a read-only task.

### New agents from the lead

Since 2026-11-20 (M6 slice 5), when part of the work fits none of the roles, the lead may add an
agent in the draft's `new_agents`: an `id`, a new `role` and a `persona`. It cannot set the model
or the reasoning; those default to Claude Code's model and `medium`, and the person can change
them. The check (plain code) refuses, as an issue the next revision is told:

| Issue | When |
|---|---|
| `agent id 'X' may use only a-z, 0-9, '-' and '_'` | The id cannot be a file name (`personas.check_id`) |
| `new agent x is listed twice` | Two new agents share an id |
| `new agent x: an agent with this id already exists` | `Planner(agent_ids=...)` has it |
| `new agent x: role r already has an agent; give its tasks to that agent` | The role is registered, or another new agent has it |
| `new agent x: no task has role r` | Nothing in the plan would use it |
| `new agent x: role 'r ' starts or ends with a space` | The agent's file cannot keep the spaces (`personas.save_agent` refuses them), so approving would fail |
| `new agent x: persona: String should have at most 10000 characters` | A field breaks `AgentConfig` |

The plan is then checked with the registered roles plus the new ones, and the critique sees the
new agents with the tasks. `PlanResult.agents` holds them. Nothing is created here: the API saves
them only when a person approves the plan (see [the M6 doc](M6-desktop.md#delivered-behavior-slice-5)).

### Live check (2026-11-15, Claude Code CLI 2.1.323)

One approved run with `claude-haiku-5-5` on a scratch repository: the request "Add a function
reverse(text) to utils.py that reverses a string, and test it" became two tasks, a backend task
and a qa task that depends on it, each with checkable criteria and no rights. The critique
accepted it on the first round. Two sessions, $0.004.

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
| `TaskAttempt.started_at`, `stopped_at` | Added on 2026-11-25 (M6 slice 9) for the run board's tile time. `started_at` is when the attempt was first assigned and survives a pause; `stopped_at` is when it last left `ASSIGNED`/`RUNNING`/`VALIDATING`, and empty while it is in one. UTC; `None` on attempts saved before. Saved in the attempt's JSON, so no migration |
| `Transition.detail` | Why the transition happened. Never empty; the texts are listed under [How to debug a run](#how-to-debug-a-run) |
| `RunReport.attempts` | Every attempt of every task, in dispatch order. A paused and resumed attempt is one entry |
| `WorktreeExecutor` path | `root/<run_id>/<task_id>/<attempt>` (was `root/<run_id>/<task_id>` in M3). An existing path is reused only when `Assignment.resume` is set |
| `RunStore(path)` | Opens or creates the SQLite file and migrates it. `start_run(plan)`, `save(...)`, `load(run_id)` (the plan and the report without workers, or `None`) and `unfinished_runs()` (ids, oldest first). `agentforge.store.default_path()` is `%APPDATA%\AgentForge\runs.db` |
| `Scheduler(..., store=None)` | With a store, `run()` saves every transition. A run id is saved once: `run()` with an id already saved raises `ValueError` before anything starts |
| `await recover(run_id)` | Continues a saved, unfinished run and returns its report. Raises `ValueError` without a store, for an unknown or finished run, while a run is active, or when an unfinished attempt's worker is not registered |
| Database tables | `runs` (the plan as JSON), `tasks` (`TaskState` as JSON, plus its status), `attempts` (`TaskAttempt` as JSON, in dispatch order), `transitions` (sequence, task, status, detail). JSON is checked with the same Pydantic contracts on load. [M5](M5-api.md) added `proposals` (migration `0002`) |

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
| Why was a plan rejected, or revised? | `PlanRejected.rounds` (or `PlanResult.rounds` for an accepted plan): each round's revision number, whether the check or the critique found the issues, and the issues |
| What happened before a crash? | `RunStore(path).load(run_id)`: everything up to the last saved transition |
| Why did a run stop with a database error? | Every unfinished task's message: `saving the run failed (OperationalError)`; the error itself is raised from `run()` |

Every transition says why it happened:

| Status | `Transition.detail` |
|---|---|
| `PENDING` | `queued`, or after a pause `resume_task was called` / `resume_run was called`, or `recovered after a restart` for a task that was `READY` |
| `READY` | `no unfinished dependencies`, or after a failed attempt `attempt 1 of 3 failed (validation_rejected); retrying` |
| `ASSIGNED` | `attempt 1 of 3 assigned to worker backend`, or `attempt 1 of 3 resumed on worker backend` |
| `RUNNING` | `worker started` or `worker resumed` |
| `VALIDATING` | `worker reported success; validating`, `validating again after a pause`, or `the diff was approved; validating` ([M5](M5-api.md)) |
| `COMPLETED` | `validation accepted` |
| `PAUSED` | `pause_task was called while RUNNING` or `pause_run was called while PENDING`: who paused it and the status it had. `recovered after a restart while RUNNING`: the process stopped while its worker was in flight. `pause_task was called while PAUSED`: a task held by `pause_run` was then paused by hand |
| `FAILED` | `attempt 3 of 3 failed (validation_rejected); no attempts left`, or `…; not retried: validator errors are setup problems` |
| `BLOCKED` | `blocked by a, which is FAILED` or `blocked by a, which is CANCELLED`. `a` is the task that failed or was cancelled, not necessarily a direct dependency. A retry unblocks a task only for the task retried: if another of its dependencies failed, it is blocked again by that one at once |
| `CANCELLED` | `cancel_task was called`, `cancel_run was called`, `saving the run failed (OperationalError)`, `run() stopped by CancelledError` (the type of the error that ended `run()`), or `worker task was cancelled` (the asyncio task was cancelled from outside the scheduler) |

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
| `agentforge.orchestration` | WARNING | A failed attempt, with the same text as `Transition.detail`; `saving the run failed (OperationalError); stopping the run` (the error type only); `recovery refused:` and the reason (ids only) |
| `agentforge.store` | DEBUG | A store opened: path and schema version |
| `agentforge.lead` | DEBUG | A draft made (task count); a draft proposing new agents (count only, never a persona); the check or the critique found issues (count and revision); the critique accepted the plan |
| `agentforge.lead` | WARNING | A plan rejected: revisions made and rounds with issues |
| `agentforge.worktrees` | DEBUG | A worktree created (path and commit) or reused for a resumed attempt; a diff recorded (length only); a worktree removed by `remove_run` (path) |
| `agentforge.worktrees` | WARNING | `remove_run` kept a folder that Git does not know as a worktree (path only; Git's message is in the raised error) |
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
- **Failed attempts' worktrees are kept.** Nothing removes them automatically; `worktrees.remove_run`
  or `python -m agentforge clean` deletes a finished run's worktrees when you ask.
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
- **Without a store, everything is lost when the process exits**, pauses included.
- **The database holds secrets the report holds**: diffs, failure messages and check output.
  It lives under your user profile; nothing from it is logged.
- **Saving blocks the event loop** for one small SQLite write per transition, which is fine at
  five workers (marked `shortcut:` in the code).
- **Workers and their executors are not saved.** Register the same workers before `recover`.
- **A crash mid-step is like a pause mid-step:** a file being written may be left half-written,
  and what was spent is spent.
- **The CLI and the demo do not save runs.** Only code that passes a store does.
- `resume_run` resumes tasks in id order; they are then dispatched by the normal rules.
- **A plan costs up to `2 * max_revisions + 2` Claude sessions** (six by default), each with its own
  `max_budget_usd` cap.
- **The critique is the model's judgement.** A plan it accepts can still be wrong; the check only
  proves the plan is well-formed. Read a plan before you run it.
- **The lead agent's request text is sent to Claude** and never logged; the critique's issues are kept
  in the rounds and not logged.
- **LangSmith tracing** comes with LangChain. AgentForge never turns it on; if you set
  `LANGSMITH_TRACING=true` yourself, LangChain sends prompts and replies to LangSmith.

## Not implemented yet

| Deferred | Waits for |
|---|---|
| A pause that lets running work finish first | When wanted; today a pause always stops the worker |
| A delay or backoff between attempts | When a real rate-limit failure shows the need |

## Acceptance checks

Run the pytest and Ruff commands in the root README. The M4 tests cover:

- `test_scheduler.py`, retries: a pass on the second attempt with the failure passed on,
  attempts running out and blocking descendants, each failure reason retried or not, cancelling
  a task that waits for its retry, the `Transition.detail` text of every status (including each
  way a task can be cancelled), and the log lines without the failure text.
- `test_scheduler.py`, pause/resume: a running task continuing the same attempt and session id,
  a waiting task held while its dependents wait, a pause during validation rerunning only the
  validation, `pause_run`/`resume_run` leaving a hand-paused task paused in both orders, resume
  on the worker that started the attempt, cancelling a paused task, pausing finished and unknown tasks, a late
  error from a stopped worker, a resume that arrives while the paused worker is still stopping,
  a pause while waiting for a retry, and the log lines.
- `test_contracts.py`: the bounds of `max_attempts`, ids, roles and titles rejecting control
  characters and line separators, and `AgentConfig` rejecting the removed `permissions`.
- `test_claude_code.py`: the retry prompt, the scheduler's session id, `--resume` with the same
  limits, the fresh-session fallback and its warning, no fallback for other failures, a rejected
  batch-file launcher, a CLI that exits before it reads its prompt, and a skipped non-JSON
  output line that is logged by length only.
- `test_lead.py` (fake CLI replying from a script): a plan accepted on the first draft; a role no
  agent has, and a critique issue, each fixed by a revision; a plan that never converges rejected
  after six sessions with every round and a WARNING; a reply that tries to grant `allowed_operations`
  rejected; rights coming only from `task_defaults`; the request text never logged; new agents
  accepted for a role nobody has and refused for each broken rule (since M6 slice 5); the `plan`
  command printing the plan, and exiting 1 with the rounds when rejected.
- `test_claude_code.py`, interface: `ClaudeCodeExecutor.ainvoke` equals `execute`, and `ClaudeCodeRunner`
  composes with other LangChain Runnables.
- `test_store.py`: migrations up and down on a disposable database, a saved run loading back
  equal to the report, a run id saved once, a real process killed mid-task and recovered (the
  task paused with its reason, then the same attempt and session continued), recovery refused
  for an unknown, finished or active run or a missing worker, and a failed save stopping the
  run with its reason and a WARNING that holds no error text.
- `test_worktrees.py`: a diff that includes files in ignored paths; a full run in which a real
  check fails once and the second attempt runs
  in a fresh worktree; a resumed attempt reusing its worktree; and a full run in which a paused
  fake Claude process is killed and then resumed in the same worktree with `--resume`.
