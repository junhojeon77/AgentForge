# AgentForge

AgentForge is a planned Windows desktop platform for coordinating software development agents.
M1 implements its Python domain contracts and deterministic, in-memory task scheduler with five mock
workers. M2 adds a read-only worker that runs the Claude Code CLI. The mock demo and the offline
tests need no account or API key; real Claude Code workers use your logged-in Claude Code install.

## Contributing guidance

[CLAUDE.md](CLAUDE.md) is the single project guide for contributors and Claude Code: working
approach, roadmap and its limits, guidance for planned components, the TDD workflow, definition of
done, commit rules, commands and an architecture summary. It replaced the former `AGENTS.md`,
whose Codex/GPT routing rules no longer apply. Update both this README and CLAUDE.md with each
task, keeping explanations proportional and distinguishing implemented behavior from future work.

## Setup on Windows

Use Python 3.11 or newer. From this directory in PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e "./apps/api[dev]"
```

Installation requires package access. Virtual-environment activation is optional when using the
explicit interpreter paths above. Build/runtime/dev dependency ranges are in `apps/api/pyproject.toml`.

## Run the mock demonstration

```powershell
.\.venv\Scripts\python.exe -m agentforge
```

The example waits until all five mock workers are executing, releases them together, validates their
mock evidence, and prints the execution report as JSON. It does not execute commands or modify a
repository.

## Run a Claude Code worker

`ClaudeCodeExecutor` runs one `claude -p` process per task in the task's workspace folder. Workers
are **read-only**: they can read, search and list files, but not edit files or run commands. Each
task gets a fresh session ID and a spending cap (`max_budget_usd`, default $1). Claude Code ships
with the VS Code extension but is not on PATH, so pass the full path:

```python
import asyncio
from pathlib import Path

from agentforge.claude_code import ClaudeCodeExecutor
from agentforge.domain import AgentConfig, RunPlan, TaskSpec
from agentforge.mocks import MockValidator
from agentforge.orchestration import Scheduler

CLAUDE = Path.home() / (
    r".vscode\extensions\anthropic.claude-code-2.1.323-win32-x64\resources\native-binary\claude.exe"
)

async def main():
    scheduler = Scheduler(validator=MockValidator())
    scheduler.register_worker(
        AgentConfig(id="reviewer", role="qa", reasoning="low"),  # model=None: Claude Code's default
        ClaudeCodeExecutor(command=(str(CLAUDE),), on_event=lambda task_id, e: print(task_id, e["type"])),
    )
    task = TaskSpec(id="t1", run_id="r1", title="Summarize the README", role="qa",
                    workspace_reference=r"C:\path\to\some\project")
    print((await scheduler.run(RunPlan(id="r1", tasks=(task,)))).model_dump_json(indent=2))

asyncio.run(main())
```

Each run is billed to your Claude Code login. Several M2 features are deliberately deferred, such
as resume/retries (M4), edit permissions and worktrees (M3), and a per-task timeout. They are
listed under "Not implemented yet" in [the M2 doc](docs/milestones/M2-claude-code.md).

## Verify

```powershell
.\.venv\Scripts\python.exe -m pytest apps/api/tests
.\.venv\Scripts\python.exe -m ruff check apps/api
.\.venv\Scripts\python.exe -m ruff format --check apps/api
```

Verified on 2026-11-13 after M2, using the commands above and the mock demonstration: **48 tests
passed and 1 skipped** (the opt-in live Claude Code test), Ruff lint passed, and all ten Python
files passed the formatting check. The demo confirmed five completed tasks and all five workers
released. Separately, one approved live `claude -p` call (Claude Code 2.1.323, $0.053) confirmed
the flags and event format the M2 executor relies on; see [the M2 doc](docs/milestones/M2-claude-code.md).
The opt-in live test itself has not been run. The command is in CLAUDE.md.

Earlier on 2026-11-13, an M1 audit round fixed the following:
- A worker raising a non-`Exception` error no longer leaves `run()` waiting forever.
- Cancelling `run()` twice no longer interrupts worker cleanup or lets a new run overlap the old one.
- The demo surfaces an early run failure instead of hanging.
- The scheduler drops redundant copies and re-scans.

That round added five tests, one of them for cancelling a task before its coroutine starts.

The same checks were rerun successfully before recording the M1 Git baseline, so M2 can build on
a verified starting point. File-by-file baseline commits depend on the complete M1 file set;
verification applies to that combined state, not each intermediate commit.

Read [the M1 contracts and limitations](docs/milestones/M1-domain.md) and
[the M2 Claude Code adapter](docs/milestones/M2-claude-code.md) for the library interface,
scheduling policy, and milestone acceptance checks. State is lost when the process exits. Worktrees,
edit/execute permissions, actual validation commands, persistence, retries, recovery, APIs, and the
desktop UI are future work.
