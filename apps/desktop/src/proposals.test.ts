import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api/client";
import {
  approvalBody,
  approveProposal,
  draftTitle,
  fixesHint,
  NO_RIGHTS,
  newRunId,
  parsePlan,
  planningSince,
  planRequest,
  planTemplate,
  proposalPath,
  proposePlan,
  rejectProposal,
  rightsSummary,
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

describe("rightsSummary", () => {
  const rights = (edit: boolean, checks: string[] = [], maxAttempts = 1) => ({
    ...NO_RIGHTS,
    edit,
    checks,
    maxAttempts,
  });

  it("is null while no task may change files, so the page warns instead", () => {
    expect(rightsSummary({ a: rights(false, ["unit"]), b: rights(false) })).toBeNull();
  });

  it("counts the tasks that may change files, the checks and the billed attempts", () => {
    const all = {
      schema: rights(true, ["unit", "lint"]),
      api: rights(true, ["unit", "lint", "types"]),
      ui: rights(true, ["lint"], 1),
      tests: rights(false, [], 1),
    };
    expect(rightsSummary(all)).toBe(
      "3 of 4 tasks may change files · 6 checks run before work is accepted · up to 4 billed attempts.",
    );
  });

  it("speaks of one task, one check and one attempt in the singular", () => {
    expect(rightsSummary({ api: rights(true, ["unit"]) })).toBe(
      "1 of 1 task may change files · 1 check runs before work is accepted · up to 1 billed attempt.",
    );
  });
});

describe("draftTitle and fixesHint", () => {
  it("counts drafts from 1, since the server's revision 0 is the first draft", () => {
    expect(draftTitle({ revision: 0, source: "check", issues: [] })).toBe(
      "Draft 1, found by the rule check:",
    );
    expect(draftTitle({ revision: 1, source: "critique", issues: [] })).toBe(
      "Draft 2, found by the lead agent's review:",
    );
  });

  it("names how many drafts and issues the lead agent fixed", () => {
    expect(
      fixesHint([
        { revision: 0, source: "check", issues: ["a"] },
        { revision: 1, source: "critique", issues: ["b", "c"] },
      ]),
    ).toBe("2 drafts, 3 issues fixed");
    expect(fixesHint([{ revision: 0, source: "check", issues: ["a"] }])).toBe(
      "1 draft, 1 issue fixed",
    );
  });
});

describe("planningSince", () => {
  it("says how long ago planning started, in whole minutes", () => {
    expect(planningSince(0)).toBe("Started less than a minute ago.");
    expect(planningSince(59_999)).toBe("Started less than a minute ago.");
    expect(planningSince(60_000)).toBe("Started 1 minute ago.");
    expect(planningSince(119_999)).toBe("Started 1 minute ago.");
    expect(planningSince(12 * 60_000 + 5_000)).toBe("Started 12 minutes ago.");
  });
});
