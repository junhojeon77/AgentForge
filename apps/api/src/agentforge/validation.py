"""Real validation: AgentForge runs the task's checks itself and ignores the worker's claims.

Checks run code the worker may have just written, with this process's rights and environment.
"""

import asyncio
import logging
import pathlib
from asyncio.subprocess import DEVNULL, PIPE, STDOUT
from collections.abc import Mapping, Sequence

from agentforge.domain import TaskSpec, ValidationReport, WorkerResult

logger = logging.getLogger(__name__)


class CommandValidator:
    """ResultValidator that runs each `check:<name>` constraint as a configured command."""

    def __init__(self, *, checks: Mapping[str, Sequence[str]], timeout: float = 600):
        self.checks = {name: tuple(command) for name, command in checks.items()}
        self.timeout = timeout

    async def validate(self, task: TaskSpec, result: WorkerResult) -> ValidationReport:
        workspace = result.workspace or task.workspace_reference
        # A single local stat before running processes; not worth a thread hop.
        if workspace is None or not pathlib.Path(workspace).is_dir():  # noqa: ASYNC240
            return ValidationReport(accepted=False, issues=("no workspace to validate",))
        issues = []
        for constraint in task.execution_constraints:
            if not constraint.startswith("check:"):
                continue
            name = constraint.removeprefix("check:")
            if name not in self.checks:
                issues.append(f"unknown check: {name}")
            elif issue := await self._run(name, workspace):
                issues.append(issue)
        return ValidationReport(accepted=not issues, issues=tuple(issues))

    async def _run(self, name: str, workspace: str) -> str | None:
        proc = await asyncio.create_subprocess_exec(
            *self.checks[name], cwd=workspace, stdin=DEVNULL, stdout=PIPE, stderr=STDOUT
        )
        try:
            output, _ = await asyncio.wait_for(proc.communicate(), self.timeout)
        except TimeoutError:
            logger.debug("check %s in %s: timed out after %gs", name, workspace, self.timeout)
            return f"check {name} timed out after {self.timeout:g}s"
        finally:
            # shortcut: kills only the started process, not its children; use a Windows job
            # object when checks spawn long-lived child processes.
            if proc.returncode is None:
                proc.kill()
                await proc.wait()
        # The exit code only: check output can hold secrets and goes to the report instead.
        logger.debug("check %s in %s: exit %s", name, workspace, proc.returncode)
        if proc.returncode:
            tail = output.decode("utf-8", errors="replace").strip()[-2000:]
            return f"check {name} failed (exit {proc.returncode}): {tail}"
        return None
