# M5 — Local REST API, approvals and live events

*AgentForge is for people who do not code as well as those who do; see
[Who it is for](../../README.md). This document covers the technical layer underneath.*

## Delivered behavior

AgentForge now runs as a local server that a person, or the planned M6 desktop app, drives over
HTTP. Nothing billed starts until a person approves it, and a worker's diff waits for a person
before the checks run the code it wrote.

```powershell
.\.venv\Scripts\python.exe -m agentforge serve --worktrees C:\path\to\worktrees --check unit="python -m pytest"
```

The server listens on `127.0.0.1:8765` only. At every start it writes a new random token to
`%APPDATA%\AgentForge\api-token`; every request must send `Authorization: Bearer <token>`.

The flow:

1. **A plan is proposed.** `POST /proposals/from-request` has the lead agent plan a request (billed),
   or `POST /proposals` takes a plan written by hand. Either way the plan is checked with the
   scheduler's rules and saved as a pending proposal. Nothing runs.
2. **A person approves it, with the rights each task gets.** `POST /proposals/{id}/approve` names a
   repository and, per task, `allowed_operations` (`edit`, `check`), `checks`, `max_attempts`,
   `timeout_seconds`, `repository_reference` and `base_commit`. A task given nothing stays
   read-only. The plan is checked again and the run starts. `POST /proposals/{id}/reject` takes a
   reason instead.
3. **A worker's diff waits for a person.** When a task that may edit reports success, it stops at
   the new status `AWAITING_APPROVAL`. Its worker is freed, so other tasks go on. Read the diff in
   `GET /runs/{id}` and then:
   - `POST /runs/{id}/tasks/{task}/approve`: the checks run, on the worker that made the diff;
   - `POST /runs/{id}/tasks/{task}/reject` with a reason: the attempt fails as
     `review_rejected`. If attempts are left, the next one starts from a clean worktree and is
     told your reason.
4. **Live events.** `GET /runs/{id}/events` streams every transition (server-sent events).
5. **Control.** Pause, resume and cancel a run or a task; retry a failed or cancelled task;
   recover a run interrupted by a restart.

A pause never skips an approval: a task waiting for one stays waiting through `pause_*` and
`resume_*`. A cancellation does cancel it, and recovery after a restart keeps it waiting.

## Contract

| Method and path | Does |
|---|---|
| `POST /proposals/from-request` | Body `{request, run_id, workspace, max_revisions}`. The lead agent plans it; 201 with the proposal, or 422 with the rounds when the plan is rejected |
| `POST /proposals` | Body: a `RunPlan`. 201 with the proposal; 400 if the plan breaks the rules |
| `GET /proposals/{id}` | The proposal: plan, source (`lead` or `hand`), rounds, status, reason |
| `POST /proposals/{id}/approve` | Body `{repository, rights: {task_id: TaskRights}}`. 202; starts the run with the same id |
| `POST /proposals/{id}/reject` | Body `{reason}` |
| `GET /runs/unfinished` | `{"runs": [...]}`: saved runs with unfinished tasks |
| `GET /runs/{id}` | The `RunReport`: live while the run is active, from the store afterwards |
| `POST /runs/{id}/recover` | 202; the run comes back with interrupted work paused; resume it |
| `POST /runs/{id}/pause`, `/resume`, `/cancel` | The active run |
| `POST /runs/{id}/tasks/{task}/pause`, `/resume`, `/cancel`, `/approve`, `/retry` | One task of the active run. `retry` on a finished run reopens it (202) |
| `POST /runs/{id}/tasks/{task}/reject` | Body `{reason}`; rejects a waiting diff |
| `GET /runs/{id}/events` | `text/event-stream`: `event: transition` with `id` = the sequence and `data` = `{sequence, task_id, status, detail}`, then `event: end`. Send `Last-Event-ID` to get only later events |

