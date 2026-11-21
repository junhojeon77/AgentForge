import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useMemo, useState } from "react";
import { API_BASE, createClient } from "./api/client";
import { readToken } from "./api/token";
import { type ConnectionState, POLL_MS, useConnection } from "./connection";
import { NewProposal, ProposalPage, STATUS } from "./ProposalPage";
import type { Proposal } from "./proposals";
import { BUTTON, problem, RunPage } from "./RunPage";

type View = { kind: "run" | "proposal"; id: string } | { kind: "new" };

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
  const [picked, setPicked] = useState<View | null>(null);
  // The folder typed for a request prefills the approve form; memory only.
  const [folder, setFolder] = useState("");
  const shown = STATES[state];
  const connected = state === "connected" ? runs : undefined;
  const proposals = useQuery({
    queryKey: ["proposals"],
    queryFn: () => client.request<{ proposals: Proposal[] }>("/proposals"),
    refetchInterval: POLL_MS,
    retry: false,
    enabled: connected !== undefined,
  });
  const fallback = connected && (connected.active ?? connected.runs[0]);
  // With no run yet, the first thing shown is the place to ask for one.
  const view: View = picked ?? (fallback ? { kind: "run", id: fallback } : { kind: "new" });
  const shownPlan =
    view.kind === "proposal" ? proposals.data?.proposals.find((p) => p.id === view.id) : undefined;
  const openRun = (id: string) => setPicked({ kind: "run", id });
  const isOpen = (kind: View["kind"], id?: string) =>
    view.kind === kind && (!id || (view.kind !== "new" && view.id === id));

  return (
    <div className="flex h-screen flex-col bg-white text-slate-900">
      <header className="flex items-center justify-between border-b border-slate-300 px-4 py-3">
        <p role="status" aria-live="polite" className={`font-medium ${shown.tone}`}>
          <span aria-hidden="true">{shown.icon} </span>
          {shown.text}
          {state === "failed" && error?.status ? ` (${error.status}: ${error.detail})` : ""}
        </p>
        <button type="button" onClick={() => refetch()} className={BUTTON}>
          Reconnect
        </button>
      </header>
      {connected && (
        <div className="flex min-h-0 flex-1">
          <nav aria-label="Runs and plans" className="w-60 shrink-0 space-y-4 overflow-y-auto border-r border-slate-300 p-2">
            <button
              type="button"
              aria-current={isOpen("new") ? "page" : undefined}
              onClick={() => setPicked({ kind: "new" })}
              className={`${BUTTON} w-full font-medium`}
            >
              Ask for something
            </button>
            {/* The page's h1 stays the first heading, so the lists are named by plain text. */}
            <div>
              <p className="mb-2 font-semibold">Runs</p>
              <ul>
                {connected.runs.map((id) => {
                  const marker =
                    id === connected.active
                      ? "Active"
                      : connected.unfinished.includes(id)
                        ? "Interrupted"
                        : "";
                  return (
                    <NavItem key={id} current={isOpen("run", id)} onClick={() => openRun(id)}>
                      {id}
                      {marker && ` · ${marker}`}
                    </NavItem>
                  );
                })}
              </ul>
            </div>
            <div>
              <p className="mb-2 font-semibold">Plans</p>
              {proposals.error && (
                <p role="alert" className="text-sm">
                  Could not list plans: {problem(proposals.error)}
                </p>
              )}
              <ul>
                {proposals.data?.proposals.map((p) => (
                  <NavItem
                    key={p.id}
                    current={isOpen("proposal", p.id)}
                    onClick={() => setPicked({ kind: "proposal", id: p.id })}
                  >
                    {p.id} · {STATUS[p.status]}
                  </NavItem>
                ))}
              </ul>
            </div>
          </nav>
          <main className="min-w-0 flex-1 overflow-y-auto p-4">
            {view.kind === "run" ? (
              <RunPage
                key={view.id}
                client={client}
                runId={view.id}
                live={view.id === connected.active}
                interrupted={view.id !== connected.active && connected.unfinished.includes(view.id)}
              />
            ) : view.kind === "new" ? (
              <NewProposal
                client={client}
                folder={folder}
                onFolder={setFolder}
                onCreated={(id) => setPicked({ kind: "proposal", id })}
              />
            ) : shownPlan ? (
              <ProposalPage
                key={shownPlan.id}
                client={client}
                proposal={shownPlan}
                folder={folder}
                onOpenRun={openRun}
              />
            ) : (
              <p>{proposals.data ? `No plan ${view.id}.` : "Loading plan…"}</p>
            )}
          </main>
        </div>
      )}
    </div>
  );
}

function NavItem({
  current,
  onClick,
  children,
}: {
  current: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        aria-current={current ? "page" : undefined}
        onClick={onClick}
        className={`block w-full truncate rounded px-2 py-1 text-left hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-700 ${current ? "bg-slate-200 font-medium" : ""}`}
      >
        {children}
      </button>
    </li>
  );
}
