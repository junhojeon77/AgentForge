"""Agent personas: one editable Markdown file per agent.

File format: a `---` line, `key: value` settings (id, role, model, reasoning), a `---` line,
then the persona text. Setup copies the seven shipped defaults into an empty folder.
"""

import os
import re
from importlib import resources
from pathlib import Path

from pydantic import ValidationError

from agentforge.domain import AgentConfig

SETTINGS = ("id", "role", "model", "reasoning")
# Lowercase only: Windows file names ignore case, so "Backend" would overwrite backend.md.
_SAFE_ID = re.compile(r"[a-z0-9_-]+")


def default_folder() -> Path:
    appdata = os.environ.get("APPDATA") or Path.home() / "AppData" / "Roaming"
    return Path(appdata) / "AgentForge" / "agents"


def default_agents() -> tuple[AgentConfig, ...]:
    files = resources.files("agentforge") / "default_personas"
    agents = (
        _parse(file.name, file.read_text(encoding="utf-8"))
        for file in files.iterdir()
        if file.name.endswith(".md")
    )
    return tuple(sorted(agents, key=lambda agent: agent.id))


def setup(folder: Path) -> Path:
    """Create the folder; copy the defaults only if it has no personas, so edits are kept."""
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    if not any(folder.glob("*.md")):
        for agent in default_agents():
            save_agent(folder, agent)
    return folder


def load_agents(folder: Path) -> tuple[AgentConfig, ...]:
    agents = (
        # utf-8-sig: Windows editors may start the file with a byte-order mark.
        _parse(path.name, path.read_text(encoding="utf-8-sig"))
        for path in Path(folder).glob("*.md")
    )
    return tuple(sorted(agents, key=lambda agent: agent.id))


def save_agent(folder: Path, agent: AgentConfig) -> None:
    """Add or edit an agent's file."""
    agent = AgentConfig.model_validate(agent)
    path = _path(folder, agent.id)
    values = (agent.id, agent.role, agent.model or "", agent.reasoning)
    if any("\n" in value or "\r" in value or value != value.strip() for value in values):
        raise ValueError(f"agent {agent.id}: settings must be single-line, without extra spaces")
    header = "".join(
        f"{key}: {value}".rstrip() + "\n" for key, value in zip(SETTINGS, values, strict=True)
    )
    temp = path.with_name(path.name + ".tmp")
    temp.write_text(f"---\n{header}---\n{agent.persona.strip()}\n", encoding="utf-8", newline="\n")
    os.replace(temp, path)  # a crash mid-write never leaves a half-written persona


def remove_agent(folder: Path, agent_id: str) -> None:
    _path(folder, agent_id).unlink()


def check_id(agent_id: str) -> None:
    """Refuse an id that cannot be an agent's file name."""
    if not _SAFE_ID.fullmatch(agent_id):
        raise ValueError(f"agent id {agent_id!r} may use only a-z, 0-9, '-' and '_'")


def _path(folder: Path, agent_id: str) -> Path:
    check_id(agent_id)
    return Path(folder) / f"{agent_id}.md"


def _parse(name: str, text: str) -> AgentConfig:
    lines = text.splitlines()
    stripped = [line.strip() for line in lines]
    try:
        if stripped[0] != "---":
            raise ValueError
        end = stripped.index("---", 1)
    except (IndexError, ValueError):
        raise ValueError(f"{name}: expected settings between two '---' lines") from None
    settings: dict[str, str | None] = {}
    for line in filter(None, stripped[1:end]):
        key, colon, value = (part.strip() for part in line.partition(":"))
        if not colon or key not in SETTINGS or key in settings:
            raise ValueError(f"{name}: unknown or repeated setting {line!r}")
        settings[key] = value
    settings["model"] = settings.get("model") or None
    try:
        agent = AgentConfig(**settings, persona="\n".join(lines[end + 1 :]).strip())
    except ValidationError as error:
        raise ValueError(f"{name}: {error}") from None
    try:
        path = _path(".", agent.id)  # same id rule as save, so every loaded agent can be saved
    except ValueError as error:
        raise ValueError(f"{name}: {error}") from None
    if name != path.name:
        raise ValueError(f"{name}: the file name must be {path.name}")
    return agent
