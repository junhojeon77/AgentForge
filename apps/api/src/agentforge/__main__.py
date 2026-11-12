"""Run the five-worker mock demonstration: python -m agentforge."""

import asyncio

from agentforge.domain import RunPlan, TaskSpec, WorkerResult
from agentforge.mocks import DEFAULT_ROLES, MockExecutor, MockValidator, register_default_workers
from agentforge.orchestration import Scheduler


async def main() -> None:
    gate = asyncio.Event()
    executor = MockExecutor(
        gate=gate,
        expected_starts=5,
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
    try:
        await executor.started.wait()
        print("All five mock workers are executing concurrently.")
        gate.set()
        report = await running
        print(report.model_dump_json(indent=2))
    finally:
        if not running.done():
            running.cancel()
            await asyncio.gather(running, return_exceptions=True)


if __name__ == "__main__":
    asyncio.run(main())
