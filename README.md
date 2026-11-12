# AgentForge

AgentForge is a planned Windows desktop platform for coordinating software development agents.
M1 implements its Python domain contracts and deterministic, in-memory task scheduler with five mock
workers. No Codex account or API key is required for this milestone.

## Contributing guidance

[AGENTS.md](AGENTS.md) provides project instructions for contributors and coding agents. It adapts
the shared guidance style to AgentForge's implemented M1 library and planned Windows desktop stack,
so future work follows the actual contracts and commands. It covers TDD, coordinator routing,
scheduler invariants, component boundaries, review, and documentation maintenance. The guidance was
checked against the current source, configuration, and milestone documentation; fresh-session
instruction discovery remains unverified. Update both this README and AGENTS.md with each task,
keeping explanations proportional and distinguishing implemented behavior from future work.

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

Verified on 2026-11-12 using the commands above and the mock demonstration: **35 tests passed**,
Ruff lint passed, and all seven Python files passed the formatting check. The demo's JSON report
confirmed five completed tasks, five completed attempts, and all five workers released. This checks
that M1's in-memory mock workflow works; real Codex execution and the desktop application remain
future milestones.

Read [the M1 contracts and limitations](docs/milestones/M1-domain.md) for the library interface,
scheduling policy, and milestone acceptance checks. State is lost when the process exits. Codex,
worktrees, actual validation commands, persistence, recovery, APIs, and the desktop UI are future work.
