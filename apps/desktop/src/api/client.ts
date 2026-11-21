import { log } from "../log";

export const API_BASE = "http://127.0.0.1:8765";

export type ErrorKind = "no-token" | "offline" | "unauthorized" | "http";

export class ApiError extends Error {
  constructor(
    readonly kind: ErrorKind,
    readonly status?: number,
    readonly detail?: string,
    readonly body?: unknown, // the refusal's parsed body, e.g. the lead agent's rounds
  ) {
    super(detail ?? kind);
  }
}

/** FastAPI's field errors (a 422) arrive as a list; make them one readable line. */
function describe(detail: unknown): string | undefined {
  if (!Array.isArray(detail)) return detail === undefined ? undefined : String(detail);
  return detail.map((e) => `${(e.loc ?? []).join(".")}: ${e.msg}`).join("; ");
}

/** A POST with a JSON body; FastAPI parses a body as JSON only with this content type. */
export function jsonBody(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export interface ClientDeps {
  readToken: () => Promise<string | null>;
  fetch?: typeof globalThis.fetch;
}

export type Client = ReturnType<typeof createClient>;

export function createClient({ readToken, fetch = globalThis.fetch }: ClientDeps) {
  let token: string | null = null;

  async function attempt(path: string, init: RequestInit): Promise<Response> {
    if (token === null) throw new ApiError("no-token");
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    try {
      return await fetch(`${API_BASE}${path}`, { ...init, headers });
    } catch (error) {
      // An abort is the caller's choice, not a lost server.
      if (init.signal?.aborted) throw error;
      throw new ApiError("offline");
    }
  }

  /** The raw answer of a successful request; refusals become an ApiError. */
  async function send(path: string, init: RequestInit = {}): Promise<Response> {
    const method = init.method ?? "GET";
    token ??= await readToken();
    let response = await attempt(path, init);
    if (response.status === 401) {
      // The server writes a new token at every start, so a refusal usually means a restart.
      token = await readToken();
      log.debug("token re-read after 401");
      response = await attempt(path, init);
      if (response.status === 401) {
        log.warn(`${method} ${path} refused the token`);
        throw new ApiError("unauthorized", 401);
      }
    }
    // Every change is logged so a person's clicks can be traced; reads only when refused,
    // because the connection poll reads every 2 seconds.
    if (!response.ok || method !== "GET") {
      log.debug(`${method} ${path} answered ${response.status}`);
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const detail = describe(body.detail) ?? response.statusText;
      throw new ApiError("http", response.status, detail, body);
    }
    return response;
  }

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    return (await send(path, init)).json() as Promise<T>;
  }

  return { send, request };
}
