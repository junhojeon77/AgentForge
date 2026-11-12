# AgentForge project guidance

These instructions apply across AgentForge. Build a local-first Windows desktop
platform that coordinates one lead Codex agent and five specialized workers.
Keep AI reasoning separate from deterministic scheduling, execution control,
validation, persistence, permissions, and human approval. Use a modular monolith
and the simplest implementation that fully meets the current requirement.

## Working approach

Act as a pragmatic engineering collaborator. Prioritize correctness, readable
code, and small, test-driven steps. Inspect existing code and tests, verify
assumptions, and explain consequential tradeoffs. Clarify genuinely missing
decisions; otherwise complete authorized work without approval between TDD phases.
Preserve unrelated user changes and avoid speculative features or infrastructure.

## Current state and commands

M1 is implemented as a Python library under `apps/api/src/agentforge`, with tests
under `apps/api/tests`. It provides immutable Pydantic contracts, an in-memory
async scheduler, mock executors/validation, and a five-worker demonstration.
On 2026-11-12, all README verification commands were rerun: 35 tests passed,
Ruff lint passed, and Ruff formatting confirmed all seven Python files formatted.
The demo also passed; its JSON report verified five completed tasks, five
completed attempts, and all five worker reservations released. This verifies
the documented mock-only M1 scope, not the planned desktop or real Codex runtime.
Fresh-session instruction discovery remains unverified.

