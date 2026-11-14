import asyncio
import logging
import pathlib
import subprocess
import sys

import pytest
from test_claude_code import FAKE_CLAUDE, fake_call, flag, is_running

from agentforge import worktrees
from agentforge.__main__ import cli
from agentforge.claude_code import ClaudeCodeExecutor
from agentforge.domain import (
    AgentConfig,
    Assignment,
    FailureReason,
    RunPlan,
    TaskSpec,
    TaskStatus,
)
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


async def test_diff_includes_files_in_ignored_paths(repo, tmp_path):
    (repo / ".gitignore").write_text("build/\n.env\n", encoding="utf-8")
    git(repo, "add", ".")
    git(repo, "commit", "-q", "-m", "ignore build output")
    path = await worktrees.create(repo, "", tmp_path / "tree")
    (path / "build").mkdir()
    (path / "build" / "conftest.py").write_text("hidden = True\n", encoding="utf-8")
    (path / ".env").write_text("KEY=1\n", encoding="utf-8")

    diff = await worktrees.diff(path)

    assert "build/conftest.py" in diff and "+hidden = True" in diff
    assert ".env" in diff and "+KEY=1" in diff


async def test_remove_deletes_a_changed_worktree(repo, tmp_path):
    path = await worktrees.create(repo, "", tmp_path / "tree")
    (path / "new.txt").write_text("fresh\n", encoding="utf-8")
    await worktrees.remove(repo, path)
    assert not path.exists()
    assert len(git(repo, "worktree", "list").splitlines()) == 1


async def test_remove_run_deletes_every_worktree_of_that_run_only(repo, tmp_path, caplog):
    caplog.set_level(logging.DEBUG, logger="agentforge")
    root = tmp_path / "trees"
    executor = WorktreeExecutor(MockExecutor(), root)
    first = await executor.execute(assignment(repo))
    retry = await executor.execute(assignment(repo).model_copy(update={"attempt_number": 2}))
    other = await executor.execute(assignment(repo, run_id="other"))
    (pathlib.Path(first.workspace) / "scratch.txt").write_text("uncommitted\n", encoding="utf-8")

    removed = await worktrees.remove_run(repo, root, "run")

    assert removed == [pathlib.Path(first.workspace), pathlib.Path(retry.workspace)]
    assert not (root / "run").exists()
    assert pathlib.Path(other.workspace).is_dir()  # noqa: ASYNC240
    assert len(git(repo, "worktree", "list").splitlines()) == 2  # the checkout and "other"
    assert git(repo, "status", "--porcelain") == ""
    assert f"worktree removed: {first.workspace}" in caplog.messages
    assert f"worktree removed: {retry.workspace}" in caplog.messages


async def test_remove_run_keeps_a_folder_git_does_not_know_and_names_it(repo, tmp_path, caplog):
    root = tmp_path / "trees"
    real = await WorktreeExecutor(MockExecutor(), root).execute(assignment(repo))
    stray = root / "run" / "b" / "1"
    stray.mkdir(parents=True)
    (stray / "keep.txt").write_text("SECRET-TOKEN\n", encoding="utf-8")

    with pytest.raises(RuntimeError, match="worktrees not removed") as error:
        await worktrees.remove_run(repo, root, "run")

    assert str(stray) in str(error.value)
    assert (stray / "keep.txt").exists()
    assert not pathlib.Path(real.workspace).exists()  # noqa: ASYNC240  the real one still went
    warnings = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    assert warnings == [f"worktree not removed: {stray}"]


async def test_remove_run_rejects_an_unsafe_id_and_ignores_a_run_with_no_worktrees(repo, tmp_path):
    with pytest.raises(ValueError, match="may use only"):
        await worktrees.remove_run(repo, tmp_path, "..")
    assert repo.is_dir()
    assert await worktrees.remove_run(repo, tmp_path / "trees", "never-ran") == []


def test_cli_clean_removes_a_runs_worktrees(repo, tmp_path, capsys):
    root = tmp_path / "trees"
    kept = asyncio.run(WorktreeExecutor(MockExecutor(), root).execute(assignment(repo)))

    code = cli(["clean", "run", "--repo", str(repo), "--root", str(root)])

    assert code == 0
    assert kept.workspace in capsys.readouterr().out
    assert not (root / "run").exists()
    with pytest.raises(SystemExit) as stopped:
        cli(["clean", "..", "--repo", str(repo), "--root", str(root)])
    assert stopped.value.code == 2


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


async def test_resume_reuses_the_attempts_worktree_and_keeps_its_edits(repo, tmp_path, caplog):
    caplog.set_level(logging.DEBUG, logger="agentforge")
    inner = MockExecutor()
    executor = WorktreeExecutor(inner, tmp_path / "trees")
    first = await executor.execute(assignment(repo))
    (pathlib.Path(first.workspace) / "keep.txt").write_text("mine\n", encoding="utf-8")

    again = await executor.execute(assignment(repo).model_copy(update={"resume": True}))

    assert again.workspace == first.workspace
    assert "+mine" in again.diff
    assert [a.task.workspace_reference for a in inner.assignments] == [first.workspace] * 2
    assert inner.assignments[1].resume
    assert f"worktree reused: {first.workspace}" in caplog.text


async def test_resume_creates_the_worktree_when_the_pause_came_before_it_existed(repo, tmp_path):
    executor = WorktreeExecutor(MockExecutor(), tmp_path / "trees")
    result = await executor.execute(assignment(repo).model_copy(update={"resume": True}))
    assert (pathlib.Path(result.workspace) / "hello.txt").exists()


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
    assert seen == {str(tmp_path / "trees" / "run" / name / "1") for name in ("a", "b")}


