// The run as a board (M6 slice 9): the lead agent's box, one group per role, a tile per agent.
// It fits the main area and scrolls: no pan, zoom or dragging. The logic is in board.ts.
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { Agent } from "./agents";
import {
  agentCount,
  countWords,
  groupTone,
  notInRun,
  orderGroups,
  requestLine,
  roleGroups,
  type TileLine,
  type Tone,
  tileLines,
  tileMeta,
  tileTasks,
  wirePath,
} from "./board";
import type { Proposal } from "./proposals";
import { type Group, type RunReport, STATUS, type TaskAttempt, type TaskState } from "./runs";
import { atBottom, Button, Code, LABEL, plural, StatusBadge } from "./ui";

// A dot always sits beside a word; it only repeats it.
const DOT: Record<Group, string> = {
  needs: "bg-needs-edge",
  working: "bg-working-edge",
  problem: "bg-problem-edge",
  done: "bg-done-ink",
  held: "border-2 border-held-edge",
  waiting: "bg-waiting-edge",
  stopped: "bg-stopped-edge",
};
const TONE_DOT: Record<Tone, Group> = {
  needs: "needs",
  working: "working",
  problem: "problem",
  quiet: "waiting",
};
const GROUP_BORDER: Record<Tone, string> = {
  needs: "border-needs-edge",
  problem: "border-[color-mix(in_oklch,var(--color-problem-edge)_70%,var(--color-line))]",
  working: "border-[color-mix(in_oklch,var(--color-working-edge)_60%,var(--color-line))]",
  quiet: "border-line",
};
const WIRE: Record<Tone, string> = {
  needs: "text-needs-edge",
  problem: "text-problem-edge",
  working: "text-working-edge",
  quiet: "text-line-strong",
};
const LINE: Record<TileLine["kind"], string> = {
  text: "text-ink",
  error: "text-problem-ink",
  you: "font-semibold text-needs-ink",
  note: "italic text-ink-muted",
};

