import asyncio
import json
import logging
import os
import pathlib
import subprocess
import sys
import uuid

import pytest
from langchain_core.runnables import Runnable, RunnableLambda

from agentforge.__main__ import cli
from agentforge.claude_code import ClaudeCall, ClaudeCodeExecutor, ClaudeCodeRunner
from agentforge.domain import (
    AgentConfig,
    Assignment,
    FailureReason,
    RunPlan,
    RunReport,
    TaskSpec,
    TaskStatus,
    WorkerResult,
)
from agentforge.mocks import MockValidator
from agentforge.orchestration import Scheduler

FAKE_CLAUDE = pathlib.Path(__file__).parent / "fake_claude.py"


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    monkeypatch.setenv("FAKE_CLAUDE_LOG", str(tmp_path / "call.json"))
    path = tmp_path / "workspace"
    path.mkdir()
    return path


def fake_call(workspace):
    return json.loads((workspace.parent / "call.json").read_text(encoding="utf-8"))


def fake_calls(workspace):
    lines = (workspace.parent / "call.json.all").read_text(encoding="utf-8").splitlines()
    return [json.loads(line) for line in lines]


def flag(argv, name):
    return argv[argv.index(name) + 1]


def executor(**kwargs):
    return ClaudeCodeExecutor(command=(sys.executable, str(FAKE_CLAUDE)), **kwargs)


def task(workspace):
    return TaskSpec(
        id="a",
        run_id="run",
        title="Read the file",
        role="backend",
        workspace_reference=None if workspace is None else str(workspace),
        acceptance_criteria=("read hello.txt",),
    )


async def run_one(workspace, claude=None):
    engine = Scheduler(validator=MockValidator())
    engine.register_worker(AgentConfig(id="w", role="backend"), claude or executor())
    return await asyncio.wait_for(engine.run(RunPlan(id="run", tasks=(task(workspace),))), 5)


def is_running(pid):
    if sys.platform == "win32":
        listing = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True
        ).stdout
        return str(pid) in listing
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


async def test_runs_read_only_claude_and_returns_structured_result(workspace):
    events = []
    worker = AgentConfig(
        id="w",
        role="backend",
        model="claude-sonnet-5-5",
        reasoning="high",
        persona="You are the backend engineer.\nReport facts only.",
    )
    claude = executor(on_event=lambda task_id, event: events.append((task_id, event["type"])))
    result = await claude.execute(Assignment(task=task(workspace), worker=worker))

    call = fake_call(workspace)
    argv = call["argv"]
    session_id = flag(argv, "--session-id")
    uuid.UUID(session_id)
    assert result == WorkerResult(
        success=True,
        message="pineapple",
        artifacts=("hello.txt",),
        satisfied_criteria=("read hello.txt",),
        session_id=session_id,
    )
    assert flag(argv, "--model") == "claude-sonnet-5-5"
    assert flag(argv, "--effort") == "high"
    assert flag(argv, "--append-system-prompt") == worker.persona
    assert flag(argv, "--output-format") == "stream-json"
    assert flag(argv, "--tools") == "Read,Glob,Grep"
    assert flag(argv, "--permission-prompts") == "none"
    assert flag(argv, "--max-budget-usd") == "1.0"
    assert {"-p", "--verbose", "--restricted", "--strict-mcp-config"} <= set(argv)
    assert "--permission-mode" not in argv
    assert "cannot edit files" in call["stdin"]
    schema = json.loads(flag(argv, "--json-schema"))
    assert not {"session_id", "workspace", "diff"} & set(schema["properties"])
    assert set(schema["required"]) == set(schema["properties"])
    assert pathlib.Path(call["cwd"]).samefile(workspace)  # noqa: ASYNC240
    assert "Read the file" in call["stdin"] and "read hello.txt" in call["stdin"]
    assert "Previous attempt" not in call["stdin"]
    assert [task_id for task_id, _ in events] == ["a"] * 7
    assert events[0][1] == "system" and events[-1][1] == "result"


