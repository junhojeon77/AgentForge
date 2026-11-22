import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api/client";
import {
  attemptStartsOpen,
  diffStats,
  diffTone,
  failureLabel,
  retriesLeft,
  runSummary,
  STATUS,
  sendControl,
  stripAnsi,
  type TaskStatus,
  taskActions,
} from "./runs";

describe("taskActions", () => {
  // Mirrors the scheduler: _hold, _release, _waiting and _retry_limit in orchestration.py.
  it.each([
    ["PENDING", true, ["pause", "cancel"]],
    ["READY", true, ["pause", "cancel"]],
    ["ASSIGNED", true, ["pause", "cancel"]],
    ["RUNNING", true, ["pause", "cancel"]],
    ["VALIDATING", true, ["pause", "cancel"]],
    ["PAUSED", true, ["resume", "cancel"]],
    ["AWAITING_APPROVAL", true, ["approve", "reject", "cancel"]],
    ["FAILED", true, ["retry"]],
    ["CANCELLED", true, ["retry"]],
    ["COMPLETED", true, []],
    ["BLOCKED", true, []],
    ["PENDING", false, []],
    ["READY", false, []],
    ["ASSIGNED", false, []],
    ["RUNNING", false, []],
    ["VALIDATING", false, []],
    ["PAUSED", false, []],
    ["AWAITING_APPROVAL", false, []],
    ["FAILED", false, ["retry"]],
    ["CANCELLED", false, ["retry"]],
    ["COMPLETED", false, []],
    ["BLOCKED", false, []],
  ] as const)("%s with the run active: %s offers %j", (status, live, expected) => {
    expect(taskActions(status, live, 1)).toEqual(expected);
  });

  it.each([
    ["FAILED", 4, ["retry"]],
    ["CANCELLED", 4, ["retry"]],
    ["FAILED", 5, []],
    ["CANCELLED", 5, []],
  ] as const)("%s after %i attempts offers %j: the server allows 5 at most", (status, n, expected) => {
    expect(taskActions(status, true, n)).toEqual(expected);
  });
});

describe("retriesLeft", () => {
  it.each([
    [3, "2 more attempts allowed (5 at most)"],
    [4, "1 more attempt allowed (5 at most)"],
    [5, "All 5 attempts used"],
  ])("after %i attempts says %j", (n, text) => {
    expect(retriesLeft(n)).toBe(text);
  });
});

function fakeSend(answer: Response | Error = new Response(null, { status: 200 })) {
  return vi.fn(async (_path: string, _init?: RequestInit) => {
    if (answer instanceof Error) throw answer;
    return answer;
  });
}

describe("sendControl", () => {
  it("posts a run control to the run's path", async () => {
    const send = fakeSend();

    await sendControl({ send }, "demo-1", "pause");

    expect(send).toHaveBeenCalledWith("/runs/demo-1/pause", { method: "POST" });
  });

  it("encodes the run and task ids in a task control's path", async () => {
    const send = fakeSend();

    await sendControl({ send }, "run 1", "approve", "task#2");

    expect(send.mock.calls[0][0]).toBe("/runs/run%201/tasks/task%232/approve");
  });

  it("sends a reject's reason as a JSON body", async () => {
    const send = fakeSend();

    await sendControl({ send }, "demo-1", "reject", "build", "tests are missing");

    const init = send.mock.calls[0][1]!;
    expect(send.mock.calls[0][0]).toBe("/runs/demo-1/tasks/build/reject");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual({ reason: "tests are missing" });
  });

  it("passes a refusal on to the caller", async () => {
    const send = fakeSend(new ApiError("http", 409, "run demo-2 is active; one run at a time"));

    await expect(sendControl({ send }, "demo-1", "retry", "build")).rejects.toMatchObject({
      status: 409,
      detail: "run demo-2 is active; one run at a time",
    });
  });
});