M6 added `GET /agents`, `PUT /agents/{id}`, `DELETE /agents/{id}`, `GET /runs`,
`GET /proposals`, `GET /checks` and CORS for the desktop app; see
[the M6 doc](M6-desktop.md#contract-added-to-m5s).

Answers: 401 without the right token; 404 for an unknown run, task or proposal; 400 when a rule
refuses (the message says which); 409 when another run is active or a proposal was already
decided.

Library changes the API builds on:

| Item | Behavior |
|---|---|
| `TaskStatus.AWAITING_APPROVAL` | Not final. A diff waiting for a person |
| `FailureReason.REVIEW_REJECTED` | A person rejected the diff; retried like any failure while attempts are left |
| `Scheduler(review_edits=True)` | Tasks that allow `"edit"` wait for approval after the worker succeeds. Off by default; the server turns it on |
| `approve_task(id)`, `reject_task(id, reason)` | `ValueError` unless the task is waiting; `KeyError` for an unknown task |
| `retry_task(id)` | A `FAILED` or `CANCELLED` task of the active run gets one more attempt (its limit is raised, up to 5); the tasks it blocked wait again |
| `recover(run_id, retry=[...])` | Also reopens a finished run for the named tasks |
| `Scheduler(on_transition=...)` | Called with `(run_id, transition)` on every transition; a failing callback is logged, never stops the run |
| `Proposal`, `PlanRound` | In `domain.py`; proposals are saved in the store (migration `0002`) |

## How to debug a run

| Question | Where the answer is |
|---|---|
| Why is a task not running? | `GET /runs/{id}`: `AWAITING_APPROVAL` means a diff waits for you; `PAUSED` shows who paused it |
| Why did an attempt fail after review? | `TaskAttempt.failure_reason` = `review_rejected`, `TaskAttempt.message` = your reason |
| Why was a plan not started? | `GET /proposals/{id}`: status and reason; a 400 from approve names the rule |
| Why was a request refused? | The answer's `detail` |
| What happened, in order? | `GET /runs/{id}/events`, or `transitions` in the report |

New transition details:

| Status | `Transition.detail` |
|---|---|
| `AWAITING_APPROVAL` | `worker reported success; waiting for a person to approve the diff` |
| `PENDING` | `approve_task was called`; `retry was called; attempt limit is 2`; `unblocked: retry was called on a` |
| `VALIDATING` | `the diff was approved; validating` |
| `READY` / `FAILED` | `attempt 1 of 2 failed (review_rejected); retrying` (the existing failure text) |

| Logger | Level | Event |
|---|---|---|
| `agentforge.api` | WARNING | A request refused for a missing or wrong token: method and path, never the header |
| `agentforge.api` | WARNING | A run stopped by an error other than a refusal: the error type only |
| `agentforge.api` | DEBUG | A request refused with 400/404/409: method, path, status |
| `agentforge.store` | DEBUG | A proposal saved (id, source) or decided (id, status), never the reason |
| `agentforge.orchestration` | WARNING | A retry refused (run, task, reason); a failing `on_transition` (error type) |

Events carry only the transition's sequence, task, status and detail, the same text the log
holds. Failure messages, your reasons, diffs and check output are in `GET /runs/{id}` only.

## Limits

- **One active run at a time.** The five-worker cap is per run; a second approval answers 409.
- **Every task runs in a worktree**, read-only ones too, so every task needs a repository.
- **The token is the only lock.** It stops web pages and other users; any program running as
  you can read the token file, as it could read your files. Stronger local security is M8.
- **Planning holds its request open** until the lead agent finishes, which can take minutes.
- **Approval waits forever.** A diff nobody approves keeps the run open; cancel it to end it.
- **A pause still stops a running worker at once**; only an approval is never skipped.
- Proposals and runs share one id space: a proposal's id becomes its run's id.

## Not implemented yet

| Deferred | Waits for |
|---|---|
| Several runs at once | When wanted; needs a shared worker cap across runs |
| Approving the rights of an edit-mode check run separately | When wanted |

## Acceptance checks

Run the pytest and Ruff commands in the root README. The M5 tests cover:

- `test_api.py` (FastAPI `TestClient`, mock workers): every route refusing a missing or wrong
  token without logging it; a hand-written plan running only after approval, with the rights
  applied and the diff waiting; a rejected diff retried with the reason; the event stream's
  replay, live follow, end event and `Last-Event-ID`; one run at a time and every refused
  approval; rejecting a proposal and the 404s; retrying a failed task of a finished run; the lead
  agent proposing a plan, and a rejected plan answering 422; the token file; the `serve` command.
- `test_scheduler.py`: a diff waiting with its worker freed, approved, rejected and retried,
  rejected without attempts left, never skipped by a pause, cancelled while waiting; read-only
  tasks never waiting; manual retry while a run goes on, and its refusals.
- `test_store.py`: migration `0002`; proposals saved, decided once and kept with their reason; a
  waiting diff still waiting after a restart; a finished run reopened to retry a task.

A manual check started the real server with uvicorn in a scratch profile: 401 without the token,
the right answer with it, a hand-written plan saved as pending, and a clean stop. No billed call
was made for M5.