async def test_edit_task_gets_edit_tools_but_no_commands(workspace):
    edit = task(workspace).model_copy(update={"allowed_operations": ("edit",)})
    await executor().execute(Assignment(task=edit, worker=AgentConfig(id="w", role="backend")))

    call = fake_call(workspace)
    argv = call["argv"]
    assert flag(argv, "--tools") == "Read,Glob,Grep,Edit,Write"
    assert flag(argv, "--permission-mode") == "acceptEdits"
    assert flag(argv, "--permission-prompts") == "none"
    assert {"--restricted", "--strict-mcp-config"} <= set(argv)
    assert "can edit files" in call["stdin"] and "cannot run commands" in call["stdin"]
    assert "cannot edit files" not in call["stdin"]


async def test_executor_is_a_langchain_runnable(workspace):
    claude = executor()
    assert isinstance(claude, Runnable)
    assignment = Assignment(task=task(workspace), worker=AgentConfig(id="w", role="backend"))

    result = await claude.ainvoke(assignment)

    assert result.success and result.message == "pineapple"
    assert result.session_id == flag(fake_call(workspace)["argv"], "--session-id")
    with pytest.raises(NotImplementedError, match="async"):
        claude.invoke(assignment)


async def test_runner_composes_with_langchain_and_returns_the_result_event(workspace):
    def call(question):
        return ClaudeCall(
            key="lead",
            name="lead r1",
            label="lead r1 round 1",
            folder=str(workspace),
            prompt=question,
            schema='{"type": "object"}',
            tools="Read,Glob,Grep",
            session_id=str(uuid.uuid4()),
        )

    chain = RunnableLambda(call) | ClaudeCodeRunner(command=(sys.executable, str(FAKE_CLAUDE)))
    result = await chain.ainvoke("Which file holds the secret word?")

    assert result["subtype"] == "success"
    assert result["structured_output"]["message"] == "pineapple"
    sent = fake_call(workspace)
    assert sent["stdin"] == "Which file holds the secret word?"
    assert flag(sent["argv"], "--tools") == "Read,Glob,Grep"
    assert flag(sent["argv"], "--json-schema") == '{"type": "object"}'
    assert pathlib.Path(sent["cwd"]).samefile(workspace)  # noqa: ASYNC240


def checking_task(workspace, **changes):
    values = {
        "allowed_operations": ("edit", "check"),
        "execution_constraints": ("check:unit", "keep it short", "check:lint"),
    }
    return TaskSpec.model_validate(task(workspace).model_dump() | values | changes)


CHECKS = {"unit": ("python", "-m", "pytest"), "lint": ("ruff", "check", "src dir")}


async def test_check_task_may_run_exactly_its_own_checks(workspace, caplog):
    caplog.set_level(logging.DEBUG, logger="agentforge")
    claude = executor(checks=CHECKS)
    await claude.execute(
        Assignment(task=checking_task(workspace), worker=AgentConfig(id="w", role="backend"))
    )

    call = fake_call(workspace)
    argv = call["argv"]
    assert flag(argv, "--tools") == "Read,Glob,Grep,Edit,Write,Bash"
    # dontAsk refuses every command without a rule; acceptEdits would approve file commands too.
    assert flag(argv, "--permission-mode") == "dontAsk"
    start = argv.index("--allowedTools") + 1
    assert argv[start : start + 4] == [
        "Edit", "Write", "Bash(python -m pytest)", "Bash(ruff check 'src dir')"
    ]  # fmt: skip
    assert argv[start + 4].startswith("--")
    assert flag(argv, "--permission-prompts") == "none"
    assert {"--restricted", "--strict-mcp-config"} <= set(argv)
    assert "python -m pytest" in call["stdin"] and "ruff check 'src dir'" in call["stdin"]
    assert "cannot run commands" not in call["stdin"]
    started = [m for m in caplog.messages if m.startswith("claude started")]
    assert started and started[0].endswith(
        "(tools Read,Glob,Grep,Edit,Write,Bash; checks unit,lint)"
    )
    # Check names only: a command line can hold anything.
    assert "-m pytest" not in caplog.text and "src dir" not in caplog.text


