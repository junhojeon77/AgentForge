"""Local REST API (M5): plans waiting for approval, runs, diff approvals and live events.

It listens on 127.0.0.1 only, and every request needs the token written at startup. One run is
active at a time: the five-worker cap is per run. Runs are saved to the run store, and every
task waits twice for a person: once when its plan is approved with the rights each task gets,
and once, for a task that edits, before the checks run the code it wrote.
"""

import asyncio
import json
import logging
import secrets
from collections.abc import AsyncIterator, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from agentforge import personas
from agentforge.claude_code import ClaudeCodeExecutor, ClaudeCodeRunner
from agentforge.domain import (
    AgentConfig,
    Identifier,
    Proposal,
    RunPlan,
    RunReport,
    TaskSpec,
    Transition,
)
from agentforge.lead import Planner, PlanRejected, PlanRequest
from agentforge.orchestration import ResultValidator, Scheduler, WorkerExecutor, validate_plan
from agentforge.personas import default_agents, default_folder, load_agents
from agentforge.store import RunStore
from agentforge.validation import CommandValidator
from agentforge.worktrees import WorktreeExecutor

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ApiSettings:
    store_path: Path
    token: str
    worktrees: Path  # every task runs in a worktree under this folder
    checks: Mapping[str, tuple[str, ...]] = field(default_factory=dict)
    claude_command: tuple[str, ...] = ("claude",)
    max_budget_usd: float = 1.0
    agents: Path = field(default_factory=default_folder)  # read again for every run
    # Browser origins allowed to call: the Tauri webview and its dev server.
    origins: tuple[str, ...] = ("http://tauri.localhost", "http://localhost:1420")


def default_token_path() -> Path:
    return default_folder().parent / "api-token"


