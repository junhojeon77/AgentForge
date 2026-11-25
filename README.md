# AgentForge

A local-first Windows platform where one lead agent coordinates specialized coding agents. It ships
with seven, and you can add, remove or fully customize any of them.

**Who it is for.** People who do not code: you ask for something in your own words, the
lead agent plans it, you approve the plan, and the team of agents builds it. People who do code
can still customize, fine-tune or edit anything (agents, plans, rights, checks) and feel at
home. The app leads with the plain path and keeps every technical control one click away; on
first start a welcome screen lets each person choose whether those controls start open (the
side list changes it later) and offers a short tour.

**Status:** M1–M5 are implemented: a Python library (workers, worktrees, retries,
pause/resume, saved runs with recovery, a lead agent that turns a request into a plan) and a
local REST API with approvals and live events. The desktop app (M6) is implemented: it lists
runs and follows each one live, with its diffs to approve or reject and controls to pause,
cancel, retry or recover work, and starts runs: ask for something in plain words, then approve
the lead agent's plan with the rights each task gets, and edits your team of agents (the lead
agent can propose a new one with a plan). Every screen follows the visual design: dark, or light if you pick
it. A run opens as a board of agent tiles, one group per role under the lead agent. On first start a welcome screen explains the app, asks for the plain or
technical view and offers a short tour. Every change a task makes is reviewed by the reviewer
agent, and the lead agent can plan fixes from those reviews.

## What is AgentForge

AgentForge is a local-first Windows desktop platform for coordinating software development agents. A
lead agent breaks a request into tasks, and specialized workers carry them out under deterministic
control and human approval. Seven agents come by default: five that build (backend, frontend,
database, QA and integration), a reviewer that checks every change, and an auditor that reviews a
whole repository. The team is yours to shape: add or remove agents, and set each one's role, model,
reasoning level and persona. At most five run at once.

It has three parts: the core library (`apps/api/src/agentforge`), a local REST API on top of it
(step 9 below) and the desktop app (`apps/desktop`, step 10). The library holds:

- **Contracts:** immutable task, worker, result and report models.
- **Scheduler:** a deterministic, in-memory async scheduler that runs a task graph on up to five
  workers at once.
- **Workers:** mock workers for demos and tests, plus a worker that runs the Claude Code
  CLI. It is read-only unless a task allows edits, and runs no commands unless a task lets it
  run its own check commands.
- **Worktrees:** each task can get its own Git worktree, and its diff is recorded.
- **Validation:** a validator that runs your check commands, such as pytest, on the result.
- **Lead agent:** a LangGraph workflow that turns a plain-English request into a task plan,
  checks it with the scheduler's rules, has Claude critique it and revises it. It cannot grant
  edit rights; you do.

The mock demo and the offline tests need no account or API key. Real Claude Code workers use your
logged-in Claude Code install.

## Why AgentForge

- **The model doesn't control the run.** AI reasoning is kept apart from scheduling, execution
  control, validation, permissions and human approval. Plain, testable code decides what runs
  next and when a task is done.
- **Agent output isn't trusted.** Every result goes through an independent validator before a
  task counts as completed. `CommandValidator` runs your check commands itself and ignores
  what the worker says it checked.
- **Local-first.** The scheduler, workers and state run on your machine, with no server to
  host. The Claude Code worker does send the files it reads to Claude, like any Claude Code
  session.
- **Replaceable workers.** Every worker sits behind one small interface, so a mock, Claude Code
  or a future runtime can be swapped without touching the scheduler.

## Core design

```mermaid
flowchart LR
    Plan[RunPlan<br/>tasks + dependencies] --> Scheduler
    Scheduler -->|Assignment| Executor[WorkerExecutor<br/>Mock or Claude Code]
    Executor -->|WorkerResult| Validator[ResultValidator]
    Validator -->|ValidationReport| Scheduler
    Scheduler --> Report[RunReport]
```

- **Immutable contracts.** Every model is a frozen Pydantic object that rejects unknown fields.
  The scheduler records progress by replacing values, never by changing them in place.
- **The whole graph is checked first.** Before anything runs, `run()` checks for unique IDs,
  known dependencies, registered roles and cycles. A bad plan raises an error; a failed task is
  reported in the `RunReport` instead.
- **Deterministic dispatch.** Ready tasks run by priority, then by ID, on the matching role's
  free worker. `max_concurrency` is 1–5 (default 5).
