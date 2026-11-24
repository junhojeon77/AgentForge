import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { AgentFields, AgentSummary } from "./AgentsPage";
import type { Agent } from "./agents";
import { ApiError, type Client } from "./api/client";
import { Icon } from "./Icon";
import {
  approveProposal,
  draftTitle,
  fixesHint,
  NO_RIGHTS,
  newRunId,
  type PlanRound,
  type PlanTask,
  type Proposal,
  planningSince,
  planRequest,
  planTemplate,
  proposePlan,
  type Rights,
  rejectProposal,
  rightsSummary,
  roundsOf,
} from "./proposals";
import {
  Alert,
  type BadgeGroup,
  Button,
  Confirm,
  FIELD,
  Field,
  Fold,
  ForDevelopers,
  LEDE,
  MoreOptions,
  PAGE_TITLE,
  plural,
  problem,
  ReasonForm,
  StatusBadge,
} from "./ui";

export const STATUS = {
  pending: "Waiting for your OK",
  approved: "Approved",
  rejected: "Rejected",
} as const;

// A plan waiting for your OK needs you (amber); approved is done, rejected is stopped.
export const PLAN_GROUP: Record<Proposal["status"], BadgeGroup> = {
  pending: "needs",
  approved: "done",
  rejected: "stopped",
};

const SECTION = "text-section font-semibold";
const MONO_FIELD = `font-mono text-control ${FIELD}`;
const CHECK =
  "inline-flex cursor-pointer items-center gap-2 text-[13px] leading-5 has-disabled:cursor-not-allowed has-disabled:text-ink-muted";
// The rights table's columns; they stack when the table itself is narrow.
const ROW =
  "grid grid-cols-[minmax(0,1fr)_150px_minmax(0,1.1fr)] items-start gap-x-4 gap-y-2 @max-[600px]:grid-cols-1";

