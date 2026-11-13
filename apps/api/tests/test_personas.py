import pytest

from agentforge.domain import AgentConfig
from agentforge.mocks import DEFAULT_ROLES
from agentforge.personas import load_agents, remove_agent, save_agent, setup


def test_setup_creates_the_five_default_personas(tmp_path):
    folder = setup(tmp_path / "agents")
    assert sorted(path.name for path in folder.glob("*.md")) == sorted(
        f"{role}.md" for role in DEFAULT_ROLES
    )
    agents = {agent.id: agent for agent in load_agents(folder)}
    assert set(agents) == set(DEFAULT_ROLES)
    assert all(agent.role == agent.id and agent.persona for agent in agents.values())
    assert agents["qa"].reasoning == "high" and agents["backend"].reasoning == "medium"
    assert all(agent.model is None for agent in agents.values())


def test_setup_never_overwrites_edits_or_restores_removed_agents(tmp_path):
    folder = setup(tmp_path)
    backend = next(agent for agent in load_agents(folder) if agent.id == "backend")
    save_agent(folder, backend.model_copy(update={"persona": "Edited."}))
    remove_agent(folder, "qa")
    setup(folder)
    agents = {agent.id: agent for agent in load_agents(folder)}
    assert agents["backend"].persona == "Edited."
    assert "qa" not in agents


def test_add_edit_and_remove_an_agent(tmp_path):
    persona = "You audit security.\n---\nNever trust input."
    agent = AgentConfig(
        id="security", role="security", model="claude-opus-5-5", reasoning="xhigh", persona=persona
    )
    save_agent(tmp_path, agent)
    assert load_agents(tmp_path) == (agent,)

    edited = agent.model_copy(update={"model": None, "persona": "Short."})
    save_agent(tmp_path, edited)
    assert load_agents(tmp_path) == (edited,)

    remove_agent(tmp_path, "security")
    assert load_agents(tmp_path) == ()
    with pytest.raises(FileNotFoundError):
        remove_agent(tmp_path, "security")


def test_load_accepts_files_saved_with_a_utf8_bom(tmp_path):
    # Windows PowerShell 5.1 and some editors start UTF-8 files with a byte-order mark.
    text = "---\nid: qa\nrole: qa\nreasoning: low\n---\nEdited by hand."
    (tmp_path / "qa.md").write_text(text, encoding="utf-8-sig")
    assert load_agents(tmp_path) == (
        AgentConfig(id="qa", role="qa", reasoning="low", persona="Edited by hand."),
    )


@pytest.mark.parametrize(
    "agent",
    [
        AgentConfig(id="../x", role="backend"),
        AgentConfig(id="Backend", role="backend"),  # Windows file names ignore case
        AgentConfig(id="a", role=" backend"),  # would not survive a reload unchanged
        AgentConfig(id="a", role="backend", model="m\nreasoning: max"),
        AgentConfig(id="a", role="back\nend"),
    ],
)
def test_save_rejects_unsafe_ids_and_multiline_values(tmp_path, agent):
    with pytest.raises(ValueError):
        save_agent(tmp_path, agent)
    assert list(tmp_path.iterdir()) == []


def test_remove_rejects_unsafe_ids(tmp_path):
    with pytest.raises(ValueError):
        remove_agent(tmp_path, "../agents")


@pytest.mark.parametrize(
    "name, text",
    [
        ("other.md", "---\nid: backend\nrole: backend\nreasoning: medium\n---\nHi."),
        ("bad.md", "---\nid: bad\nrole: backend\nreasoning: extreme\n---\nHi."),
        ("nofront.md", "Just text."),
        ("dup.md", "---\nid: dup\nid: dup\nrole: backend\n---\nHi."),
        ("Up.md", "---\nid: Up\nrole: backend\n---\nHi."),  # loadable but never saveable
    ],
)
def test_load_names_the_invalid_file(tmp_path, name, text):
    (tmp_path / name).write_text(text, encoding="utf-8")
    with pytest.raises(ValueError, match=name):
        load_agents(tmp_path)