- **Failure stays local.** A failed or cancelled task blocks only the tasks that depend on it.
  Independent branches keep running.
- **Retries start clean.** A task can allow up to five attempts. Each retry gets a fresh worktree
  and session and is told why the last attempt failed.
- **Pause and resume.** Pausing a task or the run stops its workers at once. Resuming continues
  the same attempt in the same worktree and Claude session.
- **Clean cancellation.** Cancelling a task or a run stops its work and waits for cleanup. For
  Claude Code this kills the CLI process.
- **Restricted Claude Code worker.** Each task gets one `claude -p` process limited to the Read,
  Glob and Grep tools, with a spending cap, a fresh session ID and a schema-checked result. A
  task that allows `"edit"` adds Edit and Write. A task that also allows `"check"` lets the worker
  run its own check commands, and nothing else that changes anything.
- **One worktree per task.** Edits happen in a separate Git worktree, never in your checkout.
  AgentForge records the diff with Git instead of asking the worker what it changed.
- **Editable personas.** Each agent is one Markdown file: its settings plus a persona that the
  Claude Code worker adds to its system prompt. Setup gives you the seven defaults, and you can
  edit, add or remove agents.
- **Every change is reviewed.** When you approve a plan, AgentForge adds a review task after each
  task you let edit, and hands the reviewer that task's diff. From a finished run's reviews, the
  lead agent can plan the fixes; that plan waits for your approval like any other.

A run can be saved to SQLite and recovered after a restart; without a store it lives in memory only.
What is built and what is planned is in [ROADMAP.md](ROADMAP.md).

## Prerequisites

- Windows with PowerShell
- Python 3.11 or newer
- Git, to clone the repository and for the worktrees workers edit in
- For the desktop app only: Node.js and Rust (with the MSVC build tools Tauri requires)
- For real (non-mock) workers only: Claude Code installed and logged in. The VS Code extension
  bundles `claude.exe`. An npm install's `claude.cmd` launcher is rejected; pass the path to
  `claude.exe`.

## Install

From the repository root in PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e "./apps/api[dev]"
```

Installation requires package access. Virtual-environment activation is optional when using the
explicit interpreter paths above. Build/runtime/dev dependency ranges are in `apps/api/pyproject.toml`.

## Quick start

### 1. Run the mock demo

```powershell
.\.venv\Scripts\python.exe -m agentforge
```

The example waits until all five mock workers are executing, releases them together, validates their
mock evidence, and prints the execution report as JSON. It does not execute commands or modify a
repository.

### 2. Set up the agents

```powershell
.\.venv\Scripts\python.exe -m agentforge setup
```

This creates `%APPDATA%\AgentForge\agents` with the seven default personas and prints the path.
Running it again never overwrites your edits. See [Agents and personas](#agents-and-personas).

### 3. Run Claude Code workers

`ClaudeCodeExecutor` runs one `claude -p` process per task in the task's workspace folder. Workers
are **read-only**: they can read, search and list files, but not edit files or run commands. Each
task gets a fresh session ID and a spending cap (`max_budget_usd`, default $1). Claude Code ships
with the VS Code extension but is not on PATH, so pass the full path. This example registers every
agent from your persona folder:

```python
import asyncio
from pathlib import Path

from agentforge.claude_code import ClaudeCodeExecutor
from agentforge.domain import RunPlan, TaskSpec
from agentforge.mocks import MockValidator
from agentforge.orchestration import Scheduler
from agentforge.personas import default_folder, load_agents

CLAUDE = Path.home() / (
    r".vscode\extensions\anthropic.claude-code-2.1.323-win32-x64\resources\native-binary\claude.exe"
)

async def main():
    scheduler = Scheduler(validator=MockValidator())
    claude = ClaudeCodeExecutor(command=(str(CLAUDE),), on_event=lambda task_id, e: print(task_id, e["type"]))
    for agent in load_agents(default_folder()):  # each agent's persona becomes its system prompt
        scheduler.register_worker(agent, claude)
    task = TaskSpec(id="t1", run_id="r1", title="Summarize the README", role="qa",
                    workspace_reference=r"C:\path\to\some\project")
    print((await scheduler.run(RunPlan(id="r1", tasks=(task,)))).model_dump_json(indent=2))

