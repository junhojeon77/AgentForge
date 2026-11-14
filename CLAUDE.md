# Agent Guidelines for AgentForge

This file gives instructions to AI coding assistants working on this project.

## Project Overview

AgentForge is a planned local-first Windows platform where one lead agent coordinates specialized
coding agents: five by default, and users can add, remove or fully customize any of them. M1–M3 and M4's retries are implemented as a Python library in `apps/api/src/agentforge`.
Everything else is planned. Keep AI reasoning separate from deterministic scheduling, validation,
permissions and human approval.

- How the code works: [CONTRIBUTING.md § Code map](CONTRIBUTING.md#code-map)
- What is built and what is planned: [ROADMAP.md](ROADMAP.md)
- Who decides: [GOVERNANCE.md](GOVERNANCE.md)

## Working Rules

- Never commit, push, init Git or rewrite history without explicit permission. An implementation
  request is not permission.
- Never run the live Claude Code test (it is billed) without asking first.
- The roadmap is direction, not permission: don't build later milestones or add their
  dependencies unless asked.
- Use subagents only when the user asks. Run one editor at a time; only read-only investigators
  may run in parallel.
- Keep the user's unrelated changes. Add no speculative features, abstractions or dependencies.
- After two failed fixes for the same failure, stop and report the evidence.

## Development Workflow

1. **Red:** write a focused behavioral test and watch it fail for the intended reason. For a bug,
   start with a failing regression test.
2. **Green:** make the smallest correct change; rerun focused and related tests.
3. **Refactor** only where useful, then rerun. Docs and config changes need no failing test.

Test public behavior, including boundary and failure cases. Use deterministic barriers, not
sleeps, in async tests. Never weaken assertions, skip tests or change expectations to pass.

**Done** means pytest and both Ruff checks pass, the diff is reviewed for correctness, unrelated
changes and security, and exact results are reported, naming any check that was not run.

## Git Commit Notes

- Conventional Commits in English (`feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`,
  `perf`, `style`, `chore`, `revert`).
- Keep commit messages short: a specific subject and at most a few body lines. Details belong in
  the PR description.
- Mark breaking changes with `!` and a `BREAKING CHANGE:` footer.
- Line endings must be LF, not CRLF (`.gitattributes` enforces this). After changing
  `.gitattributes`, run `git add --renormalize .`.

## Code Style

- Ruff: py311, line length 100, rules `E F I UP B ASYNC`.
- Comment only to explain "why": intent, a non-obvious constraint or a subtlety. Don't restate the
  code or narrate the change.

## Commands

Python 3.11+, from the repository root in PowerShell:

```powershell
.\.venv\Scripts\python.exe -m pip install -e "./apps/api[dev]"
.\.venv\Scripts\python.exe -m pytest apps/api/tests
.\.venv\Scripts\python.exe -m ruff check apps/api
.\.venv\Scripts\python.exe -m ruff format --check apps/api
```

The demo, setup, single-test and opt-in live test commands are in
[CONTRIBUTING.md](CONTRIBUTING.md#commands). No type checker, frontend build, migrations or CI
exist yet; don't invent commands for them.

## Docs

When behavior changes, update `README.md` (usage), `ROADMAP.md` (status), the matching
`docs/milestones/` file and the CONTRIBUTING.md code map. Keep implemented and planned behavior
clearly apart.
