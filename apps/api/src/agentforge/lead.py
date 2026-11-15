"""The lead agent: turns a plain-English request into a checked RunPlan.

A LangGraph workflow drafts a plan with the Claude Code CLI, checks it with the scheduler's own
rules, has the CLI critique it against the request, and revises it until both pass or the
revisions run out. The model only proposes tasks: rights and limits (edit, checks, attempts,
timeouts, the repository) come from the person, and the scheduler checks the plan again before
anything runs.
"""

import json
import logging
import operator
import uuid
from collections.abc import Iterable, Mapping
from typing import Annotated, Literal, TypedDict

from langchain_core.exceptions import OutputParserException
from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.prompts import PromptTemplate
from langchain_core.runnables import Runnable, RunnableConfig
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from agentforge.claude_code import READ_ONLY_TOOLS, ClaudeCall, ClaudeCodeRunner
from agentforge.domain import Contract, Identifier, RunPlan, TaskSpec
from agentforge.orchestration import validate_plan

logger = logging.getLogger(__name__)


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TaskDraft(_Strict):
    """What the model may say about a task: nothing that grants rights or sets limits."""

    id: Identifier
    title: Identifier
    role: Identifier
    description: str = ""
    objective: str = ""
    acceptance_criteria: tuple[str, ...] = ()
    dependencies: tuple[Identifier, ...] = ()


class PlanDraft(_Strict):
    tasks: tuple[TaskDraft, ...] = Field(min_length=1)


class Critique(_Strict):
    issues: tuple[str, ...] = ()


class PlanRequest(Contract):
    request: str = Field(min_length=1)
    run_id: Identifier


class PlanRound(Contract):
    """One round that found issues: in the check (rules) or the critique (the model)."""

    revision: int  # the plan revision these issues are about; 0 is the first draft
    source: Literal["check", "critique"]
    issues: tuple[str, ...]


class PlanResult(Contract):
    plan: RunPlan
    rounds: tuple[PlanRound, ...] = ()  # every round that found issues, in order


class PlanRejected(ValueError):
    """The plan still had issues when the revisions ran out; no plan is returned."""

    def __init__(self, run_id: str, rounds: tuple[PlanRound, ...]):
        super().__init__(f"run {run_id}: plan rejected; issues left after {len(rounds)} round(s)")
        self.rounds = rounds


_MODEL_FIELDS = set(TaskDraft.model_fields) | {"run_id"}
_PARSE = PydanticOutputParser(pydantic_object=PlanDraft)
_CRITIQUE_PARSE = PydanticOutputParser(pydantic_object=Critique)


def _schema(model: type[BaseModel]) -> str:
    return json.dumps(model.model_json_schema())


_INTRO = (
    "You are the lead of an AgentForge team of coding agents. You can read the repository in "
    "the current folder; you cannot edit it or run commands. Reply through the structured "
    "output.\n"
)
_TASK_RULES = (
    "Split the work into tasks. Each task goes to one worker of one of these roles: {roles}. "
    "Task ids use only letters, digits, '-' and '_'. A task lists the ids of the tasks that "
    "must finish before it, with no cycles. Keep each task small enough for one worker, and "
    "write acceptance criteria a reviewer can check.\n"
)
_DRAFT = PromptTemplate.from_template(_INTRO + _TASK_RULES + "Request:\n{request}\n")
_CRITIQUE = PromptTemplate.from_template(
    _INTRO + "Review the plan below against the request. List each concrete problem: missing "
    "work, wrong order or dependencies, tasks too large for one worker, criteria nobody can "
    "check. Return no issues if the plan is good.\nRequest:\n{request}\nPlan:\n{plan}\n"
)
_REVISE = PromptTemplate.from_template(
    _INTRO + _TASK_RULES + "Revise the plan below so that every issue is fixed, and return the "
    "whole new plan.\nRequest:\n{request}\nPlan:\n{plan}\nIssues:\n{issues}\n"
)


class _State(TypedDict):
    request: str
    run_id: str
    draft: str  # the latest draft as the model sent it, JSON
    plan: RunPlan | None
    revision: int
    pending: tuple[str, ...]  # issues found in the latest round, for the next revision
    rounds: Annotated[list[PlanRound], operator.add]
    verdict: Literal["", "accepted", "rejected"]