function Dot({ group }: { group: Group }) {
  return <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${DOT[group]}`} />;
}

/** The time now, moving once a second only while something on the board works. */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  return ticking ? now : Date.now();
}

export function RunBoard({
  run,
  runId,
  live,
  proposal,
  agents,
  onOpenPlan,
  onOpenTask,
  controls,
}: {
  run: RunReport;
  runId: string;
  live: boolean;
  /** The plan this run came from (its id is the run's), if there is one. */
  proposal: Proposal | undefined;
  agents: Agent[] | undefined;
  onOpenPlan: (id: string) => void;
  onOpenTask: (task: string, review: boolean) => void;
  /** A task's own buttons, from the run page, with `extra` after them. */
  controls: (task: TaskState, extra: ReactNode) => ReactNode;
}) {
  const board = useRef<HTMLDivElement>(null);
  const lead = useRef<HTMLElement>(null);
  const [wires, setWires] = useState<(ReturnType<typeof wirePath> & { tone: Tone })[]>([]);
  // While focus is on the board, groups keep their places; they reorder once it leaves.
  const [held, setHeld] = useState<string[] | null>(null);
  const fresh = orderGroups(roleGroups(run.tasks));
  const byRole = new Map(fresh.map((g) => [g.role, g]));
  const roles = held
    ? [...held, ...fresh.map((g) => g.role).filter((r) => !held.includes(r))]
    : fresh.map((g) => g.role);
  const groups = roles.flatMap((role) => byRole.get(role) ?? []);
  const now = useNow(live && run.tasks.some((t) => STATUS[t.status].group === "working"));
  const out = agents ? notInRun(agents, run.tasks) : [];
  const leadId = useId();

  // The lines follow the boxes: redrawn when the board changes size or the run changes.
  useLayoutEffect(() => {
    const area = board.current;
    const from = lead.current;
    if (!area || !from) return;
    const draw = () => {
      const origin = area.getBoundingClientRect();
      const top = from.getBoundingClientRect();
      const boxes = [...area.querySelectorAll<HTMLElement>("[data-tone]")];
      setWires(
        boxes.map((box) => ({
          ...wirePath(top, box.getBoundingClientRect(), origin),
          tone: box.dataset.tone as Tone,
        })),
      );
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(area);
    return () => observer.disconnect();
  }, [run, roles.join()]);

  return (
    <div
      ref={board}
      onFocus={() => setHeld((h) => h ?? roles)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setHeld(null);
      }}
      // The dot grid is the board's own ground, edge to edge under the page header.
      className="board-ground relative -mx-6 mt-6 -mb-6 flex-1 px-6 pt-6 pb-22"
    >
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 size-full overflow-visible"
      >
        {wires.map((w, i) => (
          // The lines are drawn in the order of the groups, which never repeat.
          <g key={i} className={WIRE[w.tone]}>
            <path d={w.d} fill="none" stroke="currentColor" strokeWidth={1.5} />
            <circle
              cx={w.end.x}
              cy={w.end.y}
              r={3.5}
              fill="var(--color-canvas)"
              stroke="currentColor"
              strokeWidth={1.5}
            />
          </g>
        ))}
        {wires[0] && (
          <circle
            cx={wires[0].start.x}
            cy={wires[0].start.y}
            r={3.5}
            fill="var(--color-canvas)"
            stroke="var(--color-line-strong)"
            strokeWidth={1.5}
          />
        )}
      </svg>

      <section
        ref={lead}
        aria-labelledby={leadId}
        className="relative mx-auto mb-14 w-full max-w-[380px] rounded-lg border border-line-strong bg-surface"
      >
        <div className="flex items-center gap-2 rounded-t-[9px] border-b border-line bg-code-bg px-3 py-2">
          <Dot group={live ? "working" : "waiting"} />
          <span className={`${LABEL} font-semibold text-ink`}>Lead agent</span>
          <span className="grow" />
          <span className={LABEL}>
            {plural(run.tasks.length, "task", "tasks")} ·{" "}
            {plural(agentCount(run.tasks, run.attempts), "agent", "agents")}
          </span>
        </div>
        <div className="flex flex-col gap-2 p-3">
          <h2 id={leadId} className="text-body font-semibold wrap-anywhere">
            Plan <Code>{runId}</Code>
          </h2>
          <LeadSummary proposal={proposal} />
          {out.length > 0 && (
            <p className="text-meta text-ink-muted">
              Not in this run:{" "}
              {out.map((id, i) => (
                <span key={id}>
                  {i > 0 && ", "}
                  <code className="font-mono text-ink">{id}</code>
                </span>
              ))}
            </p>
          )}
          {proposal && (
            <div>
              <Button
                kind="ghost"
                small
                aria-label={`Open plan ${runId}`}
                onClick={() => onOpenPlan(runId)}
              >
                Open plan
              </Button>
            </div>
          )}
        </div>
      </section>

      <ul
        aria-label="Agents by role"
        className="relative mx-auto grid max-w-280 grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] items-start gap-x-4 gap-y-8"
      >
        {groups.map((group) => (
          <RoleBox
            key={group.role}
            role={group.role}
            tasks={group.tasks}
            attempts={run.attempts}
            live={live}
            now={now}
            onOpenTask={onOpenTask}
            controls={controls}
          />
        ))}
      </ul>
    </div>
  );
}

/** What was asked for, in one line: the request, the run a fix plan fixes, or a hand-written plan. */
function LeadSummary({ proposal }: { proposal: Proposal | undefined }) {
  if (!proposal) return null;
  if (proposal.fixes) {
    return (
      <p className="text-[13px] leading-[18px]">
        Fixes the reviews of run <Code>{proposal.fixes}</Code>.
      </p>
    );
  }
  const line = requestLine(proposal.request);
  if (!line && proposal.source !== "hand") return null;
  return (
    <p title={proposal.request || undefined} className="truncate text-[13px] leading-[18px]">
      {line || "Written by hand."}
    </p>
  );
}

function RoleBox({
  role,
  tasks,
  attempts,
  live,
  now,
  onOpenTask,
  controls,
}: {
  role: string;
  tasks: TaskState[];
  attempts: TaskAttempt[];
  live: boolean;
  now: number;
  onOpenTask: (task: string, review: boolean) => void;
  controls: (task: TaskState, extra: ReactNode) => ReactNode;
}) {
  const id = useId();
  const tone = groupTone(tasks);
  const { tiles, rows } = tileTasks(tasks);
  const counts = [countWords(tasks), tasks.length > 1 && plural(tasks.length, "task", "tasks")];
  return (
    <li
      aria-labelledby={id}
      data-tone={tone}
      className={`min-w-0 rounded-lg border bg-panel px-2 pb-2 ${GROUP_BORDER[tone]}`}
    >
      <div className="flex min-h-8 items-center gap-2 px-1 py-2">
        <Dot group={TONE_DOT[tone]} />
        <h2 id={id} className={`${LABEL} font-semibold text-ink`}>
          {role}
        </h2>
        <span className={`${LABEL} min-w-0`}>· {counts.filter(Boolean).join(" · ")}</span>
      </div>
      <div className="flex flex-col gap-2">
        {tiles.map((state) => (
          <Tile
            key={state.task.id}
            state={state}
            attempts={attempts.filter((a) => a.task_id === state.task.id)}
            live={live}
            now={now}
            onOpenTask={onOpenTask}
            controls={controls}
          />
        ))}
        {rows.length > 0 && (
          <ul>
            {rows.map((state) => (
              <li key={state.task.id} className="border-t border-dashed border-line first:border-t-0">
                <button
                  type="button"
                  aria-label={`Open task ${state.task.id}`}
                  onClick={() => onOpenTask(state.task.id, false)}
                  className="flex w-full min-w-0 items-center gap-2 rounded-sm px-2 py-1.5 text-left text-meta hover:bg-hover"
                >
                  <Dot group={STATUS[state.status].group} />
                  <code className="font-mono text-ink">{state.task.id}</code>
                  <span className="min-w-0 flex-1 truncate text-ink-muted" title={state.task.title}>
                    {state.task.title}
                    {state.task.dependencies.length > 0 &&
                      ` · after ${state.task.dependencies.join(", ")}`}
                  </span>
                  <StatusBadge small {...STATUS[state.status]} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

const TILE: Partial<Record<Group, { border: string; strip: string }>> = {
  needs: { border: "border-needs-edge", strip: "border-needs-edge bg-needs-soft text-needs-ink" },
  problem: { border: "border-problem-edge", strip: "border-line bg-problem-soft text-problem-ink" },
  working: {
    border: "border-[color-mix(in_oklch,var(--color-working-edge)_70%,var(--color-line))]",
    strip: "border-line bg-code-bg",
  },
};
const PLAIN_TILE = { border: "border-line", strip: "border-line bg-code-bg" };

/** The AI view: one agent on its task, its output and the task's own buttons. */
function Tile({
  state,
  attempts,
  live,
  now,
  onOpenTask,
  controls,
}: {
  state: TaskState;
  attempts: TaskAttempt[];
  live: boolean;
  now: number;
  onOpenTask: (task: string, review: boolean) => void;
  controls: (task: TaskState, extra: ReactNode) => ReactNode;
}) {
  const id = useId();
  const { task } = state;
  const group = STATUS[state.status].group;
  const look = TILE[group] ?? PLAIN_TILE;
  const latest = attempts.find((a) => a.number === state.attempt_number);
  // The agent on it now, else the one that last worked on it, else its role.
  const agent = state.worker_id ?? latest?.worker_id ?? task.role;
  const review = group === "needs" && live;
  return (
    <article
      aria-labelledby={id}
      className={`flex min-w-0 flex-col rounded-md border bg-surface ${look.border}`}
    >
      <div
        className={`flex min-w-0 items-center gap-2 rounded-t-[5px] border-b py-1.5 pr-2 pl-3 ${look.strip}`}
      >
        <h3 id={id} className="shrink-0 font-mono text-[12px] leading-4 font-semibold">
          {agent}
        </h3>
        <span className="grow" />
        <StatusBadge {...STATUS[state.status]} />
      </div>
      <p
        title={task.title}
        className="truncate border-b border-line px-3 py-1 text-meta text-ink-muted"
      >
        <code className="font-mono text-ink">{task.id}</code> · {task.title}
      </p>
      <Output
        lines={tileLines(state, attempts, live)}
        name={`Output of agent ${agent} on task ${task.id}`}
        working={group === "working" && live}
        short={group === "done" || group === "stopped"}
      />
      <div className="flex min-h-10 flex-wrap items-center gap-2 border-t border-line py-1.5 pr-2 pl-3">
        <span className="min-w-0 flex-1 font-mono text-[11px] leading-4 tracking-[0.04em] text-ink-muted">
          {tileMeta(state, latest, live, now)}
        </span>
        {controls(
          state,
          review ? (
            <Button
              kind="primary"
              small
              aria-label={`Review diff for task ${task.id}`}
              onClick={() => onOpenTask(task.id, true)}
            >
              Review diff
            </Button>
          ) : (
            <Button
              kind="ghost"
              small
              aria-label={`Open task ${task.id}`}
              onClick={() => onOpenTask(task.id, false)}
            >
              Open task
            </Button>
          ),
        )}
      </div>
    </article>
  );
}

/** The tile's output, plain text only, pinned to the newest line until the person scrolls up;
 * scrolling back down (or End) follows again. A screen reader is not flooded: aria-live is off. */
function Output({
  lines,
  name,
  working,
  short,
}: {
  lines: TileLine[];
  name: string;
  working: boolean;
  short: boolean;
}) {
  const box = useRef<HTMLPreElement>(null);
  const pinned = useRef(true);
  const text = lines.map((l) => l.text).join("\n");
  useLayoutEffect(() => {
    const el = box.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [text]);
  return (
    <pre
      ref={box}
      tabIndex={0}
      role="log"
      aria-live="off"
      aria-label={name}
      onScroll={(e) => {
        pinned.current = atBottom(e.currentTarget);
      }}
      className={`overflow-auto bg-code-bg px-3 py-2 font-mono text-[11.5px] leading-[17px] whitespace-pre-wrap wrap-anywhere text-ink ${short ? "max-h-[72px]" : "h-[152px]"}`}
    >
      {lines.map((line, i) => (
        // The lines are rebuilt from the report each time, in a fixed order.
        <span key={i} className={`block ${LINE[line.kind]}`}>
          {line.text}
        </span>
      ))}
      {/* The end of a working tile's output; static, it does not blink. */}
      {working && (
        <span aria-hidden="true" className="inline-block h-[13px] w-[7px] bg-accent align-[-2px]" />
      )}
    </pre>
  );
}
