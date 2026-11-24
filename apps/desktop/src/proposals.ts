import type { Agent } from "./agents";
import { ApiError, type Client, jsonBody } from "./api/client";
import { plural } from "./ui";

// The parts of the server's Proposal (domain.py) that the proposal page shows.
export interface PlanTask {
  id: string;
  run_id: string;
  title: string;
  role: string;
  description: string;
  objective: string;
  dependencies: string[];
  acceptance_criteria: string[];
}

export interface PlanRound {
  revision: number;
  source: "check" | "critique";
  issues: string[];
}

export interface Proposal {
  id: string;
  plan: { id: string; tasks: PlanTask[] };
  source: "lead" | "hand";
  rounds: PlanRound[];
  status: "pending" | "approved" | "rejected";
  reason: string;
  agents: Agent[]; // new agents the lead wants; made only when the plan is approved
}

/** One task's rights as the approve form holds them. */
export interface Rights {
  edit: boolean;
  runChecks: boolean; // the API's "check" operation: the worker runs the checks itself
  checks: string[];
  maxAttempts: number;
  timeout: string; // seconds as typed; empty means no limit
}

// The API's TaskRights default: nothing granted, one attempt.
export const NO_RIGHTS: Rights = {
  edit: false,
  runChecks: false,
  checks: [],
  maxAttempts: 1,
  timeout: "",
};

/** The body of `POST /proposals/{id}/approve`, with the person's versions of any new agents. */
export function approvalBody(
  repository: string,
  rights: Record<string, Rights>,
  agents: Agent[] = [],
) {
  const granted = Object.entries(rights).map(([task, r]) => {
    const operations = r.edit ? (r.runChecks ? ["edit", "check"] : ["edit"]) : [];
    const body: Record<string, unknown> = {
      allowed_operations: operations,
      checks: r.checks,
      max_attempts: r.maxAttempts,
    };
    if (r.timeout.trim()) {
      const seconds = Number(r.timeout);
      // An unparsed timeout would become null, which the API reads as "no limit".
      if (!(seconds > 0) || !Number.isFinite(seconds)) {
        throw new Error(`task ${task}: the timeout must be a number of seconds above 0`);
      }
      body.timeout_seconds = seconds;
    }
    return [task, body] as const;
  });
  return { repository, rights: Object.fromEntries(granted), agents };
}

/** What the approve form will grant, in words; null while no task may change files. */
export function rightsSummary(rights: Record<string, Rights>): string | null {
  const all = Object.values(rights);
  const editing = all.filter((r) => r.edit).length;
  if (editing === 0) return null;
  const checks = all.reduce((sum, r) => sum + r.checks.length, 0);
  const attempts = all.reduce((sum, r) => sum + r.maxAttempts, 0);
  return (
    `${editing} of ${plural(all.length, "task", "tasks")} may change files · ` +
    `${plural(checks, "check runs", "checks run")} before work is accepted · ` +
    `up to ${plural(attempts, "billed attempt", "billed attempts")}.`
  );
}

/** A round's heading; drafts count from 1 for people, while the server's first is revision 0. */
export function draftTitle(round: PlanRound): string {
  const by = round.source === "check" ? "the rule check" : "the lead agent's review";
  return `Draft ${round.revision + 1}, found by ${by}:`;
}

export function fixesHint(rounds: PlanRound[]): string {
  const issues = rounds.reduce((sum, r) => sum + r.issues.length, 0);
  return `${plural(rounds.length, "draft", "drafts")}, ${plural(issues, "issue", "issues")} fixed`;
}

export function planningSince(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  return minutes < 1
    ? "Started less than a minute ago."
    : `Started ${plural(minutes, "minute", "minutes")} ago.`;
}

/** A hand-written plan; the server checks it against the rules. */
export function parsePlan(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`not valid JSON: ${(error as Error).message}`);
  }
}

export function newRunId(now: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  const day = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}`;
  return `req-${day}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
}

/** A one-task starting point for a hand-written plan. */
export function planTemplate(roles: string[], runId: string): string {
  const task = {
    id: "first-task",
    run_id: runId, // every task must name its plan's id
    title: "first-task",
    role: roles[0] ?? "backend",
    objective: "What this task must do",
    dependencies: [],
    acceptance_criteria: [],
  };
  return JSON.stringify({ id: runId, tasks: [task] }, null, 2);
}

export function proposalPath(id: string, action?: "approve" | "reject"): string {
  return `/proposals/${encodeURIComponent(id)}${action ? `/${action}` : ""}`;
}

type Requester = Pick<Client, "request">;

export function planRequest(
  client: Requester,
  body: { request: string; run_id: string; workspace: string; max_revisions: number },
): Promise<Proposal> {
  return client.request("/proposals/from-request", jsonBody(body));
}

export async function proposePlan(client: Requester, text: string): Promise<Proposal> {
  return client.request("/proposals", jsonBody(parsePlan(text)));
}

export async function approveProposal(
  client: Requester,
  id: string,
  repository: string,
  rights: Record<string, Rights>,
  agents: Agent[] = [],
): Promise<Proposal> {
  const body = approvalBody(repository, rights, agents);
  return client.request(proposalPath(id, "approve"), jsonBody(body));
}

export function rejectProposal(client: Requester, id: string, reason: string): Promise<Proposal> {
  return client.request(proposalPath(id, "reject"), jsonBody({ reason }));
}

/** The lead agent's rounds carried by a refused plan (the from-request 422), else none. */
export function roundsOf(error: unknown): PlanRound[] {
  const body = error instanceof ApiError ? error.body : undefined;
  const rounds = (body as { rounds?: unknown } | undefined)?.rounds;
  return Array.isArray(rounds) ? rounds : [];
}
