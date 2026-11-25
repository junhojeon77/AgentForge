import { describe, expect, it } from "vitest";
import {
  agentCount,
  attemptMs,
  countWords,
  elapsed,
  groupTone,
  notInRun,
  orderGroups,
  requestLine,
  roleGroups,
  tileLines,
  tileMeta,
  tileTasks,
  wirePath,
} from "./board";
import type { TaskAttempt, TaskState, TaskStatus } from "./runs";

function state(id: string, status: TaskStatus, changes: Partial<TaskState["task"]> = {}): TaskState {
  return {
    task: {
      id,
      title: `Title of ${id}`,
      role: "backend",
      dependencies: [],
      max_attempts: 3,
      allowed_operations: [],
      execution_constraints: [],
      ...changes,
    },
    status,
    failure_reason: null,
    message: "",
    attempt_number: 0,
    worker_id: null,
  };
}

function attempt(number: number, changes: Partial<TaskAttempt> = {}): TaskAttempt {
  return {
    task_id: "a",
    worker_id: "backend",
    number,
    status: "COMPLETED",
    failure_reason: null,
    message: "",
    result: null,
    started_at: null,
    stopped_at: null,
    ...changes,
  };
}

const ids = (tasks: TaskState[]) => tasks.map((t) => t.task.id);

describe("roleGroups", () => {
  it("makes one group per role, in the order the plan first names each role", () => {
    const tasks = [
      state("ui", "RUNNING", { role: "frontend" }),
      state("api", "PENDING"),
      state("page", "PENDING", { role: "frontend" }),
    ];
    const groups = roleGroups(tasks);
    expect(groups.map((g) => g.role)).toEqual(["frontend", "backend"]);
    expect(ids(groups[0].tasks)).toEqual(["ui", "page"]);
  });
});

describe("groupTone", () => {
  it("is waits-for-you first, then trouble, then working, else quiet", () => {
    expect(groupTone([state("a", "FAILED"), state("b", "AWAITING_APPROVAL")])).toBe("needs");
    expect(groupTone([state("a", "RUNNING"), state("b", "BLOCKED")])).toBe("problem");
    expect(groupTone([state("a", "COMPLETED"), state("b", "VALIDATING")])).toBe("working");
    expect(groupTone([state("a", "COMPLETED"), state("b", "PAUSED")])).toBe("quiet");
  });
});

describe("orderGroups", () => {
  it("puts groups waiting for you first, then running ones, then the rest in plan order", () => {
    const groups = roleGroups([
      state("q", "PENDING", { role: "qa" }),
      state("f", "FAILED", { role: "db" }),
      state("r", "RUNNING", { role: "frontend" }),
      state("w", "AWAITING_APPROVAL", { role: "backend" }),
      state("d", "COMPLETED", { role: "docs" }),
    ]);
    expect(orderGroups(groups).map((g) => g.role)).toEqual(["backend", "frontend", "qa", "db", "docs"]);
  });
});

describe("tileTasks", () => {
  it("gives a tile to every task at work, waiting for you or in trouble; the rest are rows", () => {
    const split = tileTasks([
      state("done", "COMPLETED"),
      state("run", "RUNNING"),
      state("wait", "AWAITING_APPROVAL"),
      state("next", "PENDING"),
    ]);
    expect(ids(split.tiles)).toEqual(["run", "wait"]);
    expect(ids(split.rows)).toEqual(["done", "next"]);
  });

  it("shows the next task when the agent rests, and the last one when all are finished", () => {
    expect(ids(tileTasks([state("a", "COMPLETED"), state("b", "PENDING"), state("c", "READY")]).tiles)).toEqual(["b"]);
    expect(ids(tileTasks([state("a", "COMPLETED"), state("b", "CANCELLED")]).tiles)).toEqual(["b"]);
  });
});

describe("countWords", () => {
  it("counts the tasks by state in words, in a fixed order, leaving out zero counts", () => {
    const tasks = [
      state("a", "AWAITING_APPROVAL"),
      state("b", "RUNNING"),
      state("c", "COMPLETED"),
      state("d", "PENDING"),
      state("e", "READY"),
    ];
    expect(countWords(tasks)).toBe("1 working · 1 waits for you · 1 done · 2 waiting");
    expect(
      countWords([
        state("a", "AWAITING_APPROVAL"),
        state("b", "AWAITING_APPROVAL"),
        state("c", "FAILED"),
        state("d", "PAUSED"),
        state("e", "CANCELLED"),
      ]),
    ).toBe("2 wait for you · 1 with a problem · 1 paused · 1 cancelled");
    expect(countWords([])).toBe("");
  });
});

describe("agentCount", () => {
  it("counts each agent that worked in a role, and one for a role nobody has worked in yet", () => {
    const tasks = [state("a", "COMPLETED"), state("b", "RUNNING"), state("ui", "PENDING", { role: "frontend" })];
    const attempts = [
      { task_id: "a", worker_id: "backend" },
      { task_id: "b", worker_id: "backend-2" },
      { task_id: "a", worker_id: "backend" },
    ];
    expect(agentCount(tasks, attempts)).toBe(3);
  });
});

