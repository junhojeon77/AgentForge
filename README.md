# AgentForge

AgentForge is a planned Windows desktop platform for coordinating software development agents.
M1 implements its Python domain contracts and deterministic, in-memory task scheduler with five mock
workers. No Codex account or API key is required for this milestone.

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

## Verify

```powershell
.\.venv\Scripts\python.exe -m pytest apps/api/tests
.\.venv\Scripts\python.exe -m ruff check apps/api
.\.venv\Scripts\python.exe -m ruff format --check apps/api
```

Verified on 2026-11-13 using the commands above and the mock demonstration: **40 tests passed**,
Ruff lint passed, and all seven Python files passed the formatting check. The demo's JSON report
confirmed five completed tasks, five completed attempts, and all five workers released. This checks
that M1's in-memory mock workflow works; real Codex execution and the desktop application remain
future milestones.

The 2026-11-13 round fixed M1 audit findings: a worker raising a non-`Exception` error no longer
leaves `run()` waiting forever; cancelling `run()` twice no longer interrupts worker cleanup or
lets a new run overlap the old one; the demo surfaces an early run failure instead of hanging; and
the scheduler drops redundant copies and re-scans. Five tests were added, including one for
cancelling a task before its coroutine starts. M2 work has not started.

The same checks were rerun successfully before recording the M1 Git baseline, so M2 can build on
a verified starting point. File-by-file baseline commits depend on the complete M1 file set;
verification applies to that combined state, not each intermediate commit.

Read [the M1 contracts and limitations](docs/milestones/M1-domain.md) for the library interface,
scheduling policy, and milestone acceptance checks. State is lost when the process exits. Codex,
worktrees, actual validation commands, persistence, recovery, APIs, and the desktop UI are future work.