class Planner(Runnable[PlanRequest, PlanResult]):
    """Turns a request into a checked RunPlan, as a LangChain Runnable built on LangGraph.

    Each draft, critique and revision is one read-only Claude Code session in `workspace`, so
    the worst case is `2 * max_revisions + 2` sessions, each with the runner's spending cap.
    """

    def __init__(
        self,
        runner: ClaudeCodeRunner,
        *,
        roles: Iterable[str],
        workspace: str,
        max_revisions: int = 2,
        effort: str = "medium",
        model: str | None = None,
        task_defaults: Mapping[str, object] | None = None,
    ):
        if type(max_revisions) is not int or max_revisions < 0:
            raise ValueError("max_revisions must be a whole number, 0 or more")
        self.task_defaults = dict(task_defaults or {})
        if granted := _MODEL_FIELDS & set(self.task_defaults):
            raise ValueError(f"task_defaults cannot set what the plan decides: {sorted(granted)}")
        self.runner = runner
        self.roles = tuple(sorted(set(roles)))
        self.workspace = workspace
        self.max_revisions = max_revisions
        self.effort = effort
        self.model = model
        self.graph = self._build()

    def invoke(self, input: PlanRequest, config: RunnableConfig | None = None, **kwargs):
        raise NotImplementedError("Planner is async only: use ainvoke")

    async def ainvoke(
        self, input: PlanRequest, config: RunnableConfig | None = None, **kwargs
    ) -> PlanResult:
        request = PlanRequest.model_validate(input)
        state = await self.graph.ainvoke(
            {
                "request": request.request,
                "run_id": request.run_id,
                "draft": "",
                "plan": None,
                "revision": 0,
                "pending": (),
                "rounds": [],
                "verdict": "",
            },
            config,
        )
        rounds = tuple(state["rounds"])
        if state["verdict"] != "accepted":
            logger.warning(
                "lead %s: plan rejected after %d revision(s); %d round(s) had issues",
                request.run_id, state["revision"], len(rounds),
            )  # fmt: skip
            raise PlanRejected(request.run_id, rounds)
        return PlanResult(plan=state["plan"], rounds=rounds)

    def _build(self):
        graph = StateGraph(_State)
        graph.add_node("draft", self._draft)
        graph.add_node("check", self._check)
        graph.add_node("critique", self._critique)
        graph.add_node("revise", self._revise)
        graph.add_edge(START, "draft")
        graph.add_edge("draft", "check")
        graph.add_edge("revise", "check")
        graph.add_conditional_edges("check", self._after_check, ["critique", "revise", END])
        graph.add_conditional_edges("critique", self._after_critique, ["revise", END])
        return graph.compile()

    async def _ask(self, state: _State, prompt: str, schema: str) -> dict:
        result = await self.runner.ainvoke(
            ClaudeCall(
                key=f"lead:{state['run_id']}",
                name=f"lead {state['run_id']}",
                label=f"lead {state['run_id']} revision {state['revision']}",
                folder=self.workspace,
                prompt=prompt,
                schema=schema,
                tools=READ_ONLY_TOOLS,
                session_id=str(uuid.uuid4()),
                effort=self.effort,
                model=self.model,
            )
        )
        output = result.get("structured_output")
        if result.get("is_error") or result.get("subtype") != "success" or output is None:
            raise RuntimeError(f"the lead's Claude session failed: {result.get('subtype')}")
        return output

    async def _draft(self, state: _State) -> dict:
        prompt = _DRAFT.format(request=state["request"], roles=", ".join(self.roles))
        return {"draft": json.dumps(await self._ask(state, prompt, _schema(PlanDraft)))}

    async def _revise(self, state: _State) -> dict:
        prompt = _REVISE.format(
            request=state["request"],
            roles=", ".join(self.roles),
            plan=state["draft"],
            issues="\n".join(f"- {issue}" for issue in state["pending"]),
        )
        output = await self._ask(state, prompt, _schema(PlanDraft))
        return {"draft": json.dumps(output), "revision": state["revision"] + 1}

    async def _check(self, state: _State) -> dict:
        """The scheduler's rules, applied by plain code: no AI decides here."""
        run_id, revision = state["run_id"], state["revision"]
        try:
            draft = _PARSE.parse(state["draft"])
        except OutputParserException:
            issues = ("the reply does not match the plan schema; use only the fields it lists",)
        else:
            logger.debug("lead %s: draft made (%d tasks)", run_id, len(draft.tasks))
            try:
                plan = RunPlan(
                    id=run_id,
                    tasks=tuple(
                        TaskSpec(**task.model_dump(), run_id=run_id, **self.task_defaults)
                        for task in draft.tasks
                    ),
                )
                plan, _ = validate_plan(plan, self.roles)
            except (ValidationError, ValueError) as error:
                issues = (str(error).splitlines()[0],)
            else:
                return {"plan": plan, "pending": ()}
        logger.debug(
            "lead %s: check found %d issue(s) in revision %d", run_id, len(issues), revision
        )
        found = PlanRound(revision=revision, source="check", issues=issues)
        return {"plan": None, "pending": issues, "rounds": [found]}

    async def _critique(self, state: _State) -> dict:
        prompt = _CRITIQUE.format(
            request=state["request"], plan=state["plan"].model_dump_json(include={"tasks"})
        )
        output = await self._ask(state, prompt, _schema(Critique))
        try:
            issues = _CRITIQUE_PARSE.parse(json.dumps(output)).issues
        except OutputParserException:
            issues = ("the critique did not match its schema",)
        run_id, revision = state["run_id"], state["revision"]
        if not issues:
            logger.debug("lead %s: critique found no issues; plan accepted", run_id)
            return {"pending": (), "verdict": "accepted"}
        # The count only: the critique is the model's text.
        logger.debug(
            "lead %s: critique found %d issue(s) in revision %d", run_id, len(issues), revision
        )
        found = PlanRound(revision=revision, source="critique", issues=issues)
        return {"pending": issues, "rounds": [found]}

    def _next_after_issues(self, state: _State) -> str:
        return "revise" if state["revision"] < self.max_revisions else END

    def _after_check(self, state: _State) -> str:
        return "critique" if state["plan"] is not None else self._next_after_issues(state)

    def _after_critique(self, state: _State) -> str:
        return END if state["verdict"] == "accepted" else self._next_after_issues(state)
