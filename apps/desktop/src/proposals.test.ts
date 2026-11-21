import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api/client";
import {
  approvalBody,
  approveProposal,
  NO_RIGHTS,
  newRunId,
  parsePlan,
  planRequest,
  planTemplate,
  proposalPath,
  proposePlan,
  rejectProposal,
  roundsOf,
} from "./proposals";

function fakeRequest(answer: unknown = { id: "p1" }) {
  return vi.fn(async (_path: string, _init?: RequestInit): Promise<any> => {
    if (answer instanceof Error) throw answer;
    return answer;
  });
}

function sentJson(request: ReturnType<typeof fakeRequest>): unknown {
  const init = request.mock.calls[0][1]!;
  expect(init.method).toBe("POST");
  expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
  return JSON.parse(String(init.body));
}

describe("approvalBody", () => {
  it("grants nothing for a task left as is", () => {
    expect(approvalBody("C:/repo", { build: NO_RIGHTS })).toEqual({
      repository: "C:/repo",
      rights: { build: { allowed_operations: [], checks: [], max_attempts: 1 } },
      agents: [],
    });
  });

  it("sends edit, check, the chosen checks, attempts and a timeout", () => {
    const rights = {
      build: { edit: true, runChecks: true, checks: ["pytest"], maxAttempts: 3, timeout: "600" },
    };

    expect(approvalBody("C:/repo", rights).rights.build).toEqual({
      allowed_operations: ["edit", "check"],
      checks: ["pytest"],
      max_attempts: 3,
      timeout_seconds: 600,
    });
  });

  it("drops running checks without edit, the server's own rule", () => {
    const rights = { build: { ...NO_RIGHTS, runChecks: true } };

    expect(approvalBody("C:/repo", rights).rights.build.allowed_operations).toEqual([]);
  });

  it("sends the person's versions of the new agents", () => {
    const designer = {
      id: "designer",
      role: "design",
      model: "opus",
      reasoning: "high" as const,
      persona: "Draws calm screens",
    };

    expect(approvalBody("C:/repo", {}, [designer]).agents).toEqual([designer]);
  });

  it.each(["abc", "0", "-5"])("refuses the timeout %j instead of sending no limit", (timeout) => {
    expect(() => approvalBody("C:/repo", { build: { ...NO_RIGHTS, timeout } })).toThrow(
      "task build: the timeout must be a number of seconds above 0",
    );
  });
});

describe("parsePlan", () => {
  it("parses a plan", () => {
    expect(parsePlan('{"id": "p1", "tasks": []}')).toEqual({ id: "p1", tasks: [] });
  });

  it("says plainly when the text is not JSON", () => {
    expect(() => parsePlan("{id: p1")).toThrow(/^not valid JSON: /);
  });
});

describe("newRunId", () => {
  it("names the run after the local time it was asked", () => {
    expect(newRunId(new Date(2026, 10, 20, 9, 5, 7))).toBe("req-20261120-090507");
  });
});

describe("planTemplate", () => {
  it("gives a one-task plan that passes the run id rule, with an existing role", () => {
    const plan = JSON.parse(planTemplate(["backend", "qa"], "req-1"));

    expect(plan.id).toBe("req-1");
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0].run_id).toBe("req-1");
    expect(plan.tasks[0].role).toBe("backend");
  });
});

describe("requests", () => {
  it("encodes the proposal id in its paths", () => {
    expect(proposalPath("plan 1")).toBe("/proposals/plan%201");
    expect(proposalPath("a#b", "approve")).toBe("/proposals/a%23b/approve");
  });

  it("asks the lead agent to plan a request", async () => {
    const request = fakeRequest();
    const body = { request: "add a login page", run_id: "r1", workspace: "C:/repo", max_revisions: 2 };

    await planRequest({ request }, body);

    expect(request.mock.calls[0][0]).toBe("/proposals/from-request");
    expect(sentJson(request)).toEqual(body);
  });

  it("sends a hand-written plan as it was written", async () => {
    const request = fakeRequest();

    await proposePlan({ request }, '{"id": "r1", "tasks": []}');

    expect(request.mock.calls[0][0]).toBe("/proposals");
    expect(sentJson(request)).toEqual({ id: "r1", tasks: [] });
  });

  it("sends nothing when the hand-written plan is not JSON", async () => {
    const request = fakeRequest();

    await expect(proposePlan({ request }, "not json")).rejects.toThrow(/not valid JSON/);
    expect(request).not.toHaveBeenCalled();
  });

  it("approves with the rights", async () => {
    const request = fakeRequest();

    await approveProposal({ request }, "r 1", "C:/repo", { build: NO_RIGHTS });

    expect(request.mock.calls[0][0]).toBe("/proposals/r%201/approve");
    expect(sentJson(request)).toEqual(approvalBody("C:/repo", { build: NO_RIGHTS }));
  });

  it("rejects with the reason", async () => {
    const request = fakeRequest();

    await rejectProposal({ request }, "r1", "too broad");

    expect(request.mock.calls[0][0]).toBe("/proposals/r1/reject");
    expect(sentJson(request)).toEqual({ reason: "too broad" });
  });
});

describe("roundsOf", () => {
  const rounds = [{ revision: 0, source: "check", issues: ["no worker registered for role: ux"] }];

  it("reads the lead agent's rounds from a refused plan", () => {
    const error = new ApiError("http", 422, "plan rejected", { detail: "plan rejected", rounds });

    expect(roundsOf(error)).toEqual(rounds);
  });

  it.each([
    new ApiError("http", 400, "bad", { detail: "bad" }),
    new ApiError("offline"),
    new Error("x"),
  ])("finds none in another failure", (error) => {
    expect(roundsOf(error)).toEqual([]);
  });
});
