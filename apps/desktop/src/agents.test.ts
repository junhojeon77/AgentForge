import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api/client";
import { type Agent, agentPath, removeAgent, saveAgent, toId } from "./agents";

const DESIGNER: Agent = {
  id: "designer",
  role: "design",
  model: null,
  reasoning: "medium",
  persona: "Draws screens",
};

function fakeSend(answer: Response | Error = new Response("{}", { status: 200 })) {
  return vi.fn(async (_path: string, _init?: RequestInit) => {
    if (answer instanceof Error) throw answer;
    return answer;
  });
}

describe("toId", () => {
  it.each([
    ["My QA agent", "my-qa-agent"],
    ["  UI / UX  designer!", "ui-ux-designer"],
    ["db_admin-2", "db_admin-2"],
    ["", ""],
    ["???", ""],
  ])("turns %j into the file name %j", (name, id) => {
    expect(toId(name)).toBe(id);
  });
});

describe("requests", () => {
  it("encodes the agent id in its path", () => {
    expect(agentPath("a b")).toBe("/agents/a%20b");
  });

  it("saves an agent with a PUT of its JSON", async () => {
    const send = fakeSend();

    await saveAgent({ send }, DESIGNER);

    const [path, init] = send.mock.calls[0];
    expect(path).toBe("/agents/designer");
    expect(init!.method).toBe("PUT");
    expect(new Headers(init!.headers).get("Content-Type")).toBe("application/json");
    expect(JSON.parse(String(init!.body))).toEqual(DESIGNER);
  });

  it("removes an agent with a DELETE", async () => {
    const send = fakeSend();

    await removeAgent({ send }, "designer");

    expect(send).toHaveBeenCalledWith("/agents/designer", { method: "DELETE" });
  });

  it("passes a refusal on to the caller", async () => {
    const send = fakeSend(new ApiError("http", 400, "agent qa is the last agent; add another first"));

    await expect(removeAgent({ send }, "qa")).rejects.toMatchObject({
      status: 400,
      detail: "agent qa is the last agent; add another first",
    });
  });
});
