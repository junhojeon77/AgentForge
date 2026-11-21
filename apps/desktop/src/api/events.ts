import { log } from "../log";
import { ApiError, type Client } from "./client";

export interface Transition {
  sequence: number;
  task_id: string;
  status: string;
  detail: string;
}

export interface FollowOptions {
  signal?: AbortSignal;
  /** Pause before reconnecting; injected so tests need no timers. */
  wait?: () => Promise<void>;
}

const RECONNECT_MS = 2000;

/**
 * Follow a run's transitions until its `end` event or an abort, reconnecting after a drop.
 * Uses fetch, not EventSource, because EventSource cannot send the bearer token.
 */
export async function followEvents(
  client: Pick<Client, "send">,
  runId: string,
  onEvent: (transition: Transition) => void,
  { signal, wait = () => new Promise((r) => setTimeout(r, RECONNECT_MS)) }: FollowOptions = {},
): Promise<void> {
  let lastId = 0;
  const path = `/runs/${encodeURIComponent(runId)}/events`;
  while (!signal?.aborted) {
    let connected = false;
    try {
      const headers: Record<string, string> = lastId ? { "Last-Event-ID": String(lastId) } : {};
      const response = await client.send(path, { headers, signal });
      connected = true;
      for await (const { event, id, data } of frames(response.body!)) {
        if (event === "end") {
          log.debug(`events for run ${runId} ended after ${lastId}`);
          return;
        }
        if (event === "transition") {
          lastId = Number(id);
          onEvent(JSON.parse(data) as Transition);
        }
        if (signal?.aborted) return;
      }
    } catch (error) {
      if (signal?.aborted) return;
      // A broken stream or a lost server is worth waiting out; a 404 or a refused token is not.
      const lost = connected || (error instanceof ApiError && error.kind === "offline");
      if (!lost) throw error;
    }
    log.debug(`events for run ${runId} dropped after ${lastId}; reconnecting`);
    await wait();
  }
}

async function* frames(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, "\n");
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const frame = { event: "message", id: "", data: "" };
        for (const line of block.split("\n")) {
          const colon = line.indexOf(":");
          const field = line.slice(0, colon);
          const text = line.slice(colon + 1).replace(/^ /, "");
          if (field === "event" || field === "id" || field === "data") frame[field] = text;
        }
        yield frame;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
