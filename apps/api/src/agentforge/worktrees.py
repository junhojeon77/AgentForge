"""Git worktrees: one checkout per task. They isolate changes, not execution."""

import asyncio
import logging
import re
from asyncio.subprocess import PIPE
from pathlib import Path

from agentforge.domain import Assignment, WorkerResult
from agentforge.orchestration import WorkerExecutor

logger = logging.getLogger(__name__)

# Ids become folder names under the root, so nothing that could climb out of it.
_SAFE_ID = re.compile(r"[A-Za-z0-9_-]+")


async def _git(cwd: str | Path, *args: str) -> str:
    proc = await asyncio.create_subprocess_exec("git", *args, cwd=cwd, stdout=PIPE, stderr=PIPE)
    try:
        out, err = await proc.communicate()
    finally:
        if proc.returncode is None:  # cancelled mid-command
            proc.kill()
            await proc.wait()
    if proc.returncode:
        detail = err.decode("utf-8", errors="replace").strip()[-2000:]
        raise RuntimeError(f"git {args[0]} failed: {detail}")
    return out.decode("utf-8", errors="replace")


async def create(repo: str | Path, base_commit: str, path: str | Path) -> Path:
    """Check out `base_commit` (empty: HEAD) of `repo` as a new detached worktree at `path`."""
    path = Path(path)
    if not path.is_absolute():  # git would resolve a relative path inside the repository
        raise ValueError(f"worktree path must be absolute: {path}")
    # Resolving first rejects unknown commits and keeps a "-x" value from being read as a flag.
    commit = f"{base_commit or 'HEAD'}^{{commit}}"
    sha = (await _git(repo, "rev-parse", "--verify", "--end-of-options", commit)).strip()
    await _git(repo, "worktree", "add", "--detach", str(path), sha)
    logger.debug("worktree created: %s at %s", path, sha)
    return path


async def diff(path: str | Path) -> str:
    """Everything changed in the worktree since its base commit, new files included."""
    await _git(path, "add", "-A")
    # The worktree's content is untrusted: never run diff programs its attributes select.
    changes = await _git(path, "diff", "--cached", "--no-ext-diff", "--no-textconv", "HEAD")
    # The length only: a diff can hold secrets.
    logger.debug("diff recorded: %s (%d characters)", path, len(changes))
    return changes


async def remove(repo: str | Path, path: str | Path) -> None:
    """Delete the worktree and its uncommitted changes."""
    await _git(repo, "worktree", "remove", "--force", str(path))


class WorktreeExecutor:
    """Runs another executor inside a fresh worktree at root/<run_id>/<task_id>/<attempt>.

    The worktree is kept afterwards for validation and review; call `remove` to delete it.
    Share one instance per repository: it serializes `git worktree add`.
    """

    def __init__(self, inner: WorkerExecutor, root: str | Path):
        self.inner = inner
        self.root = Path(root).resolve()
        self._creating = asyncio.Lock()

    async def execute(self, assignment: Assignment) -> WorkerResult:
        task = assignment.task
        if not task.repository_reference:
            raise ValueError(f"task {task.id} needs a repository_reference")
        for value in (task.run_id, task.id):
            if not _SAFE_ID.fullmatch(value):
                raise ValueError(f"worktree id {value!r} may use only A-Z, a-z, 0-9, '-' and '_'")
        path = self.root / task.run_id / task.id / str(assignment.attempt_number)
        # Only an attempt the scheduler is resuming may reuse its worktree; its edits and its
        # saved Claude session live there. A single local stat; not worth a thread hop.
        if assignment.resume and path.is_dir():  # noqa: ASYNC240
            logger.debug("worktree reused: %s", path)
        else:
            async with self._creating:
                await create(task.repository_reference, task.base_commit, path)
        inner_task = task.model_copy(update={"workspace_reference": str(path)})
        result = WorkerResult.model_validate(
            await self.inner.execute(assignment.model_copy(update={"task": inner_task}))
        )
        return result.model_copy(update={"workspace": str(path), "diff": await diff(path)})