async def test_edit_run_records_the_diff_and_passes_a_real_check(repo, tmp_path, monkeypatch):
    monkeypatch.setenv("FAKE_CLAUDE_LOG", str(tmp_path / "trees" / "run" / "a" / "call.json"))
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
    tree = tmp_path / "trees" / "run" / "a" / "1"
    assert report.tasks[0].status == TaskStatus.COMPLETED, report.tasks[0].message
    assert result.workspace == str(tree)
    assert "fake_edit.txt" in result.diff and "+edited by fake claude" in result.diff
    assert pathlib.Path(fake_call(tree)["cwd"]).samefile(tree)  # noqa: ASYNC240
    assert not (repo / "fake_edit.txt").exists()
    assert git(repo, "status", "--porcelain") == ""


async def test_paused_claude_worker_is_killed_and_resumes_its_session_in_the_same_worktree(
    repo, tmp_path, monkeypatch
):
    monkeypatch.setenv("FAKE_CLAUDE_LOG", str(tmp_path / "call.json"))
    monkeypatch.setenv("FAKE_CLAUDE_MODE", "hang")
    started = asyncio.Event()
    claude = ClaudeCodeExecutor(
        command=(sys.executable, str(FAKE_CLAUDE)), on_event=lambda task_id, event: started.set()
    )
    exists = "import pathlib, sys; sys.exit(not pathlib.Path('fake_edit.txt').exists())"
    engine = Scheduler(
        validator=CommandValidator(checks={"edited": (sys.executable, "-c", exists)})
    )
    engine.register_worker(
        AgentConfig(id="w", role="backend"), WorktreeExecutor(claude, tmp_path / "trees")
    )
    edit = task(repo, allowed_operations=("edit",), execution_constraints=("check:edited",))
    running = asyncio.create_task(engine.run(RunPlan(id="run", tasks=(edit,))))
    await asyncio.wait_for(started.wait(), 30)

    await asyncio.wait_for(engine.pause_task("a"), 30)
    first = fake_call(tmp_path / "trees")
    assert engine.snapshot().tasks[0].status == TaskStatus.PAUSED
    assert not is_running(first["pid"])

    monkeypatch.setenv("FAKE_CLAUDE_MODE", "edit")
    await engine.resume_task("a")
    report = await asyncio.wait_for(running, 60)

    tree = tmp_path / "trees" / "run" / "a" / "1"
    second = fake_call(tmp_path / "trees")
    (attempt,) = report.attempts
    assert report.tasks[0].status == TaskStatus.COMPLETED, report.tasks[0].message
    assert flag(second["argv"], "--resume") == flag(first["argv"], "--session-id")
    assert attempt.session_id == attempt.result.session_id == flag(second["argv"], "--resume")
    assert pathlib.Path(second["cwd"]).samefile(tree)  # noqa: ASYNC240
    assert "interrupted" in second["stdin"]
    assert attempt.result.workspace == str(tree) and "fake_edit.txt" in attempt.result.diff
    assert git(repo, "status", "--porcelain") == ""


async def test_retry_starts_in_a_fresh_worktree_and_tells_the_worker_why(
    repo, tmp_path, monkeypatch, caplog
):
    caplog.set_level(logging.DEBUG, logger="agentforge")
    monkeypatch.setenv("FAKE_CLAUDE_LOG", str(tmp_path / "call.json"))
    monkeypatch.setenv("FAKE_CLAUDE_MODE", "edit")
    # Fails the first time it runs and passes afterwards; the marker lives outside the worktrees.
    flaky = (
        "import pathlib, sys; marker = pathlib.Path(sys.argv[1]); seen = marker.exists(); "
        "marker.touch(); print('CHECK-OUTPUT-MARKER'); sys.exit(not seen)"
    )
    check = (sys.executable, "-c", flaky, str(tmp_path / "ran-once"))
    engine = Scheduler(validator=CommandValidator(checks={"flaky": check}))
    claude = ClaudeCodeExecutor(command=(sys.executable, str(FAKE_CLAUDE)))
    engine.register_worker(
        AgentConfig(id="w", role="backend"), WorktreeExecutor(claude, tmp_path / "trees")
    )
    edit = task(
        repo,
        allowed_operations=("edit",),
        execution_constraints=("check:flaky",),
        max_attempts=2,
    )

    report = await asyncio.wait_for(engine.run(RunPlan(id="run", tasks=(edit,))), 60)

    trees = tmp_path / "trees" / "run" / "a"
    first, second = report.attempts
    assert report.tasks[0].status == TaskStatus.COMPLETED, report.tasks[0].message
    assert (first.status, first.failure_reason) == (
        TaskStatus.FAILED,
        FailureReason.VALIDATION_REJECTED,
    )
    assert "CHECK-OUTPUT-MARKER" in first.message
    assert first.result.workspace == str(trees / "1")
    assert second.result.workspace == str(trees / "2")
    # A clean copy: the second attempt's diff adds the file again instead of finding it there.
    assert "+edited by fake claude" in first.result.diff
    assert "+edited by fake claude" in second.result.diff
    call = fake_call(tmp_path / "trees")
    assert pathlib.Path(call["cwd"]).samefile(trees / "2")  # noqa: ASYNC240
    assert "CHECK-OUTPUT-MARKER" in call["stdin"]
    assert str(trees / "2") in caplog.text and "check flaky" in caplog.text
    assert "CHECK-OUTPUT-MARKER" not in caplog.text
    assert git(repo, "status", "--porcelain") == ""