asyncio.run(main())
```

Each run is billed to your Claude Code login. Add `timeout_seconds=600` to a task to stop a worker
that runs longer than ten minutes; the attempt then fails as `worker_timeout`.

To try one task without writing Python, use the `claude` command. It loads your agents, runs one
read-only task in the folder you name and prints the report:

```powershell
$env:AGENTFORGE_CLAUDE = "$env:USERPROFILE\.vscode\extensions\anthropic.claude-code-2.1.323-win32-x64\resources\native-binary\claude.exe"
.\.venv\Scripts\python.exe -m agentforge claude "Summarize the README" --workspace C:\path\to\project --timeout 600
```

`--role` picks the agent (default `qa`). Details are in [the M2 doc](docs/milestones/M2-claude-code.md).

### 4. Let a worker edit code in a worktree

Wrap the executor in `WorktreeExecutor`, allow `"edit"` on the task, and use `CommandValidator`
to run real checks. Change these lines in the example above:

```python
from agentforge.validation import CommandValidator
from agentforge.worktrees import WorktreeExecutor

    scheduler = Scheduler(validator=CommandValidator(checks={"unit": ("python", "-m", "pytest")}))
    worker = WorktreeExecutor(claude, root=r"C:\path\to\worktrees")  # share one for all agents
    ...
        scheduler.register_worker(agent, worker)
    task = TaskSpec(id="t1", run_id="r1", title="Fix the failing test", role="backend",
                    repository_reference=r"C:\path\to\some\repo",  # base_commit defaults to HEAD
                    allowed_operations=("edit",), execution_constraints=("check:unit",))
```

The worker edits `C:\path\to\worktrees\r1\t1\1` (run, task, attempt), not your checkout. Afterwards
`report.attempts[0].result.diff` holds the change, and the task completes only if pytest exits 0
there. To let the worker run that check itself while it works, add `"check"` to
`allowed_operations` and give the executor the same mapping:
`ClaudeCodeExecutor(command=..., checks={"unit": ("python", "-m", "pytest")})`. AgentForge still
runs the check itself afterwards.

The worktree is kept. When the run is finished and reviewed, delete all of its worktrees:

```powershell
.\.venv\Scripts\python.exe -m agentforge clean r1 --repo C:\path\to\some\repo --root C:\path\to\worktrees
```

In Python that is `await agentforge.worktrees.remove_run(repo, root, "r1")`. Uncommitted changes in
those worktrees are deleted with them; the diff stays in the report.

Two things to know first. Checks run code the worker wrote, with your user rights: a worktree
is not a sandbox. And edit mode was confirmed against the live CLI in one check, with one model:
edits worked, and writes outside the worktree or to its `.git` file were refused. Both are
detailed in [the M3 doc](docs/milestones/M3-worktrees.md).

### 5. Retry a failed task

Add `max_attempts` (1–5, default 1) to the task:

```python
    task = TaskSpec(..., execution_constraints=("check:unit",), max_attempts=3)
```

If pytest fails, the task runs again in a new worktree (`...\r1\t1\2`) with a new Claude session,
and the worker is told the check output. The task fails only when all three attempts have failed.
Every attempt is billed. `report.attempts` lists each one with its diff and failure message, and
`report.transitions` gives a reason for every status change: why a task was retried, failed,
blocked or cancelled.

To follow a run as it happens, turn on logging before you start it:

```python
import logging

logging.basicConfig(level=logging.DEBUG)
```

Logs never contain prompts, diffs or check output. What each line means, and where to look when a
run goes wrong, is in [the M4 doc](docs/milestones/M4-orchestration.md#how-to-debug-a-run).

### 6. Pause and resume

While `scheduler.run(plan)` is running as an asyncio task, call these from the same event loop:

```python
    await scheduler.pause_task("t1")   # or: await scheduler.pause_run()
    ...
    await scheduler.resume_task("t1")  # or: await scheduler.resume_run()
```

A task that has not started is held. A running task's Claude process is killed and its worker is
freed; resume continues the same attempt in the same worktree with `claude --resume`, so it does
not use up a retry. `run()` does not return while anything is paused, and `resume_run` leaves a
task you paused with `pause_task` paused. Limits, such as a file left half-written by the kill,
are in [the M4 doc](docs/milestones/M4-orchestration.md#limits).

### 7. Save a run and recover it after a restart

Pass a store, and every step of the run is saved to SQLite as it happens:

```python
from agentforge.store import RunStore, default_path

    scheduler = Scheduler(validator=..., store=RunStore(default_path()))
