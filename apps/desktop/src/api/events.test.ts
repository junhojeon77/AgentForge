import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./client";
import { followEvents, type Transition } from "./events";

function stream(...chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

function frame(sequence: number, status: string, detail = "a reason"): string {
  const data = JSON.stringify({ sequence, task_id: "build", status, detail });
  // The server's framing (api.py `_event`); END below uses CRLF, which SSE also allows.
  return `id: ${sequence}\nevent: transition\ndata: ${data}\n\n`;
}

const END = 'event: end\r\ndata: {"run_id": "demo-1"}\r\n\r\n';

function setup(answers: Array<Response | Error>) {
  vi.spyOn(console, "debug").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const send = vi.fn(async (_path: string, _init?: RequestInit) => {
    const next = answers.shift()!;
    if (next instanceof Error) throw next;
    return next;
  });
  const seen: Transition[] = [];
  const wait = vi.fn(async () => {});
  return { send, seen, wait, onEvent: (t: Transition) => seen.push(t) };
}

function lastEventId(send: ReturnType<typeof setup>["send"], call: number): string | null {
  return new Headers(send.mock.calls[call][1]?.headers).get("Last-Event-ID");
}

afterEach(() => vi.restoreAllMocks());

describe("followEvents", () => {
  it("parses frames split across chunks and stops at the end event", async () => {
    const whole = frame(1, "RUNNING") + frame(2, "SUCCEEDED") + END;
    const { send, seen, wait, onEvent } = setup([stream(whole.slice(0, 30), whole.slice(30, 95), whole.slice(95))]);

    await followEvents({ send }, "demo-1", onEvent, { wait });

    expect(send.mock.calls[0][0]).toBe("/runs/demo-1/events");
    expect(seen.map((t) => [t.sequence, t.status])).toEqual([
      [1, "RUNNING"],
      [2, "SUCCEEDED"],
    ]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("reconnects after a drop with the last id it saw, and logs ids only", async () => {
    const { send, seen, wait, onEvent } = setup([
      stream(frame(1, "RUNNING"), frame(2, "VALIDATING", "secret check output")),
      new ApiError("offline"),
      stream(frame(3, "SUCCEEDED"), END),
    ]);

    await followEvents({ send }, "demo-1", onEvent, { wait });

    expect(lastEventId(send, 0)).toBeNull();
    expect(lastEventId(send, 1)).toBe("2");
    expect(lastEventId(send, 2)).toBe("2");
    expect(seen.map((t) => t.sequence)).toEqual([1, 2, 3]);
    expect(wait).toHaveBeenCalledTimes(2);
    const logged = JSON.stringify(vi.mocked(console.debug).mock.calls);
    expect(logged).toContain("events for run demo-1 dropped after 2; reconnecting");
    expect(logged).not.toContain("secret check output");
  });

  it("reconnects when the stream breaks while being read", async () => {
    const encoder = new TextEncoder();
    let reads = 0;
    // Erroring in start() would discard the queued frame, so fail on the second read instead.
    const broken = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          if (reads++ === 0) controller.enqueue(encoder.encode(frame(1, "RUNNING")));
          else controller.error(new TypeError("network error"));
        },
      }),
    );
    const { send, seen, wait, onEvent } = setup([broken, stream(frame(2, "SUCCEEDED"), END)]);

    await followEvents({ send }, "demo-1", onEvent, { wait });

    expect(lastEventId(send, 1)).toBe("1");
    expect(seen.map((t) => t.sequence)).toEqual([1, 2]);
  });

  it("stops without reconnecting when aborted", async () => {
    const controller = new AbortController();
    const { send, wait } = setup([stream(frame(1, "RUNNING"))]);

    await followEvents({ send }, "demo-1", () => controller.abort(), { signal: controller.signal, wait });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1]?.signal).toBe(controller.signal);
  });

  it("gives up on a refusal that a reconnect cannot fix", async () => {
    const { send, wait, onEvent } = setup([new ApiError("http", 404, "unknown run")]);

    await expect(followEvents({ send }, "nope", onEvent, { wait })).rejects.toMatchObject({ status: 404 });
    expect(wait).not.toHaveBeenCalled();
  });
});