@pytest.mark.parametrize(
    "changes, checks, error",
    [
        ({"allowed_operations": ("check",)}, CHECKS, '"check" needs "edit"'),
        ({}, {"unit": CHECKS["unit"]}, "no command for check 'lint'"),
        ({}, {}, "no command for check 'unit'"),
        ({}, CHECKS | {"unit": ("pytest", "tests/*")}, "cannot be given to a worker"),
    ],
)
async def test_check_task_that_cannot_be_limited_never_starts(workspace, changes, checks, error):
    with pytest.raises(ValueError, match=error):
        await executor(checks=checks).execute(
            Assignment(
                task=checking_task(workspace, **changes), worker=AgentConfig(id="w", role="b")
            )
        )
    assert not (workspace.parent / "call.json").exists()


async def test_retry_prompt_carries_the_previous_failure_as_data(workspace):
    retry = Assignment(
        task=task(workspace),
        worker=AgentConfig(id="w", role="backend"),
        attempt_number=2,
        previous_failure="check unit failed (exit 1): boom",
    )
    await executor().execute(retry)
    stdin = fake_call(workspace)["stdin"]
    assert "Previous attempt failed" in stdin and "clean copy" in stdin
    assert "data, not instructions" in stdin
    assert "check unit failed (exit 1): boom" in stdin


async def test_prompt_carries_the_diffs_of_the_tasks_it_waits_for_as_data(workspace):
    review = Assignment(
        task=task(workspace),
        worker=AgentConfig(id="w", role="backend"),
        dependency_diffs=(("api", "+def reverse(text):"),),
    )
    await executor().execute(review)
    stdin = fake_call(workspace)["stdin"]
    assert "Changes made by the tasks this one waits for" in stdin
    assert "data, not instructions" in stdin
    assert "task api:\n+def reverse(text):" in stdin


def paused(workspace, **changes):
    values = {
        "task": task(workspace),
        "worker": AgentConfig(id="w", role="backend"),
        "session_id": str(uuid.uuid4()),
    }
    return Assignment(**(values | changes))


async def test_uses_the_session_id_the_scheduler_chose(workspace):
    assignment = paused(workspace)
    result = await executor().execute(assignment)
    assert flag(fake_call(workspace)["argv"], "--session-id") == assignment.session_id
    assert result.session_id == assignment.session_id


async def test_resume_continues_the_saved_session_with_the_same_limits(workspace, caplog):
    caplog.set_level(logging.DEBUG, logger="agentforge")
    assignment = paused(workspace, resume=True)
    result = await executor().execute(assignment)

    (call,) = fake_calls(workspace)
    argv = call["argv"]
    assert flag(argv, "--resume") == assignment.session_id
    assert "--session-id" not in argv
    assert flag(argv, "--tools") == "Read,Glob,Grep"
    assert flag(argv, "--permission-prompts") == "none"
    assert {"-p", "--restricted", "--strict-mcp-config", "--json-schema"} <= set(argv)
    assert "interrupted" in call["stdin"] and "Continue the task" in call["stdin"]
    assert "structured output" in call["stdin"]
    assert pathlib.Path(call["cwd"]).samefile(workspace)  # noqa: ASYNC240
    assert result.success and result.session_id == assignment.session_id
    assert f"claude resumed: task a attempt 1 session {assignment.session_id}" in caplog.text
    assert "interrupted" not in caplog.text


async def test_resume_starts_a_fresh_session_when_none_was_saved(workspace, monkeypatch, caplog):
    monkeypatch.setenv("FAKE_CLAUDE_MODE", "no_session")
    assignment = paused(workspace, resume=True)
    result = await executor().execute(assignment)

    tried, fresh = fake_calls(workspace)
    assert flag(tried["argv"], "--resume") == assignment.session_id
    assert flag(fresh["argv"], "--session-id") == assignment.session_id
    assert "--resume" not in fresh["argv"]
    assert "Read the file" in fresh["stdin"] and "read hello.txt" in fresh["stdin"]
    assert "interrupted" in fresh["stdin"] and "may already be here" in fresh["stdin"]
    assert result.success and result.session_id == assignment.session_id
    warnings = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    assert warnings == [
        f"task a attempt 1: no saved session {assignment.session_id} to resume; "
        "starting a fresh one in the same folder"
    ]


