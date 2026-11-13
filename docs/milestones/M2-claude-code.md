# M2 — Claude Code Worker Adapter (read-only)

## Delivered behavior

`agentforge.claude_code.ClaudeCodeExecutor` is a `WorkerExecutor` that runs one Claude Code CLI
process per task (`claude -p`) and turns its reply into a `WorkerResult`. It plugs into the M1
`Scheduler` unchanged: register it for any role with `register_worker`. Workers are read-only. They
can read, search and list files in the task's workspace, but they cannot edit files or run commands.

M2 originally named a Codex adapter on the roadmap. It was switched to Claude Code by decision on
2026-11-13. No new Python dependency was added; the adapter uses `asyncio` subprocesses.

## Contract

| Item | Behavior |
|---|---|
| `ClaudeCodeExecutor(command=("claude",), max_budget_usd=1.0, on_event=None)` | `command` is the program prefix; pass the full path to `claude.exe` when it is not on PATH |
| `AgentConfig.model` | Passed as `--model`; `None` (the new default) lets Claude Code choose |
| `AgentConfig.reasoning` | Passed as `--effort`; must be `low`, `medium`, `high`, `xhigh` or `max` |
| `AgentConfig.persona` | Passed as `--append-system-prompt` when not empty (max 10,000 characters); loaded from the persona folder by `agentforge.personas` |
| `TaskSpec.workspace_reference` | Required existing folder; becomes the process working directory |
| `WorkerResult.session_id` | A fresh UUID per task, passed as `--session-id` and set on every result |
| `on_event(task_id, event)` | Receives every raw stream-json event (dict) as it arrives |

Flags used on every call: `-p --output-format stream-json --verbose --json-schema <schema>
--session-id <uuid> --effort <level> --tools Read,Glob,Grep --permission-prompts none --restricted
--strict-mcp-config --max-budget-usd <n>`, plus `--model` and `--append-system-prompt` when set.
The prompt is written to stdin. Per the CLI 2.1.323 `--help`, `--restricted` also confines the file
tools to the working directory, so workers can't read outside the task's workspace. This comes
from the help text only; no live test checks it.
The JSON schema is `WorkerResult`'s schema without `session_id`, with every field required.

Outcome mapping:

- A `result` event with `subtype: "success"` and a `structured_output` → that output as the
  `WorkerResult`. The scheduler's independent validator still decides completion.
- Any other `result` (an error subtype such as `error_max_budget_usd`, or no structured output)
  → `WorkerResult(success=False)` → `WORKER_FAILURE`.
- The process exits without a `result` → `RuntimeError` with the exit code and stderr tail →
  `EXECUTOR_EXCEPTION`.
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

## Not implemented yet

| Deferred | Waits for |
|---|---|
| Session resume and retries | M4 (retries, pause/resume). Session IDs are already recorded for it; the CLI's `--resume` is not used yet. |
| Edit/execute permissions and worktrees | M3 (worktree management, restricted execution). Until then workers stay read-only. |
| A per-task timeout | Later runtime work. For now `cancel_task` stops a stuck worker. |
| A Claude Code mode for `python -m agentforge` | When wanted; the demo stays mock-only. |
| Validating the `model` string | Not needed while arguments go straight to the executable with no shell. Revisit if a shell or remote runner is introduced. |
| Using `AgentConfig.permissions` | M3, when permissions become real. It is still descriptive. |

## Acceptance checks

Run the pytest and Ruff commands in the root README. Offline tests replace the CLI with
`apps/api/tests/fake_claude.py`, which replays the recorded fixture, and cover:
- the arguments, working directory, prompt, session ID and event callback;
- an error result as `WORKER_FAILURE` and a crash as `EXECUTOR_EXCEPTION`;
- cancellation killing the process;
- a missing workspace and a missing executable.

The live test `test_live_claude_code_reads_the_workspace` runs only when you set
`AGENTFORGE_LIVE_CLAUDE=1` and `AGENTFORGE_CLAUDE=<path to claude.exe>`.
