// The run board's logic (M6 slice 9): groups by role, which tasks get a tile, the counts in words,
// a tile's time and its text until the server streams live output (slice 10).
import { type Group, STATUS, stripAnsi, type TaskAttempt, type TaskState } from "./runs";
import { plural } from "./ui";

export interface RoleGroup {
  role: string;
  tasks: TaskState[];
}

/** A group's colour: its border, its line from the lead agent and its dot. */
export type Tone = "needs" | "problem" | "working" | "quiet";

const groupOf = (task: TaskState): Group => STATUS[task.status].group;
const any = (tasks: TaskState[], group: Group) => tasks.some((t) => groupOf(t) === group);

/** One group per role, in the order the plan first names each role. */
export function roleGroups(tasks: TaskState[]): RoleGroup[] {
  const groups = new Map<string, TaskState[]>();
  for (const task of tasks) {
    const role = task.task.role;
    groups.set(role, [...(groups.get(role) ?? []), task]);
  }
  return [...groups].map(([role, tasks]) => ({ role, tasks }));
}

export function groupTone(tasks: TaskState[]): Tone {
  if (any(tasks, "needs")) return "needs";
  if (any(tasks, "problem")) return "problem";
  return any(tasks, "working") ? "working" : "quiet";
}

/** Waiting for you first, then running, then the rest in plan order (the sort is stable). */
export function orderGroups(groups: RoleGroup[]): RoleGroup[] {
  const rank = (g: RoleGroup) => (any(g.tasks, "needs") ? 0 : any(g.tasks, "working") ? 1 : 2);
  return [...groups].sort((a, b) => rank(a) - rank(b));
}

const SHOWN: Group[] = ["needs", "working", "problem"];

/** A tile for every task at work, waiting for you or in trouble; with none, the next task to
 * start, or else the last one. Two agents sharing a role get a tile each. */
export function tileTasks(tasks: TaskState[]): { tiles: TaskState[]; rows: TaskState[] } {
  let tiles = tasks.filter((t) => SHOWN.includes(groupOf(t)));
  if (tiles.length === 0) {
    const next = tasks.find((t) => groupOf(t) === "waiting" || groupOf(t) === "held");
    tiles = [next ?? tasks[tasks.length - 1]].filter(Boolean);
  }
  return { tiles, rows: tasks.filter((t) => !tiles.includes(t)) };
}

const COUNTS: [Group, (n: number) => string][] = [
  ["working", (n) => `${n} working`],
  ["needs", (n) => `${n} ${n === 1 ? "waits" : "wait"} for you`],
  ["problem", (n) => `${n} with a problem`],
  ["held", (n) => `${n} paused`],
  ["done", (n) => `${n} done`],
  ["waiting", (n) => `${n} waiting`],
  ["stopped", (n) => `${n} cancelled`],
];

/** "1 working · 1 waits for you · 1 done · 2 waiting": the board bar's and the groups' counts. */
export function countWords(tasks: TaskState[]): string {
  return COUNTS.map(([group, words]) => [tasks.filter((t) => groupOf(t) === group).length, words] as const)
    .filter(([n]) => n > 0)
    .map(([n, words]) => words(n))
    .join(" · ");
}

/** The agents a run uses: each that worked in a role, and one for a role not started yet. */
export function agentCount(
  tasks: TaskState[],
  attempts: Pick<TaskAttempt, "task_id" | "worker_id">[],
): number {
  return roleGroups(tasks).reduce((sum, { tasks: mine }) => {
    const ids = new Set(mine.map((t) => t.task.id));
    const workers = new Set(attempts.filter((a) => ids.has(a.task_id)).map((a) => a.worker_id));
    return sum + Math.max(1, workers.size);
  }, 0);
}

/** The ids of the team's agents whose role no task in the run has. */
export function notInRun(agents: { id: string; role: string }[], tasks: TaskState[]): string[] {
  const roles = new Set(tasks.map((t) => t.task.role));
  return agents.filter((a) => !roles.has(a.role)).map((a) => a.id);
}

