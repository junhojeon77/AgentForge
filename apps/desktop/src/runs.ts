import { type Client, jsonBody } from "./api/client";
import type { Transition } from "./api/events";

// The parts of the server's RunReport (domain.py) that the run page shows.
export type TaskStatus =
  | "PENDING"
  | "READY"
  | "ASSIGNED"
  | "RUNNING"
  | "VALIDATING"
  | "AWAITING_APPROVAL"
  | "COMPLETED"
  | "PAUSED"
  | "BLOCKED"
  | "FAILED"
  | "CANCELLED";

export interface TaskState {
  task: {
    id: string;
    title: string;
    role: string;
    dependencies: string[];
    max_attempts: number;
    allowed_operations: string[];
    execution_constraints: string[];
  };
  status: TaskStatus;
  failure_reason: string | null;
  message: string;
  attempt_number: number;
}

export interface TaskAttempt {
  task_id: string;
  worker_id: string;
  number: number;
  status: TaskStatus;
  failure_reason: string | null;
  message: string;
  result: { message: string; diff: string } | null;
}

export interface RunReport {
  run_id: string | null;
  tasks: TaskState[];
  attempts: TaskAttempt[];
  transitions: Transition[];
}

export type TaskAction = "pause" | "resume" | "cancel" | "approve" | "reject" | "retry";
export type RunAction = "pause" | "resume" | "cancel" | "recover";

/** How a status is shown: only Needs you, Working and Problem get a colour. */
export type Group = "needs" | "working" | "problem" | "waiting" | "held" | "done" | "stopped";

export const STATUS: Record<TaskStatus, { label: string; group: Group }> = {
  PENDING: { label: "Pending", group: "waiting" },
  READY: { label: "Ready", group: "waiting" },
  ASSIGNED: { label: "Assigned", group: "working" },
  RUNNING: { label: "Running", group: "working" },
  VALIDATING: { label: "Validating", group: "working" },
  AWAITING_APPROVAL: { label: "Awaiting approval", group: "needs" },
  COMPLETED: { label: "Completed", group: "done" },
  PAUSED: { label: "Paused", group: "held" },
  BLOCKED: { label: "Blocked", group: "problem" },
  FAILED: { label: "Failed", group: "problem" },
  CANCELLED: { label: "Cancelled", group: "stopped" },
};

const FAILURES: Record<string, string> = {
  worker_failure: "The agent reported a failure",
  executor_exception: "The agent could not run",
  worker_timeout: "The agent ran out of time",
  invalid_result: "The agent's answer was not valid",
  validation_rejected: "A check failed",
  validator_exception: "A check could not run, not retried",
  review_rejected: "You rejected the diff",
};

/** The plain label of a failure code, or null for a code the app does not know. */
export function failureLabel(code: string): string | null {
  return Object.hasOwn(FAILURES, code) ? FAILURES[code] : null;
}

// The server's cap on attempts per task (TaskSpec.max_attempts, le=5).
export const MAX_ATTEMPTS = 5;

/** The controls a task offers. They mirror the scheduler's rules in orchestration.py. */
export function taskActions(status: TaskStatus, live: boolean, attempt: number): TaskAction[] {
  // The API reopens a finished run for a retry, so it needs no active run; _retry_limit
  // refuses a sixth attempt.
  if (status === "FAILED" || status === "CANCELLED") {
    return attempt < MAX_ATTEMPTS ? ["retry"] : [];
  }
  if (!live || status === "COMPLETED" || status === "BLOCKED") return [];
  if (status === "AWAITING_APPROVAL") return ["approve", "reject", "cancel"];
  if (status === "PAUSED") return ["resume", "cancel"];
  return ["pause", "cancel"];
}

export function retriesLeft(attempt: number): string {
  const left = MAX_ATTEMPTS - attempt;
  if (left <= 0) return `All ${MAX_ATTEMPTS} attempts used`;
  return `${left} more ${left === 1 ? "attempt" : "attempts"} allowed (${MAX_ATTEMPTS} at most)`;
}

/** The run header's summary, e.g. "5 tasks · 1 completed · 2 waiting for you". */
export function runSummary(tasks: { status: TaskStatus }[]): string {
  const parts = [`${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`];
  const completed = tasks.filter((t) => t.status === "COMPLETED").length;
  const waiting = tasks.filter((t) => t.status === "AWAITING_APPROVAL").length;
  if (completed) parts.push(`${completed} completed`);
  if (waiting) parts.push(`${waiting} waiting for you`);
  return parts.join(" · ");
}

/** The latest attempt opens while it runs or waits for review; earlier ones while it runs, so
 * a reject reason stays readable. */
export function attemptStartsOpen(
  number: number,
  task: { status: TaskStatus; attempt_number: number },
): boolean {
  const working = STATUS[task.status].group === "working";
  if (number !== task.attempt_number) return working;
  return working || task.status === "AWAITING_APPROVAL";
}

/** The attempt whose review band is on screen, or null. A refused approve or reject shows in the
 * band only while it is there; the server usually refuses because the task left review, and
 * then the reload removes the band. */
export function reviewAttempt(
  task: { status: TaskStatus; attempt_number: number },
  live: boolean,
  attempts: readonly { number: number }[],
): number | null {
  const waits = taskActions(task.status, live, task.attempt_number).includes("approve");
  return waits && attempts.some((a) => a.number === task.attempt_number)
    ? task.attempt_number
    : null;
}

export type DiffTone = "file" | "hunk" | "added" | "removed";

/** Each line of a git diff with its tone, decided by where it is: outside a hunk every line is a
 * file header; inside one, a removed "-- note" reads "--- note" and is still a removed line. */
export function diffLines(diff: string): { text: string; tone: DiffTone | null }[] {
  let inHunk = false;
  return diff.split("\n").map((text) => {
    // Hunk lines start with " ", "+", "-" or "\", so these can only begin a file or a hunk.
    if (text.startsWith("diff --git ")) inHunk = false;
    else if (text.startsWith("@@")) inHunk = true;
    if (!inHunk) return { text, tone: "file" };
    if (text.startsWith("@@")) return { text, tone: "hunk" };
    if (text.startsWith("+")) return { text, tone: "added" };
    return { text, tone: text.startsWith("-") ? "removed" : null };
  });
}

export function diffStats(diff: string): { files: number; added: number; removed: number } {
  const stats = { files: 0, added: 0, removed: 0 };
  for (const { text, tone } of diffLines(diff)) {
    if (tone === "added") stats.added++;
    else if (tone === "removed") stats.removed++;
    else if (text.startsWith("diff --git ")) stats.files++;
  }
  return stats;
}

// CSI sequences such as colour codes: ESC [ parameters intermediates final.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");

/** Agent and check output is shown as text: colour codes are removed, never interpreted. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}

/** POST a run control, or a task's when `task` is given; a refusal comes back as an ApiError. */
export async function sendControl(
  client: Pick<Client, "send">,
  runId: string,
  action: TaskAction | RunAction,
  task?: string,
  reason?: string,
): Promise<void> {
  let path = `/runs/${encodeURIComponent(runId)}`;
  if (task !== undefined) path += `/tasks/${encodeURIComponent(task)}`;
  const init = reason === undefined ? { method: "POST" } : jsonBody({ reason });
  await client.send(`${path}/${action}`, init);
}
