import pytest
from pydantic import ValidationError

from agentforge.domain import AgentConfig, TaskSpec


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


def test_agent_roles_are_extensible():
    assert AgentConfig(id="custom", role="security").role == "security"
