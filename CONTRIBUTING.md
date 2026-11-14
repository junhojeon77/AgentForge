# Contributing to AgentForge

Thanks for helping. This guide covers setup, the workflow, commits and a map of the code. Who
decides what is in [GOVERNANCE.md](GOVERNANCE.md), and what is planned is in
[ROADMAP.md](ROADMAP.md).

## Setup

Python 3.11+ on Windows. From the repository root in PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e "./apps/api[dev]"
```

## Commands

```powershell
.\.venv\Scripts\python.exe -m agentforge                      # five-worker mock demo, prints JSON report
.\.venv\Scripts\python.exe -m agentforge setup                # copy default personas to %APPDATA%\AgentForge\agents
.\.venv\Scripts\python.exe -m pytest apps/api/tests          # all tests
.\.venv\Scripts\python.exe -m pytest apps/api/tests/test_scheduler.py::test_empty_plan   # single test
.\.venv\Scripts\python.exe -m ruff check apps/api
.\.venv\Scripts\python.exe -m ruff format --check apps/api
```

The live Claude Code test is opt-in because it is billed to the logged-in Claude account:

```powershell
$env:AGENTFORGE_LIVE_CLAUDE = "1"
$env:AGENTFORGE_CLAUDE = "$env:USERPROFILE\.vscode\extensions\anthropic.claude-code-2.1.323-win32-x64\resources\native-binary\claude.exe"
.\.venv\Scripts\python.exe -m pytest apps/api/tests/test_claude_code.py::test_live_claude_code_reads_the_workspace
```

Pytest config lives in `apps/api/pyproject.toml` and sets `asyncio_mode = "auto"`, so async tests
need no marker. Ruff targets py311 with line length 100 and rules `E F I UP B ASYNC`. There is no
type checker, frontend build, migration tool or CI yet.

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

A change is done when pytest and both Ruff checks pass, the diff has been reviewed for
correctness, unrelated changes and security, and the PR reports the exact results (with any checks
that were not run named). When behavior changes, update the README (usage), ROADMAP.md (status)
and the matching milestone doc, keeping implemented and planned behavior apart.

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
agent personas, all in `apps/api/src/agentforge`. State is lost when the process exits.

- **`domain.py`: contracts.** Every model extends `Contract` (Pydantic, `frozen=True`,
  `extra="forbid"`, `revalidate_instances="always"`); collections are tuples. `TaskSpec` is the
  frozen task definition. Mutable progress lives in separate scheduler-owned
  `TaskState`/`WorkerState`/`TaskAttempt` values, which are replaced with
  `model_copy(update=...)`, never mutated. `AgentConfig.model` (default `None` = runtime default)
  and `reasoning` (`low`…`max`) are read by the Claude Code executor; `permissions` is still
  descriptive. `AgentConfig.persona` (≤10,000 chars, the cap keeps the CLI argument under the
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
    sets `_wake`. The worker stays reserved through validation.
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
- **`claude_code.py`: `ClaudeCodeExecutor`.** Runs one `claude -p --output-format stream-json`
  process per task in the task's `workspace_reference` folder, read-only (`--tools
  Read,Glob,Grep --permission-prompts none --restricted --strict-mcp-config`), or with
  `Edit,Write` and `--permission-mode acceptEdits` added when the task allows `"edit"`. It
  never gets a tool that runs commands. The prompt goes
  on stdin, a fresh `--session-id`, `--effort`/`--model` from `AgentConfig`, the persona as
  `--append-system-prompt`, the `WorkerResult` schema via `--json-schema`, and a
  `--max-budget-usd` cap. Every event goes to `on_event`; the final `result.structured_output`
  becomes the `WorkerResult`. On a retry the prompt also carries `previous_failure`, labelled as
  data, not instructions. The session id comes from `Assignment.session_id`. With
  `Assignment.resume` it runs `--resume <id>` and a short "continue" prompt instead; if the CLI
  says it has no such session, it starts one fresh session in the same folder. An error result → `WORKER_FAILURE`, no result →
  `EXECUTOR_EXCEPTION`, and cancellation kills the process. The CLI is usually not on PATH: pass
  `command=(<path to the VS Code extension's claude.exe>,)`.
- **`worktrees.py`: one checkout per task.** `create`, `diff` and `remove` are thin async
  wrappers over `git`. `create` resolves the commit with `rev-parse --end-of-options` before
  `worktree add --detach`, so a commit string can't act as a flag, and requires an absolute
  path. `diff` stages everything in the worktree's own index and diffs it against `HEAD` with
  external diff programs off, because worktree content is untrusted. `WorktreeExecutor(inner,
  root)` wraps another executor: it creates `root/<run_id>/<task_id>/<attempt>` (ids limited to
  `[A-Za-z0-9_-]+`), runs `inner` there and adds `workspace` and `diff` to the result. Each retry
  gets a new worktree. Worktrees are kept, are not sandboxes, and are reused only by an attempt
  that is being resumed after a pause.
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
  raises `ValueError` naming the bad file. M5/M6 will call these functions; there is no API or UI
  yet.
- **`__main__.py`** wires the mocks into a five-task plan to demonstrate concurrent execution;
  `python -m agentforge setup` creates the persona folder at `default_folder()`.

Tests are in `apps/api/tests/`:
- `test_contracts.py`: contract validation and immutability.
- `test_scheduler.py`: dispatch, failure, retries, pause/resume, cancellation, race behavior, log
  lines and a demo smoke test. `GatedExecutor` holds each task at its own gate.
- `test_personas.py`: the persona folder.
- `test_claude_code.py`: the Claude Code executor. It uses `fake_claude.py`, which replays
  `fixtures/claude_stream.jsonl` (a trimmed live recording). Its live test is opt-in.
- `test_worktrees.py`: worktrees and diffs in disposable Git repositories, plus full
  edit → diff → check runs with the fake Claude, one of them retried after a failing check.
- `test_validation.py`: the command validator. Its `hanging` fixture is a check that reports
  its pid over a local socket, a barrier for the timeout and cancellation tests.

Delivered contracts and limits are in [M1-domain.md](docs/milestones/M1-domain.md),
[M2-claude-code.md](docs/milestones/M2-claude-code.md),
[M3-worktrees.md](docs/milestones/M3-worktrees.md) and
[M4-orchestration.md](docs/milestones/M4-orchestration.md).
