import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AgentsPage } from "./AgentsPage";
import { API_BASE, createClient } from "./api/client";
import { readToken } from "./api/token";
import { type ConnectionState, POLL_MS, useConnection } from "./connection";
import { Tour, ViewFooter, Welcome } from "./GuideScreens";
import {
  endTour,
  finishWelcome,
  type Guide,
  loadGuide,
  saveGuide,
  setView,
  showAgain,
} from "./guide";
import { Icon, type IconName } from "./Icon";
import { NewProposal, PLAN_GROUP, ProposalPage, STATUS } from "./ProposalPage";
import type { Proposal } from "./proposals";
import { RunPage, runQuery } from "./RunPage";
import {
  Button,
  CopyButton,
  NeedsCount,
  plural,
  problem,
  StatusBadge,
  TechnicalView,
} from "./ui";

type View = { kind: "run" | "proposal"; id: string } | { kind: "new" | "agents" };
type Tab = "runs" | "plans";

const HOST = API_BASE.slice(7);
// README step 9's command: serve needs --worktrees, so the short form would fail as typed.
const SERVE = String.raw`.\.venv\Scripts\python.exe -m agentforge serve --worktrees "$env:LOCALAPPDATA\AgentForge\worktrees"`;

const QUIET = "border-line bg-panel text-ink";
const TROUBLE = "border-problem-edge bg-problem-soft text-problem-ink";

// Words carry the state; the icon and colour only repeat it.
const STATES: Record<ConnectionState, { icon: IconName; iconTone: string; bar: string; text: string }> =
  {
    connecting: {
      icon: "connecting",
      iconTone: "text-working-edge",
      bar: QUIET,
      text: "Connecting…",
    },
    "no-token": {
      icon: "no-token",
      iconTone: "",
      bar: "border-needs-edge bg-needs-soft text-needs-ink",
      // The disconnected screen below has the steps and the full command; a short one here
      // would fail without --worktrees.
      text: "No token yet: start the server (steps below)",
    },
    offline: { icon: "offline", iconTone: "", bar: TROUBLE, text: `Server offline at ${HOST}` },
    unauthorized: {
      icon: "offline",
      iconTone: "",
      bar: TROUBLE,
      text: "Token refused, even after reading it again",
    },
    failed: { icon: "offline", iconTone: "", bar: TROUBLE, text: "Server error" },
    connected: {
      icon: "connected",
      iconTone: "text-done-ink",
      bar: QUIET,
      text: `Connected to ${HOST}`,
    },
  };

