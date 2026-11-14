# Roadmap

The goal: one lead agent coordinates specialized coding agents. Five ship by default, and users
can add, remove or fully customize any of them. Adding, removing and editing agent files works
today (M2). On-screen editing is planned for M6.

AgentForge is built in milestones. M1, M2, M3 and the retry part of M4 are implemented. The rest is
direction, not a promise, and not permission to start a later milestone early (see
[GOVERNANCE.md](GOVERNANCE.md)).

| Milestone | Scope | Status |
|---|---|---|
| M1 | Domain contracts, deterministic scheduler, five mock workers | Implemented within [documented limits](docs/milestones/M1-domain.md) |
| M2 | Read-only Claude Code worker, model/effort settings, session IDs, structured results, event callback, editable agent personas | Implemented within [documented limits](docs/milestones/M2-claude-code.md) |
| M3 | One Git worktree per task, edit-capable workers that cannot run commands, recorded diffs, a validator that runs check commands | Implemented within [documented limits](docs/milestones/M3-worktrees.md) |
| M4 | Lead orchestration, retries, pause/resume, persistence and recovery | Retries implemented within [documented limits](docs/milestones/M4-orchestration.md); the rest is planned |
| M5 | FastAPI REST commands, approvals and SSE events | Planned |
| M6 | Tauri 2 desktop dashboard (React, TypeScript), including on-screen agent editing | Planned |
| M7 | Integration candidates, conflict detection, review and approved integration | Planned |
| M8 | Windows packaging, backend lifecycle, secure local communication and recovery checks | Planned |

FastAPI, SQLite/SQLAlchemy/Alembic, LangGraph, Tauri and the frontend stack are planned, not
installed. Add each only when its milestone is approved.

## Deferred from M2, M3 and M4's retries

Session resume (M4), a per-task timeout for workers, a Claude Code demo mode,
model-string validation and `AgentConfig.permissions`. Details are in the M2 doc's
["Not implemented yet"](docs/milestones/M2-claude-code.md#not-implemented-yet) table.
From M3: workers running commands themselves, a sandbox or resource limits for checks, automatic
worktree cleanup and a live test of edit mode. Details are in the
[M3 doc](docs/milestones/M3-worktrees.md#not-implemented-yet).
From M4's retries: a delay between attempts and a manual retry command. Details are in the
[M4 doc](docs/milestones/M4-orchestration.md#not-implemented-yet).
`PAUSED`, pause/resume and recovery are still reserved for the rest of M4.

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
- **Desktop (M6, `apps/desktop`):** Tauri 2/Rust, React/TypeScript, Vite, Tailwind, shadcn/ui,
  Zustand, TanStack Query, Vitest. Follow the implemented REST/SSE contracts. Show loading,
  empty, failure and recovery states; provide semantic controls, accessible names, keyboard
  navigation, visible focus and readable contrast, and never signal status by color alone. Treat
  diffs and agent output as untrusted display data; keep credentials out of bundles. Agent editing
  calls the existing `agentforge.personas` functions.

## Verification history

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
