import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api/client";
import {
  attemptStartsOpen,
  diffLines,
  diffStats,
  failureLabel,
  hasReviews,
  retriesLeft,
  reviewAttempt,
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

  it.each([
    ["FAILED", true, []],
    ["CANCELLED", true, []],
    ["FAILED", false, ["retry"]],
    ["CANCELLED", false, ["retry"]],
  ] as const)(
    "%s in a run that is not active, another run active %s, offers %j: one run at a time",
    (status, otherActive, expected) => {
      expect(taskActions(status, false, 1, otherActive)).toEqual(expected);
    },
  );
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

describe("diffLines", () => {
  it("tones each line by where it is: headers outside a hunk, changes inside one", () => {
    const diff = [
      "diff --git a/schema.sql b/schema.sql",
      "new file mode 100644",
      "index 0000000..5d6e7f8",
      "--- /dev/null",
      "+++ b/schema.sql",
      "@@ -0,0 +1,3 @@",
      "+create table users;",
      // Inside a hunk these are a removed "-- note" and an added "++ x", not file headers.
      "--- note",
      "+++ x",
      " kept",
      "\\ No newline at end of file",
      "@@ -9 +9 @@",
      "-old",
      "diff --git a/b.txt b/b.txt",
      "--- a/b.txt",
      "+++ b/b.txt",
      "@@ -1 +1 @@",
      "+y",
      "",
    ].join("\n");

    expect(diffLines(diff).map((line) => line.tone)).toEqual([
      "file",
      "file",
      "file",
      "file",
      "file",
      "hunk",
      "added",
      "removed",
      "added",
      null,
      null,
      "hunk",
      "removed",
      "file",
      "file",
      "file",
      "hunk",
      "added",
      null,
    ]);
    expect(diffLines(diff)[7]).toEqual({ text: "--- note", tone: "removed" });
  });
});

describe("reviewAttempt", () => {
  const task = (status: TaskStatus) => ({ status, attempt_number: 2 });
  const attempts = [{ number: 1 }, { number: 2 }];

  it("is the latest attempt while the task waits for review on the active run", () => {
    expect(reviewAttempt(task("AWAITING_APPROVAL"), true, attempts)).toBe(2);
  });

  it.each([
    // After a refused approve the reload shows the task elsewhere, so the band is gone and
    // the refusal must show under the card's buttons.
    ["the task left review", task("RUNNING"), true, attempts],
    ["the run is not active", task("AWAITING_APPROVAL"), false, attempts],
    ["the waiting attempt is not listed", task("AWAITING_APPROVAL"), true, [{ number: 1 }]],
  ] as const)("is null when %s", (_why, state, live, listed) => {
    expect(reviewAttempt(state, live, listed)).toBeNull();
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

  it("counts a removed '-- note' and an added '++ x' inside a hunk as changed lines", () => {
    const diff = [
      "diff --git a/schema.sql b/schema.sql",
      "--- a/schema.sql",
      "+++ b/schema.sql",
      "@@ -1,2 +1,2 @@",
      "--- note",
      "+++ x",
      " kept",
    ].join("\n");

    expect(diffStats(diff)).toEqual({ files: 1, added: 1, removed: 1 });
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

describe("hasReviews", () => {
  // Mirrors _reviews in api.py: the fix plan needs a finished review that says something.
  const review = (status: TaskStatus, message: string, role = "reviewer") => ({
    run_id: "r1",
    transitions: [],
    tasks: [
      {
        task: {
          id: "review-a",
          title: "review-a",
          role,
          dependencies: ["a"],
          max_attempts: 1,
          allowed_operations: [],
          execution_constraints: [],
        },
        status,
        failure_reason: null,
        message: "",
        attempt_number: 1,
      },
    ],
    attempts: [
      {
        task_id: "review-a",
        worker_id: "reviewer",
        number: 1,
        status,
        failure_reason: null,
        message: "",
        result: { message, diff: "" },
      },
    ],
  });

  it("is true for a finished review with a report", () => {
    expect(hasReviews(review("COMPLETED", "Must fix: 1."))).toBe(true);
  });

  it.each([
    ["a review still running", review("RUNNING", "Must fix: 1.")],
    ["an empty report", review("COMPLETED", "  ")],
    ["a review that found nothing to fix", review("COMPLETED", "Looks good. Ship.")],
    ["another role", review("COMPLETED", "Must fix: 1.", "qa")],
  ])("is false for %s", (_name, run) => {
    expect(hasReviews(run)).toBe(false);
  });
});
