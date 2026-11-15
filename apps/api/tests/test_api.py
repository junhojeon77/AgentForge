import json
import logging
import sys

import pytest
from fastapi.testclient import TestClient
from test_claude_code import FAKE_CLAUDE

from agentforge.api import ApiSettings, create_app, write_token
from agentforge.domain import AgentConfig, WorkerResult
from agentforge.mocks import MockExecutor, MockValidator

TOKEN = "test-token-SECRET"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


class FailsFirst:
    """Fails task a's first attempt; everything else succeeds."""

    def __init__(self):
        self.assignments = []

    async def execute(self, assignment):
        self.assignments.append(assignment)
        passed = assignment.task.id != "a" or assignment.attempt_number > 1
        return WorkerResult(success=passed, message="first try fails")


def settings(tmp_path, **changes):
    values = {
        "store_path": tmp_path / "runs.db",
        "token": TOKEN,
        "worktrees": tmp_path / "trees",
        "checks": {"unit": ("python", "-m", "pytest")},
        "claude_command": (sys.executable, str(FAKE_CLAUDE)),
    }
    return ApiSettings(**(values | changes))


@pytest.fixture
def make_client(tmp_path):
    clients = []

    def make(executor=None, **changes):
        workers = [
            (AgentConfig(id="w1", role="backend"), executor or MockExecutor()),
            (AgentConfig(id="w2", role="qa"), executor or MockExecutor()),
        ]
        client = TestClient(
            create_app(settings(tmp_path, **changes), workers=workers, validator=MockValidator())
        )
        client.__enter__()
        clients.append(client)
        return client

    yield make
    for client in clients:
        client.__exit__(None, None, None)


def hand_plan(run_id="r1", *tasks):
    tasks = tasks or (
        {"id": "a", "run_id": run_id, "title": "a", "role": "backend"},
        {"id": "b", "run_id": run_id, "title": "b", "role": "qa", "dependencies": ["a"]},
    )
    return {"id": run_id, "tasks": list(tasks)}


def until(client, run_id, check, attempts=500):
    """Ask for the report until `check(report)` holds: each request lets the server's loop run."""
    for _ in range(attempts):
        report = client.get(f"/runs/{run_id}", headers=AUTH).json()
        if check(report):
            return report
    raise AssertionError(f"run {run_id} never reached the expected state: {report}")


def status(report, task_id):
    return {t["task"]["id"]: t["status"] for t in report["tasks"]}[task_id]


def finished(report):
    return all(
        t["status"] in ("COMPLETED", "FAILED", "BLOCKED", "CANCELLED") for t in report["tasks"]
    )


def approve(client, run_id="r1", **body):
    body.setdefault("repository", "C:/repo")
    return client.post(f"/proposals/{run_id}/approve", json=body, headers=AUTH)


ROUTES = [
    ("get", "/runs/unfinished"),
    ("get", "/runs/r1"),
    ("get", "/runs/r1/events"),
    ("post", "/proposals"),
    ("post", "/proposals/from-request"),
    ("get", "/proposals/r1"),
    ("post", "/proposals/r1/approve"),
    ("post", "/proposals/r1/reject"),
    ("post", "/runs/r1/recover"),
    ("post", "/runs/r1/pause"),
    ("post", "/runs/r1/resume"),
    ("post", "/runs/r1/cancel"),
    ("post", "/runs/r1/tasks/a/approve"),
    ("post", "/runs/r1/tasks/a/reject"),
    ("post", "/runs/r1/tasks/a/retry"),
    ("post", "/runs/r1/tasks/a/pause"),
    ("post", "/runs/r1/tasks/a/resume"),
    ("post", "/runs/r1/tasks/a/cancel"),
]


@pytest.mark.parametrize("method, path", ROUTES)
def test_every_route_needs_the_token(make_client, caplog, method, path):
    client = make_client()
    for headers in ({}, {"Authorization": "Bearer BAD-VALUE-123"}, {"Authorization": TOKEN}):
        assert getattr(client, method)(path, headers=headers).status_code == 401
    warnings = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    assert warnings and all(w.startswith("api: refused ") for w in warnings)
    assert "SECRET" not in caplog.text and "BAD-VALUE-123" not in caplog.text


