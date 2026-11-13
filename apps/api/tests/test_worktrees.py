import asyncio
import pathlib
import subprocess
import sys

import pytest
from test_claude_code import FAKE_CLAUDE, fake_call

from agentforge import worktrees
from agentforge.claude_code import ClaudeCodeExecutor
from agentforge.domain import AgentConfig, Assignment, RunPlan, TaskSpec, TaskStatus
from agentforge.mocks import MockExecutor
from agentforge.orchestration import Scheduler
from agentforge.validation import CommandValidator
from agentforge.worktrees import WorktreeExecutor


def git(cwd, *args):
    identity = ("-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false")
    done = subprocess.run(
        ["git", *identity, *args], cwd=cwd, check=True, capture_output=True, text=True
    )
    return done.stdout.strip()


@pytest.fixture
def repo(tmp_path):
    path = tmp_path / "repo"
    path.mkdir()
    git(path, "init", "-q")
    (path / "hello.txt").write_text("one\n", encoding="utf-8")
    git(path, "add", ".")
    git(path, "commit", "-q", "-m", "first")
    return path


def task(repo, **changes):
    values = {
        "id": "a",
        "run_id": "run",
        "title": "Edit the repo",
        "role": "backend",
        "repository_reference": str(repo),
    }
    return TaskSpec(**(values | changes))


def assignment(repo, **changes):
    return Assignment(task=task(repo, **changes), worker=AgentConfig(id="w", role="backend"))


async def test_create_checks_out_the_base_commit_without_touching_the_repo(repo, tmp_path):
    first = git(repo, "rev-parse", "HEAD")
    (repo / "hello.txt").write_text("two\n", encoding="utf-8")
    git(repo, "commit", "-q", "-am", "second")
    second = git(repo, "rev-parse", "HEAD")

    path = await worktrees.create(repo, first, tmp_path / "trees" / "a")

    assert (path / "hello.txt").read_text(encoding="utf-8") == "one\n"
    assert git(path, "rev-parse", "HEAD") == first
    assert git(repo, "rev-parse", "HEAD") == second
    assert (repo / "hello.txt").read_text(encoding="utf-8") == "two\n"


async def test_create_defaults_to_head(repo, tmp_path):
    path = await worktrees.create(repo, "", tmp_path / "tree")
    assert git(path, "rev-parse", "HEAD") == git(repo, "rev-parse", "HEAD")


@pytest.mark.parametrize("commit", ["no-such-commit", "--orphan", "-f"])
async def test_create_rejects_a_bad_commit(repo, tmp_path, commit):
    with pytest.raises(RuntimeError, match="git rev-parse failed"):
        await worktrees.create(repo, commit, tmp_path / "tree")
    assert not (tmp_path / "tree").exists()


async def test_create_needs_an_absolute_path(repo):
    with pytest.raises(ValueError, match="absolute"):
        await worktrees.create(repo, "", "tree")
    assert not (repo / "tree").exists()


async def test_diff_includes_modified_and_new_files(repo, tmp_path):
    path = await worktrees.create(repo, "", tmp_path / "tree")
    assert await worktrees.diff(path) == ""
    (path / "hello.txt").write_text("two\n", encoding="utf-8")
    (path / "new.txt").write_text("fresh\n", encoding="utf-8")

    diff = await worktrees.diff(path)

    assert "-one" in diff and "+two" in diff
    assert "new.txt" in diff and "+fresh" in diff


async def test_remove_deletes_a_changed_worktree(repo, tmp_path):
    path = await worktrees.create(repo, "", tmp_path / "tree")
    (path / "new.txt").write_text("fresh\n", encoding="utf-8")
    await worktrees.remove(repo, path)
    assert not path.exists()
    assert len(git(repo, "worktree", "list").splitlines()) == 1


@pytest.mark.parametrize("changes", [{"id": ".."}, {"id": "a/b"}, {"run_id": "..\\x"}])
async def test_executor_rejects_ids_that_could_leave_the_root(repo, tmp_path, changes):
    inner = MockExecutor()
    with pytest.raises(ValueError, match="may use only"):
        await WorktreeExecutor(inner, tmp_path / "trees").execute(assignment(repo, **changes))
    assert not inner.assignments


async def test_executor_needs_a_repository(repo, tmp_path):
    with pytest.raises(ValueError, match="repository_reference"):
        await WorktreeExecutor(MockExecutor(), tmp_path / "trees").execute(
            assignment(repo, repository_reference="")
        )


async def test_executor_never_reuses_an_existing_worktree(repo, tmp_path):
    executor = WorktreeExecutor(MockExecutor(), tmp_path / "trees")
    first = await executor.execute(assignment(repo))
    kept = pathlib.Path(first.workspace) / "keep.txt"
    kept.write_text("mine\n", encoding="utf-8")
    with pytest.raises(RuntimeError, match="git worktree failed"):
        await executor.execute(assignment(repo))
    assert kept.read_text(encoding="utf-8") == "mine\n"


async def test_workers_get_separate_worktrees_at_once(repo, tmp_path):
    gate = asyncio.Event()
    inner = MockExecutor(gate=gate, expected_starts=2)
    trees = WorktreeExecutor(inner, tmp_path / "trees")
    engine = Scheduler(validator=CommandValidator(checks={}))
    for worker in ("w1", "w2"):
        engine.register_worker(AgentConfig(id=worker, role="backend"), trees)
    plan = RunPlan(id="run", tasks=(task(repo, id="a"), task(repo, id="b")))
    running = asyncio.create_task(engine.run(plan))
    await asyncio.wait_for(inner.started.wait(), 20)
    gate.set()
    report = await asyncio.wait_for(running, 20)

    assert report.successful
    seen = {a.task.workspace_reference for a in inner.assignments}
    assert seen == {str(tmp_path / "trees" / "run" / name) for name in ("a", "b")}


async def test_edit_run_records_the_diff_and_passes_a_real_check(repo, tmp_path, monkeypatch):
    monkeypatch.setenv("FAKE_CLAUDE_LOG", str(tmp_path / "trees" / "run" / "call.json"))
    monkeypatch.setenv("FAKE_CLAUDE_MODE", "edit")
    exists = "import pathlib, sys; sys.exit(not pathlib.Path('fake_edit.txt').exists())"
    engine = Scheduler(
        validator=CommandValidator(checks={"edited": (sys.executable, "-c", exists)})
    )
    claude = ClaudeCodeExecutor(command=(sys.executable, str(FAKE_CLAUDE)))
    engine.register_worker(
        AgentConfig(id="w", role="backend"), WorktreeExecutor(claude, tmp_path / "trees")
    )
    edit = task(repo, allowed_operations=("edit",), execution_constraints=("check:edited",))

    report = await asyncio.wait_for(engine.run(RunPlan(id="run", tasks=(edit,))), 30)

    result = report.attempts[0].result
    tree = tmp_path / "trees" / "run" / "a"
    assert report.tasks[0].status == TaskStatus.COMPLETED, report.tasks[0].message
    assert result.workspace == str(tree)
    assert "fake_edit.txt" in result.diff and "+edited by fake claude" in result.diff
    assert pathlib.Path(fake_call(tree)["cwd"]).samefile(tree)  # noqa: ASYNC240
    assert not (repo / "fake_edit.txt").exists()
    assert git(repo, "status", "--porcelain") == ""
