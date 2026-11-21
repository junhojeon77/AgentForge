import { useEffect, useMemo, useState } from "react";
import { API_BASE, ApiError, createClient, type Client } from "./api/client";
import { followEvents, type Transition } from "./api/events";
import { readToken } from "./api/token";
import { type ConnectionState, useConnection } from "./connection";
import { log } from "./log";

// Icon and words carry the state; color only repeats it.
const STATES: Record<ConnectionState, { icon: string; text: string; tone: string }> = {
  connecting: { icon: "…", text: "Connecting…", tone: "text-slate-700" },
  "no-token": {
    icon: "!",
    text: "No token yet: start the server with `python -m agentforge serve`",
    tone: "text-amber-800",
  },
  offline: { icon: "✕", text: `Server offline at ${API_BASE.slice(7)}`, tone: "text-red-800" },
  unauthorized: {
    icon: "✕",
    text: "Token refused, even after reading it again",
    tone: "text-red-800",
  },
  failed: { icon: "✕", text: "Server error", tone: "text-red-800" },
  connected: { icon: "●", text: `Connected to ${API_BASE.slice(7)}`, tone: "text-green-800" },
};

export function App() {
  const client = useMemo(() => createClient({ readToken }), []);
  const { state, error, runs, refetch } = useConnection(client);
  const shown = STATES[state];
  const active = state === "connected" ? (runs?.active ?? null) : null;

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <header className="flex items-center justify-between border-b border-slate-300 px-4 py-3">
        <p role="status" aria-live="polite" className={`font-medium ${shown.tone}`}>
          <span aria-hidden="true">{shown.icon} </span>
          {shown.text}
          {state === "failed" && error?.status ? ` (${error.status}: ${error.detail})` : ""}
        </p>
        <button
          type="button"
          onClick={() => refetch()}
          className="rounded border border-slate-400 px-3 py-1 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        >
          Reconnect
        </button>
      </header>
      <main className="p-4">
        {state !== "connected" ? null : active ? (
          <LiveRun key={active} client={client} runId={active} />
        ) : (
          <p>No active run.</p>
        )}
      </main>
    </div>
  );
}

function LiveRun({ client, runId }: { client: Client; runId: string }) {
  const [events, setEvents] = useState<Transition[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    followEvents(client, runId, (t) => setEvents((all) => [...all, t]), {
      signal: controller.signal,
    }).catch((e: unknown) => {
      const status = e instanceof ApiError ? (e.status ?? e.kind) : "error";
      log.warn(`events for run ${runId} stopped: ${status}`);
      setProblem(e instanceof ApiError ? (e.detail ?? e.kind) : "the event stream failed");
    });
    return () => controller.abort();
  }, [client, runId]);

  return (
    <section aria-labelledby="run-title">
      <h1 id="run-title" className="mb-2 text-lg font-semibold">
        Active run: {runId}
      </h1>
      {problem && <p role="alert">Live events stopped: {problem}</p>}
      {events.length === 0 ? (
        <p>Waiting for events…</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Task</th>
              <th scope="col">Status</th>
              <th scope="col">Reason</th>
            </tr>
          </thead>
          <tbody>
            {events.map((t) => (
              <tr key={t.sequence} className="border-t border-slate-200">
                <td>{t.sequence}</td>
                <td>{t.task_id}</td>
                <td className="font-mono">{t.status}</td>
                <td>{t.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