/** From the attempt's start to when it last stopped working, or to now while it works on a live
 * run. None for attempts saved before times were kept, or left working by a run that stopped. */
export function attemptMs(
  attempt: Pick<TaskAttempt, "started_at" | "stopped_at">,
  live: boolean,
  now: number,
): number | null {
  if (!attempt.started_at) return null;
  const end = attempt.stopped_at ? Date.parse(attempt.stopped_at) : live ? now : null;
  return end === null ? null : end - Date.parse(attempt.started_at);
}

const two = (n: number) => String(n).padStart(2, "0");

export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${two(s % 60)}s`;
  return `${Math.floor(s / 3600)}h ${two(Math.floor(s / 60) % 60)}m`;
}

/** The tile's foot line: "Attempt 1 of 3 · 3m 12s · live", or what a task not yet started may do. */
export function tileMeta(
  state: TaskState,
  attempt: TaskAttempt | undefined,
  live: boolean,
  now: number,
): string {
  const { task } = state;
  if (!state.attempt_number || !attempt) {
    const may = task.allowed_operations.includes("edit") ? "May edit" : "Read-only";
    return `${may} · ${plural(task.max_attempts, "attempt", "attempts")} allowed`;
  }
  const parts = [`Attempt ${state.attempt_number} of ${task.max_attempts}`];
  const ms = attemptMs(attempt, live, now);
  if (ms !== null) parts.push(elapsed(ms));
  if (ms !== null && !attempt.stopped_at) parts.push("live");
  return parts.join(" · ");
}

/** A line in a tile's output: the agent's own words, a failure, what waits for you, or an app note. */
export interface TileLine {
  kind: "text" | "error" | "you" | "note";
  text: string;
}

const listed = (ids: string[]) =>
  ids.length === 1 ? ids[0] : `${ids.slice(0, -1).join(", ")} and ${ids[ids.length - 1]}`;

/** What a tile shows until the server streams live output (slice 10): the last report and the
 * state in words. Agent text stays plain, colour codes removed. */
export function tileLines(state: TaskState, attempts: TaskAttempt[], live: boolean): TileLine[] {
  const latest = attempts.find((a) => a.number === state.attempt_number);
  const report = [...attempts].sort((a, b) => b.number - a.number).find((a) => a.result?.message)
    ?.result?.message;
  const said = report ? [{ kind: "text" as const, text: stripAnsi(report) }] : [];
  const note = (text: string): TileLine[] => [{ kind: "note", text }];
  switch (groupOf(state)) {
    case "working":
      return note(
        live ? "Live output appears here when the server sends it." : "Not working: the run has stopped.",
      );
    case "needs":
      return [...said, { kind: "you", text: "Waiting for your review." }];
    case "problem": {
      const why = latest?.message || state.message;
      return why ? [{ kind: "error", text: stripAnsi(why) }] : note(STATUS[state.status].label + ".");
    }
    case "held":
      return note("Paused.");
    case "stopped":
      return note("Cancelled.");
    case "done":
      return said.length ? said : note("Done.");
    default: {
      const after = state.task.dependencies;
      return note(
        after.length
          ? `Resting. Starts when ${listed(after)} ${after.length === 1 ? "is" : "are"} done.`
          : "Resting. Starts when an agent is free.",
      );
    }
  }
}

/** The request's first line with text: the lead agent's box says what was asked for. */
export function requestLine(request: string): string {
  return request.split("\n").find((line) => line.trim())?.trim() ?? "";
}

type Box = { left: number; top: number; width: number; height: number };

/** The line from the bottom middle of the lead agent's box to the top middle of a group, in the
 * board's own coordinates. */
export function wirePath(lead: Box, group: Box, board: { left: number; top: number }) {
  const start = { x: lead.left + lead.width / 2 - board.left, y: lead.top + lead.height - board.top };
  const end = { x: group.left + group.width / 2 - board.left, y: group.top - board.top };
  const mid = (start.y + end.y) / 2;
  return { d: `M${start.x} ${start.y} C ${start.x} ${mid}, ${end.x} ${mid}, ${end.x} ${end.y}`, start, end };
}