```

If the process stops mid-run, start a new one, register the same workers, and call
`scheduler.recover("r1")` as an asyncio task. Work that was in flight comes back paused, so
nothing billed starts until you call `await scheduler.resume_run()`; it then continues the same
attempt in the same worktree. `RunStore(default_path()).unfinished_runs()` lists runs to recover.
The database holds diffs and failure messages, so treat it like the report. Details are in
[the M4 doc](docs/milestones/M4-orchestration.md#delivered-behavior-persistence-and-recovery).

### 8. Turn a request into a plan

```powershell
.\.venv\Scripts\python.exe -m agentforge plan "Add reverse(text) to utils.py and test it" --workspace C:\path\to\repo
```

The lead agent drafts tasks for your agents' roles, checks them, has Claude critique them and
revises them, then prints the plan as JSON. It does not run it, and every task is read-only until
you give it rights. Each plan is billed: up to six short Claude sessions by default. Details are in
[the M4 doc](docs/milestones/M4-orchestration.md#delivered-behavior-the-lead-agent).

### 9. Run the local API

```powershell
.\.venv\Scripts\python.exe -m agentforge serve --worktrees C:\path\to\worktrees --check unit="python -m pytest"
```

The server listens on `127.0.0.1:8765` only and writes a new token to
`%APPDATA%\AgentForge\api-token` at each start. If the port is already in use (usually a server
that is still running), `serve` stops before writing its token, so the running one keeps working.
Send it as `Authorization: Bearer <token>`.
Propose a plan (`POST /proposals`, or `/proposals/from-request` for the lead agent), approve it
with the rights each task gets, then approve each worker's diff before its checks run, and
follow it all on `GET /runs/{id}/events`. Every task you let edit gets a `review-<id>` task
after it (the team needs an agent with role `reviewer`). Once a run has finished,
`POST /runs/{id}/fix-plan` has the lead agent plan fixes for what its reviews say must be fixed
(billed; only reviews with "Must fix" findings count). `GET /runs`, `GET /proposals` and
`GET /checks` list what is there, and the agent routes are under
[Agents and personas](#agents-and-personas).
Endpoints and limits are in [the M5 doc](docs/milestones/M5-api.md) and
[the M6 doc](docs/milestones/M6-desktop.md).

### 10. Open the desktop app

Needs Node.js and Rust. Start the server (step 9) first, then:

```powershell
npm --prefix apps/desktop install
npm --prefix apps/desktop run tauri dev
```

The first time, a welcome screen explains how AgentForge works and asks how the app should look:
**Plain** (technical options start folded under **More options**) or **Technical** (they start
open). Then take the short tour, which points at each part of the window, or skip it. The app
remembers your answers. **View** at the bottom of the side list changes the choice, **Theme**
switches the window between dark (the start) and light, and **Show the guide again** brings back
the welcome screen and the tour.

The window shows whether the server answers and lists every saved run. A run opens as a board:
the lead agent's box (the plan, what was asked for, the agents not in this run), then one group
per role with its agent's tile: the task, its status, its time and its last report (live output
comes in a later slice), and the task's buttons. **Review diff** opens the task in a panel on the
right with its attempts, diff and review. The pill at the bottom switches to **List**, the page
with every task's card and the history, and counts the tasks in words. Either way the page
shows each task with its attempts, diffs and reasons, and follows the active run live. There you approve or
reject a waiting diff (a rejection needs a reason, which the next attempt is told), pause,
resume, cancel or retry tasks, and recover a run that a restart interrupted. The app reads the
token from `%APPDATA%\AgentForge\api-token` again after each server restart.

To start a run, choose **Ask for something**, say what you want and name your project folder.
The lead agent plans it (billed; the app asks first), and the plan waits under **Plans** for your
OK. Tick what each task may do (change files, which checks run before its work is accepted),
then **Approve and start**; or reject it with a reason. After each task you let edit, the
reviewer checks its change, and its report shows on the run's page. When a review of a finished
run found something that must be fixed, **Plan fixes from the reviews** asks you first (it is
billed), then asks the lead agent for a plan that fixes it; the plan opens under **Plans** for
your OK. Developers can write the plan as JSON instead, and set attempts and time limits under
**More options**.

**Your team** lists your agents: add one, change its role or how it should work (model and
reasoning are under **More options**), or remove it; changes apply from the next run. When no
agent fits part of a request, the lead agent may propose a new one with its plan. You see it on
the plan's page, can change it, and it joins your team only when you approve the plan. Details
are in [the M6 doc](docs/milestones/M6-desktop.md).

### 11. Verify

```powershell
.\.venv\Scripts\python.exe -m pytest apps/api/tests
.\.venv\Scripts\python.exe -m ruff check apps/api
.\.venv\Scripts\python.exe -m ruff format --check apps/api
npm --prefix apps/desktop test
npm --prefix apps/desktop run build
```

## Agents and personas

Each agent is one Markdown file named after its id, such as `backend.md`. Settings go between the
two `---` lines, and the persona text follows:

```markdown
---
id: backend
role: backend
model:
reasoning: medium
---
You are the backend engineer on an AgentForge team. ...
```

| Setting | Meaning |
|---|---|
| `id` | Unique name, which is also the file name. Lowercase letters, digits, `-` and `_` only. |
| `role` | Which tasks the agent takes. Several agents may share a role. |
| `model` | Claude model to use, such as `opus` or `claude-opus-5-5`. Leave it empty for Claude Code's default. Spaces are not allowed. |
| `reasoning` | Effort level: `low`, `medium`, `high`, `xhigh` or `max`. |

The persona text (up to 10,000 characters) is added to the Claude Code worker's system prompt.

- **Defaults:** backend, frontend, database, qa, integration, reviewer and auditor. The reviewer
  checks one change and the auditor a whole folder or repository; both only report, in plain
  words, and change nothing. They ship in
  [apps/api/src/agentforge/default_personas](apps/api/src/agentforge/default_personas) and are
  copied to `%APPDATA%\AgentForge\agents` by `python -m agentforge setup`, but only when that
  folder has no agents yet.
- **Edit** a file in any text editor, or call `save_agent(folder, agent)`.
- **Add** a new `<id>.md` file, or call `save_agent` with a new id.
- **Remove** the file, or call `remove_agent(folder, agent_id)`.
- **Load** them all with `load_agents(folder)`. A broken file raises an error that names it.

These functions are in `agentforge.personas`. The local API calls them too: `GET /agents`,
`PUT /agents/{id}` and `DELETE /agents/{id}`. An edit applies from the next run; the running run
keeps its agents. The API refuses to remove the last agent, because an empty folder brings back
the seven defaults. A folder made before the reviewer and auditor shipped does not get them:
add them on **Your team** (a plan that edits needs a `reviewer`) or copy their files from
`default_personas`. The desktop app edits them on screen (**Your team**), and the lead agent may
propose a new agent with a plan, made only when a person approves it.

## Documentation

- [CONTRIBUTING.md](CONTRIBUTING.md): setup, commands, workflow, commit rules and a map of the
  code.
- [ROADMAP.md](ROADMAP.md): milestones, deferred work and verification history.
- [GOVERNANCE.md](GOVERNANCE.md): who decides, and what AI agents may do in this repository.
- [CLAUDE.md](CLAUDE.md): rules for AI coding assistants.
- [M1: domain and scheduler](docs/milestones/M1-domain.md): contracts, scheduling policy, limits
  and acceptance checks.
- [M2: Claude Code adapter](docs/milestones/M2-claude-code.md): executor contract, CLI flags,
  outcome mapping, the live check, the timeout and the `claude` command.
- [M3: worktrees and validation](docs/milestones/M3-worktrees.md): worktrees, edit mode, diffs,
  check commands, risks and deferred work.
- [M4: retries, pause/resume, saved runs and the lead agent](docs/milestones/M4-orchestration.md):
  retry rules, pause and resume, saved runs, the lead agent, how to debug a run, limits and
  deferred work.
- [M5: local REST API, approvals and live events](docs/milestones/M5-api.md): endpoints,
  approvals, the token, reviews and fix plans, how to debug a run and limits.
- [M6: desktop dashboard](docs/milestones/M6-desktop.md): the app's screens slice by slice, its
  contract additions, how to debug it and limits.
- [docs/design/agentforge](docs/design/agentforge/README.md): the visual design the app follows.
