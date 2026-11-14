import pytest
from pydantic import ValidationError

from agentforge.domain import AgentConfig, RunPlan, TaskSpec, WorkerResult


def test_task_spec_preserves_contract_and_is_immutable():
    task = TaskSpec(id="a", run_id="run", title="A", role="custom", priority=2)
    assert task.workspace_reference is None
    assert task.dependencies == ()
    assert task.model_dump().keys() >= {
        "id",
        "run_id",
        "title",
        "description",
        "objective",
        "role",
        "priority",
        "dependencies",
        "repository_reference",
        "base_commit",
        "workspace_reference",
        "acceptance_criteria",
        "allowed_operations",
        "execution_constraints",
        "expected_output",
    }
    with pytest.raises(ValidationError):
        task.title = "changed"


@pytest.mark.parametrize("values", [{"id": ""}, {"priority": "high"}, {"extra": 1}])
def test_invalid_task_contract(values):
    with pytest.raises(ValidationError):
        TaskSpec(**({"id": "a", "run_id": "run", "title": "A", "role": "backend"} | values))


@pytest.mark.parametrize(
    "bad",
    ["a\nb", "a\n", "a\rb", "a\tb", "a\x00", "\x1b[31mred", "a\x7f", "a\x85b", "a b", "a "],
)
def test_ids_titles_and_roles_reject_control_characters(bad):
    values = {"id": "a", "run_id": "run", "title": "A", "role": "backend"}
    for field in values:
        with pytest.raises(ValidationError):
            TaskSpec(**(values | {field: bad}))
    with pytest.raises(ValidationError):
        TaskSpec(**values, dependencies=(bad,))
    with pytest.raises(ValidationError):
        AgentConfig(id=bad, role="backend")
    with pytest.raises(ValidationError):
        AgentConfig(id="a", role=bad)
    with pytest.raises(ValidationError):
        RunPlan(id=bad)


@pytest.mark.parametrize("good", ["my task", "작업-1", "naïve_id", " padded "])
def test_ids_still_accept_spaces_and_other_languages(good):
    assert TaskSpec(id=good, run_id="run", title=good, role="backend").id == good


def test_agent_roles_are_extensible():
    assert AgentConfig(id="custom", role="security").role == "security"


def test_agent_model_defaults_to_runtime_choice_and_effort_is_validated():
    agent = AgentConfig(id="a", role="backend")
    assert agent.model is None
    assert agent.reasoning == "medium"
    assert AgentConfig(id="a", role="backend", reasoning="xhigh").reasoning == "xhigh"
    with pytest.raises(ValidationError):
        AgentConfig(id="a", role="backend", reasoning="extreme")


def test_agent_has_no_permissions_setting():
    with pytest.raises(ValidationError):
        AgentConfig(id="a", role="backend", permissions=("read",))


def test_agent_persona_is_optional_and_capped():
    assert AgentConfig(id="a", role="backend").persona == ""
    assert len(AgentConfig(id="a", role="backend", persona="x" * 10_000).persona) == 10_000
    with pytest.raises(ValidationError):
        AgentConfig(id="a", role="backend", persona="x" * 10_001)


def test_worker_result_session_id_is_optional():
    assert WorkerResult(success=True).session_id is None
    assert WorkerResult(success=True, session_id="s").session_id == "s"


def test_timeout_is_optional_and_must_be_a_positive_number():
    values = {"id": "a", "run_id": "run", "title": "A", "role": "backend"}
    assert TaskSpec(**values).timeout_seconds is None
    assert TaskSpec(**values, timeout_seconds=0.5).timeout_seconds == 0.5
    assert TaskSpec(**values, timeout_seconds=30).timeout_seconds == 30
    for bad in (0, -1, "30", True, float("inf"), float("nan")):
        with pytest.raises(ValidationError):
            TaskSpec(**values, timeout_seconds=bad)


@pytest.mark.parametrize(
    "model", ["opus", "claude-sonnet-5-5", "claude-opus-5-5[1m]", "us.anthropic.claude-opus-5-5"]
)
def test_agent_model_accepts_model_ids_and_aliases(model):
    assert AgentConfig(id="a", role="backend", model=model).model == model


@pytest.mark.parametrize("model", ["", " opus", "opus ", "claude opus", "m\nreasoning: max", "-p"])
def test_agent_model_rejects_spaces_line_breaks_and_flags(model):
    with pytest.raises(ValidationError):
        AgentConfig(id="a", role="backend", model=model)


def test_max_attempts_defaults_to_one_and_is_bounded():
    values = {"id": "a", "run_id": "run", "title": "A", "role": "backend"}
    assert TaskSpec(**values).max_attempts == 1
    assert TaskSpec(**values, max_attempts=5).max_attempts == 5
    for bad in (0, 6, True, "2"):
        with pytest.raises(ValidationError):
            TaskSpec(**values, max_attempts=bad)