describe("diffTone", () => {
  it.each([
    ["+added line", "added"],
    ["-removed line", "removed"],
    ["@@ -1,2 +1,3 @@", "hunk"],
    // File headers are tested before + and -, so they are never read as added or removed.
    ["diff --git a/app.py b/app.py", "file"],
    ["index 1a2b3c4..5d6e7f8 100644", "file"],
    ["+++ b/app.py", "file"],
    ["--- a/app.py", "file"],
    [" unchanged line", null],
    ["", null],
  ] as const)("%j is %s", (line, tone) => {
    expect(diffTone(line)).toBe(tone);
  });
});

describe("diffStats", () => {
  it("counts files and changed lines, not the header lines", () => {
    const diff = [
      "diff --git a/app.py b/app.py",
      "index 1a2b3c4..5d6e7f8 100644",
      "--- a/app.py",
      "+++ b/app.py",
      "@@ -1,2 +1,3 @@",
      " kept",
      "-old",
      "+new",
      "+added",
      "diff --git a/b.txt b/b.txt",
      "--- a/b.txt",
      "+++ b/b.txt",
      "@@ -1 +1 @@",
      "-x",
      "+y",
    ].join("\n");

    expect(diffStats(diff)).toEqual({ files: 2, added: 3, removed: 2 });
  });
});

describe("STATUS", () => {
  // Only Needs you, Working and Problem are coloured; the words always show.
  it.each([
    ["PENDING", "Pending", "waiting"],
    ["READY", "Ready", "waiting"],
    ["ASSIGNED", "Assigned", "working"],
    ["RUNNING", "Running", "working"],
    ["VALIDATING", "Validating", "working"],
    ["AWAITING_APPROVAL", "Awaiting approval", "needs"],
    ["COMPLETED", "Completed", "done"],
    ["PAUSED", "Paused", "held"],
    ["BLOCKED", "Blocked", "problem"],
    ["FAILED", "Failed", "problem"],
    ["CANCELLED", "Cancelled", "stopped"],
  ] as const)("%s reads %j in the %s group", (status, label, group) => {
    expect(STATUS[status]).toEqual({ label, group });
  });
});

describe("failureLabel", () => {
  it.each([
    ["worker_failure", "The agent reported a failure"],
    ["executor_exception", "The agent could not run"],
    ["worker_timeout", "The agent ran out of time"],
    ["invalid_result", "The agent's answer was not valid"],
    ["validation_rejected", "A check failed"],
    ["validator_exception", "A check could not run, not retried"],
    ["review_rejected", "You rejected the diff"],
  ])("%s reads %j", (code, label) => {
    expect(failureLabel(code)).toBe(label);
  });

  it("has no label for a code it does not know, so only the code shows", () => {
    expect(failureLabel("something_new")).toBeNull();
  });
});

describe("runSummary", () => {
  const tasks = (...statuses: TaskStatus[]) => statuses.map((status) => ({ status }));

  it("counts tasks, completed ones and the ones waiting for you", () => {
    expect(
      runSummary(tasks("COMPLETED", "AWAITING_APPROVAL", "AWAITING_APPROVAL", "RUNNING", "PENDING")),
    ).toBe("5 tasks · 1 completed · 2 waiting for you");
  });

  it("leaves out counts that are zero and says one task", () => {
    expect(runSummary(tasks("RUNNING"))).toBe("1 task");
  });
});

describe("stripAnsi", () => {
  it("removes colour codes and keeps everything else as text", () => {
    expect(stripAnsi("\u001b[31mFAILED\u001b[0m <b>test_login</b>")).toBe(
      "FAILED <b>test_login</b>",
    );
  });
});

describe("attemptStartsOpen", () => {
  const task = (status: TaskStatus, attempt_number = 2) => ({ status, attempt_number });

  it.each([
    ["RUNNING", 2, true],
    ["AWAITING_APPROVAL", 2, true],
    ["FAILED", 2, false],
    ["COMPLETED", 2, false],
    // Earlier attempts open while the latest runs, so your reject reason stays readable.
    ["RUNNING", 1, true],
    ["AWAITING_APPROVAL", 1, false],
    ["PAUSED", 1, false],
  ] as const)("with the task %s, attempt %i starts open: %s", (status, number, open) => {
    expect(attemptStartsOpen(number, task(status))).toBe(open);
  });
});
