import { log } from "../log";

export const API_BASE = "http://127.0.0.1:8765";

export type ErrorKind = "no-token" | "offline" | "unauthorized" | "http";

export class ApiError extends Error {
  constructor(
    readonly kind: ErrorKind,
    readonly status?: number,
    readonly detail?: string,
  ) {
    super(detail ?? kind);
  }
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
    if (!response.ok) {
      log.debug(`${method} ${path} answered ${response.status}`);
      const body = await response.json().catch(() => ({}));
      throw new ApiError("http", response.status, String(body.detail ?? response.statusText));
    }
    return response;
  }

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    return (await send(path, init)).json() as Promise<T>;
  }

  return { send, request };
}
