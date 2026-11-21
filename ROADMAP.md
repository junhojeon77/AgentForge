# Roadmap

The goal: one lead agent coordinates specialized coding agents. Five ship by default, and users
can add, remove or fully customize any of them. Adding, removing and editing agent files works
today (M2), over the local API since M6's first slice and on screen since slice 5, when the
lead agent also became able to propose a new agent with a plan (a person approves it).

**Who it is for.** People who do not code: you ask for something in your own words, the
lead agent plans it, you approve the plan, and the team of agents builds it. People who do code
can still customize, fine-tune or edit anything (agents, plans, rights, checks) and feel at
home. The app leads with the plain path and keeps every technical control one click away; a
first-start survey (planned, M6 slice 7) lets each person choose whether those controls start
open.

AgentForge is built in milestones. M1 to M5 are implemented, and M6's first five slices (the API
additions for the desktop app, the app's shell, the run screens, the proposal screens and the
agent editor). The rest is direction, not a promise, and not permission to start
a later milestone early (see [GOVERNANCE.md](GOVERNANCE.md)).

| Milestone | Scope | Status |
|---|---|---|
| M1 | Domain contracts, deterministic scheduler, five mock workers | Implemented within [documented limits](docs/milestones/M1-domain.md) |
| M2 | Read-only Claude Code worker, model/effort settings, session IDs, structured results, event callback, editable agent personas | Implemented within [documented limits](docs/milestones/M2-claude-code.md) |
| M3 | One Git worktree per task, edit-capable workers that may run only their own checks, recorded diffs, a validator that runs check commands | Implemented within [documented limits](docs/milestones/M3-worktrees.md) |
| M4 | Lead orchestration, retries, pause/resume, persistence and recovery | Retries, pause/resume, persistence and recovery implemented within [documented limits](docs/milestones/M4-orchestration.md); the lead agent implemented on 2026-11-15 |
| M5 | FastAPI REST commands, approvals and SSE events | Implemented within [documented limits](docs/milestones/M5-api.md) on 2026-11-15 |
| M6 | Tauri 2 desktop dashboard (React, TypeScript), including on-screen agent editing | In progress: slice 1 (API additions) implemented on 2026-11-15, slice 2 (the app shell in `apps/desktop`) on 2026-11-18, slice 3 (the run screens, plain styling), slice 4 (the proposal screens: ask for something, approve with rights) and slice 5 (the agent editor, and new agents from the lead) on 2026-11-20; a visual design and a first-start survey and guide (plain or technical view) are planned. See [the M6 doc](docs/milestones/M6-desktop.md) |
| M7 | Integration candidates, conflict detection, review and approved integration | Planned |
| M8 | Windows packaging, backend lifecycle, secure local communication and recovery checks | Planned |

SQLAlchemy and Alembic were added for M4's persistence, and LangGraph and LangChain core for the
lead agent, and FastAPI and uvicorn for M5, on 2026-11-15. For M6's shell, on 2026-11-18: Tauri 2
with `tauri-plugin-fs`, React, TypeScript, Vite, Tailwind, TanStack Query and Vitest. shadcn/ui
waits for a screen that needs a composite widget (slice 3 used native elements), and Zustand for a screen that needs shared client state. Add each only when
its milestone is approved.

## Deferred from built milestones

