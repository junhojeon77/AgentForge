"""Claude Code worker: runs `claude -p` read-only and returns its structured WorkerResult.

Flags and the stream-json event shapes were checked against Claude Code CLI 2.1.323.
"""

import asyncio
import json
import pathlib
import shutil
import uuid
from asyncio.subprocess import PIPE
from collections.abc import Callable, Sequence

from agentforge.domain import Assignment, TaskSpec, WorkerResult

READ_ONLY_TOOLS = "Read,Glob,Grep"
STREAM_LIMIT = 16 * 1024 * 1024  # one stream-json event per line; tool results can be large


def _result_schema() -> str:
    schema = WorkerResult.model_json_schema()
    del schema["properties"]["session_id"]
    schema["required"] = list(schema["properties"])
    return json.dumps(schema)


def _prompt(task: TaskSpec) -> str:
    lines = [
        "You are a read-only AgentForge worker. You can read, search and list files in the "
        "current folder, but you cannot edit files or run commands."
    ]
    sections = (
        ("Task", task.title),
        ("Description", task.description),
        ("Objective", task.objective),
        ("Acceptance criteria", task.acceptance_criteria),
        ("Expected output", task.expected_output),
        ("Constraints", task.execution_constraints),
    )
    for heading, value in sections:
        if value:
            lines.append(f"{heading}:")
            lines += [f"- {item}" for item in value] if isinstance(value, tuple) else [value]
    lines.append(
        "Report through the structured output. List in passed_checks only checks you actually "
        "ran, and in satisfied_criteria only criteria you verified."
    )
    return "\n".join(lines)


class ClaudeCodeExecutor:
    """WorkerExecutor backed by the Claude Code CLI in read-only print mode."""

    def __init__(
        self,
        *,
        command: Sequence[str] = ("claude",),
        max_budget_usd: float = 1.0,
        on_event: Callable[[str, dict], None] | None = None,
    ):
        self.command = tuple(command)
        self.max_budget_usd = max_budget_usd
        self.on_event = on_event

    async def execute(self, assignment: Assignment) -> WorkerResult:
        task, worker = assignment.task, assignment.worker
        program = shutil.which(self.command[0])
        if program is None:
            raise FileNotFoundError(
                f"Claude Code CLI not found: {self.command[0]!r}. Pass "
                "command=(<path to claude.exe>,), e.g. the one bundled with the VS Code extension."
            )
        workspace = task.workspace_reference
        # A single local stat before a long-running process; not worth a thread hop.
        if workspace is None or not pathlib.Path(workspace).is_dir():  # noqa: ASYNC240
            raise ValueError(f"task {task.id} needs an existing workspace folder")
        session_id = str(uuid.uuid4())
        args = [
            *self.command[1:],
            "-p",
            "--output-format", "stream-json", "--verbose",
            "--json-schema", _result_schema(),
            "--session-id", session_id,
            "--effort", worker.reasoning,
            "--tools", READ_ONLY_TOOLS,
            "--permission-prompts", "none",
            "--restricted", "--strict-mcp-config",
            "--max-budget-usd", str(self.max_budget_usd),
        ]  # fmt: skip
        if worker.model is not None:
            args += ["--model", worker.model]
        if worker.persona:
            args += ["--append-system-prompt", worker.persona]
        proc = await asyncio.create_subprocess_exec(
            program, *args, cwd=workspace, stdin=PIPE, stdout=PIPE, stderr=PIPE, limit=STREAM_LIMIT
        )
        try:
            proc.stdin.write(_prompt(task).encode("utf-8"))
            await proc.stdin.drain()
            proc.stdin.close()
            stderr, result = await asyncio.gather(
                proc.stderr.read(), self._read_events(task.id, proc.stdout)
            )
            code = await proc.wait()
        finally:
            if proc.returncode is None:  # cancelled or failed mid-run: don't leave Claude running
                proc.kill()
                await proc.wait()
        if result is None:
            detail = stderr.decode("utf-8", errors="replace").strip()[-2000:]
            raise RuntimeError(f"claude exited {code} without a result: {detail}")
        output = result.get("structured_output")
        if result.get("is_error") or result.get("subtype") != "success" or output is None:
            reason = result.get("result") or "no structured output"
            return WorkerResult(
                success=False, message=f"{result.get('subtype')}: {reason}", session_id=session_id
            )
        return WorkerResult.model_validate({**output, "session_id": session_id})

    async def _read_events(self, task_id: str, stdout: asyncio.StreamReader) -> dict | None:
        result = None
        async for line in stdout:
            if not line.strip():
                continue
            event = json.loads(line)
            if self.on_event is not None:
                self.on_event(task_id, event)
            if event.get("type") == "result":
                result = event
        return result
