# Contributing to AgentForge

Thanks for helping. This guide covers setup, the workflow, commits and a map of the code. Who
decides what is in [GOVERNANCE.md](GOVERNANCE.md), and what is planned is in
[ROADMAP.md](ROADMAP.md).

**Who it is for.** People who do not code: you ask for something in your own words, the
lead agent plans it, you approve the plan, and the team of agents builds it. People who do code
can still customize, fine-tune or edit anything (agents, plans, rights, checks) and feel at
home. The app leads with the plain path and keeps every technical control one click away; on
first start a welcome screen lets each person choose whether those controls start open (the
side list changes it later) and offers a short tour.

When you write a screen or a message: plain words first (say "May change files", not
`allowed_operations`), ids still visible, and technical controls behind **More options** or a
"for developers" section, never removed.

## Setup

Python 3.11+ on Windows. From the repository root in PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e "./apps/api[dev]"
```

The desktop app also needs Node.js and Rust (with the MSVC build tools Tauri requires):

```powershell
npm --prefix apps/desktop install
```

## Commands

```powershell
.\.venv\Scripts\python.exe -m agentforge                      # five-worker mock demo, prints JSON report
.\.venv\Scripts\python.exe -m agentforge setup                # copy default personas to %APPDATA%\AgentForge\agents
.\.venv\Scripts\python.exe -m agentforge claude "<task>"       # one read-only Claude Code task (billed)
.\.venv\Scripts\python.exe -m agentforge plan "<request>"      # lead agent: print a task plan (billed)
.\.venv\Scripts\python.exe -m agentforge clean <run_id> --repo <repo> --root <root>  # delete a finished run's worktrees
.\.venv\Scripts\python.exe -m agentforge serve --worktrees <dir> [--check name=command]   # local API on 127.0.0.1:8765
.\.venv\Scripts\python.exe -m pytest apps/api/tests          # all tests
.\.venv\Scripts\python.exe -m pytest apps/api/tests/test_scheduler.py::test_empty_plan   # single test
.\.venv\Scripts\python.exe -m ruff check apps/api
.\.venv\Scripts\python.exe -m ruff format --check apps/api
npm --prefix apps/desktop test                                # desktop tests (Vitest)
npm --prefix apps/desktop run build                           # desktop type check (tsc) + Vite build
npm --prefix apps/desktop run tauri dev                       # open the desktop app
```

The live Claude Code test is opt-in because it is billed to the logged-in Claude account:

```powershell
$env:AGENTFORGE_LIVE_CLAUDE = "1"
$env:AGENTFORGE_CLAUDE = "$env:USERPROFILE\.vscode\extensions\anthropic.claude-code-2.1.323-win32-x64\resources\native-binary\claude.exe"
.\.venv\Scripts\python.exe -m pytest apps/api/tests/test_claude_code.py::test_live_claude_code_reads_the_workspace
```

Pytest config lives in `apps/api/pyproject.toml` and sets `asyncio_mode = "auto"`, so async tests
need no marker. Ruff targets py311 with line length 100 and rules `E F I UP B ASYNC`. The desktop
app is type-checked with `tsc` (strict) as part of its build. There is no Python type checker or
CI yet.

Database migrations live in `apps/api/src/agentforge/migrations/versions/`. `RunStore` applies them
itself. To write a new one after changing the tables in `store.py`:

```powershell
.\.venv\Scripts\python.exe -m alembic -c apps/api/alembic.ini revision -m "what changes"
```

Test every migration up and down on a disposable database, as `test_store.py` does.

## Workflow

1. Read the requirement, the code it touches and its tests.
2. **Red:** write a focused behavioral test and watch it fail for the intended reason. For a bug,
   start with a failing regression test.
3. **Green:** make the smallest correct change, then rerun the focused and related tests.
4. **Refactor** only where it helps, then rerun. Docs, formatting and config changes need no
   failing test.

Test public behavior, including boundary and failure cases. In async tests, use deterministic
barriers (such as `MockExecutor(gate=..., expected_starts=N)`), not sleeps. Never weaken
assertions, skip tests or change expectations just to pass.

A change is done when pytest and both Ruff checks pass (and, for `apps/desktop`, its tests and
build), the diff has been reviewed for
correctness, unrelated changes and security, and the PR reports the exact results (with any checks
that were not run named). Every change also updates every document it affects in the same piece
of work: the README (usage), ROADMAP.md (status, deferred lists, verification history), every
milestone doc that mentions it (a done row leaves its "Not implemented yet" table), this file's
code map and commands, GOVERNANCE.md and CLAUDE.md. Keep implemented and planned behavior apart,
and say in the PR which documents changed.

## Commits and pull requests

- [Conventional Commits](https://www.conventionalcommits.org/) in English: `feat`, `fix`, `docs`,
  `refactor`, `test`, `build`, `ci`, `perf`, `style`, `chore`, `revert`.
- Keep messages short: a specific subject line and, if needed, a body of one to three lines.
  Put the full explanation and verification results in the PR description.
- Mark breaking changes with `!` and a `BREAKING CHANGE:` footer.
- Line endings are LF, enforced by [.gitattributes](.gitattributes). If you change it, run
  `git add --renormalize .` and commit the result.

## Code map

The code is a library, not a service: immutable contracts, a deterministic in-memory async
scheduler, mock workers, a Claude Code worker, Git worktrees, a command validator and editable
agent personas and an optional SQLite run store, all in `apps/api/src/agentforge`. Without a store,
state is lost when the process exits.

- **`domain.py`: contracts.** Every model extends `Contract` (Pydantic, `frozen=True`,
  `extra="forbid"`, `revalidate_instances="always"`); collections are tuples. `Identifier` (ids,
  roles, titles) rejects control characters and line separators, because those values are
  printed in logs and transition reasons. `TaskSpec` is the
  frozen task definition. Mutable progress lives in separate scheduler-owned
  `TaskState`/`WorkerState`/`TaskAttempt` values, which are replaced with
  `model_copy(update=...)`, never mutated. `AgentConfig.model` (default `None` = runtime default;
  model ids and aliases only, never a value that reads as a flag) and `reasoning` (`low`…`max`)
  are read by the Claude Code executor. `TaskSpec.timeout_seconds` (optional) limits each
  attempt's worker.
  `AgentConfig.persona` (≤10,000 chars, the cap keeps the CLI argument under the
  Windows command-line limit) is sent as `--append-system-prompt`. `WorkerResult.session_id`,
  `workspace` and `diff` are set by executors, never by the model. `TaskSpec.allowed_operations`
  containing `"edit"` is what lets a Claude Code worker edit files. `TaskSpec.max_attempts`
  (1–5, default 1) allows retries; `Assignment.previous_failure`, `TaskState.attempt_number`,
  `TaskAttempt.message` and `Transition.detail` record them. `Assignment.session_id` (chosen by
  the scheduler, kept on `TaskAttempt.session_id`) and `Assignment.resume` let an attempt stopped
  by a pause be continued.
- **`orchestration.py`: `Scheduler`.** Two `Protocol` seams are where workers and validators plug
  in: `WorkerExecutor.execute(Assignment) -> WorkerResult` (mock or Claude Code) and
  `ResultValidator.validate(TaskSpec, WorkerResult) -> ValidationReport` (mock or
  `CommandValidator`).
  - `run(plan)` validates the whole DAG up front: unique IDs, matching `run_id`, known
    dependencies, registered roles, and acyclicity via Kahn's algorithm. Kahn's dependents map is
    kept as `_dependents` for blocking. It then loops `_dispatch()` → wait on `_wake` until every
    task is terminal. A new run is refused while a previous run's tasks are still cleaning up.
  - `_dispatch()` promotes PENDING→READY when all dependencies are COMPLETED. It sorts READY tasks
    by `(-priority, id)`, reserves the lowest-ID idle worker of the matching role, and spawns one
    asyncio task per assignment, up to `max_concurrency` (1–5).
  - `_execute()` runs RUNNING → executor → result validation → VALIDATING → validator →
    COMPLETED/FAILED. Its `finally` fails a task that is still RUNNING or VALIDATING (a
    `BaseException` that bypassed the handlers), releases the worker, drops the active task and
    sets `_wake`. The worker stays reserved through validation. The executor call runs inside
    `asyncio.timeout(task.timeout_seconds)`; when that limit expires the attempt fails as
    `WORKER_TIMEOUT`, and a `TimeoutError` the worker raised itself stays `EXECUTOR_EXCEPTION`.
  - `_fail()` decides retries. With attempts left, and unless the reason is
    `VALIDATOR_EXCEPTION`, it marks the attempt FAILED and puts the task back to READY, never
    FAILED, because FAILED is terminal and would block descendants. Otherwise the task fails.
    Attempts are keyed by `(task_id, number)`; `_transition()` leaves an already-finished attempt
    alone, so cancelling a task that waits for its retry keeps the failed attempt's record.
  - Pause/resume: `pause_task`/`pause_run` mark unfinished tasks PAUSED (`_hold()`), then stop
    their workers with `_stop()`, the same helper cancellation uses. PAUSED is not terminal, so
    `run()` keeps waiting. `resume_*` put tasks back to PENDING. In `_dispatch()` an attempt that
    is not finished means "stopped by a pause": it is continued (`Assignment.resume`), with the
    same number and session id, and only on the worker that started it. `_execute()` skips the
    worker when the attempt already has a result (paused during validation). After each await
    it checks that the task is still RUNNING or VALIDATING, and `_fail()` ignores anything
    else, so a stopped worker's late result or error cannot change a paused task.
  - Diagnostics: every `_transition()`/`_record()` call passes a `detail` saying why, so no
    `Transition.detail` is empty. BLOCKED and CANCELLED also put it in `TaskState.message`
    (`_block_descendants()`, `_cancel()`, `_cancel_all()`). `_record()` logs every transition
    with its detail at DEBUG and `_fail()` logs the retry decision at WARNING. No module logs a
    prompt, persona, diff, check output, failure message or exception text.
  - Atomicity relies on a single event loop and on making no `await` inside a state mutation.
    `_transition()` refuses to leave a terminal state, so the first terminal outcome wins: late
    success can't overwrite cancellation.
  - FAILED/CANCELLED recursively mark descendants BLOCKED (`blocked_by` = origin) while
    independent branches continue. Task failure is reported in `RunReport`, not raised. Only
    graph/contract errors raise.
  - `model_validate(x)` re-checks inputs and outputs even when built with `model_construct`.
    `snapshot()` builds fresh frozen objects, so callers can't change scheduler state.
  - Cancellation (`cancel_task`, `cancel_run`, or cancelling the `run` coroutine) awaits cleanup.
    `run` shields its `cancel_run()` so a repeated caller cancellation can't interrupt cleanup.
    `_release_unstarted()` covers tasks cancelled before their coroutine's first step, where
    `finally` never runs.
- **`mocks.py`: test doubles.** `DEFAULT_ROLES` lists backend, frontend, database, qa and
  integration. The lead orchestrator is not a registered worker. `MockExecutor(gate=...,
  expected_starts=N)` provides a deterministic barrier: `started` fires after N assignments, and
  the executor blocks until the gate opens. `MockValidator` checks string evidence only:
  `expected_output` ⊆ artifacts, `acceptance_criteria` ⊆ satisfied criteria, and each
  `check:<name>` constraint ⊆ `passed_checks`. It never inspects files or runs commands.
  `register_default_workers` registers `default_agents()`.
- **`claude_code.py`: `ClaudeCodeRunner` and `ClaudeCodeExecutor`.** `ClaudeCodeRunner` is a
  LangChain Runnable that runs one CLI session from a `ClaudeCall` and returns its `result`
  event; it owns the fixed flags, the batch-file check, the process handling and the
  no-session fallback. `ClaudeCodeExecutor` (also a Runnable) builds a worker's call and
  runs it through the runner. Together they run one `claude -p --output-format stream-json`
  process per task in the task's `workspace_reference` folder, read-only (`--tools
  Read,Glob,Grep --permission-prompts none --restricted --strict-mcp-config`), or with
  `Edit,Write` and `--permission-mode acceptEdits` added when the task allows `"edit"`. A task
  that also allows `"check"` gets `Bash` with `--permission-mode dontAsk` and one exact
  `--allowedTools "Bash(<command>)"` rule per check, built from the executor's `checks` mapping
  (`_check_commands`); otherwise it never gets a tool that runs commands. The prompt goes
  on stdin, a fresh `--session-id`, `--effort`/`--model` from `AgentConfig`, the persona as
  `--append-system-prompt`, the `WorkerResult` schema via `--json-schema`, and a
  `--max-budget-usd` cap. Every event goes to `on_event`; the final `result.structured_output`
  becomes the `WorkerResult`. On a retry the prompt also carries `previous_failure`, labelled as
  data, not instructions. The session id comes from `Assignment.session_id`. With
  `Assignment.resume` it runs `--resume <id>` and a short "continue" prompt instead; if the CLI
  says it has no such session, it starts one fresh session in the same folder. An error result → `WORKER_FAILURE`, no result →
  `EXECUTOR_EXCEPTION`, and cancellation kills the process. The CLI is usually not on PATH: pass
  `command=(<path to the VS Code extension's claude.exe>,)`. A `.cmd`/`.bat` launcher is
  rejected, because cmd.exe would cut the multi-line persona. An output line that is not a JSON
  event is skipped with a WARNING (length only).
- **`worktrees.py`: one checkout per task.** `create`, `diff` and `remove` are thin async
  wrappers over `git`. `create` resolves the commit with `rev-parse --end-of-options` before
  `worktree add --detach`, so a commit string can't act as a flag, and requires an absolute
  path. `diff` stages everything, ignored paths included (`git add -A -f`), in the worktree's
  own index and diffs it against `HEAD` with
  external diff programs off, because worktree content is untrusted. `WorktreeExecutor(inner,
  root)` wraps another executor: it creates `root/<run_id>/<task_id>/<attempt>` (ids limited to
  `[A-Za-z0-9_-]+`), runs `inner` there and adds `workspace` and `diff` to the result. Each retry
  gets a new worktree. Worktrees are kept, are not sandboxes, and are reused only by an attempt
  that is being resumed after a pause. `remove_run(repo, root, run_id)` deletes every worktree
  of a finished run on request; a folder Git does not know as a worktree is kept and named in
  the error.
- **`store.py`: `RunStore`.** SQLite through SQLAlchemy Core: tables `runs`, `tasks`, `attempts`
  and `transitions`. Contracts are stored as JSON and validated with Pydantic on load, so
  `domain.py` stays the one definition. Opening a store runs the Alembic migrations in
  `migrations/` (`env.py` uses the store's connection, or the URL in `apps/api/alembic.ini`
  when run from the command line). `Scheduler._record` calls `save()` on every transition;
  a failed save sets `_store_error`, which `_drive()` raises, cancelling the run. `recover()`
  loads a run, pauses in-flight tasks through the pause path and adds them to `_run_paused`.
- **`lead.py`: the lead agent.** `Planner` is a LangChain Runnable around a compiled LangGraph
  `StateGraph` with the nodes draft, check, critique and revise. Draft, critique and revise are
  read-only `ClaudeCodeRunner` sessions with prompts from `PromptTemplate` and replies read by
  `PydanticOutputParser`. check is plain code: `orchestration.validate_plan`, the same rules the
  scheduler applies, so the two cannot drift. `TaskDraft` lists the only fields the model may
  set; rights and limits come from `task_defaults`. `AgentDraft` (in `PlanDraft.new_agents`) is
  a new agent the model may propose; `_new_agents` checks it (id, clash with `agent_ids`, role,
  use) and the API saves it only when a person approves the plan.
- **`validation.py`: `CommandValidator`.** Runs each `check:<name>` constraint as a configured
  argv (no shell) in the result's workspace with a timeout. It rejects on a non-zero exit, a
  timeout or an unknown check, and never reads the worker's `passed_checks`. Timeout and
  cancellation kill the check process, but not its children.
- **`personas.py`: editable agents.** One `<id>.md` per agent: flat `key: value` settings (`id`,
  `role`, `model`, `reasoning`) between `---` lines, then the persona text. It is parsed by hand
  (no YAML dependency) and read as `utf-8-sig`, because Windows editors may add a BOM. Ids are
  `[a-z0-9_-]+`: lowercase because Windows file names ignore case, and no path characters. The
  file name must equal the id, on load and on save. `setup(folder)` copies the shipped
  `default_personas/*.md` only into a folder with no personas, so it never overwrites edits or
  restores removed agents. `save_agent` writes a temp file, then `os.replace`. `load_agents`
  raises `ValueError` naming the bad file. `check_id` is the id rule on its own, used by the
  lead's check. The API's agent routes call these functions.
- **`api.py`: the local REST API (M5).** `create_app(settings, workers=, validator=)` builds
  the FastAPI app; tests pass mock workers. A token dependency guards every route with
  `secrets.compare_digest`. `_Server` holds the store, the one active run (`launch` starts it
  as an asyncio task and turns an early `ValueError` into a 400) and the event-stream queues
  that `Scheduler(on_transition=...)` feeds. `_granted` applies the rights a person gives on
  approval; every task defaults to read-only. `serve` runs uvicorn on 127.0.0.1 only.
  Since M6: `_Server.agents()` reads `ApiSettings.agents` again for every plan check and run
  start (injected test workers skip it), so an edit applies from the next run; the agent routes
  are plain `def` so FastAPI runs their file I/O in a thread; `CORSMiddleware` allows only
  `ApiSettings.origins` and answers preflights before the token check; `GET /runs` and
  `GET /proposals` use `RunStore.runs()` and `proposals()`, ordered by SQLite rowid.
  The scheduler side: `AWAITING_APPROVAL` (set in `_execute` when `review_edits` is on),
  `approve_task` (re-dispatches the attempt, whose result makes `_execute` validate only),
  `reject_task` (through `_fail`), and `retry_task`/`recover(retry=...)` (`_reopen`, the only
  way out of a final status). `_hold` leaves a waiting task alone so a pause never skips an
  approval.
- **`__main__.py`**: `cli()` parses the command line with `argparse`. No arguments runs the
  mock five-task demo (`main()`); `setup` creates the persona folder at `default_folder()`;
  `claude "<task>"` runs one read-only task with `ClaudeCodeExecutor` for every agent in the
  persona folder (or the defaults) and prints the report. A missing folder or an unknown role
  stops it before Claude starts. `clean <run_id> --repo --root` calls `worktrees.remove_run`.
  `serve` writes a new token file and starts `api.serve`; it imports the web stack only then.

Tests are in `apps/api/tests/`:
- `test_contracts.py`: contract validation and immutability.
- `test_scheduler.py`: dispatch, failure, retries, pause/resume, cancellation, race behavior, log
  lines and a demo smoke test. `GatedExecutor` holds each task at its own gate.
- `test_personas.py`: the persona folder.
- `test_claude_code.py`: the Claude Code executor. It uses `fake_claude.py`, which replays
  `fixtures/claude_stream.jsonl` (a trimmed live recording). Its live test is opt-in.
- `test_worktrees.py`: worktrees and diffs in disposable Git repositories, plus full
  edit → diff → check runs with the fake Claude, one of them retried after a failing check.
- `test_lead.py`: the lead agent, with `fake_claude.py` in `script` mode replying from a prepared
  list, one reply per call.
- `test_store.py`: saved runs, migrations and recovery on disposable databases. `crash_run.py` is a
  run that the crash test kills mid-task in a real subprocess.
- `test_api.py`: the REST API through FastAPI's `TestClient` with mock workers; `until()` asks
  for the report until a state is reached, each request letting the server's loop run. The
  `real_workers_client` fixture loads workers from a temporary agents folder, with only the
  worktree executor replaced by a mock.
- `test_validation.py`: the command validator. Its `hanging` fixture is a check that reports
  its pid over a local socket, a barrier for the timeout and cancellation tests.

The desktop app (M6) is in `apps/desktop`: Tauri 2, React and TypeScript, built with Vite.

- **`src-tauri/`: the Rust shell.** `main.rs` only registers `tauri-plugin-fs`.
  `capabilities/default.json` lets the window read one file, `$DATA/AgentForge/api-token`
  (`$DATA` is `%APPDATA%`; `$APPDATA` would be the app's own folder). Bundling is off until M8.
- **`src/api/client.ts`: `createClient({readToken, fetch})`.** `send` adds the bearer token,
  re-reads it once after a 401 (the server writes a new one at every start) and turns failures
  into `ApiError` with a `kind`: `no-token`, `offline`, `unauthorized` or `http` (with the
  server's `detail`; FastAPI's field errors become `field: message` lines, and the parsed body
  is kept as `ApiError.body`). `request` is `send` plus JSON; `jsonBody(body)` makes a JSON
  request (POST unless a method is given). It logs every change it sends and every refusal as `<method> <path> answered <status>`,
  never a body.
- **`src/api/events.ts`: `followEvents`.** It reads `GET /runs/{id}/events` with `fetch`, because
  `EventSource` cannot send the token, and parses the frames itself. After a drop or a lost
  server it waits and reconnects with `Last-Event-ID`; it stops at `end`, on abort, or on any
  other refusal.
- **`src/api/token.ts`**: `readToken()` through the fs plugin; `null` when there is no file.
- **`src/connection.ts`: `useConnection`.** It polls `GET /runs` with TanStack Query and maps the
  outcome to a state (`connectionState`); `logState` logs each change.
- **`src/runs.ts`: the run page's rules.** The report types, `taskActions(status, live,
  attempt)` (which controls a task offers, mirroring the scheduler, Retry only below 5
  attempts), `STATUS` (each status's words and colour group), `failureLabel`, `runSummary`,
  `retriesLeft`, `attemptStartsOpen`, `reviewAttempt` (the attempt whose review band is on
  screen, so a refused approve shows under the card once the band is gone), `diffLines(diff)`
  (each line's tone by where it is: outside a hunk a file header, inside one a change, so a
  removed `-- note` stays a removed line) and `diffStats`, `stripAnsi`, and
  `sendControl(client, runId, action, task?, reason?)`, which POSTs a run or task control.
- **`src/RunPage.tsx`: one run.** `runQuery` reads `GET /runs/{id}` with TanStack Query (the side
  list shares it for the active run's count); while the run is active, the page reloads it on
  every `followEvents` event. The header, task cards, every attempt with its diff, the review
  band and the history with its task filter. `useControl` gives the header and each card their
  own pending state and refusal.
- **`src/ui.tsx`: the pieces every screen shares.** `Button` (primary, secondary, destructive,
  confirm, ghost; busy shows the static arc), `StatusBadge`, `NeedsCount`, `Alert`,
  `CopyButton` and `copyText` (a failure logged by name, never the text), `Confirm` (asks first,
  in place, focus on the safe answer), `ReasonForm` (a required reason), `problem` (an error in
  words), `TechnicalView` (true in the technical view), `MoreOptions` (technical fields, open
  only in the technical view), `Field` (a labelled field with a hint), `BUTTON` and `FIELD`.
- **`src/index.css` and `src/Icon.tsx`: the design.** The Tailwind v4 theme from
  [docs/design/agentforge](docs/design/agentforge/README.md): only its colours exist (Tailwind's
  default palette is removed, and an unknown class is silently ignored, so use the design's
  names), dark follows Windows through `prefers-color-scheme`, system fonts only. `Icon` is the
  design's stroke icon set; every icon sits beside a word.
- **`src/proposals.ts`: the proposal screens' rules.** The proposal types, `Rights` and
  `NO_RIGHTS`, `approvalBody(repository, rights, agents)` (the approve body, refusing a bad timeout),
  `parsePlan`, `newRunId`, `planTemplate`, `roundsOf(error)` and one function per request:
  `planRequest`, `proposePlan`, `approveProposal`, `rejectProposal`.
- **`src/ProposalPage.tsx`: plans.** `NewProposal` (Ask for something, and the JSON editor for
  developers) and `ProposalPage` (one plan, its new agents, its approve-with-rights form and
  reject). Technical fields sit in `MoreOptions`; the JSON editor follows `TechnicalView` too.
- **`src/agents.ts`: the team's rules.** `Agent`, `REASONING`, `PERSONA_LIMIT`, `toId(name)`,
  `agentPath`, `saveAgent` (PUT) and `removeAgent` (DELETE).
- **`src/AgentsPage.tsx`: Your team.** The list, the inline editor and remove; `AgentFields`
  (how it should work, and model and reasoning under More options) is shared with the plan
  page's new agents, whose role stays as proposed; the editor adds the role.
- **`src/App.tsx`**: the status bar, the "can't reach its server" screen, the side list (Ask for
  something, Your team, and the Runs and Plans tabs with their counts of what waits for you; the
  plans and the active run's report polled with `GET /runs`) and the selected page; with no run
  yet it opens Ask for something. It shows the welcome screen until it is passed, the tour
  while one is wanted and the app is connected, and marks the tour's targets with `data-tour`.
- **`src/guide.ts`: the guide's saved choices.** `Guide` (the view, whether the welcome was
  passed, the tour wanted, done or skipped), `loadGuide` and `saveGuide` (the window's
  `localStorage`, passed in; a bad or unreadable value falls back to the start and is logged
  by reason, never by its text), and `finishWelcome`, `endTour`, `setView` and `showAgain`.
- **`src/GuideScreens.tsx`: the guide on screen.** `Welcome`, `Tour` (a modal `<dialog>` per
  step, placed beside its target by CSS anchor positioning in `index.css`) and `ViewFooter`
  (the side list's **View** switch and **Show the guide again**).
- **`src/log.ts`**: console lines prefixed `agentforge.desktop:`. Ids, statuses, paths and
  reasons only, never the token or response text.

Its tests sit next to the code (`*.test.ts`) and use a fake `fetch`, a fake token reader and
an injected `wait`, with no timers: `client.test.ts`, `events.test.ts`, `connection.test.ts`,
`runs.test.ts`, `proposals.test.ts`, `agents.test.ts`, `ui.test.ts` and `guide.test.ts` (a
fake storage). The components have no tests of their own; `tsc` checks them.

Delivered contracts and limits are in [M1-domain.md](docs/milestones/M1-domain.md),
[M2-claude-code.md](docs/milestones/M2-claude-code.md),
[M3-worktrees.md](docs/milestones/M3-worktrees.md),
[M4-orchestration.md](docs/milestones/M4-orchestration.md),
[M5-api.md](docs/milestones/M5-api.md) and [M6-desktop.md](docs/milestones/M6-desktop.md).