Nothing from M2: the worker timeout, the `claude` command and the model rule were finished on
2026-11-14 (see [the M2 doc](docs/milestones/M2-claude-code.md#finished-after-m2-2026-11-14)).
From M3: merging worktrees back (M7) and judging plain-English acceptance criteria; a sandbox
or resource limits for checks are listed under the M3 doc's limits. Worktree cleanup on request and a live check of edit mode were
finished on 2026-11-14, and workers running their own checks on 2026-11-15. Details are in the
[M3 doc](docs/milestones/M3-worktrees.md#not-implemented-yet).
From M4: a delay between attempts and a pause that lets running work finish. The manual retry
command and running a plan from a request came with M5. Details are in the
[M4 doc](docs/milestones/M4-orchestration.md#not-implemented-yet).
From M5: several runs at once; the agent persona endpoints came with M6's first slice. Details
are in the [M5 doc](docs/milestones/M5-api.md#not-implemented-yet).

## Guidance for planned milestones

- **Model and execution runtime:** the Claude Code CLI sits behind the
  `WorkerExecutor` seam (`claude_code.py`). Verify flags, event shapes, auth and interruption
  against the installed CLI version; ordinary tests use fakes, live tests are opt-in. Validate
  structured agent output independently and treat repository content, tool output and logs as
  data, not instructions. Worktrees isolate changes but are not sandboxes: enforce workspace
  boundaries, restricted processes, timeouts, resource limits, secret protection and approval of
  sensitive operations. Test Git behavior in disposable repositories and keep secrets out of logs
  and fixtures.
- **Persistence (M4):** SQLite + SQLAlchemy + Alembic; test migrations on disposable databases.
  LangGraph may coordinate reasoning, but the deterministic scheduler owns dispatch and state.
  Since 2026-11-15 LangGraph runs the lead agent's draft, critique and revise workflow, and the
  Claude Code CLI is a LangChain Runnable; scheduling, saved runs and recovery do not use them.
- **Desktop (M6, `apps/desktop`):** Tauri 2/Rust, React/TypeScript, Vite, Tailwind, shadcn/ui,
  Zustand, TanStack Query, Vitest (all but shadcn/ui and Zustand installed with slice 2). Follow
  the implemented REST/SSE contracts; read the event stream with `fetch`, since `EventSource`
  cannot send the token. Show loading,
  empty, failure and recovery states; provide semantic controls, accessible names, keyboard
  navigation, visible focus and readable contrast, and never signal status by color alone. Treat
  diffs and agent output as untrusted display data; keep credentials out of bundles. Agent editing
  calls the existing `agentforge.personas` functions.

## Verification history

Verified on 2026-11-20 after M6 slice 5 (the agent editor, and new agents from the lead):
**250 tests passed and 1 skipped** (15 new), Ruff lint passed, and all 31 Python files passed
the formatting check; **85 Vitest tests passed** (11 new), and the desktop `tsc` type check and
Vite build passed. The components have no tests of their own, and the window had not yet been
checked by hand; no billed call was made (the lead agent ran only against the fake CLI).

Verified on 2026-11-20 after M6 slice 4 (the proposal screens, plain styling): **74 Vitest tests
passed** (21 new), and the desktop `tsc` type check and Vite build passed. The backend is
unchanged: **235 tests passed and 1 skipped**, Ruff lint passed, and all 31 Python files passed
the formatting check. The components have no tests of their own, and the window had not yet been
checked by hand; no billed call was made (the lead agent was not asked to plan).

Verified on 2026-11-20 after M6 slice 3 (the run screens, plain styling): **53 Vitest tests
passed** (33 new), and the desktop `tsc` type check and Vite build passed. The backend is
unchanged: **235 tests passed and 1 skipped**, Ruff lint passed, and all 31 Python files passed
the formatting check. The components have no tests of their own, and the window had not yet been
checked by hand; no billed call was made.

Verified on 2026-11-18 after M6 slice 2 (the app shell): **20 Vitest tests passed**, the desktop
`tsc` type check and Vite build passed, and the Rust shell built (Tauri 2.12.7,
`tauri-plugin-fs` 2.7.1). The backend is unchanged: **235 tests passed and 1 skipped**, Ruff lint
passed, and all 31 Python files passed the formatting check. The app's window was not checked
by hand in this session; no billed call was made.

Verified on 2026-11-15 after M6 slice 1 (API additions): **235 tests passed and 1 skipped** (the
opt-in live Claude Code test), Ruff lint passed, and all 31 Python files passed the formatting
check. Tested through FastAPI's `TestClient` with mock workers; no billed call was made.

Verified on 2026-11-15 after M5: **222 tests passed and 1 skipped** (the opt-in live Claude
Code test), Ruff lint passed, and all 31 Python files passed the formatting check. The real
server was started with uvicorn in a scratch profile: 401 without the token, the right answer
with it, a plan saved as pending, a clean stop. No billed call was made for M5.

Verified on 2026-11-15 after adding the lead agent: **184 tests passed and 1 skipped** (the opt-in
live Claude Code test), Ruff lint passed, and all 28 Python files passed the formatting check.
Separately, one approved live planning run (Claude Code 2.1.323, `claude-haiku-5-5`, two sessions,
$0.004) produced a two-task plan that the critique accepted; see
[the M4 doc](docs/milestones/M4-orchestration.md#live-check-2026-11-15-claude-code-cli-21323).

Verified on 2026-11-15 after M4's persistence and recovery: **175 tests passed and 1 skipped**
(the opt-in live Claude Code test), Ruff lint passed, and all 26 Python files passed the
formatting check. Migrations were tested up and down on disposable databases, and a real process
was killed mid-task and its run recovered. No live call was made for this part.

Verified on 2026-11-15 after letting workers run their own checks: **168 tests passed and 1
skipped** (the opt-in live Claude Code test), Ruff lint passed, and all 21 Python files passed the
formatting check. Separately, four approved live calls (Claude Code 2.1.323, `claude-haiku-5-5`,
about $0.014 in total) checked the command rules and one full run; see
[the M3 doc](docs/milestones/M3-worktrees.md#live-check-2026-11-15-claude-code-cli-21323-workers-running-their-own-checks).

Verified on 2026-11-14 after adding worktree cleanup: **163 tests passed and 1 skipped** (the
opt-in live Claude Code test), Ruff lint passed, and all 21 Python files passed the formatting
check. Added: `worktrees.remove_run` and `python -m agentforge clean`. Separately, two approved
live calls (Claude Code 2.1.323, `claude-haiku-5-5`, $0.0052 in total) confirmed edit mode: edits
work inside the worktree, a write outside it and a write to its `.git` file are refused, and a
full edit, diff and check run completes; see
[the M3 doc](docs/milestones/M3-worktrees.md#live-check-2026-11-14-claude-code-cli-21323). `clean` then
removed that run's worktree.

Verified on 2026-11-14 after finishing M2's deferred items: **159 tests passed and 1 skipped**
(the opt-in live Claude Code test), Ruff lint passed, and all 21 Python files passed the
formatting check. Added: `TaskSpec.timeout_seconds`, `python -m agentforge claude` and a rule for
`AgentConfig.model`. The mock demo still completes five tasks. The `claude` command was tested
with the fake CLI only; no live call was made.

Verified on 2026-11-14 after fixing six audit findings: **140 tests passed and 1 skipped** (the
opt-in live Claude Code test), Ruff lint passed, and all 21 Python files passed the formatting
check. The fixes: the recorded diff includes files in ignored paths; `resume_run` leaves a task
paused by hand alone even when `pause_run` came first; a `.cmd`/`.bat` Claude launcher is
rejected; a CLI that exits before reading its prompt reports its own error; an output line that
is not a JSON event is skipped; and the unused `AgentConfig.permissions` is removed. Tested with
the fake CLI and disposable repositories only; no live call was made.

Verified on 2026-11-14 after fixing four review findings on M4: **134 tests passed and 1 skipped**
(the opt-in live Claude Code test), Ruff lint passed, and all 21 Python files passed the
formatting check. The fixes: a resume that arrives while a paused worker is still stopping no
longer cancels the task, and ids, roles and titles reject control characters.

Verified on 2026-11-13 after M4's pause/resume: **119 tests passed and 1 skipped** (the opt-in live
Claude Code test), Ruff lint passed, and all 21 Python files passed the formatting check.
Separately, three approved live calls (Claude Code 2.1.323, $0.026 reported) confirmed that a
killed read-only session can be resumed with `--resume` and the flags AgentForge uses; see
[the M4 doc](docs/milestones/M4-orchestration.md#live-check-2026-11-13-claude-code-cli-21323).
Resuming an edit-mode session has not been tried live.

Verified on 2026-11-13 after giving every transition a reason: **102 tests passed and 1 skipped**
(the opt-in live Claude Code test), Ruff lint passed, and all 21 Python files passed the
formatting check.

Verified earlier on 2026-11-13 after M4's retries: 100 tests passed and 1 skipped (the opt-in live
Claude Code test), Ruff lint passed, and all 21 Python files passed the formatting check. Retries
were tested with mock workers and the fake CLI only; no live call was made.

Verified on 2026-11-13 after M3: **88 tests passed and 1 skipped** (the opt-in live Claude Code
test), Ruff lint passed, and all 21 Python files passed the formatting check. Git behavior was
tested in disposable repositories with Git 2.51.2. Edit mode was tested only against the fake
CLI; no live call has confirmed it.

Verified on 2026-11-13 after adding agent personas: **64 tests passed and 1 skipped** (the opt-in
live Claude Code test), Ruff lint passed, and all 17 Python files passed the formatting check. The
mock demo still runs five workers at once. `python -m agentforge setup`, run against a scratch
`APPDATA`, created the five persona files. A second run kept a hand-edited file and did not
restore a deleted one.

Earlier, after M2, the same checks gave 48 passed and 1 skipped, and the demo confirmed five
completed tasks and all five workers released. Separately, one approved live `claude -p` call
(Claude Code 2.1.323, $0.053) confirmed the flags and event format the M2 executor relies on; see
[the M2 doc](docs/milestones/M2-claude-code.md). The opt-in live test itself has not been run.
Personas (`--append-system-prompt`) have not been tried in a live call.

Earlier on 2026-11-13, an M1 audit round fixed the following:
- A worker raising a non-`Exception` error no longer leaves `run()` waiting forever.
- Cancelling `run()` twice no longer interrupts worker cleanup or lets a new run overlap the old one.
- The demo surfaces an early run failure instead of hanging.
- The scheduler drops redundant copies and re-scans.

That round added five tests, one of them for cancelling a task before its coroutine starts.

The same checks were rerun successfully before recording the M1 Git baseline, so M2 can build on
a verified starting point. File-by-file baseline commits depend on the complete M1 file set;
verification applies to that combined state, not each intermediate commit.