async def test_resume_that_fails_for_another_reason_is_not_retried_fresh(workspace, monkeypatch):
    monkeypatch.setenv("FAKE_CLAUDE_MODE", "crash")
    with pytest.raises(RuntimeError, match="fatal: not logged in"):
        await executor().execute(paused(workspace, resume=True))
    assert len(fake_calls(workspace)) == 1


async def test_error_result_is_a_worker_failure_with_session(workspace, monkeypatch):
    monkeypatch.setenv("FAKE_CLAUDE_MODE", "error_result")
    report = await run_one(workspace)
    state, attempt = report.tasks[0], report.attempts[0]
    assert state.status == TaskStatus.FAILED
    assert state.failure_reason == FailureReason.WORKER_FAILURE
    assert "error_max_budget_usd" in state.message
    assert attempt.result.session_id == flag(fake_call(workspace)["argv"], "--session-id")
    assert "--model" not in fake_call(workspace)["argv"]  # unset model: CLI default
    assert "--append-system-prompt" not in fake_call(workspace)["argv"]  # empty persona


async def test_exit_without_result_is_an_executor_exception(workspace, monkeypatch):
    monkeypatch.setenv("FAKE_CLAUDE_MODE", "crash")
    state = (await run_one(workspace)).tasks[0]
    assert state.failure_reason == FailureReason.EXECUTOR_EXCEPTION
    assert "exited 1" in state.message and "fatal: not logged in" in state.message


async def test_cancel_kills_the_claude_process(workspace, monkeypatch):
    monkeypatch.setenv("FAKE_CLAUDE_MODE", "hang")
    started = asyncio.Event()
    claude = executor(on_event=lambda task_id, event: started.set())
    engine = Scheduler(validator=MockValidator())
    engine.register_worker(AgentConfig(id="w", role="backend"), claude)
    running = asyncio.create_task(engine.run(RunPlan(id="run", tasks=(task(workspace),))))
    await asyncio.wait_for(started.wait(), 5)
    await asyncio.wait_for(engine.cancel_task("a"), 5)
    report = await asyncio.wait_for(running, 5)
    assert report.tasks[0].status == TaskStatus.CANCELLED
    assert not is_running(fake_call(workspace)["pid"])


async def test_timeout_kills_the_claude_process(workspace, monkeypatch):
    monkeypatch.setenv("FAKE_CLAUDE_MODE", "hang")
    started = asyncio.Event()
    claude = executor(on_event=lambda task_id, event: started.set())
    engine = Scheduler(validator=MockValidator())
    engine.register_worker(AgentConfig(id="w", role="backend"), claude)
    slow = TaskSpec.model_validate(task(workspace).model_dump() | {"timeout_seconds": 3})
    report = await asyncio.wait_for(engine.run(RunPlan(id="run", tasks=(slow,))), 10)
    assert started.is_set()  # the fake CLI was running when the limit hit
    assert report.tasks[0].failure_reason == FailureReason.WORKER_TIMEOUT
    assert not is_running(fake_call(workspace)["pid"])


