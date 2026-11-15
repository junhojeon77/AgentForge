"""Starts a saved run that test_store.py kills mid-task, like a crash.

argv[1] is the database path. Task a completes; b starts, prints "b started" and hangs; c waits
for b. The line is printed only after b's RUNNING transition is saved.
"""

import asyncio
import sys

from agentforge.domain import AgentConfig, Assignment, RunPlan, TaskSpec, WorkerResult
from agentforge.mocks import MockValidator
from agentforge.orchestration import Scheduler
from agentforge.store import RunStore


class HangsOnB:
    async def execute(self, assignment: Assignment) -> WorkerResult:
        if assignment.task.id == "b":
            print("b started", flush=True)
            await asyncio.Event().wait()
        return WorkerResult(success=True)


def task(task_id: str, *dependencies: str) -> TaskSpec:
    return TaskSpec(
        id=task_id, run_id="run", title=task_id, role="backend", dependencies=dependencies
    )


async def main() -> None:
    scheduler = Scheduler(validator=MockValidator(), store=RunStore(sys.argv[1]))
    scheduler.register_worker(AgentConfig(id="worker", role="backend"), HangsOnB())
    await scheduler.run(RunPlan(id="run", tasks=(task("a"), task("b", "a"), task("c", "b"))))


asyncio.run(main())
