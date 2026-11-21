import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api/client";
import { diffTone, sendControl, taskActions } from "./runs";

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
    expect(taskActions(status, live)).toEqual(expected);
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
    ["+++ b/app.py", null],
    ["--- a/app.py", null],
    [" unchanged line", null],
  ] as const)("%j is %s", (line, tone) => {
    expect(diffTone(line)).toBe(tone);
  });
});