def test_a_hand_written_plan_runs_only_after_approval_and_its_diff_waits_too(make_client):
    client = make_client()
    created = client.post("/proposals", json=hand_plan(), headers=AUTH)
    assert created.status_code == 201
    assert created.json()["status"] == "pending" and created.json()["source"] == "hand"
    assert client.get("/runs/r1", headers=AUTH).status_code == 404  # nothing runs yet

    started = approve(client, rights={"a": {"allowed_operations": ["edit"], "max_attempts": 2}})
    assert started.status_code == 202
    plan = client.get("/proposals/r1", headers=AUTH).json()
    assert plan["status"] == "approved"
    a, b = plan["plan"]["tasks"]
    assert a["allowed_operations"] == ["edit"] and a["max_attempts"] == 2
    assert b["allowed_operations"] == [] and b["repository_reference"] == "C:/repo"

    until(client, "r1", lambda r: status(r, "a") == "AWAITING_APPROVAL")
    assert client.post("/runs/r1/tasks/a/approve", headers=AUTH).status_code == 200
    report = until(client, "r1", finished)
    assert {t["status"] for t in report["tasks"]} == {"COMPLETED"}


def test_a_rejected_diff_is_retried_with_the_reason(make_client):
    executor = MockExecutor()
    client = make_client(executor)
    client.post("/proposals", json=hand_plan("r1", hand_plan()["tasks"][0]), headers=AUTH)
    approve(client, rights={"a": {"allowed_operations": ["edit"], "max_attempts": 2}})
    until(client, "r1", lambda r: status(r, "a") == "AWAITING_APPROVAL")

    rejected = client.post(
        "/runs/r1/tasks/a/reject", json={"reason": "rename the helper"}, headers=AUTH
    )
    assert rejected.status_code == 200
    until(client, "r1", lambda r: status(r, "a") == "AWAITING_APPROVAL" and len(r["attempts"]) == 2)
    client.post("/runs/r1/tasks/a/approve", headers=AUTH)
    report = until(client, "r1", finished)

    assert report["attempts"][0]["failure_reason"] == "review_rejected"
    assert executor.assignments[1].previous_failure == "rename the helper"


def test_events_replay_follow_and_resume_from_the_last_id(make_client):
    client = make_client()
    client.post("/proposals", json=hand_plan(), headers=AUTH)
    approve(client, rights={"a": {"allowed_operations": ["edit"]}})
    until(client, "r1", lambda r: status(r, "a") == "AWAITING_APPROVAL")

    events, ended = [], False
    with client.stream("GET", "/runs/r1/events", headers=AUTH) as response:
        assert response.headers["content-type"].startswith("text/event-stream")
        event = {}
        for line in response.iter_lines():
            if line.startswith(("id:", "event:", "data:")):
                key, _, value = line.partition(":")
                event[key] = value.strip()
            elif not line and event:
                if event["event"] == "end":
                    ended = True
                    break
                data = json.loads(event["data"])
                assert set(data) == {"sequence", "task_id", "status", "detail"}
                assert event["id"] == str(data["sequence"])
                events.append(data)
                if data["status"] == "AWAITING_APPROVAL":
                    client.post("/runs/r1/tasks/a/approve", headers=AUTH)
                event = {}
    assert ended
    sequences = [e["sequence"] for e in events]
    assert sequences == list(range(1, len(sequences) + 1))
    assert events[-1]["task_id"] == "b" and events[-1]["status"] == "COMPLETED"

    with client.stream(
        "GET", "/runs/r1/events", headers=AUTH | {"Last-Event-ID": str(sequences[-3])}
    ) as response:
        later = [json.loads(line[5:]) for line in response.iter_lines() if line.startswith("data:")]
    assert [e["sequence"] for e in later if "sequence" in e] == sequences[-2:]


def test_only_one_run_at_a_time_and_bad_approvals_are_refused(make_client):
    client = make_client()
    client.post("/proposals", json=hand_plan("r1"), headers=AUTH)
    client.post("/proposals", json=hand_plan("r2"), headers=AUTH)

    refused = [
        ({"rights": {"zz": {}}}, "no task zz"),
        ({"rights": {"a": {"checks": ["lint"]}}}, "unknown check: lint"),
        ({"rights": {"a": {"allowed_operations": ["check"]}}}, '"check" needs "edit"'),
        ({"repository": ""}, "needs a repository"),
        ({"rights": {"a": {"allowed_operations": ["delete"]}}}, None),
    ]
    for body, message in refused:
        answer = approve(client, "r1", **body)
        assert answer.status_code in (400, 422), body
        if message:
            assert message in answer.json()["detail"]

    approve(client, "r1", rights={"a": {"allowed_operations": ["edit"]}})
    until(client, "r1", lambda r: status(r, "a") == "AWAITING_APPROVAL")
    busy = approve(client, "r2")
    assert busy.status_code == 409 and "run r1 is active" in busy.json()["detail"]
    again = approve(client, "r1")
    assert again.status_code == 409 and "approved, not pending" in again.json()["detail"]
    client.post("/runs/r1/cancel", headers=AUTH)
    until(client, "r1", finished)
    assert approve(client, "r2").status_code == 202


