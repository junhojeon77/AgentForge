import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AgentFields } from "./AgentsPage";
import type { Agent } from "./agents";
import type { Client } from "./api/client";
import {
  approveProposal,
  NO_RIGHTS,
  newRunId,
  type PlanRound,
  type PlanTask,
  type Proposal,
  planRequest,
  planTemplate,
  proposePlan,
  type Rights,
  rejectProposal,
  roundsOf,
} from "./proposals";
import { BUTTON, Confirm, FIELD, Field, MoreOptions, problem, ReasonForm } from "./RunPage";

export const STATUS = {
  pending: "Waiting for your OK",
  approved: "Approved",
  rejected: "Rejected",
} as const;

function Rounds({ rounds }: { rounds: PlanRound[] }) {
  if (rounds.length === 0) return null;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer">What the lead agent fixed along the way</summary>
      <ol className="mt-1 list-inside list-decimal space-y-1">
        {rounds.map((round, i) => (
          // Rounds never move or change, so their position is a stable key.
          <li key={i}>
            Draft {round.revision}, found by the {round.source === "check" ? "rule check" : "review"}:
            <ul className="ml-6 list-disc">
              {round.issues.map((issue, j) => (
                <li key={j} className="break-words">
                  {issue}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </details>
  );
}

function NewAgents({ title, agents }: { title: string; agents: Agent[] }) {
  return (
    <>
      <h2 className="font-semibold">{title}</h2>
      <ul className="space-y-2">
        {agents.map((agent) => (
          <li key={agent.id} className="rounded border border-slate-300 p-3 text-sm">
            <p className="font-medium break-all">
              {agent.id} · {agent.role}
            </p>
            <p className="text-slate-700">
              {agent.model ?? "default model"} · {agent.reasoning} reasoning
            </p>
            {agent.persona && (
              <p className="break-words whitespace-pre-wrap">{agent.persona}</p>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function TaskSummary({ task }: { task: PlanTask }) {
  return (
    <li className="rounded border border-slate-300 p-3 text-sm">
      <h3 className="font-medium break-all">{task.title}</h3>
      <p className="text-slate-700 break-all">
        {task.id} · {task.role}
        {task.dependencies.length > 0 && ` · after ${task.dependencies.join(", ")}`}
      </p>
      {task.objective && <p className="break-words whitespace-pre-wrap">{task.objective}</p>}
      {task.description && (
        <p className="break-words whitespace-pre-wrap text-slate-700">{task.description}</p>
      )}
      {task.acceptance_criteria.length > 0 && (
        <>
          <p className="mt-1 font-medium">Done when</p>
          <ul className="list-inside list-disc">
            {task.acceptance_criteria.map((c, i) => (
              <li key={i} className="break-words">
                {c}
              </li>
            ))}
          </ul>
        </>
      )}
    </li>
  );
}

/** One proposal: its plan, how it was made and, while pending, the approve and reject forms. */
export function ProposalPage({
  client,
  proposal,
  folder,
  onOpenRun,
}: {
  client: Client;
  proposal: Proposal;
  folder: string;
  onOpenRun: (id: string) => void;
}) {
  const { id, status } = proposal;
  return (
    <section aria-labelledby="proposal-title" className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 id="proposal-title" className="text-lg font-semibold break-all">
          Plan {id}
        </h1>
        <span>
          · {STATUS[status]} · written {proposal.source === "lead" ? "by the lead agent" : "by hand"}
        </span>
      </div>
      {status === "approved" && (
        <p className="flex flex-wrap items-center gap-2">
          Approved: it runs as run {id}.
          <button type="button" className={BUTTON} onClick={() => onOpenRun(id)}>
            Open run
          </button>
        </p>
      )}
      {status === "rejected" && (
        <p className="break-words">Rejected: {proposal.reason}</p>
      )}
      <Rounds rounds={proposal.rounds} />
      {status !== "pending" && proposal.agents.length > 0 && (
        <NewAgents
          title={status === "approved" ? "Agents this plan added to your team" : "New agents it asked for"}
          agents={proposal.agents}
        />
      )}
      <h2 className="font-semibold">Tasks</h2>
      <ul className="space-y-3">
        {proposal.plan.tasks.map((task) => (
          <TaskSummary key={task.id} task={task} />
        ))}
      </ul>
      {status === "pending" && (
        <Decide client={client} proposal={proposal} folder={folder} onStarted={onOpenRun} />
      )}
    </section>
  );
}

function Decide({
  client,
  proposal,
  folder,
  onStarted,
}: {
  client: Client;
  proposal: Proposal;
  folder: string;
  onStarted: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const checks = useQuery({
    queryKey: ["checks"],
    queryFn: () => client.request<{ checks: Record<string, string[]> }>("/checks"),
    staleTime: Infinity,
    retry: false,
  });
  const [repository, setRepository] = useState(folder);
  const [agents, setAgents] = useState<Agent[]>(proposal.agents);
  const [rights, setRights] = useState<Record<string, Rights>>(() =>
    Object.fromEntries(proposal.plan.tasks.map((t) => [t.id, NO_RIGHTS])),
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

  return (
    <>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          approve.mutate();
        }}
      >
        <h2 className="font-semibold">Approve and start</h2>
        <p className="text-sm">
          A task left as it is can only read your files. Tick what each task may do.
        </p>
        <Field label="Project folder" hint="The Git repository the team works in.">
          {(id) => (
            <input
              id={id}
              required
              value={repository}
              onChange={(e) => setRepository(e.target.value)}
              className={FIELD}
            />
          )}
        </Field>
        {checks.error && <p role="alert">Could not read the checks: {problem(checks.error)}</p>}
        {proposal.plan.tasks.map((task) => (
          <TaskRights
            key={task.id}
            task={task}
            rights={rights[task.id]}
            checks={checks.data?.checks ?? {}}
            onChange={(change) => set(task.id, change)}
          />
        ))}
        {agents.length > 0 && (
          <>
            <h3 className="font-semibold">New agents for this plan</h3>
            <p className="text-sm">
              No agent on your team fits part of this work, so the lead agent wrote new ones.
              Approving the plan adds them to your team; you can change them first.
            </p>
            {agents.map((agent, i) => (
              <fieldset
                key={agent.id}
                className="space-y-2 rounded border border-slate-300 p-3 text-sm"
              >
                <legend className="px-1 font-medium break-all">
                  {agent.id} · {agent.role}
                </legend>
                <AgentFields
                  agent={agent}
                  onChange={(change) =>
                    setAgents((all) => all.map((a, j) => (j === i ? { ...a, ...change } : a)))
                  }
                />
              </fieldset>
            ))}
          </>
        )}
        <button type="submit" className={BUTTON} disabled={busy || !repository.trim()}>
          Approve and start
        </button>
        {approve.error && <p role="alert">{problem(approve.error)}</p>}
      </form>
      <ReasonForm
        label="Or reject it: why? This is kept with the plan."
        button="Reject plan"
        disabled={busy}
        onSubmit={(reason) => reject.mutate(reason)}
      />
      {reject.error && <p role="alert">{problem(reject.error)}</p>}
    </>
  );
}

function TaskRights({
  task,
  rights,
  checks,
  onChange,
}: {
  task: PlanTask;
  rights: Rights;
  checks: Record<string, string[]>;
  onChange: (change: Partial<Rights>) => void;
}) {
  const names = Object.keys(checks);
  return (
    <fieldset className="space-y-2 rounded border border-slate-300 p-3 text-sm">
      <legend className="px-1 font-medium break-all">
        {task.title} ({task.id})
      </legend>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={rights.edit}
          // Running checks itself needs edit too, the server's rule.
          onChange={(e) => onChange({ edit: e.target.checked, runChecks: false })}
        />
        May change files
      </label>
      <fieldset>
        <legend>Checks to run before its work is accepted</legend>
        {names.length === 0 && <p className="text-slate-700">No checks are set up on the server.</p>}
        {names.map((name) => (
          <label key={name} className="flex flex-wrap items-center gap-2">
            <input
              type="checkbox"
              checked={rights.checks.includes(name)}
              onChange={(e) =>
                onChange({
                  checks: e.target.checked
                    ? [...rights.checks, name]
                    : rights.checks.filter((c) => c !== name),
                })
              }
            />
            {name}
            <code className="text-xs text-slate-700">{checks[name].join(" ")}</code>
          </label>
        ))}
      </fieldset>
      <MoreOptions>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={rights.runChecks}
            disabled={!rights.edit}
            onChange={(e) => onChange({ runChecks: e.target.checked })}
          />
          Let it run the checks itself while it works (needs "May change files")
        </label>
        <Field label="Attempts" hint="Each attempt is billed; 1 to 5.">
          {(id) => (
            <input
              id={id}
              type="number"
              min={1}
              max={5}
              required
              value={rights.maxAttempts}
              onChange={(e) => onChange({ maxAttempts: Number(e.target.value) })}
              className={`w-20 ${FIELD}`}
            />
          )}
        </Field>
        <Field label="Time limit per attempt, in seconds" hint="Empty: no limit.">
          {(id) => (
            <input
              id={id}
              type="number"
              min={1}
              value={rights.timeout}
              onChange={(e) => onChange({ timeout: e.target.value })}
              className={`w-28 ${FIELD}`}
            />
          )}
        </Field>
      </MoreOptions>
    </fieldset>
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
  const template = planTemplate(agents.data?.agents.map((a) => a.role) ?? [], runId.trim());
  const text = plan ?? template;
  const busy = ask.isPending || byHand.isPending;

  return (
    <section aria-labelledby="new-title" className="max-w-3xl space-y-4">
      <h1 id="new-title" className="text-lg font-semibold">
        Ask for something
      </h1>
      <p className="text-sm">
        Say what you want in your own words. The lead agent turns it into a plan for the team; you
        look it over and approve it before any work starts.
      </p>
      <Field label="What do you want built?">
        {(id) => (
          <textarea
            id={id}
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            className={`min-h-28 ${FIELD}`}
          />
        )}
      </Field>
      <Field label="Project folder" hint="The folder of your project, e.g. C:\Code\my-app.">
        {(id) => (
          <input
            id={id}
            value={folder}
            onChange={(e) => onFolder(e.target.value)}
            className={FIELD}
          />
        )}
      </Field>
      <MoreOptions>
        <Field label="Run name" hint="The plan keeps this name, and so does its run.">
          {(id) => (
            <input
              id={id}
              value={runId}
              onChange={(e) => setRunId(e.target.value)}
              className={`font-mono ${FIELD}`}
            />
          )}
        </Field>
        <Field label="Revisions" hint="How many times the lead agent may fix its own plan; 0 to 5.">
          {(id) => (
            <input
              id={id}
              type="number"
              min={0}
              max={5}
              value={revisions}
              onChange={(e) => setRevisions(Number(e.target.value))}
              className={`w-20 ${FIELD}`}
            />
          )}
        </Field>
      </MoreOptions>
      <Confirm
        label="Plan it"
        question="Plan this with the lead agent? It uses your Claude account, so it is billed."
        yes="Yes, plan it"
        keep="Not now"
        disabled={busy || !request.trim() || !folder.trim() || !runId.trim()}
        onConfirm={() => ask.mutate()}
      />
      {ask.isPending && (
        <p role="status">The lead agent is planning… this can take a few minutes.</p>
      )}
      {ask.error && (
        <div role="alert" className="space-y-1">
          <p>The plan was not made: {problem(ask.error)}</p>
          <Rounds rounds={roundsOf(ask.error)} />
        </div>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer">Write the plan yourself (for developers)</summary>
        <form
          className="mt-2 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            byHand.mutate(text);
          }}
        >
          <Field
            label="Plan (JSON, a RunPlan)"
            hint="Every task's run_id must equal the plan's id, and its role must be an agent's role."
          >
            {(id) => (
              <textarea
                id={id}
                spellCheck={false}
                value={text}
                onChange={(e) => setPlan(e.target.value)}
                className={`min-h-64 font-mono text-xs ${FIELD}`}
              />
            )}
          </Field>
          <button type="submit" className={BUTTON} disabled={busy}>
            Save the plan
          </button>
          {byHand.error && <p role="alert">{problem(byHand.error)}</p>}
        </form>
      </details>
    </section>
  );
}
