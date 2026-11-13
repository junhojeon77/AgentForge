"""python -m agentforge: the five-worker mock demo; `setup` creates the persona folder."""

import asyncio
import sys

from agentforge.domain import RunPlan, TaskSpec, WorkerResult
from agentforge.mocks import DEFAULT_ROLES, MockExecutor, MockValidator, register_default_workers
from agentforge.orchestration import Scheduler
from agentforge.personas import default_folder, setup


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


if __name__ == "__main__":
    if sys.argv[1:] == ["setup"]:
        print(f"Agent personas are in {setup(default_folder())}")
    elif sys.argv[1:]:
        sys.exit("usage: python -m agentforge [setup]")
    else:
        asyncio.run(main())
