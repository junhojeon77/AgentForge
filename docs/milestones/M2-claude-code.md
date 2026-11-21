# M2 — Claude Code Worker Adapter (read-only)

*AgentForge is for people who do not code as well as those who do; see
[Who it is for](../../README.md). This document covers the technical layer underneath.*

## Delivered behavior

`agentforge.claude_code.ClaudeCodeExecutor` is a `WorkerExecutor` that runs one Claude Code CLI
process per task (`claude -p`) and turns its reply into a `WorkerResult`. It plugs into the M1
`Scheduler` unchanged: register it for any role with `register_worker`. Workers are read-only. They
can read, search and list files in the task's workspace, but they cannot edit files or run commands.

Agents are fully customizable. `agentforge.personas` keeps each agent as one editable Markdown file.
You can add an agent with any id and role, remove any agent (the defaults included), and change
each agent's model, reasoning level and persona. `python -m agentforge setup` copies the five
defaults only into a folder that has no personas yet.

M2 originally named a Codex adapter on the roadmap. It was switched to Claude Code by decision on
2026-11-13. No new Python dependency was added; the adapter uses `asyncio` subprocesses.

## Contract

| Item | Behavior |
|---|---|
| `ClaudeCodeExecutor(command=("claude",), max_budget_usd=1.0, on_event=None, checks=None)` | `command` is the program prefix; pass the full path to `claude.exe` when it is not on PATH. A `.cmd` or `.bat` launcher (an npm install's `claude.cmd`) is rejected with a `ValueError`: Windows runs it through cmd.exe, which would cut the multi-line persona at its first line break. `checks` ({name: argv}) is used only by tasks that allow `"check"`; see [M3](M3-worktrees.md) |
| `AgentConfig.model` | Passed as `--model`; `None` (the new default) lets Claude Code choose |
| `AgentConfig.reasoning` | Passed as `--effort`; must be `low`, `medium`, `high`, `xhigh` or `max` |
| `AgentConfig.persona` | Passed as `--append-system-prompt` when not empty (max 10,000 characters); loaded from the persona folder by `agentforge.personas` |
| `TaskSpec.workspace_reference` | Required existing folder; becomes the process working directory |
| `WorkerResult.session_id` | A fresh UUID per attempt, passed as `--session-id` and set on every result. Since M4 the scheduler chooses it (`Assignment.session_id`); the executor makes one up only when called without it |
| `on_event(task_id, event)` | Receives every raw stream-json event (dict) as it arrives |
| `ClaudeCodeRunner(command, max_budget_usd, on_event)` | Since 2026-11-15: one CLI session as a LangChain Runnable. `await runner.ainvoke(ClaudeCall(...))` returns the CLI's `result` event; `ClaudeCall` gives the prompt, folder, tools, JSON schema, session and limits. The executor and the lead agent both use it, so every session gets the same fixed flags |
| `ClaudeCodeExecutor` as a Runnable | `await executor.ainvoke(assignment)` equals `execute(assignment)`; `invoke` raises, because everything here is async |

Flags used on every call: `-p --output-format stream-json --verbose --json-schema <schema>
--session-id <uuid> --effort <level> --tools Read,Glob,Grep --permission-prompts none --restricted
--strict-mcp-config --max-budget-usd <n>`, plus `--model` and `--append-system-prompt` when set.
A task that allows `"edit"` adds `Edit,Write` and `--permission-mode acceptEdits`; one that also
allows `"check"` adds `Bash`, `--permission-mode dontAsk` and `--allowedTools` rules instead (see
[M3](M3-worktrees.md)).
The prompt is written to stdin. Per the CLI 2.1.323 `--help`, `--restricted` also confines the file
tools to the working directory, so workers can't read outside the task's workspace. For writes a live
call confirmed it on 2026-11-14 (see [M3](M3-worktrees.md#live-check-2026-11-14-claude-code-cli-21323)); for reads it
still comes from the help text only.
The JSON schema is `WorkerResult`'s schema without `session_id`, with every field required.

Outcome mapping:

- A `result` event with `subtype: "success"` and a `structured_output` → that output as the
  `WorkerResult`. The scheduler's independent validator still decides completion.
- Any other `result` (an error subtype such as `error_max_budget_usd`, or no structured output)
  → `WorkerResult(success=False)` → `WORKER_FAILURE`.
- The process exits without a `result` → `RuntimeError` with the exit code and stderr tail →
  `EXECUTOR_EXCEPTION`. This holds also when the CLI exits before it reads the prompt.
- An output line that is not a JSON event is skipped, with a WARNING that gives only the
  task id and the line's length.
- Cancelling the task kills the Claude Code process and waits for it to exit.

## Live check (2026-11-13, Claude Code CLI 2.1.323)

One approved live call with the flags above confirmed:
- the prompt is read from stdin;
- the session ID passed in comes back unchanged;
- only `Read`, `Glob`, `Grep` and the built-in `StructuredOutput` tool were offered;
- the schema-checked reply is in `result.structured_output`;
- the default model was `claude-opus-5-5`.

The call cost $0.053. A trimmed copy of that recording is the offline test fixture
(`apps/api/tests/fixtures/claude_stream.jsonl`). The error-result shape used by the offline tests
is assumed from the documented subtypes and was not recorded live.

## Limits

Claude Code must already be installed and logged in. It is bundled with the VS Code extension at
`%USERPROFILE%\.vscode\extensions\anthropic.claude-code-<version>-win32-x64\resources\native-binary\claude.exe`,
which is not on PATH by default. Each task is billed to that login; `max_budget_usd` caps each task.
Five concurrent workers mean up to five concurrent Claude Code sessions. Event lines up to 16 MiB
are supported.

The opt-in live test has never been run; one-off approved calls checked the flags instead.
Personas (`--append-system-prompt`) and `python -m agentforge claude` have not been tried
against the live CLI. Both are tested only with the fake CLI.

## Finished after M2 (2026-11-14)

The three items M2 had deferred are now built.

| Item | Behavior |
|---|---|
| `TaskSpec.timeout_seconds` | Optional, a positive number of seconds; `None` (the default) means no limit. It applies to each attempt's worker, not to validation (checks have their own timeout). When it runs out, the scheduler cancels the worker, which kills the Claude Code process, and the attempt fails as `WORKER_TIMEOUT` with the message `worker timed out after 30s`. It is retried like any other failure while attempts remain. A `TimeoutError` the worker raises itself stays an `EXECUTOR_EXCEPTION` |
| `AgentConfig.model` | Must start with a letter or digit and contain only letters, digits and `. _ : / @ [ ] -`. This accepts aliases such as `opus` and ids such as `claude-opus-5-5[1m]`, and rejects spaces, line breaks and a value that could be read as a flag. A persona file with a bad model fails to load, naming the file. It does not check that the model exists |
| `python -m agentforge claude "<task>"` | Runs one read-only task with Claude Code and prints the report as JSON. Options: `--workspace` (default: the current folder), `--role` (default `qa`), `--timeout` seconds, and `--command` (default: `$AGENTFORGE_CLAUDE`, else `claude`). Workers come from the persona folder, or the five defaults when it has none. It prints a billing notice first. A missing folder or a role no agent has stops it before Claude starts (exit 2). Exit 0 when the task completed, 1 otherwise |

## Not implemented yet

Nothing from M2 is deferred.

## Acceptance checks

Run the pytest and Ruff commands in the root README. Offline tests replace the CLI with
`apps/api/tests/fake_claude.py`, which replays the recorded fixture, and cover:
- the arguments, working directory, prompt, session ID and event callback;
- an error result as `WORKER_FAILURE` and a crash as `EXECUTOR_EXCEPTION`;
- cancellation killing the process;
- a missing workspace and a missing executable;
- a timeout that kills the process, and `python -m agentforge claude` run against the fake CLI,
  with an unknown role and a missing folder rejected before any process starts.

`test_contracts.py` covers the `timeout_seconds` bounds and the `model` rule;
`test_scheduler.py` covers a timed-out worker being stopped, failed, logged and retried, and a
worker's own `TimeoutError` staying an executor exception.

The live test `test_live_claude_code_reads_the_workspace` runs only when you set
`AGENTFORGE_LIVE_CLAUDE=1` and `AGENTFORGE_CLAUDE=<path to claude.exe>`.
