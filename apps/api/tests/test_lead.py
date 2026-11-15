import json
import logging
import sys

import pytest
from langchain_core.runnables import Runnable
from test_claude_code import FAKE_CLAUDE, fake_calls, flag

from agentforge.__main__ import cli
from agentforge.claude_code import ClaudeCodeRunner
from agentforge.domain import RunPlan
from agentforge.lead import Planner, PlanRejected, PlanRequest, PlanRound

REQUEST = "Add a health endpoint SECRET-REQUEST and test it"


def draft(*tasks):
    return {"tasks": list(tasks)}


def spec(task_id, role="backend", dependencies=(), **extra):
    return {
        "id": task_id,
        "title": f"Do {task_id}",
        "role": role,
        "description": "",
        "objective": "",
        "acceptance_criteria": [f"{task_id} works"],
        "dependencies": list(dependencies),
        **extra,
    }


GOOD = draft(spec("api"), spec("tests", role="qa", dependencies=("api",)))
NO_ISSUES = {"issues": []}


@pytest.fixture
def scripted(tmp_path, monkeypatch):
    """Point the fake CLI at a list of replies; returns a function that writes the list."""
    log = tmp_path / "call.json"
    monkeypatch.setenv("FAKE_CLAUDE_LOG", str(log))
    monkeypatch.setenv("FAKE_CLAUDE_MODE", "script")
    (tmp_path / "repo").mkdir()

    def write(*replies):
        path = tmp_path / "script.json"
        path.write_text(json.dumps(replies), encoding="utf-8")
        monkeypatch.setenv("FAKE_CLAUDE_SCRIPT", str(path))
        return tmp_path / "repo"

    return write


def planner(repo, **options):
    runner = ClaudeCodeRunner(command=(sys.executable, str(FAKE_CLAUDE)))
    return Planner(runner, roles=("backend", "qa"), workspace=str(repo), **options)


def calls(repo):
    return fake_calls(repo)


async def test_plan_accepted_on_the_first_draft(scripted, caplog):
    caplog.set_level(logging.DEBUG, logger="agentforge")
    repo = scripted(GOOD, NO_ISSUES)
    lead = planner(repo)
    assert isinstance(lead, Runnable)

    result = await lead.ainvoke(PlanRequest(request=REQUEST, run_id="r1"))

    assert isinstance(result.plan, RunPlan) and result.plan.id == "r1"
    assert [t.id for t in result.plan.tasks] == ["api", "tests"]
    assert result.plan.tasks[1].dependencies == ("api",)
    assert all(t.run_id == "r1" and t.allowed_operations == () for t in result.plan.tasks)
    assert result.rounds == ()
    drafted, critiqued = calls(repo)
    assert REQUEST in drafted["stdin"] and "backend, qa" in drafted["stdin"]
    assert REQUEST in critiqued["stdin"] and '"api"' in critiqued["stdin"]
    for call in (drafted, critiqued):
        assert flag(call["argv"], "--tools") == "Read,Glob,Grep"
        assert "--permission-mode" not in call["argv"]
    assert "lead r1: draft made (2 tasks)" in caplog.messages
    assert "lead r1: critique found no issues; plan accepted" in caplog.messages
    assert "SECRET-REQUEST" not in caplog.text


async def test_a_role_no_agent_has_is_found_by_the_check_and_revised(scripted, caplog):
    caplog.set_level(logging.DEBUG, logger="agentforge")
    repo = scripted(draft(spec("ui", role="designer")), GOOD, NO_ISSUES)

    result = await planner(repo).ainvoke(PlanRequest(request=REQUEST, run_id="r1"))

    assert [t.role for t in result.plan.tasks] == ["backend", "qa"]
    assert result.rounds == (
        PlanRound(revision=0, source="check", issues=("no worker registered for role: designer",)),
    )
    revised = calls(repo)[1]
    assert "no worker registered for role: designer" in revised["stdin"]
    assert "lead r1: check found 1 issue(s) in revision 0" in caplog.messages


async def test_a_critique_issue_is_revised(scripted):
    repo = scripted(draft(spec("api")), {"issues": ["nothing tests the endpoint"]}, GOOD, NO_ISSUES)

    result = await planner(repo).ainvoke(PlanRequest(request=REQUEST, run_id="r1"))

    assert [t.id for t in result.plan.tasks] == ["api", "tests"]
    assert result.rounds == (
        PlanRound(revision=0, source="critique", issues=("nothing tests the endpoint",)),
    )
    assert "nothing tests the endpoint" in calls(repo)[2]["stdin"]


async def test_a_plan_that_never_converges_is_rejected(scripted, caplog):
    repo = scripted(GOOD, {"issues": ["a"]}, GOOD, {"issues": ["b"]}, GOOD, {"issues": ["c"]})

    with pytest.raises(PlanRejected) as rejected:
        await planner(repo, max_revisions=2).ainvoke(PlanRequest(request=REQUEST, run_id="r1"))

    assert [r.issues for r in rejected.value.rounds] == [("a",), ("b",), ("c",)]
    assert len(calls(repo)) == 6  # draft, then critique and revise twice, then a last critique
    warnings = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    assert warnings == ["lead r1: plan rejected after 2 revision(s); 3 round(s) had issues"]


async def test_the_model_cannot_grant_rights(scripted):
    repo = scripted(draft(spec("api", allowed_operations=["edit"])), GOOD, NO_ISSUES)

    result = await planner(repo).ainvoke(PlanRequest(request=REQUEST, run_id="r1"))

    (first,) = result.rounds
    assert first.source == "check" and "does not match the plan schema" in first.issues[0]
    assert all(t.allowed_operations == () for t in result.plan.tasks)


async def test_rights_and_limits_come_from_the_person(scripted):
    repo = scripted(GOOD, NO_ISSUES)
    lead = planner(repo, task_defaults={"allowed_operations": ("edit",), "max_attempts": 2})

    result = await lead.ainvoke(PlanRequest(request=REQUEST, run_id="r1"))

    assert all(t.allowed_operations == ("edit",) for t in result.plan.tasks)
    assert all(t.max_attempts == 2 for t in result.plan.tasks)
    with pytest.raises(ValueError, match="role"):
        planner(repo, task_defaults={"role": "qa"})


def test_cli_plan_prints_the_plan_and_exits_1_when_rejected(
    scripted, tmp_path, monkeypatch, capsys
):
    monkeypatch.setenv("APPDATA", str(tmp_path / "appdata"))  # the five default agents
    repo = scripted(GOOD, NO_ISSUES)
    fake = ["--command", sys.executable, str(FAKE_CLAUDE)]

    code = cli(["plan", REQUEST, "--workspace", str(repo), "--run-id", "r1", *fake])

    out, err = capsys.readouterr()
    assert code == 0 and "billed" in err
    assert [t["id"] for t in json.loads(out)["plan"]["tasks"]] == ["api", "tests"]

    (tmp_path / "call.json.all").unlink()
    scripted(GOOD, {"issues": ["a"]})
    code = cli(["plan", REQUEST, "--workspace", str(repo), "--max-revisions", "0", *fake])
    out, err = capsys.readouterr()
    assert code == 1 and "plan rejected" in err
    assert json.loads(out) == [{"revision": 0, "source": "critique", "issues": ["a"]}]