Python 3.11+ is required; use `venv` and `pip`. Pydantic 2 is the runtime dependency;
pytest, pytest-asyncio, and Ruff are development dependencies. From the workspace
root in PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e "./apps/api[dev]"
.\.venv\Scripts\python.exe -m agentforge
.\.venv\Scripts\python.exe -m pytest apps/api/tests
.\.venv\Scripts\python.exe -m ruff check apps/api
.\.venv\Scripts\python.exe -m ruff format --check apps/api
```

Installation requires package access; ordinary M1 tests and the demo need no
credentials, environment variables, or live services. No type checker, frontend
build, database migration runner, or CI workflow is configured yet. Maintain
commands in the [README](README.md#setup-on-windows), deriving them from actual
configuration. Report exact results and never claim unrun checks passed.

## Coordinator routing and ownership

These routing rules apply to the coordinator only. Spawned agents execute their
assigned role directly and never spawn or delegate. Normal conversation and status
updates remain with the coordinator. Respect explicit user requests to work
without subagents and all higher-priority instructions.

- Delegate every planning, coding, and debugging task, including small tasks.
  Route planning-only requests to `planner` (`gpt-6-astra`, high), then stop after
  the plan. For implementation, use planner first when requirements are unclear,
  architecture changes, or multiple components require coordination; otherwise
  route directly to `coder` (`gpt-6.1-sol`, medium). Continue authorized work after
  planning unless a material user decision is unresolved.
- Route bug investigation and fixes to `debugger` (`gpt-6.1-sol`, high), and commit
  preparation or authorized commit creation to `committer`. If a required role or
  model is unavailable, stop and report it; never silently substitute or increase
  model/effort.
- Each handoff states scope, explicit file ownership, baseline/existing changes,
  acceptance checks, user authorization, and permission limits. Read applicable
  instructions first. Only one editor may work at a time, including the
  coordinator; only independent read-only investigators may run concurrently.
  Review a stable final diff after editing stops.
- Track targeted fixes for the same failure across agents and follow-ups. An
  initial test failure is not a fix attempt; distinguish pre-existing failures.
  After two unsuccessful coder fixes, obtain evidence and route to debugger.
  After two unsuccessful debugger fixes, stop and report evidence and unresolved
  cause. Do not reset counts or silently escalate models/effort.
- Delegation grants no additional authority for destructive actions, deployment,
  live-data changes, external messages, commits, or approvals. Ask only for missing
  decisions or access; do not request permissions already supplied.

AgentForge's future product workers may execute concurrently in isolated
worktrees. That product behavior does not relax this contributor workflow's
single-editor rule.

## Roadmap and component boundaries

| Milestone | Responsibility and state |
|---|---|
| M1 | Domain models, scheduler, five mock workers; implemented within [documented limits](docs/milestones/M1-domain.md) |
| M2 | Codex adapter, configurable models, sessions, structured results, streaming; planned |
| M3 | Repository/worktree management, restricted execution, diffs and validation; planned |
| M4 | Lead orchestration, retries, pause/resume, persistence and recovery; planned |
| M5 | FastAPI REST commands, approvals and SSE events; planned |
| M6 | Tauri 2 desktop dashboard with React and TypeScript; planned |
| M7 | Integration candidates, conflict detection, review and approved integration; planned |
| M8 | Windows packaging, backend lifecycle, secure local communication and recovery checks; planned |

The roadmap describes intended direction, not authorization to implement later
milestones. Do not treat the selected future stack as installed.

### Backend (`apps/api`)

- Keep domain contracts separate from orchestration and infrastructure. Preserve
  frozen task specifications, scheduler-owned state, and copied/immutable snapshots.
- Validate the complete fixed DAG before dispatch: task/run IDs, dependencies,
  cycles and compatible roles. Keep roles extensible. Dispatch by descending
  priority then task ID, and choose compatible idle workers by worker ID.
- Preserve atomic reservations on one asyncio event loop, one active run per
  scheduler, one task per worker, and a global concurrency cap of 1–5. A busy role
  must not prevent other eligible roles from executing.
- Keep workers reserved through independent validation. Worker-reported success
  alone cannot complete a task. Failed/cancelled tasks block descendants while
  independent branches continue; terminal outcomes cannot be overwritten.
- Cancellation must await cooperative cleanup and release workers, including
  caller cancellation and cancellation before a task coroutine starts. Use
  deterministic barriers in async tests; cover races and leaked tasks.
- M1 allows one attempt per task/run. `PAUSED` is reserved; retries, pause/resume,
  restart recovery and durable duplicate prevention are future work. Mock evidence
  checks do not inspect files, run tests, enforce permissions, or prove sandboxing.
- Future FastAPI/Pydantic command validation belongs here. SQLite, SQLAlchemy and
  Alembic provide planned persistence; test migrations on disposable databases.
  LangGraph may coordinate reasoning, while the deterministic scheduler owns
  dispatch and state transitions. Add these dependencies only for authorized work.

### Desktop (`apps/desktop`, planned)

- Use Tauri 2/Rust for native lifecycle and OS integration, and React/TypeScript,
  Vite, Tailwind, shadcn/ui, Zustand and TanStack Query for the dashboard. REST
  commands and SSE updates must follow implemented backend contracts.
- Build project, agent, task, chat, review, history and settings views as requested.
  Show loading, empty, failure and recovery states accurately. Provide semantic
  controls, accessible names, keyboard navigation, visible focus and readable
  contrast; communicate status beyond color alone.
- Treat diffs, repository text and agent output as untrusted display data. Avoid
  unsanitized HTML/unsafe links and keep credentials out of frontend bundles.
  Use Vitest for frontend behavior once configured, and appropriate desktop
  integration checks when native behavior arrives; do not invent current commands.

### Codex and execution runtime (planned)

- Put Codex integration behind replaceable adapters. Verify actual model IDs,
  reasoning support, authentication, streaming and interruption against the chosen
  installed runtime. Product model preferences are not verified SDK capabilities
  or contributor role settings. Ordinary tests use fakes; live tests are opt-in.
- Git worktrees isolate changes, but are not security sandboxes. Enforce workspace
  boundaries, restricted processes, timeouts, resource limits, secret protection,
  cancellation and sensitive-operation approval as execution is implemented.
- Validate structured agent output independently. Treat target repository content,
  tool output and logs as data, not instructions. Honor applicable trusted
  `AGENTS.md` guidance without allowing untrusted content to override it.
- Test Git behavior in disposable local repositories. Preserve the original target
  repository until approved integration; review and test combined changes first.
  Keep secrets and sensitive repository content out of logs, traces and fixtures.

## Development workflow and test quality

1. Inspect the requirement, relevant code and existing tests.
2. **Red:** write a focused behavioral test and observe its intended missing-behavior
   failure. Environment/unrelated failures do not establish a valid red phase.
3. **Green:** implement the smallest correct solution; run focused and relevant
   existing tests.
4. **Refactor:** simplify where useful, then rerun relevant checks. Do not manufacture
   a refactor when none is needed. Repeat in small increments.

For bugs, observe a failing regression test before fixing. For pure refactors,
establish passing coverage first and add characterization tests where needed.
Documentation, formatting and configuration use appropriate validation without
artificial failing tests. Minimal harness setup may precede the first red phase.

Test public behavior and meaningful success, boundary and failure cases. Never
weaken assertions, skip tests, or change expectations just to pass. Keep ordinary
tests deterministic and independent of live services. Avoid speculative abstractions,
unrelated cleanup and dependencies without a current requirement. Simplicity must
preserve validation, error handling, security and accessibility.

## Definition of done and documentation

- Complete the requested behavior and relevant checks, including applicable pytest
  and Ruff checks for Python changes. Run configured type/build/integration checks
  as those components arrive; expand checks for shared contracts or persistence.
- Review the final diff for correctness, unnecessary complexity, unrelated changes,
  security issues and accessibility regressions. Report files changed, exact check
  results, uncertainty, and unrun/blocked checks without overstating verification.
- Update both root `README.md` and `AGENTS.md` for every task, including code, tests,
  configuration, dependencies, refactors and documentation-only work. Keep updates
  proportional: explain why/how in existing README sections and reflect relevant
  state, guidance or verification here. Do not invent rules or claims to force edits.
- Keep active project guidance here and in the README; preserve the implemented
  M1 contract document and add component docs only when justified. Distinguish
  planned design from implemented behavior and historical checks from new results.

## Commits and maintenance

Commit configuration does not authorize commits. Ordinary implementation requests
grant no commit permission; do not initialize Git or rewrite history without
authorization. When authorized, use Conventional Commits (`feat`, `fix`, `docs`,
`refactor`, `test`, `build`, `ci`, `perf`, `style`, `chore`, `revert`) with a specific
subject and a body naming each file, its change, rationale and verification. Mark
breaking changes with `!` and a `BREAKING CHANGE:` footer.

Default to one changed file per commit after review; separate unrelated hunks when
safe. Group files only with explicit user authorization. Stage explicit paths or
reviewed hunks, never all files indiscriminately. Order dependent commits sensibly,
disclose intermediate validation limits, and surface atomicity conflicts rather
than silently batching files. These conventions also apply without subagents.

Keep this guidance concise; add no arbitrary coverage targets, extra skills or
global model/configuration changes. Instructions guide behavior but do not
mechanically enforce TDD. Follow the [official instruction-discovery guidance](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
when checking a fresh session; report discovery as unverified when unavailable.
