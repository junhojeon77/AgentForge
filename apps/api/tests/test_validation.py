import asyncio
import sys

import pytest
from test_claude_code import is_running

from agentforge.domain import TaskSpec, WorkerResult
from agentforge.validation import CommandValidator

OK = (sys.executable, "-c", "print('fine')")
FAIL = (sys.executable, "-c", "import sys; print('boom detail'); sys.exit(3)")
DONE = WorkerResult(success=True)


def task(workspace, *checks):
    return TaskSpec(
        id="a",
        run_id="run",
        title="t",
        role="backend",
        workspace_reference=None if workspace is None else str(workspace),
        execution_constraints=(*(f"check:{name}" for name in checks), "be tidy"),
    )


@pytest.fixture
async def hanging():
    """A check that reports its pid to the test, then hangs: a barrier without sleeps."""
    pids = asyncio.Queue()

    async def on_connect(reader, writer):
        pids.put_nowait(int(await reader.readline()))
        writer.close()

    server = await asyncio.start_server(on_connect, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    script = (
        "import os, socket, time\n"
        f"s = socket.create_connection(('127.0.0.1', {port}))\n"
        "s.sendall(f'{os.getpid()}\\n'.encode())\n"
        "time.sleep(60)\n"
    )
    yield (sys.executable, "-c", script), pids
    server.close()
    await server.wait_closed()


async def test_passing_checks_accept(tmp_path):
    validator = CommandValidator(checks={"unit": OK, "lint": OK})
    report = await validator.validate(task(tmp_path, "unit", "lint"), DONE)
    assert report.accepted and report.issues == ()


async def test_failing_check_rejects_with_its_output(tmp_path):
    validator = CommandValidator(checks={"unit": FAIL, "lint": OK})
    report = await validator.validate(task(tmp_path, "unit", "lint"), DONE)
    assert not report.accepted
    assert len(report.issues) == 1
    assert "unit" in report.issues[0] and "exit 3" in report.issues[0]
    assert "boom detail" in report.issues[0]


async def test_worker_claims_are_not_believed(tmp_path):
    lying = WorkerResult(success=True, passed_checks=("unit",), satisfied_criteria=("all",))
    report = await CommandValidator(checks={"unit": FAIL}).validate(task(tmp_path, "unit"), lying)
    assert not report.accepted


async def test_unknown_check_rejects(tmp_path):
    validator = CommandValidator(checks={"unit": OK})
    report = await validator.validate(task(tmp_path, "unit", "typo"), DONE)
    assert not report.accepted
    assert report.issues == ("unknown check: typo",)


async def test_checks_run_in_the_result_workspace_before_the_task_workspace(tmp_path):
    tree = tmp_path / "tree"
    tree.mkdir()
    (tree / "marker").write_text("x", encoding="utf-8")
    here = (sys.executable, "-c", "import os, sys; sys.exit(not os.path.exists('marker'))")
    validator = CommandValidator(checks={"here": here})
    in_tree = WorkerResult(success=True, workspace=str(tree))

    assert (await validator.validate(task(tmp_path, "here"), in_tree)).accepted
    assert (await validator.validate(task(tree, "here"), DONE)).accepted
    assert not (await validator.validate(task(tmp_path, "here"), DONE)).accepted


async def test_missing_workspace_rejects(tmp_path):
    validator = CommandValidator(checks={"unit": OK})
    for workspace in (None, tmp_path / "missing"):
        report = await validator.validate(task(workspace, "unit"), DONE)
        assert not report.accepted
        assert report.issues == ("no workspace to validate",)


async def test_timeout_kills_the_check(tmp_path, hanging):
    command, pids = hanging
    validator = CommandValidator(checks={"slow": command}, timeout=2)
    report = await asyncio.wait_for(validator.validate(task(tmp_path, "slow"), DONE), 20)
    assert not report.accepted
    assert report.issues == ("check slow timed out after 2s",)
    assert not is_running(await asyncio.wait_for(pids.get(), 5))


async def test_cancel_kills_the_check(tmp_path, hanging):
    command, pids = hanging
    validator = CommandValidator(checks={"slow": command})
    running = asyncio.create_task(validator.validate(task(tmp_path, "slow"), DONE))
    pid = await asyncio.wait_for(pids.get(), 20)
    running.cancel()
    await asyncio.gather(running, return_exceptions=True)
    assert running.cancelled()
    assert not is_running(pid)
