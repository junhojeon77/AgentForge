import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, createClient } from "./client";

const SECRET = "tok-secret-123";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function logged(): string {
  const calls = [
    ...vi.mocked(console.debug).mock.calls,
    ...vi.mocked(console.warn).mock.calls,
  ];
  return JSON.stringify(calls);
}

function setup(answers: Array<Response | Error>, tokens: Array<string | null>) {
  vi.spyOn(console, "debug").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const readToken = vi.fn(async () => (tokens.length > 1 ? tokens.shift()! : tokens[0]));
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => {
    const next = answers.shift()!;
    if (next instanceof Error) throw next;
    return next;
  });
  const client = createClient({ readToken, fetch: fetch as unknown as typeof globalThis.fetch });
  return { client, readToken, fetch };
}

function sentAuth(fetch: ReturnType<typeof setup>["fetch"], call: number): string | null {
  return new Headers(fetch.mock.calls[call][1]?.headers).get("Authorization");
}

afterEach(() => vi.restoreAllMocks());

describe("request", () => {
  it("sends the token as a bearer header to the local server", async () => {
    const { client, fetch } = setup([json(200, { runs: [] })], [SECRET]);

    await expect(client.request("/runs")).resolves.toEqual({ runs: [] });

    expect(fetch.mock.calls[0][0]).toBe("http://127.0.0.1:8765/runs");
    expect(sentAuth(fetch, 0)).toBe(`Bearer ${SECRET}`);
  });

  it("re-reads the token after a 401 and retries once", async () => {
    const { client, fetch, readToken } = setup(
      [json(401, { detail: "missing or wrong token" }), json(200, { ok: true })],
      ["old-token", SECRET],
    );

    await expect(client.request("/runs")).resolves.toEqual({ ok: true });

    expect(readToken).toHaveBeenCalledTimes(2);
    expect(sentAuth(fetch, 1)).toBe(`Bearer ${SECRET}`);
    expect(logged()).toContain("token re-read after 401");
  });

  it("gives up as unauthorized when the fresh token is refused too", async () => {
    const { client, fetch } = setup([json(401, {}), json(401, {})], [SECRET]);

    await expect(client.request("/runs")).rejects.toMatchObject({ kind: "unauthorized" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("reports no-token without calling the server when the token file is missing", async () => {
    const { client, fetch } = setup([], [null]);

    await expect(client.request("/runs")).rejects.toMatchObject({ kind: "no-token" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports offline when the server cannot be reached", async () => {
    const { client } = setup([new TypeError("Failed to fetch")], [SECRET]);

    await expect(client.request("/runs")).rejects.toMatchObject({ kind: "offline" });
  });

  it("carries the server's detail for other refusals, and keeps it out of the log", async () => {
    const { client } = setup([json(400, { detail: "persona file x.md is broken" })], [SECRET]);

    const error = await client.request("/agents").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: "http", status: 400, detail: "persona file x.md is broken" });
    expect(logged()).toContain("GET /agents answered 400");
    expect(logged()).not.toContain("persona file");
  });

  it("turns field errors into readable lines and keeps the body, all out of the log", async () => {
    const detail = [
      { loc: ["body", "tasks", 0, "role"], msg: "Field required", input: "SECRET-PLAN" },
      { loc: ["body", "id"], msg: "String should have at least 1 character" },
    ];
    const { client } = setup([json(422, { detail })], [SECRET]);

    const error = await client
      .send("/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "", tasks: ["SECRET-PLAN"] }),
      })
      .catch((e: unknown) => e);

    expect(error).toMatchObject({
      status: 422,
      detail: "body.tasks.0.role: Field required; body.id: String should have at least 1 character",
      body: { detail },
    });
    expect(logged()).toContain("POST /proposals answered 422");
    expect(logged()).not.toContain("SECRET-PLAN");
    expect(logged()).not.toContain("Field required");
  });

  it("logs each change it sends with its status, never its body", async () => {
    const { client } = setup([json(200, { runs: [] }), json(200, { ok: true })], [SECRET]);

    await client.request("/runs");
    await client.send("/runs/r1/tasks/build/reject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "SECRET-REASON" }),
    });

    expect(logged()).toContain("POST /runs/r1/tasks/build/reject answered 200");
    expect(logged()).not.toContain("SECRET-REASON");
    // The connection poll reads every 2 seconds; successful reads would flood the console.
    expect(logged()).not.toContain("GET /runs answered");
  });

  it("logs an agent save with its status, never the persona", async () => {
    const { client } = setup([json(200, { id: "designer" })], [SECRET]);

    await client.send("/agents/designer", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "designer", role: "design", persona: "SECRET-PERSONA" }),
    });

    expect(logged()).toContain("PUT /agents/designer answered 200");
    expect(logged()).not.toContain("SECRET-PERSONA");
  });

  it("never logs the token", async () => {
    const { client } = setup([json(401, {}), json(401, {})], [SECRET]);

    await client.request("/runs").catch(() => {});

    expect(logged()).not.toContain(SECRET);
  });
});
