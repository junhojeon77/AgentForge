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

/** The controls a task offers. They mirror the scheduler's rules in orchestration.py. */
export function taskActions(status: TaskStatus, live: boolean): TaskAction[] {
  // The API reopens a finished run for a retry, so it needs no active run.
  if (status === "FAILED" || status === "CANCELLED") return ["retry"];
  if (!live || status === "COMPLETED" || status === "BLOCKED") return [];
  if (status === "AWAITING_APPROVAL") return ["approve", "reject", "cancel"];
  if (status === "PAUSED") return ["resume", "cancel"];
  return ["pause", "cancel"];
}

export function diffTone(line: string): "added" | "removed" | "hunk" | null {
  if (line.startsWith("+++") || line.startsWith("---")) return null;
  if (line.startsWith("+")) return "added";
  if (line.startsWith("-")) return "removed";
  return line.startsWith("@@") ? "hunk" : null;
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