describe("notInRun", () => {
  it("lists the team's agents whose role no task in the run has", () => {
    const team = [
      { id: "backend", role: "backend" },
      { id: "auditor", role: "auditor" },
      { id: "reviewer", role: "reviewer" },
    ];
    expect(notInRun(team, [state("a", "PENDING")])).toEqual(["auditor", "reviewer"]);
  });
});

describe("attemptMs and elapsed", () => {
  const start = "2026-11-24T10:00:00Z";
  const now = Date.parse("2026-11-24T10:05:30Z");

  it("runs from the start to the last stop, or to now while it works on a live run", () => {
    expect(attemptMs({ started_at: start, stopped_at: "2026-11-24T10:03:12Z" }, true, now)).toBe(192_000);
    expect(attemptMs({ started_at: start, stopped_at: null }, true, now)).toBe(330_000);
  });

  it("has no time for an attempt from before times were kept, or one a stopped run left working", () => {
    expect(attemptMs({ started_at: null, stopped_at: null }, true, now)).toBeNull();
    expect(attemptMs({ started_at: start, stopped_at: null }, false, now)).toBeNull();
  });

  it("is written in seconds, minutes or hours", () => {
    expect(elapsed(45_000)).toBe("45s");
    expect(elapsed(192_000)).toBe("3m 12s");
    expect(elapsed(3_840_000)).toBe("1h 04m");
    expect(elapsed(-5)).toBe("0s"); // a clock set back never shows a negative time
  });
});

describe("tileMeta", () => {
  const now = Date.parse("2026-11-24T10:03:12Z");
  const working = attempt(1, { status: "RUNNING", started_at: "2026-11-24T10:00:00Z" });

  it("names the attempt, its time and whether it is live", () => {
    const running = { ...state("a", "RUNNING"), attempt_number: 1 };
    expect(tileMeta(running, working, true, now)).toBe("Attempt 1 of 3 · 3m 12s · live");
    const stopped = { ...working, stopped_at: "2026-11-24T10:01:00Z" };
    const waiting = { ...state("a", "AWAITING_APPROVAL"), attempt_number: 1 };
    expect(tileMeta(waiting, stopped, true, now)).toBe("Attempt 1 of 3 · 1m 00s");
    expect(tileMeta(running, attempt(1), true, now)).toBe("Attempt 1 of 3");
  });

  it("says what a task that has not started may do", () => {
    expect(tileMeta(state("a", "PENDING"), undefined, true, now)).toBe("Read-only · 3 attempts allowed");
    const edit = state("a", "PENDING", { allowed_operations: ["edit"], max_attempts: 1 });
    expect(tileMeta(edit, undefined, true, now)).toBe("May edit · 1 attempt allowed");
  });
});

describe("tileLines", () => {
  const report = { message: "Done.\u001b[32m 8 passed\u001b[0m", diff: "" };

  it("says live output comes later while the task works", () => {
    expect(tileLines({ ...state("a", "RUNNING"), attempt_number: 1 }, [attempt(1)], true)).toEqual([
      { kind: "note", text: "Live output appears here when the server sends it." },
    ]);
  });

  it("shows the report, colour codes removed, then that it waits for review", () => {
    const waiting = { ...state("a", "AWAITING_APPROVAL"), attempt_number: 1 };
    expect(tileLines(waiting, [attempt(1, { result: report })], true)).toEqual([
      { kind: "text", text: "Done. 8 passed" },
      { kind: "you", text: "Waiting for your review." },
    ]);
  });

  it("shows why the latest attempt failed", () => {
    const failed = { ...state("a", "FAILED"), attempt_number: 2 };
    const attempts = [attempt(1, { message: "old" }), attempt(2, { message: "1 test failed" })];
    expect(tileLines(failed, attempts, true)).toEqual([{ kind: "error", text: "1 test failed" }]);
  });

  it("says what a resting task waits for", () => {
    expect(tileLines(state("a", "PENDING", { dependencies: ["api", "ui"] }), [], true)).toEqual([
      { kind: "note", text: "Resting. Starts when api and ui are done." },
    ]);
    expect(tileLines(state("a", "READY"), [], true)).toEqual([
      { kind: "note", text: "Resting. Starts when an agent is free." },
    ]);
  });

  it("notes paused, cancelled and a done task with no report", () => {
    expect(tileLines(state("a", "PAUSED"), [], true)).toEqual([{ kind: "note", text: "Paused." }]);
    expect(tileLines(state("a", "CANCELLED"), [], true)).toEqual([{ kind: "note", text: "Cancelled." }]);
    expect(tileLines(state("a", "COMPLETED"), [], true)).toEqual([{ kind: "note", text: "Done." }]);
  });
});

describe("requestLine", () => {
  it("is the request's first line that has text", () => {
    expect(requestLine("\n  Reset a password by email  \nwith tokens")).toBe("Reset a password by email");
    expect(requestLine("")).toBe("");
  });
});

describe("wirePath", () => {
  it("curves from the bottom middle of the lead box to the top middle of a group", () => {
    const board = { left: 100, top: 50 };
    const lead = { left: 400, top: 74, width: 380, height: 150 };
    const group = { left: 124, top: 280, width: 300, height: 200 };
    expect(wirePath(lead, group, board)).toEqual({
      d: "M490 174 C 490 202, 174 202, 174 230",
      end: { x: 174, y: 230 },
      start: { x: 490, y: 174 },
    });
  });
});