export function App() {
  const client = useMemo(() => createClient({ readToken }), []);
  const { state, error, runs, refetch } = useConnection(client);
  const [picked, setPicked] = useState<View | null>(null);
  // The folder typed for a request prefills the approve form; memory only.
  const [folder, setFolder] = useState("");
  const [reconnecting, setReconnecting] = useState(false);
  const [tab, setTab] = useState<Tab>("runs");
  const [guide, setGuide] = useState(() => loadGuide(() => globalThis.localStorage));
  const keep = (next: Guide) => {
    setGuide(next);
    saveGuide(() => globalThis.localStorage, next);
  };
  const list = useRef<HTMLDivElement>(null);
  const scrolls = useRef<Record<Tab, number>>({ runs: 0, plans: 0 });
  const shown = STATES[state];
  const connected = state === "connected" ? runs : undefined;
  const active = connected?.active ?? null;
  const proposals = useQuery({
    queryKey: ["proposals"],
    queryFn: () => client.request<{ proposals: Proposal[] }>("/proposals"),
    refetchInterval: POLL_MS,
    retry: false,
    enabled: connected !== undefined,
  });
  // The active run's diffs waiting for review, for its count in the side list.
  const activeRun = useQuery({
    ...runQuery(client, active ?? ""),
    enabled: active !== null,
    refetchInterval: POLL_MS,
  });
  const waitingDiffs =
    activeRun.data?.tasks.filter((t) => t.status === "AWAITING_APPROVAL").length ?? 0;
  const waitingPlans = proposals.data?.proposals.filter((p) => p.status === "pending").length ?? 0;

  const fallback = connected && (connected.active ?? connected.runs[0]);
  // With no run yet, the first thing shown is the place to ask for one.
  const view: View = picked ?? (fallback ? { kind: "run", id: fallback } : { kind: "new" });
  const shownPlan =
    view.kind === "proposal" ? proposals.data?.proposals.find((p) => p.id === view.id) : undefined;
  const isOpen = (kind: View["kind"], id?: string) =>
    view.kind === kind && (!id || ("id" in view && view.id === id));

  // Each tab keeps its own scroll position.
  const switchTab = (next: Tab) => {
    if (next === tab) return;
    if (list.current) scrolls.current[tab] = list.current.scrollTop;
    setTab(next);
  };
  useLayoutEffect(() => {
    if (list.current) list.current.scrollTop = scrolls.current[tab];
  }, [tab]);
  const show = (next: View) => {
    setPicked(next);
    if (next.kind === "run") switchTab("runs");
    if (next.kind === "proposal") switchTab("plans");
  };
  const reconnect = () => {
    setReconnecting(true);
    void refetch().finally(() => setReconnecting(false));
  };

  const suffix = state === "failed" && error?.status ? ` (${error.status}: ${error.detail})` : "";
  const tabs = [
    {
      id: "runs" as const,
      label: "Runs",
      count: waitingDiffs,
      means: `${plural(waitingDiffs, "diff waits", "diffs wait")} for you`,
    },
    {
      id: "plans" as const,
      label: "Plans",
      count: waitingPlans,
      means: `${plural(waitingPlans, "plan waits", "plans wait")} for your OK`,
    },
  ];

  // The welcome needs no server, so it comes first even while the server is off.
  if (!guide.welcomed) {
    return (
      <div className="flex h-screen flex-col bg-canvas text-ink">
        <Welcome
          view={guide.view}
          onView={(view) => keep(setView(guide, view))}
          onDone={(takeTour) => keep(finishWelcome(guide.view, takeTour))}
        />
      </div>
    );
  }

  const frame = (
    <div className="flex h-screen flex-col bg-canvas text-ink">
      <header
        data-tour="status"
        className={`flex h-9 shrink-0 items-center justify-between gap-3 border-b px-3 ${shown.bar}`}
      >
        <p
          role="status"
          aria-live="polite"
          title={shown.text + suffix}
          className="flex min-w-0 items-center gap-2 text-control font-semibold"
        >
          <Icon name={shown.icon} className={`size-4 shrink-0 ${shown.iconTone}`} />
          <span className="truncate">
            {shown.text}
            {suffix}
          </span>
        </p>
        <Button small busy={reconnecting} disabled={reconnecting} onClick={reconnect}>
          Reconnect
        </Button>
      </header>
      {state !== "connected" && state !== "connecting" && (
        <Disconnected busy={reconnecting} onReconnect={reconnect} />
      )}
      {connected && (
        <div className="flex min-h-0 flex-1">
          <nav
            aria-label="AgentForge"
            className="flex w-62 shrink-0 flex-col border-r border-line bg-panel max-[900px]:w-50"
          >
            <div className="space-y-1 p-2">
              <Button
                kind="primary"
                data-tour="ask"
                className="w-full justify-center"
                aria-current={isOpen("new") ? "page" : undefined}
                onClick={() => show({ kind: "new" })}
              >
                Ask for something
              </Button>
              <SideItem
                current={isOpen("agents")}
                tour="team"
                onClick={() => show({ kind: "agents" })}
              >
                Your team
              </SideItem>
            </div>
            <div
              role="tablist"
              aria-label="Runs and plans"
              className="flex gap-1 border-b border-line px-2"
              onKeyDown={(e) => {
                if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                e.preventDefault();
                const next = tab === "runs" ? "plans" : "runs";
                switchTab(next);
                document.getElementById(`tab-${next}`)?.focus();
              }}
            >
              {tabs.map((t) => (
                <button
                  key={t.id}
                  id={`tab-${t.id}`}
                  type="button"
                  role="tab"
                  data-tour={t.id}
                  aria-selected={tab === t.id}
                  aria-controls="side-list"
                  tabIndex={tab === t.id ? 0 : -1}
                  onClick={() => switchTab(t.id)}
                  className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-2 py-2 text-control font-semibold ${
                    tab === t.id
                      ? "border-accent text-ink"
                      : "border-transparent text-ink-muted hover:text-ink"
                  }`}
                >
                  {t.label}
                  <NeedsCount count={t.count} label={t.means} />
                </button>
              ))}
            </div>
            <div
              ref={list}
              id="side-list"
              role="tabpanel"
              aria-labelledby={`tab-${tab}`}
              className="min-h-0 flex-1 overflow-y-auto p-2"
            >
              {/* The page's h1 stays the first heading, so the lists are named by plain text. */}
              {tab === "runs" ? (
                <>
                  <ListHeading label="Runs" count={connected.runs.length} />
                  <ul>
                    {connected.runs.map((id) => (
                      <li key={id}>
                        <SideItem
                          current={isOpen("run", id)}
                          title={id}
                          onClick={() => show({ kind: "run", id })}
                        >
                          <SideId>{id}</SideId>
                          {id === connected.active ? (
                            <StatusBadge group="working" label="Active" />
                          ) : (
                            connected.unfinished.includes(id) && (
                              <StatusBadge group="needs" label="Interrupted" />
                            )
                          )}
                          {id === connected.active && (
                            <NeedsCount count={waitingDiffs} label={tabs[0].means} />
                          )}
                        </SideItem>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <>
                  <ListHeading label="Plans" count={proposals.data?.proposals.length ?? 0} />
                  {proposals.error && (
                    <p role="alert" className="px-2 text-meta text-problem-ink">
                      Could not list plans: {problem(proposals.error)}
                    </p>
                  )}
                  <ul>
                    {proposals.data?.proposals.map((p) => (
                      <li key={p.id}>
                        <SideItem
                          current={isOpen("proposal", p.id)}
                          title={p.id}
                          onClick={() => show({ kind: "proposal", id: p.id })}
                        >
                          <SideId>{p.id}</SideId>
                          <StatusBadge group={PLAN_GROUP[p.status]} label={STATUS[p.status]} />
                        </SideItem>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            <ViewFooter
              view={guide.view}
              onView={(view) => keep(setView(guide, view))}
              onShowAgain={() => keep(showAgain(guide))}
            />
          </nav>
          <main className="min-w-0 flex-1 overflow-y-auto p-6">
            <div className="max-w-280">
              {view.kind === "run" ? (
                <RunPage
                  key={view.id}
                  client={client}
                  runId={view.id}
                  live={view.id === connected.active}
                  interrupted={
                    view.id !== connected.active && connected.unfinished.includes(view.id)
                  }
                  otherRun={connected.active !== view.id ? connected.active : null}
                  onOpenPlan={(id) => show({ kind: "proposal", id })}
                />
              ) : view.kind === "agents" ? (
                <AgentsPage client={client} />
              ) : view.kind === "new" ? (
                <NewProposal
                  client={client}
                  folder={folder}
                  onFolder={setFolder}
                  onCreated={(id) => show({ kind: "proposal", id })}
                />
              ) : view.kind !== "proposal" ? null : shownPlan ? (
                <ProposalPage
                  key={shownPlan.id}
                  client={client}
                  proposal={shownPlan}
                  folder={folder}
                  activeRun={connected.active}
                  onOpenRun={(id) => show({ kind: "run", id })}
                />
              ) : (
                <p>{proposals.data ? `No plan ${view.id}.` : "Loading plan…"}</p>
              )}
            </div>
          </main>
        </div>
      )}
      {/* A tour chosen while the server is off starts once the frame it points at is there. */}
      {connected && guide.tour === "wanted" && (
        <Tour onEnd={(finished) => keep(endTour(guide, finished))} />
      )}
    </div>
  );
  return <TechnicalView value={guide.view === "technical"}>{frame}</TechnicalView>;
}

/** What fills the window while the server cannot be reached; the status bar says which case. */
function Disconnected({ busy, onReconnect }: { busy: boolean; onReconnect: () => void }) {
  return (
    <main className="flex-1 overflow-y-auto p-8">
      <div className="max-w-[560px] space-y-4">
        <h1 className="font-display text-[18px] leading-6 font-semibold">
          AgentForge can't reach its server
        </h1>
        <p className="text-ink-muted">
          The app shows your runs once the local AgentForge server is running on this machine. It
          checks again every 2 seconds.
        </p>
        <ol className="list-decimal space-y-3 pl-5">
          <li>Open PowerShell in your AgentForge folder.</li>
          <li className="space-y-2">
            <p>Start the server:</p>
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-code-bg px-3 py-2">
              <code className="min-w-0 flex-1 basis-64 font-mono text-[13px] wrap-anywhere">
                {SERVE}
              </code>
              <CopyButton text={SERVE} what="server command" label="Copy command" />
            </div>
          </li>
          <li>Leave it running. This window connects by itself, or press Reconnect.</li>
        </ol>
        <Button kind="primary" busy={busy} disabled={busy} onClick={onReconnect}>
          Reconnect
        </Button>
      </div>
    </main>
  );
}

function ListHeading({ label, count }: { label: string; count: number }) {
  return (
    <p className="flex justify-between px-2 pt-1 pb-2 text-meta font-semibold text-ink-muted">
      <span>{label}</span>
      <span className="tabular-nums">{count}</span>
    </p>
  );
}

/** An id that is cut short in the side list; the item's `title` and name keep it whole. */
function SideId({ children }: { children: ReactNode }) {
  return <span className="min-w-0 grow basis-24 truncate font-mono text-[12px]">{children}</span>;
}

function SideItem({
  current,
  title,
  tour,
  onClick,
  children,
}: {
  current: boolean;
  title?: string;
  /** Marks the item for a tour step (GuideScreens.tsx). */
  tour?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      data-tour={tour}
      aria-current={current ? "page" : undefined}
      onClick={onClick}
      className={`relative flex min-h-9 w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-2 py-1.5 text-left text-[13px] ${
        current
          ? "bg-selected font-semibold before:absolute before:inset-y-1 before:left-0 before:w-[3px] before:rounded-full before:bg-accent"
          : "hover:bg-hover"
      }`}
    >
      {children}
    </button>
  );
}
