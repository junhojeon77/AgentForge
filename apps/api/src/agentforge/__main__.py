"""python -m agentforge: the five-worker mock demo, `setup` for the persona folder, `claude` to
run one read-only task with Claude Code, and `clean` to delete a finished run's worktrees."""

import argparse
import asyncio
import os
import sys
from collections.abc import Sequence
from pathlib import Path

from agentforge import worktrees
from agentforge.claude_code import ClaudeCodeExecutor
from agentforge.domain import RunPlan, RunReport, TaskSpec, WorkerResult
from agentforge.mocks import DEFAULT_ROLES, MockExecutor, MockValidator, register_default_workers
from agentforge.orchestration import Scheduler
from agentforge.personas import default_agents, default_folder, load_agents, setup


async def main() -> None:
    gate = asyncio.Event()
    executor = MockExecutor(
        gate=gate,
        expected_starts=len(DEFAULT_ROLES),
        result=WorkerResult(
            success=True,
            artifacts=("mock-artifact",),
            passed_checks=("unit",),
            satisfied_criteria=("mock acceptance",),
        ),
    )
    scheduler = Scheduler(validator=MockValidator())
    register_default_workers(scheduler, executor)
    plan = RunPlan(
        id="demo",
        tasks=tuple(
            TaskSpec(
                id=role,
                run_id="demo",
                title=f"Mock {role} task",
                role=role,
                expected_output=("mock-artifact",),
                execution_constraints=("check:unit",),
                acceptance_criteria=("mock acceptance",),
            )
            for role in DEFAULT_ROLES
        ),
    )
    running = asyncio.create_task(scheduler.run(plan))
    started = asyncio.create_task(executor.started.wait())
    try:
        # A run that fails before all workers start must surface its error, not hang.
        await asyncio.wait({running, started}, return_when=asyncio.FIRST_COMPLETED)
        if started.done():
            print("All five mock workers are executing concurrently.")
        gate.set()
        report = await running
        print(report.model_dump_json(indent=2))
    finally:
        for future in (running, started):
            if not future.done():
                future.cancel()
        await asyncio.gather(running, started, return_exceptions=True)


async def run_claude(plan: RunPlan, command: Sequence[str]) -> RunReport:
    """Run `plan` read-only with Claude Code, one worker per agent in the persona folder."""
    scheduler = Scheduler(validator=MockValidator())
    claude = ClaudeCodeExecutor(command=command)
    for agent in load_agents(default_folder()) or default_agents():
        scheduler.register_worker(agent, claude)
    return await scheduler.run(plan)


def cli(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m agentforge", description=__doc__)
    modes = parser.add_subparsers(dest="mode", metavar="{setup,claude,clean}")
    modes.add_parser("setup", help="create the agent persona folder")
    claude = modes.add_parser(
        "claude", help="run one read-only task with Claude Code (billed to your Claude login)"
    )
    claude.add_argument("title", help="what the worker should do")
    claude.add_argument("--workspace", default=".", help="the folder to work in (default: here)")
    claude.add_argument("--role", default="qa", help="which agent's role runs it (default: qa)")
    claude.add_argument("--timeout", type=float, help="seconds before the worker is stopped")
    claude.add_argument(
        "--command",
        nargs="+",
        default=(os.environ.get("AGENTFORGE_CLAUDE", "claude"),),
        metavar="PROGRAM",
        help="path to claude.exe and any arguments (default: $AGENTFORGE_CLAUDE, else claude)",
    )
    clean = modes.add_parser(
        "clean", help="delete every worktree of a finished run, with its uncommitted changes"
    )
    clean.add_argument("run_id", help="the id of the run")
    clean.add_argument("--repo", required=True, help="the repository the worktrees belong to")
    clean.add_argument("--root", required=True, help="the folder given to WorktreeExecutor")
    args = parser.parse_args(argv)
    if args.mode == "setup":
        print(f"Agent personas are in {setup(default_folder())}")
        return 0
    if args.mode is None:
        asyncio.run(main())
        return 0
    if args.mode == "clean":
        try:
            removed = asyncio.run(worktrees.remove_run(args.repo, args.root, args.run_id))
        except ValueError as error:
            clean.error(str(error))
        except RuntimeError as error:  # some folders were kept; the error names each one
            print(error, file=sys.stderr)
            return 1
        for path in removed:
            print(path)
        if not removed:
            print(f"No worktrees found for run {args.run_id}.")
        return 0
    workspace = Path(args.workspace).resolve()
    if not workspace.is_dir():
        claude.error(f"workspace is not a folder: {workspace}")
    try:
        task = TaskSpec(
            id="task",
            run_id="cli",
            title=args.title,
            role=args.role,
            workspace_reference=str(workspace),
            timeout_seconds=args.timeout,
        )
        print("AgentForge: this run is billed to your Claude Code login.", file=sys.stderr)
        # A bad plan, such as a role no agent has, raises before Claude starts.
        report = asyncio.run(run_claude(RunPlan(id="cli", tasks=(task,)), args.command))
    except ValueError as error:
        claude.error(str(error))
    print(report.model_dump_json(indent=2))
    return 0 if report.successful else 1


if __name__ == "__main__":
    sys.exit(cli())