def write_token(path: Path) -> Path:
    """Write a new random token for this start; the file sits under the user's own profile."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(secrets.token_urlsafe(32), encoding="utf-8")
    return path


class _Body(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TaskRights(_Body):
    """What a person grants one task when approving its plan. Nothing is granted by default."""

    allowed_operations: tuple[Literal["edit", "check"], ...] = ()
    checks: tuple[Identifier, ...] = ()
    max_attempts: int = Field(1, ge=1, le=5)
    timeout_seconds: float | None = Field(None, gt=0, allow_inf_nan=False)
    repository_reference: str = ""
    base_commit: str = ""


class Approval(_Body):
    repository: str = ""  # used by every task that does not name its own
    rights: dict[str, TaskRights] = {}
    # The person's versions of the new agents the plan proposes; None keeps them as proposed.
    agents: tuple[AgentConfig, ...] | None = None


class Rejection(_Body):
    reason: str = Field(min_length=1)


class PlanBody(_Body):
    request: str = Field(min_length=1)
    run_id: Identifier
    workspace: str
    max_revisions: int = Field(2, ge=0, le=5)


class _Refused(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status, self.detail = status, detail


def _granted(plan: RunPlan, approval: Approval, checks: Mapping[str, object]) -> RunPlan:
    """The plan with the rights a person gave; every task without rights stays read-only."""
    ids = {task.id for task in plan.tasks}
    if unknown := sorted(set(approval.rights) - ids):
        raise _Refused(400, f"the plan has no task {', '.join(unknown)}")
    tasks = []
    for task in plan.tasks:
        rights = approval.rights.get(task.id, TaskRights())
        if "check" in rights.allowed_operations and "edit" not in rights.allowed_operations:
            raise _Refused(400, f'task {task.id}: "check" needs "edit" too')
        # A hand-written plan can name checks too; one the server lacks could never pass.
        named = [
            c.removeprefix("check:") for c in task.execution_constraints if c.startswith("check:")
        ]
        if missing := [name for name in (*named, *rights.checks) if name not in checks]:
            raise _Refused(400, f"task {task.id}: unknown check: {', '.join(missing)}")
        repository = rights.repository_reference or approval.repository
        if not repository:
            raise _Refused(400, f"task {task.id} needs a repository")
        tasks.append(
            TaskSpec.model_validate(
                task.model_dump()
                | {
                    "allowed_operations": rights.allowed_operations,
                    "execution_constraints": task.execution_constraints
                    + tuple(f"check:{name}" for name in rights.checks),
                    "max_attempts": rights.max_attempts,
                    "timeout_seconds": rights.timeout_seconds,
                    "repository_reference": repository,
                    "base_commit": rights.base_commit or task.base_commit,
                }
            )
        )
    return RunPlan(id=plan.id, tasks=tuple(tasks))


def _event(name: str, data: dict, event_id: int | None = None) -> str:
    head = "" if event_id is None else f"id: {event_id}\n"
    return f"{head}event: {name}\ndata: {json.dumps(data)}\n\n"


class _Server:
    """What one API process holds: the store, the active run and the open event streams."""

    def __init__(
        self,
        settings: ApiSettings,
        workers: Sequence[tuple[AgentConfig, WorkerExecutor]] | None,
        validator: ResultValidator | None,
    ):
        self.settings = settings
        self.store = RunStore(settings.store_path)
        self.injected = None if workers is None else list(workers)
        if workers is None:
            claude = ClaudeCodeExecutor(
                command=settings.claude_command,
                max_budget_usd=settings.max_budget_usd,
                checks=settings.checks,
            )
            self.executor = WorktreeExecutor(claude, settings.worktrees)
        self.validator = validator or CommandValidator(checks=settings.checks)
        self.run_id: str | None = None  # the active run
        self.scheduler: Scheduler | None = None
        self.task: asyncio.Task[RunReport] | None = None
        self.streams: dict[str, list[asyncio.Queue[Transition | None]]] = {}

    def agents(self) -> tuple[AgentConfig, ...]:
        """The agents the next run gets: read from the folder each time, so edits apply."""
        try:
            return load_agents(self.settings.agents) or default_agents()
        except ValueError as error:  # the message starts with the file's name
            raise _Refused(400, f"agents folder {self.settings.agents}: {error}") from None

    def workers(self) -> list[tuple[AgentConfig, WorkerExecutor]]:
        if self.injected is not None:
            return self.injected
        return [(agent, self.executor) for agent in self.agents()]

    def roles(self) -> set[str]:
        return {agent.role for agent, _ in self.workers()}

    def _publish(self, run_id: str, transition: Transition) -> None:
        for queue in self.streams.get(run_id, ()):
            queue.put_nowait(transition)

    def active(self, run_id: str) -> Scheduler:
        if self.run_id != run_id or self.scheduler is None:
            raise _Refused(404, f"run {run_id} is not active")
        return self.scheduler

    async def launch(self, run_id: str, start) -> None:
        """Start a run in the background and wait until it is running or has been refused."""
        if self.run_id is not None:
            raise _Refused(409, f"run {self.run_id} is active; one run at a time")
        workers = self.workers()
        scheduler = Scheduler(
            validator=self.validator,
            store=self.store,
            review_edits=True,
            on_transition=self._publish,
        )
        for agent, executor in workers:
            scheduler.register_worker(agent, executor)
        logger.debug(
            "api: run %s starts with agents %s", run_id, ", ".join(a.id for a, _ in workers)
        )
        task = asyncio.create_task(start(scheduler), name=f"agentforge-api:{run_id}")
        self.run_id, self.scheduler, self.task = run_id, scheduler, task
        task.add_done_callback(lambda done: self._ended(run_id, done))
        # Refusals happen before the run's first wait, so a few loop turns settle it.
        for _ in range(20):
            if task.done() or scheduler.running:
                break
            await asyncio.sleep(0)
        if task.done() and not task.cancelled() and isinstance(task.exception(), ValueError):
            self._ended(run_id, task)  # free the slot now, not on the next loop turn
            raise _Refused(400, str(task.exception()))

    def _ended(self, run_id: str, task: asyncio.Task) -> None:
        if self.task is task:
            self.run_id = self.scheduler = self.task = None
        if not task.cancelled() and (error := task.exception()) is not None:
            if not isinstance(error, ValueError):
                logger.warning("api: run %s stopped by %s", run_id, type(error).__name__)
        for queue in self.streams.get(run_id, ()):
            queue.put_nowait(None)

    def report(self, run_id: str) -> RunReport:
        if self.run_id == run_id and self.scheduler is not None:
            return self.scheduler.snapshot()
        saved = self.store.load(run_id)
        if saved is None:
            raise _Refused(404, f"run {run_id} is not saved")
        return saved[1]


def create_app(
    settings: ApiSettings,
    *,
    workers: Sequence[tuple[AgentConfig, WorkerExecutor]] | None = None,
    validator: ResultValidator | None = None,
) -> FastAPI:
    """The API. `workers` and `validator` replace the Claude Code workers in tests."""
    expected = f"Bearer {settings.token}".encode()

    def authorized(request: Request, authorization: str = Header(default="")) -> None:
        if not secrets.compare_digest(authorization.encode(), expected):
            # The route only: never the header's value.
            logger.warning(
                "api: refused %s %s: missing or wrong token", request.method, request.url.path
            )
            raise HTTPException(status_code=401, detail="missing or wrong token")

    app = FastAPI(title="AgentForge", dependencies=[Depends(authorized)])
    # A preflight carries no token, so CORS answers it before the token check; the real request
    # still needs the token.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.origins),
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "Last-Event-ID"],
    )
    server = _Server(settings, workers, validator)

    @app.exception_handler(_Refused)
    async def refused(request: Request, error: _Refused) -> JSONResponse:
        logger.debug("api: %s %s answered %d", request.method, request.url.path, error.status)
        return JSONResponse({"detail": error.detail}, status_code=error.status)

    def checked(plan: RunPlan, new_roles: Iterable[str] = ()) -> RunPlan:
        try:
            return validate_plan(plan, {*server.roles(), *new_roles})[0]
        except ValueError as error:
            raise _Refused(400, str(error)) from None

    async def control(action, *args) -> dict:
        try:
            await action(*args)
        except KeyError as error:
            raise _Refused(404, f"no task {error.args[0]}") from None
        except ValueError as error:
            raise _Refused(400, str(error)) from None
        return {"ok": True}

    @app.post("/proposals", status_code=201)
    async def propose(plan: RunPlan) -> Proposal:
        proposal = Proposal(id=plan.id, plan=checked(plan), source="hand")
        try:
            server.store.propose(proposal)
        except ValueError as error:
            raise _Refused(409, str(error)) from None
        return proposal

    @app.post("/proposals/from-request", status_code=201)
    async def propose_from_request(body: PlanBody):
        if not Path(body.workspace).is_dir():  # noqa: ASYNC240
            raise _Refused(400, f"workspace is not a folder: {body.workspace}")
        # Before planning, which is billed; the save below still catches a name taken meanwhile.
        if body.run_id in server.store.runs():
            raise _Refused(409, f"run {body.run_id} is already saved; use a new run id")
        if server.store.get_proposal(body.run_id) is not None:
            raise _Refused(409, f"proposal {body.run_id} already exists")
        runner = ClaudeCodeRunner(
            command=settings.claude_command, max_budget_usd=settings.max_budget_usd
        )
        lead = Planner(
            runner,
            roles=server.roles(),
            agent_ids={agent.id for agent in server.agents()},
            workspace=body.workspace,
            max_revisions=body.max_revisions,
        )
        try:
            result = await lead.ainvoke(PlanRequest(request=body.request, run_id=body.run_id))
        except PlanRejected as rejected:
            rounds = [r.model_dump(mode="json") for r in rejected.rounds]
            return JSONResponse({"detail": str(rejected), "rounds": rounds}, status_code=422)
        proposal = Proposal(
            id=body.run_id,
            plan=result.plan,
            source="lead",
            rounds=result.rounds,
            agents=result.agents,
        )
        try:
            server.store.propose(proposal)
        except ValueError as error:
            raise _Refused(409, str(error)) from None
        return proposal

    def proposal_or_404(proposal_id: str) -> Proposal:
        proposal = server.store.get_proposal(proposal_id)
        if proposal is None:
            raise _Refused(404, f"no proposal {proposal_id}")
        return proposal

    @app.get("/proposals/{proposal_id}")
    async def get_proposal(proposal_id: str) -> Proposal:
        return proposal_or_404(proposal_id)

    @app.post("/proposals/{proposal_id}/approve", status_code=202)
    async def approve_proposal(proposal_id: str, approval: Approval) -> Proposal:
        proposal = proposal_or_404(proposal_id)
        if proposal.status != "pending":
            raise _Refused(409, f"proposal {proposal_id} is {proposal.status}, not pending")
        if server.run_id is not None:
            raise _Refused(409, f"run {server.run_id} is active; one run at a time")
        agents = proposal.agents if approval.agents is None else approval.agents
        if sorted(a.id for a in agents) != sorted(a.id for a in proposal.agents):
            proposed = ", ".join(sorted(a.id for a in proposal.agents)) or "none"
            raise _Refused(400, f"keep the proposed agents: {proposed}")
        # Its tasks reach a new agent by role, so the role stays as proposed.
        roles = {a.id: a.role for a in proposal.agents}
        if any(a.role != roles[a.id] for a in agents):
            proposed = ", ".join(f"{agent_id} ({role})" for agent_id, role in sorted(roles.items()))
            raise _Refused(400, f"keep the proposed roles: {proposed}")
        existing = {agent.id for agent in server.agents()}
        if clash := sorted(a.id for a in agents if a.id in existing):
            raise _Refused(
                409,
                f"agent {', '.join(clash)} already exists; reject the plan and ask again, "
                "or remove that agent",
            )
        plan = checked(_granted(proposal.plan, approval, settings.checks), (a.role for a in agents))
        if agents:
            # Every check has passed: only now do the new agents join the team.
            folder = personas.setup(settings.agents)
            for agent in agents:
                try:
                    personas.save_agent(folder, agent)
                except ValueError as error:
                    raise _Refused(400, str(error)) from None
                logger.debug("api: agent %s saved", agent.id)
        decided = server.store.decide_proposal(proposal_id, "approved", plan=plan, agents=agents)
        await server.launch(plan.id, lambda scheduler: scheduler.run(plan))
        return decided

    @app.post("/proposals/{proposal_id}/reject")
    async def reject_proposal(proposal_id: str, rejection: Rejection) -> Proposal:
        proposal_or_404(proposal_id)
        try:
            return server.store.decide_proposal(proposal_id, "rejected", reason=rejection.reason)
        except ValueError as error:
            raise _Refused(409, str(error)) from None

    @app.get("/proposals")
    async def list_proposals() -> dict:
        return {"proposals": server.store.proposals()}

    @app.get("/runs")
    async def list_runs() -> dict:
        store = server.store
        return {
            "active": server.run_id,
            "unfinished": store.unfinished_runs(),
            "runs": store.runs(),
        }

    @app.get("/checks")
    async def list_checks() -> dict:
        return {"checks": {name: list(argv) for name, argv in settings.checks.items()}}

    # Plain functions: FastAPI runs them in a thread, so file reads never block the event loop.
    @app.get("/agents")
    def list_agents() -> dict:
        return {"agents": server.agents()}

    @app.put("/agents/{agent_id}")
    def save_agent(agent_id: str, agent: AgentConfig) -> AgentConfig:
        if agent.id != agent_id:
            raise _Refused(400, f"the path names agent {agent_id}, the body {agent.id}")
        # Without setup, editing one default in an empty folder would save it and drop the rest.
        folder = personas.setup(settings.agents)
        try:
            personas.save_agent(folder, agent)
        except ValueError as error:
            raise _Refused(400, str(error)) from None
        logger.debug("api: agent %s saved", agent.id)
        return agent

    # On the event loop, unlike the routes above: in threads, two removals could both pass the
    # last-agent check and empty the folder. Its file work is one glob and one unlink.
    @app.delete("/agents/{agent_id}")
    async def remove_agent(agent_id: str) -> dict:
        folder = personas.setup(settings.agents)
        # An empty folder would bring back all five defaults, so the last agent stays.
        if [path.name for path in folder.glob("*.md")] == [f"{agent_id}.md"]:
            raise _Refused(400, f"agent {agent_id} is the last agent; add another first")
        try:
            personas.remove_agent(folder, agent_id)
        except FileNotFoundError:
            raise _Refused(404, f"no agent {agent_id}") from None
        except ValueError as error:
            raise _Refused(400, str(error)) from None
        logger.debug("api: agent %s removed", agent_id)
        return {"ok": True}

    @app.get("/runs/{run_id}")
    async def report(run_id: str) -> RunReport:
        return server.report(run_id)

    @app.post("/runs/{run_id}/recover", status_code=202)
    async def recover(run_id: str) -> dict:
        await server.launch(run_id, lambda scheduler: scheduler.recover(run_id))
        return {"run_id": run_id}

    @app.post("/runs/{run_id}/pause")
    async def pause_run(run_id: str) -> dict:
        return await control(server.active(run_id).pause_run)

    @app.post("/runs/{run_id}/resume")
    async def resume_run(run_id: str) -> dict:
        return await control(server.active(run_id).resume_run)

    @app.post("/runs/{run_id}/cancel")
    async def cancel_run(run_id: str) -> dict:
        return await control(server.active(run_id).cancel_run)

    # Before the general task route below, which would otherwise take /reject.
    @app.post("/runs/{run_id}/tasks/{task_id}/reject")
    async def reject_task(run_id: str, task_id: str, rejection: Rejection) -> dict:
        scheduler = server.active(run_id)
        return await control(scheduler.reject_task, task_id, rejection.reason)

    @app.post("/runs/{run_id}/tasks/{task_id}/{action}")
    async def task_action(run_id: str, task_id: str, action: str) -> dict:
        actions = ("pause", "resume", "cancel", "approve", "retry")
        if action not in actions:
            raise _Refused(404, f"no action {action}; use one of {', '.join(actions)}")
        if action == "retry" and server.run_id != run_id:
            # A finished run is reopened: the task gets one more attempt.
            await server.launch(run_id, lambda s: s.recover(run_id, retry=[task_id]))
            return JSONResponse({"run_id": run_id}, status_code=202)
        scheduler = server.active(run_id)
        method = {
            "pause": scheduler.pause_task,
            "resume": scheduler.resume_task,
            "cancel": scheduler.cancel_task,
            "approve": scheduler.approve_task,
            "retry": scheduler.retry_task,
        }[action]
        return await control(method, task_id)

    @app.get("/runs/{run_id}/events")
    async def events(
        run_id: str, last_event_id: int = Header(default=0, alias="Last-Event-ID")
    ) -> StreamingResponse:
        queue: asyncio.Queue[Transition | None] = asyncio.Queue()
        # Subscribe before reading the report, so nothing falls between the two.
        server.streams.setdefault(run_id, []).append(queue)
        try:
            replay = server.report(run_id).transitions
        except _Refused:
            server.streams[run_id].remove(queue)
            raise
        live = server.run_id == run_id

        async def stream() -> AsyncIterator[str]:
            sent = last_event_id
            try:
                for transition in replay:
                    if transition.sequence > sent:
                        sent = transition.sequence
                        yield _event("transition", _shown(transition), transition.sequence)
                while live:
                    transition = await queue.get()
                    if transition is None:
                        break
                    if transition.sequence > sent:
                        sent = transition.sequence
                        yield _event("transition", _shown(transition), transition.sequence)
                yield _event("end", {"run_id": run_id})
            finally:
                server.streams[run_id].remove(queue)

        return StreamingResponse(stream(), media_type="text/event-stream")

    return app


def _shown(transition: Transition) -> dict:
    # The detail never holds failure text, diffs or check output; those stay in the report.
    return transition.model_dump(mode="json")


def serve(settings: ApiSettings, port: int) -> None:  # pragma: no cover - starts a real server
    import uvicorn

    logger.info("api: serving on http://127.0.0.1:%d", port)
    # Loopback only: the API can start billed work and runs checks with the user's rights.
    uvicorn.run(create_app(settings), host="127.0.0.1", port=port, log_level="warning")