def test_cli_runs_one_task_with_claude_code(workspace, tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("APPDATA", str(tmp_path / "appdata"))  # no personas: the defaults
    code = cli(
        ["claude", "Read the file", "--workspace", str(workspace), "--timeout", "30",
         "--command", sys.executable, str(FAKE_CLAUDE)]
    )  # fmt: skip
    out, err = capsys.readouterr()
    report = RunReport.model_validate_json(out)
    assert code == 0
    assert report.tasks[0].status == TaskStatus.COMPLETED
    assert report.tasks[0].task.role == "qa" and report.tasks[0].task.timeout_seconds == 30
    call = fake_call(workspace)
    assert "Read the file" in call["stdin"]
    assert pathlib.Path(call["cwd"]).samefile(workspace)
    assert flag(call["argv"], "--tools") == "Read,Glob,Grep"
    assert "--append-system-prompt" in call["argv"]  # the default qa persona
    assert "billed" in err


def test_cli_rejects_an_unknown_role_before_starting_claude(workspace, tmp_path, monkeypatch):
    monkeypatch.setenv("APPDATA", str(tmp_path / "appdata"))
    with pytest.raises(SystemExit) as stopped:
        cli(["claude", "Read the file", "--workspace", str(workspace), "--role", "nobody",
             "--command", sys.executable, str(FAKE_CLAUDE)])  # fmt: skip
    assert stopped.value.code == 2
    assert not (workspace.parent / "call.json").exists()


def test_cli_rejects_a_missing_workspace(tmp_path):
    with pytest.raises(SystemExit) as stopped:
        cli(["claude", "Read the file", "--workspace", str(tmp_path / "missing")])
    assert stopped.value.code == 2


async def test_workspace_must_be_an_existing_folder(tmp_path):
    for workspace in (None, tmp_path / "missing"):
        with pytest.raises(ValueError, match="workspace"):
            await executor().execute(
                Assignment(task=task(workspace), worker=AgentConfig(id="w", role="backend"))
            )


async def test_missing_executable_names_the_fix(tmp_path):
    claude = ClaudeCodeExecutor(command=("agentforge-no-such-claude",))
    with pytest.raises(FileNotFoundError, match="claude.exe"):
        await claude.execute(Assignment(task=task(tmp_path), worker=AgentConfig(id="w", role="b")))


async def test_batch_file_launcher_is_rejected(tmp_path):
    launcher = tmp_path / "claude.cmd"
    launcher.write_text("@echo off\n", encoding="utf-8")
    launcher.chmod(0o755)
    claude = ClaudeCodeExecutor(command=(str(launcher),))
    with pytest.raises(ValueError, match="claude.exe"):
        await claude.execute(Assignment(task=task(tmp_path), worker=AgentConfig(id="w", role="b")))


async def test_exit_before_reading_the_prompt_still_reports_the_cli_error(workspace, monkeypatch):
    monkeypatch.setenv("FAKE_CLAUDE_MODE", "unread")
    big = task(workspace).model_copy(update={"description": "x" * 200_000})
    with pytest.raises(RuntimeError, match="fatal: not logged in"):
        await executor().execute(Assignment(task=big, worker=AgentConfig(id="w", role="backend")))


async def test_output_line_that_is_not_a_json_event_is_skipped(workspace, monkeypatch, caplog):
    monkeypatch.setenv("FAKE_CLAUDE_MODE", "noise")
    seen = []
    claude = executor(on_event=lambda task_id, event: seen.append(event))
    result = await claude.execute(
        Assignment(task=task(workspace), worker=AgentConfig(id="w", role="backend"))
    )
    assert result.success and result.message == "pineapple"
    assert seen and all(isinstance(event, dict) for event in seen)
    warnings = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 2
    assert all(w.startswith("task a: skipped an output line of ") for w in warnings)
    assert all(w.endswith(" bytes that is not a JSON event") for w in warnings)
    assert "SECRET-TOKEN" not in caplog.text


@pytest.mark.skipif(
    os.environ.get("AGENTFORGE_LIVE_CLAUDE") != "1",
    reason="live call: set AGENTFORGE_LIVE_CLAUDE=1 and AGENTFORGE_CLAUDE=<claude path>",
)
async def test_live_claude_code_reads_the_workspace(tmp_path):
    (tmp_path / "hello.txt").write_text("The secret word is: pineapple\n", encoding="utf-8")
    claude = ClaudeCodeExecutor(
        command=(os.environ.get("AGENTFORGE_CLAUDE", "claude"),), max_budget_usd=0.5
    )
    live_task = task(tmp_path).model_copy(
        update={"objective": "Read hello.txt and put the secret word in message."}
    )
    worker = AgentConfig(id="w", role="backend", reasoning="low")
    result = await claude.execute(Assignment(task=live_task, worker=worker))
    assert result.success and "pineapple" in result.message
    uuid.UUID(result.session_id)
