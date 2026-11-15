# Agent Guidelines for AgentForge

This file gives instructions to AI coding assistants working on this project.

## Project Overview

AgentForge is a planned local-first Windows platform where one lead agent coordinates specialized
coding agents: five by default, and users can add, remove or fully customize any of them. M1–M3 and M4's retries, pause/resume and saved runs are implemented as a Python library in `apps/api/src/agentforge`.
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

**Done** means pytest and both Ruff checks pass, the diagnostics rule below is met, the diff is
reviewed for correctness, unrelated changes and security, and exact results are reported, naming
any check that was not run.

## Diagnostics (required)

Everything that happens in a run must be debuggable in two places. This is a must for every
feature, not an extra:

- **Report:** every state change, decision and failure records a clear, plain reason in the run
  report (as `TaskAttempt.message` and `Transition.detail` do for retries). Someone reading only
  the report must be able to tell what happened and why.
- **Log:** the same events get a `logging` line through `logging.getLogger(__name__)`: DEBUG for
  progress, WARNING for failures. The library installs no handler.

Never log prompts, personas, diffs, check output or failure messages; they can hold secrets and
belong in the report only. Log ids, statuses, reasons, paths and exit codes.

A plan must say where each reason is recorded and which log line covers it. Tests must assert
both, including that secret-bearing text stays out of the log. Document them in the milestone
doc's "How to debug a run" section.

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
[CONTRIBUTING.md](CONTRIBUTING.md#commands), with the command for writing a new database migration.
No type checker, frontend build or CI exists yet; don't invent commands for them.

## Docs

Every change updates every document it affects, in the same piece of work, with no exceptions:
code, tests, config, commands, rules or docs. Before calling a change done, search all of these
for what changed (names, behavior, numbers, commands) and fix every stale line:

- `README.md` (usage), `ROADMAP.md` (status, deferred lists, verification history)
- every `docs/milestones/` file that mentions it, including "Not implemented yet" tables: delete
  a row once it is done, wherever it appears
- the `CONTRIBUTING.md` code map and commands, `GOVERNANCE.md` and this file
- `docs/DECISIONS.md` (see below)

Keep implemented and planned behavior clearly apart. Report which documents were updated, and
say so when a change touches none.

Always record decisions. Every new or changed design decision gets an entry in
`docs/DECISIONS.md` in the same piece of work, using its five lines: Decision, Why, What I gave
up, What would make me change it, Where. The file is the maintainer's private record and Git
ignores it: never commit it or remove it from `.gitignore`. Write the maintainer's personal
answers (motivation, lessons, their own part) only as "Draft: confirm or rewrite".