def test_a_proposal_can_be_rejected_and_unknown_things_are_404(make_client):
    client = make_client()
    client.post("/proposals", json=hand_plan(), headers=AUTH)
    answer = client.post("/proposals/r1/reject", json={"reason": "split a"}, headers=AUTH)
    assert answer.status_code == 200 and answer.json()["reason"] == "split a"
    assert approve(client).status_code == 409
    assert client.get("/proposals/nope", headers=AUTH).status_code == 404
    assert client.get("/runs/nope", headers=AUTH).status_code == 404
    assert client.get("/runs/nope/events", headers=AUTH).status_code == 404
    assert client.post("/runs/nope/pause", headers=AUTH).status_code == 404
    assert client.post("/runs/nope/recover", headers=AUTH).status_code == 400
    bad_plan = hand_plan("r9", {"id": "a", "run_id": "r9", "title": "a", "role": "designer"})
    answer = client.post("/proposals", json=bad_plan, headers=AUTH)
    assert answer.status_code == 400 and "no worker registered for role: designer" in answer.text


def test_a_failed_task_of_a_finished_run_is_retried_through_the_api(make_client):
    client = make_client(FailsFirst())
    client.post("/proposals", json=hand_plan(), headers=AUTH)
    approve(client)
    report = until(client, "r1", finished)
    assert status(report, "a") == "FAILED" and status(report, "b") == "BLOCKED"
    assert client.get("/runs/unfinished", headers=AUTH).json() == {"runs": []}

    assert client.post("/runs/r1/tasks/a/retry", headers=AUTH).status_code == 202
    report = until(client, "r1", lambda r: finished(r) and status(r, "b") == "COMPLETED")
    assert status(report, "a") == "COMPLETED"
    refused = client.post("/runs/r1/tasks/a/retry", headers=AUTH)
    assert refused.status_code == 400 and "only a failed or cancelled task" in refused.text


def test_the_lead_agent_proposes_a_plan_through_the_api(make_client, tmp_path, monkeypatch):
    log = tmp_path / "call.json"
    monkeypatch.setenv("FAKE_CLAUDE_LOG", str(log))
    monkeypatch.setenv("FAKE_CLAUDE_MODE", "script")
    script = tmp_path / "script.json"
    drafted = {
        "tasks": [
            {
                "id": "api",
                "title": "Build it",
                "role": "backend",
                "description": "",
                "objective": "",
                "acceptance_criteria": ["works"],
                "dependencies": [],
            }
        ]
    }
    script.write_text(json.dumps([drafted, {"issues": []}]), encoding="utf-8")
    monkeypatch.setenv("FAKE_CLAUDE_SCRIPT", str(script))
    client = make_client()
    body = {"request": "Build it", "run_id": "lead1", "workspace": str(tmp_path)}

    answer = client.post("/proposals/from-request", json=body, headers=AUTH)

    assert answer.status_code == 201
    assert answer.json()["source"] == "lead" and answer.json()["status"] == "pending"
    assert [t["id"] for t in answer.json()["plan"]["tasks"]] == ["api"]

    log.with_name("call.json.all").unlink()
    script.write_text(json.dumps([drafted, {"issues": ["x"]}]), encoding="utf-8")
    body = body | {"run_id": "lead2", "max_revisions": 0}
    rejected = client.post("/proposals/from-request", json=body, headers=AUTH)
    assert rejected.status_code == 422
    assert rejected.json()["rounds"] == [{"revision": 0, "source": "critique", "issues": ["x"]}]


def test_the_token_file_holds_only_the_token(tmp_path):
    path = write_token(tmp_path / "AgentForge" / "api-token")
    token = path.read_text(encoding="utf-8")
    assert len(token) >= 43 and token == token.strip()
    assert write_token(path).read_text(encoding="utf-8") != token  # a new one each start


def test_cli_serve_builds_the_settings_and_writes_a_fresh_token(tmp_path, monkeypatch):
    import agentforge.api
    from agentforge.__main__ import cli

    monkeypatch.setenv("APPDATA", str(tmp_path / "appdata"))
    started = []
    monkeypatch.setattr(agentforge.api, "serve", lambda s, port: started.append((s, port)))

    python = r"C:\Program Files\Python\python.exe"
    code = cli(
        ["serve", "--worktrees", str(tmp_path / "trees"), "--port", "9000",
         "--check", f'unit="{python}" -m pytest', "--store", str(tmp_path / "runs.db")]
    )  # fmt: skip

    assert code == 0
    ((serving, port),) = started
    assert port == 9000
    assert serving.checks == {"unit": (python, "-m", "pytest")}
    token_file = tmp_path / "appdata" / "AgentForge" / "api-token"
    assert serving.token == token_file.read_text(encoding="utf-8")
    with pytest.raises(SystemExit) as stopped:
        cli(["serve", "--worktrees", str(tmp_path), "--check", "unit"])
    assert stopped.value.code == 2