/** Each draft the lead agent fixed and its issues, as plain text. */
function Drafts({ rounds }: { rounds: PlanRound[] }) {
  return (
    <ol className="flex flex-col gap-2">
      {rounds.map((round, i) => (
        // Rounds never move or change, so their position is a stable key.
        <li key={i}>
          <p className="font-semibold">{draftTitle(round)}</p>
          <ul className="mt-0.5 list-disc pl-5">
            {round.issues.map((issue, j) => (
              <li key={j} className="whitespace-pre-wrap wrap-anywhere">
                {issue}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

/** Ids in code, joined by commas. */
function Ids({ ids }: { ids: string[] }) {
  return ids.map((id, i) => (
    <span key={id}>
      {i > 0 && ", "}
      <code className="font-mono">{id}</code>
    </span>
  ));
}

function TaskCard({ task, n }: { task: PlanTask; n: number }) {
  return (
    <li className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-2 gap-y-0.5 rounded-lg border border-line bg-surface px-4 py-3">
      <span aria-hidden="true" className="row-span-2 text-section font-semibold text-ink-muted tabular-nums">
        {n}
      </span>
      <h3 className="text-section font-semibold wrap-anywhere">{task.title}</h3>
      <p className="text-meta text-ink-muted wrap-anywhere">
        <code className="font-mono">{task.id}</code> · {task.role}
        {task.dependencies.length > 0 && (
          <>
            {" "}
            · after <Ids ids={task.dependencies} />
          </>
        )}
      </p>
      <div className="col-start-2 mt-2 grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-x-6 gap-y-2 @max-[600px]:grid-cols-1">
        <div>
          {task.objective && <p className="whitespace-pre-wrap wrap-anywhere">{task.objective}</p>}
          {task.description && (
            <p className="mt-1 text-[13px] leading-[18px] whitespace-pre-wrap text-ink-muted wrap-anywhere">
              {task.description}
            </p>
          )}
        </div>
        {task.acceptance_criteria.length > 0 && (
          <div>
            <h4 className="mb-0.5 text-meta font-semibold text-ink-muted">Done when</h4>
            <ul className="list-disc pl-[18px] text-[13px] leading-[18px]">
              {task.acceptance_criteria.map((c, i) => (
                <li key={i} className="whitespace-pre-wrap wrap-anywhere">
                  {c}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </li>
  );
}

/** One proposal: its plan, how it was made and, while pending, the approve and reject forms. */
export function ProposalPage({
  client,
  proposal,
  folder,
  activeRun,
  onOpenRun,
}: {
  client: Client;
  proposal: Proposal;
  folder: string;
  activeRun: string | null;
  onOpenRun: (id: string) => void;
}) {
  const { id, status, rounds } = proposal;
  const tasks = proposal.plan.tasks;
  return (
    <section aria-labelledby="proposal-title" className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 id="proposal-title" className={PAGE_TITLE}>
            Plan <code className="font-mono text-[18px]">{id}</code>
          </h1>
          <StatusBadge group={PLAN_GROUP[status]} label={STATUS[status]} />
        </div>
        <p className="text-meta text-ink-muted">
          Written {proposal.source === "lead" ? "by the lead agent" : "by hand"} ·{" "}
          {plural(tasks.length, "task", "tasks")}
          {proposal.fixes && (
            <>
              {" "}
              · Fixes the reviews of run <code className="font-mono">{proposal.fixes}</code>
            </>
          )}
        </p>
      </header>
      {status === "approved" && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="flex items-center gap-2">
            <Icon name="done" className="size-4 shrink-0 text-done-ink" />
            <span className="wrap-anywhere">
              Approved: it runs as run <code className="font-mono">{id}</code>.
            </span>
          </p>
          <Button aria-label={`Open run ${id}`} onClick={() => onOpenRun(id)}>
            Open run
          </Button>
        </div>
      )}
      {status === "rejected" && (
        <div className="flex max-w-form flex-col gap-1">
          <p className="text-control font-semibold">Your reason for rejecting it</p>
          <p className="rounded-md border border-line bg-code-bg px-3 py-2 whitespace-pre-wrap wrap-anywhere">
            {proposal.reason}
          </p>
        </div>
      )}
      {rounds.length > 0 && (
        <div className="max-w-form">
          {/* History, not a setting, so it starts folded in both views. */}
          <Fold
            label="What the lead agent fixed along the way"
            hint={fixesHint(rounds)}
            startOpen={false}
          >
            <Drafts rounds={rounds} />
          </Fold>
        </div>
      )}
      {status !== "pending" && proposal.agents.length > 0 && (
        <section aria-labelledby="plan-agents-title" className="flex flex-col gap-3">
          <h2 id="plan-agents-title" className={SECTION}>
            {status === "approved" ? "Agents this plan added to your team" : "New agents it asked for"}
          </h2>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
            {proposal.agents.map((agent) => (
              <li key={agent.id} className="rounded-lg border border-line bg-surface px-4 py-3">
                <AgentSummary agent={agent} full />
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="tasks-title" className="flex flex-col gap-3">
        <h2 id="tasks-title" className={SECTION}>
          Tasks
        </h2>
        <ol className="@container flex flex-col gap-3">
          {tasks.map((task, i) => (
            <TaskCard key={task.id} task={task} n={i + 1} />
          ))}
        </ol>
      </section>
      {status === "pending" && (
        <Decide
          client={client}
          proposal={proposal}
          folder={folder}
          activeRun={activeRun}
          onStarted={onOpenRun}
        />
      )}
    </section>
  );
}

function Decide({
  client,
  proposal,
  folder,
  activeRun,
  onStarted,
}: {
  client: Client;
  proposal: Proposal;
  folder: string;
  activeRun: string | null;
  onStarted: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const checks = useQuery({
    queryKey: ["checks"],
    queryFn: () => client.request<{ checks: Record<string, string[]> }>("/checks"),
    staleTime: Infinity,
    retry: false,
  });
  const tasks = proposal.plan.tasks;
  const [repository, setRepository] = useState(folder);
  const [agents, setAgents] = useState<Agent[]>(proposal.agents);
  const [rights, setRights] = useState<Record<string, Rights>>(() =>
    Object.fromEntries(tasks.map((t) => [t.id, NO_RIGHTS])),
  );
  const reload = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["runs"] }),
      queryClient.invalidateQueries({ queryKey: ["proposals"] }),
    ]);
  const approve = useMutation({
    mutationFn: () => approveProposal(client, proposal.id, repository.trim(), rights, agents),
    onSuccess: async () => {
      await reload();
      onStarted(proposal.id);
    },
  });
  const reject = useMutation({
    mutationFn: (reason: string) => rejectProposal(client, proposal.id, reason),
    onSettled: reload,
  });
  const busy = approve.isPending || reject.isPending;
  const set = (task: string, change: Partial<Rights>) =>
    setRights((all) => ({ ...all, [task]: { ...all[task], ...change } }));
  const allowAll = () =>
    setRights((all) =>
      Object.fromEntries(Object.entries(all).map(([task, r]) => [task, { ...r, edit: true }])),
    );
  const summary = rightsSummary(rights);
  const refused = approve.error;
  // The server checks for an active run first, so a 409 while one runs is that refusal.
  const whatToDo =
    refused instanceof ApiError && refused.status === 409 && activeRun
      ? " Wait for it to finish, or cancel it, then approve again."
      : "";

  return (
    <fieldset disabled={busy} className="flex min-w-0 flex-col gap-6">
      <form
        aria-labelledby="approve-title"
        className="flex flex-col gap-4 border-t border-line pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          approve.mutate();
        }}
      >
        <div className="flex flex-col gap-1">
          <h2 id="approve-title" className={SECTION}>
            Approve and start
          </h2>
          <p className={LEDE}>
            A task left as it is can only read your files. Tick what each task may do. After each
            task you let edit, the reviewer checks its change.
          </p>
        </div>
        <div className="max-w-form">
          <Field
            label="Project folder"
            hint="The Git repository the team works in. It starts as the folder you asked about."
          >
            {(id, hint) => (
              <input
                id={id}
                aria-describedby={hint}
                required
                spellCheck={false}
                value={repository}
                onChange={(e) => setRepository(e.target.value)}
                className={`w-full ${MONO_FIELD}`}
              />
            )}
          </Field>
        </div>
        {checks.error && <Alert title="Could not read the checks:" text={problem(checks.error)} />}
        <TaskRights
          tasks={tasks}
          rights={rights}
          checks={checks.data?.checks ?? {}}
          onChange={set}
          onAllowAll={allowAll}
        />
        {agents.length > 0 && (
          <section aria-labelledby="new-agents-title" className="flex flex-col gap-3">
            <h3 id="new-agents-title" className={SECTION}>
              New agents for this plan
            </h3>
            <p className="max-w-form">
              No agent on your team fits part of this work, so the lead agent wrote new ones.
              Approving the plan adds them to your team; you can change them first.
            </p>
            {agents.map((agent, i) => (
              <ProposedAgent
                key={agent.id}
                agent={agent}
                tasks={tasks}
                onChange={(change) =>
                  setAgents((all) => all.map((a, j) => (j === i ? { ...a, ...change } : a)))
                }
              />
            ))}
          </section>
        )}
        {summary ? (
          <p className="text-[13px] leading-[18px]">{summary}</p>
        ) : (
          <Alert
            tone="needs"
            text="No task may change files, so the team can only read your project and report. Tick “May change files” for each task that should build something."
          />
        )}
        <div>
          <Button
            type="submit"
            kind="primary"
            busy={approve.isPending}
            disabled={busy || !repository.trim()}
          >
            Approve and start
          </Button>
        </div>
        {refused && (
          <Alert
            // A bad time limit is caught before sending.
            title={refused instanceof ApiError ? "The server refused it:" : "Not sent:"}
            text={problem(refused) + whatToDo}
          />
        )}
      </form>
      <div className="flex max-w-form flex-col gap-2 border-t border-line pt-4">
        <ReasonForm
          label="Or reject it: why? This is kept with the plan."
          button="Reject plan"
          kind="destructive"
          busy={reject.isPending}
          disabled={busy}
          onSubmit={(reason) => reject.mutate(reason)}
        />
        {reject.error && <Alert title="Could not reject it:" text={problem(reject.error)} />}
      </div>
    </fieldset>
  );
}

/** A new agent the lead agent proposed: its role stays as the plan needs it, the rest can change. */
function ProposedAgent({
  agent,
  tasks,
  onChange,
}: {
  agent: Agent;
  tasks: PlanTask[];
  onChange: (change: Partial<Agent>) => void;
}) {
  const titleId = useId();
  const users = tasks.filter((t) => t.role === agent.role).map((t) => t.id);
  const one = users.length === 1;
  return (
    <div
      role="group"
      aria-labelledby={titleId}
      className="flex flex-col gap-4 rounded-lg border border-accent bg-surface p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 id={titleId} className="font-mono text-section font-semibold wrap-anywhere">
          {agent.id}
        </h4>
        <p className="text-meta text-ink-muted">Added to your team when you approve.</p>
      </div>
      <Field
        label="Role"
        hint={`Set by the plan: ${one ? "task" : "tasks"} ${users.join(", ")} ${one ? "needs" : "need"} an agent with this role.`}
      >
        {(id, hint) => (
          <input
            id={id}
            aria-describedby={hint}
            readOnly
            value={agent.role}
            className={MONO_FIELD}
          />
        )}
      </Field>
      <AgentFields agent={agent} onChange={onChange} />
    </div>
  );
}

/** What each task may do, one row per task. Nothing is granted until it is ticked. */
function TaskRights({
  tasks,
  rights,
  checks,
  onChange,
  onAllowAll,
}: {
  tasks: PlanTask[];
  rights: Record<string, Rights>;
  checks: Record<string, string[]>;
  onChange: (task: string, change: Partial<Rights>) => void;
  onAllowAll: () => void;
}) {
  const names = Object.keys(checks);
  return (
    <div className="flex flex-col gap-2">
      <div className="@container rounded-lg border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-t-lg border-b border-line bg-panel px-4 py-2 text-meta text-ink-muted">
          <span>{plural(tasks.length, "task", "tasks")} · nothing is allowed until you tick it</span>
          {/* It only ticks; it never grants checks, attempts or time. */}
          <Button
            kind="ghost"
            small
            disabled={tasks.every((t) => rights[t.id].edit)}
            onClick={onAllowAll}
          >
            Let every task change files
          </Button>
        </div>
        <div
          aria-hidden="true"
          className={`${ROW} px-4 pt-2 text-meta font-semibold text-ink-muted @max-[600px]:hidden`}
        >
          <span>Task</span>
          <span />
          <span>Checks to run before its work is accepted</span>
        </div>
        {tasks.map((task, i) => (
          <RightsRow
            key={task.id}
            task={task}
            rights={rights[task.id]}
            names={names}
            first={i === 0}
            onChange={(change) => onChange(task.id, change)}
          />
        ))}
      </div>
      {/* Each command once, not in every row. */}
      {names.length > 0 && (
        <p className="flex flex-wrap gap-x-4 gap-y-0.5 text-meta leading-[18px] text-ink-muted">
          <span>Checks on this server:</span>
          {names.map((name) => (
            <span key={name} className="wrap-anywhere">
              <strong className="font-semibold text-ink">{name}</strong>{" "}
              <code className="font-mono text-ink">{checks[name].join(" ")}</code>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

function RightsRow({
  task,
  rights: r,
  names,
  first,
  onChange,
}: {
  task: PlanTask;
  rights: Rights;
  names: string[];
  first: boolean;
  onChange: (change: Partial<Rights>) => void;
}) {
  const limit = r.timeout.trim() ? `${r.timeout.trim()} s time limit` : "no time limit";
  return (
    <div className={`px-4 pt-3 ${first ? "" : "border-t border-line"}`}>
      <div className={ROW}>
        <div className="min-w-0">
          <p className="font-semibold wrap-anywhere">{task.title}</p>
          <p className="text-meta text-ink-muted wrap-anywhere">
            <code className="font-mono">{task.id}</code> · {task.role}
          </p>
        </div>
        <label className={CHECK}>
          <input
            type="checkbox"
            aria-label={`Task ${task.id} may change files`}
            checked={r.edit}
            // Running checks itself needs edit too, the server's rule.
            onChange={(e) => onChange({ edit: e.target.checked, runChecks: false })}
            className="size-4"
          />
          May change files
        </label>
        <fieldset className="flex min-w-0 flex-wrap gap-x-4 gap-y-0.5">
          {/* The column head names it on a wide table; stacked, each row says it. */}
          <legend className="sr-only text-meta text-ink-muted @max-[600px]:not-sr-only @max-[600px]:mb-0.5">
            Checks to run before its work is accepted
          </legend>
          {names.length === 0 && (
            <p className="text-meta text-ink-muted">No checks are set up on the server.</p>
          )}
          {names.map((name) => (
            <label key={name} className={CHECK}>
              <input
                type="checkbox"
                aria-label={`Run check ${name} on task ${task.id}`}
                checked={r.checks.includes(name)}
                onChange={(e) =>
                  onChange({
                    checks: e.target.checked
                      ? [...r.checks, name]
                      : r.checks.filter((c) => c !== name),
                  })
                }
                className="size-4"
              />
              {name}
            </label>
          ))}
        </fieldset>
      </div>
      <MoreOptions rule={false} hint={`${plural(r.maxAttempts, "attempt", "attempts")} · ${limit}`}>
        <label className={CHECK}>
          <input
            type="checkbox"
            aria-label={`Let it run the checks itself while it works, task ${task.id}`}
            checked={r.runChecks}
            disabled={!r.edit}
            onChange={(e) => onChange({ runChecks: e.target.checked })}
            className="size-4"
          />
          Let it run the checks itself while it works (needs “May change files”)
        </label>
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
          <Field label="Attempts" hint="1 to 5. Each attempt is billed.">
            {(id, hint) => (
              <input
                id={id}
                aria-label={`Attempts for task ${task.id}`}
                aria-describedby={hint}
                type="number"
                min={1}
                max={5}
                required
                value={r.maxAttempts}
                onChange={(e) => onChange({ maxAttempts: Number(e.target.value) })}
                className={`w-[88px] ${FIELD}`}
              />
            )}
          </Field>
          <Field label="Time limit per attempt, in seconds" hint="Empty means no limit.">
            {(id, hint) => (
              <input
                id={id}
                aria-label={`Time limit per attempt, in seconds, for task ${task.id}`}
                aria-describedby={hint}
                type="number"
                min={1}
                value={r.timeout}
                onChange={(e) => onChange({ timeout: e.target.value })}
                className={`w-28 ${FIELD}`}
              />
            )}
          </Field>
        </div>
      </MoreOptions>
    </div>
  );
}

/** A long wait, watched rather than animated: the static arc and the time since it started. */
function Planning({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-md border border-working-edge bg-working-soft px-4 py-3 text-working-ink"
    >
      <Icon name="working" className="mt-0.5 size-4 shrink-0" />
      <div>
        <p className="font-semibold">The lead agent is planning… this can take a few minutes.</p>
        <p className="text-meta">
          {planningSince(now - since)} The plan opens here when it is ready.
        </p>
      </div>
    </div>
  );
}

/** Ask the lead agent for a plan, or (for developers) write one by hand. */
export function NewProposal({
  client,
  folder,
  onFolder,
  onCreated,
}: {
  client: Client;
  folder: string;
  onFolder: (folder: string) => void;
  onCreated: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [request, setRequest] = useState("");
  const [runId, setRunId] = useState(() => newRunId(new Date()));
  const [revisions, setRevisions] = useState(2);
  const [plan, setPlan] = useState<string | null>(null);
  const agents = useQuery({
    queryKey: ["agents"],
    queryFn: () => client.request<{ agents: { role: string }[] }>("/agents"),
    retry: false,
  });
  const created = async (proposal: Proposal) => {
    await queryClient.invalidateQueries({ queryKey: ["proposals"] });
    onCreated(proposal.id);
  };
  const ask = useMutation({
    mutationFn: () =>
      planRequest(client, {
        request: request.trim(),
        run_id: runId.trim(),
        workspace: folder.trim(),
        max_revisions: revisions,
      }),
    onSuccess: created,
  });
  const byHand = useMutation({
    mutationFn: (text: string) => proposePlan(client, text),
    onSuccess: created,
  });
  const roles = agents.data?.agents.map((a) => a.role) ?? [];
  const text = plan ?? planTemplate(roles, runId.trim());
  const busy = ask.isPending || byHand.isPending;
  const missing = !request.trim()
    ? "Say what you want built first."
    : !folder.trim()
      ? "Name the project folder first."
      : !runId.trim()
        ? "Give the run a name first (under More options)."
        : "";
  const note = missing || (ask.error ? "You can change your request first. Each try is billed." : "");
  const rounds = roundsOf(ask.error);

  return (
    <section aria-labelledby="new-title" className="flex max-w-form flex-col gap-6">
      {/* Every field waits while the lead agent plans. */}
      <fieldset disabled={ask.isPending} className="flex min-w-0 flex-col gap-4">
        <header className="flex flex-col gap-2">
          <h1 id="new-title" className={PAGE_TITLE}>
            Ask for something
          </h1>
          <p className={LEDE}>
            Say what you want in your own words. The lead agent turns it into a plan for the team;
            you look it over and approve it before any work starts.
          </p>
        </header>
        <Field
          lead
          label="What do you want built?"
          hint="Describe it as you would to a person: what it should do, for whom, and anything it must not do."
        >
          {(id, hint) => (
            <textarea
              id={id}
              aria-describedby={hint}
              autoFocus
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              className={`min-h-[160px] resize-y ${FIELD}`}
            />
          )}
        </Field>
        <Field
          label="Project folder"
          hint="The folder of your project on this computer, e.g. C:\Code\my-app."
        >
          {(id, hint) => (
            <input
              id={id}
              aria-describedby={hint}
              spellCheck={false}
              value={folder}
              onChange={(e) => onFolder(e.target.value)}
              className={MONO_FIELD}
            />
          )}
        </Field>
        <MoreOptions hint={`Run name ${runId} · ${plural(revisions, "revision", "revisions")}`}>
          <Field label="Run name" hint="The plan keeps this name, and so does its run.">
            {(id, hint) => (
              <input
                id={id}
                aria-describedby={hint}
                spellCheck={false}
                value={runId}
                onChange={(e) => setRunId(e.target.value)}
                className={MONO_FIELD}
              />
            )}
          </Field>
          <Field
            label="Revisions"
            hint="How many times the lead agent may improve its own plan before showing it to you; 0 to 5."
          >
            {(id, hint) => (
              <input
                id={id}
                aria-describedby={hint}
                type="number"
                min={0}
                max={5}
                value={revisions}
                onChange={(e) => setRevisions(Number(e.target.value))}
                className={`w-[88px] ${FIELD}`}
              />
            )}
          </Field>
        </MoreOptions>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Confirm
            label={ask.error ? "Plan it again" : "Plan it"}
            question="Plan this with the lead agent? It uses your Claude account, so it is billed."
            yes="Yes, plan it"
            keep="Not now"
            destructive={false}
            busy={ask.isPending}
            disabled={busy || missing !== ""}
            onConfirm={() => ask.mutate()}
          />
          {note && <span className="text-meta text-ink-muted">{note}</span>}
        </div>
      </fieldset>
      {ask.isPending && <Planning since={ask.submittedAt} />}
      {ask.error && (
        <Alert title="The plan was not made:" text={problem(ask.error)}>
          {rounds.length > 0 && (
            <div className="basis-full pl-6">
              <Drafts rounds={rounds} />
            </div>
          )}
        </Alert>
      )}
      <ForDevelopers title="Write the plan yourself">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            byHand.mutate(text);
          }}
        >
          <Field
            label="The plan, as JSON"
            hint={
              <>
                Every task's <code className="font-mono">run_id</code> must equal the plan's{" "}
                <code className="font-mono">id</code>, and its{" "}
                <code className="font-mono">role</code> must be a role on your team
                {roles.length > 0 ? `: ${roles.join(", ")}` : ""}.
              </>
            }
          >
            {(id, hint) => (
              <textarea
                id={id}
                aria-describedby={hint}
                spellCheck={false}
                wrap="off"
                disabled={busy}
                value={text}
                onChange={(e) => setPlan(e.target.value)}
                className="min-h-[360px] resize-y overflow-auto rounded-md border border-line-strong bg-code-bg px-3 py-2 font-mono text-code-block whitespace-pre text-ink [tab-size:2]"
              />
            )}
          </Field>
          <div>
            <Button type="submit" busy={byHand.isPending} disabled={busy}>
              Save the plan
            </Button>
          </div>
          {byHand.error && (
            <Alert
              // Text that is not JSON is never sent.
              title={
                byHand.error instanceof ApiError
                  ? "The server refused the plan:"
                  : "The plan was not sent:"
              }
              text={problem(byHand.error)}
            />
          )}
        </form>
      </ForDevelopers>
    </section>
  );
}
