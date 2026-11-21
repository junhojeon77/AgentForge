import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  type Agent,
  PERSONA_LIMIT,
  REASONING,
  removeAgent,
  saveAgent,
  toId,
} from "./agents";
import type { Client } from "./api/client";
import { BUTTON, Confirm, FIELD, Field, MoreOptions, problem } from "./RunPage";

const NEW_AGENT: Agent = { id: "", role: "", model: null, reasoning: "medium", persona: "" };

/** How an agent works, then model and reasoning under More options. The plan page uses it for
 * the lead's new agents too; there the role stays as proposed, since the plan's tasks need it. */
export function AgentFields({
  agent,
  onChange,
}: {
  agent: Agent;
  onChange: (change: Partial<Agent>) => void;
}) {
  return (
    <>
      <Field
        label="How it should work"
        hint={`${agent.persona.length.toLocaleString("en-US")} of ${PERSONA_LIMIT.toLocaleString("en-US")} characters`}
      >
        {(id) => (
          <textarea
            id={id}
            maxLength={PERSONA_LIMIT}
            value={agent.persona}
            onChange={(e) => onChange({ persona: e.target.value })}
            className={`min-h-40 ${FIELD}`}
          />
        )}
      </Field>
      <MoreOptions>
        <Field label="Model" hint="Empty: the default model. Otherwise an id or alias, e.g. opus.">
          {(id) => (
            <input
              id={id}
              spellCheck={false}
              value={agent.model ?? ""}
              onChange={(e) => onChange({ model: e.target.value.trim() || null })}
              className={`font-mono ${FIELD}`}
            />
          )}
        </Field>
        <Field label="Reasoning" hint="How hard it thinks; higher is slower and costs more.">
          {(id) => (
            <select
              id={id}
              value={agent.reasoning}
              onChange={(e) => onChange({ reasoning: e.target.value as Agent["reasoning"] })}
              className={`w-32 ${FIELD}`}
            >
              {REASONING.map((level) => (
                <option key={level}>{level}</option>
              ))}
            </select>
          )}
        </Field>
      </MoreOptions>
    </>
  );
}

/** The team: every agent the next run gets, to add, edit or remove. */
export function AgentsPage({ client }: { client: Client }) {
  const agents = useQuery({
    queryKey: ["agents"],
    queryFn: () => client.request<{ agents: Agent[] }>("/agents"),
    retry: false,
  });
  // The id being edited; "" while adding a new agent.
  const [editing, setEditing] = useState<string | null>(null);
  const team = agents.data?.agents;

  return (
    <section aria-labelledby="team-title" className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 id="team-title" className="text-lg font-semibold">
          Your team
        </h1>
        <button
          type="button"
          className={BUTTON}
          disabled={editing === "" || !team}
          onClick={() => setEditing("")}
        >
          Add an agent
        </button>
      </div>
      <p className="text-sm">
        These agents do the work. The lead agent gives each task to the agent with the matching
        role, and can suggest a new agent when no role fits; you approve it with the plan. Changes
        apply from the next run.
      </p>
      {agents.error && <p role="alert">Could not read the team: {problem(agents.error)}</p>}
      {editing === "" && team && (
        <Editor
          client={client}
          taken={team.map((a) => a.id)}
          onDone={() => setEditing(null)}
        />
      )}
      {!team ? (
        !agents.error && <p>Loading the team…</p>
      ) : (
        <ul className="space-y-3">
          {team.map((agent) =>
            editing === agent.id ? (
              <li key={agent.id}>
                <Editor client={client} agent={agent} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <AgentCard
                key={agent.id}
                client={client}
                agent={agent}
                onEdit={() => setEditing(agent.id)}
              />
            ),
          )}
        </ul>
      )}
    </section>
  );
}

function AgentCard({
  client,
  agent,
  onEdit,
}: {
  client: Client;
  agent: Agent;
  onEdit: () => void;
}) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => removeAgent(client, agent.id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["agents"] }),
  });
  return (
    <li className="space-y-1 rounded border border-slate-300 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-medium break-all">{agent.id}</h2>
        <span className="break-all">· {agent.role}</span>
        <span className="text-slate-700">
          · {agent.model ?? "default model"} · {agent.reasoning} reasoning
        </span>
        <button
          type="button"
          className={BUTTON}
          aria-label={`Edit agent ${agent.id}`}
          onClick={onEdit}
        >
          Edit
        </button>
        <Confirm
          label="Remove"
          name={`Remove agent ${agent.id}`}
          question={`Remove agent ${agent.id}? Runs from now on will not use it.`}
          yes="Yes, remove"
          keep="Keep it"
          disabled={remove.isPending}
          onConfirm={() => remove.mutate()}
        />
      </div>
      {/* A persona is text written by a person or the lead agent: plain text, never HTML. */}
      {agent.persona && (
        <p className="line-clamp-3 break-words whitespace-pre-wrap text-slate-700">
          {agent.persona}
        </p>
      )}
      {remove.error && <p role="alert">{problem(remove.error)}</p>}
    </li>
  );
}

function Editor({
  client,
  agent,
  taken = [],
  onDone,
}: {
  client: Client;
  agent?: Agent; // none: a new agent
  taken?: string[];
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [draft, setDraft] = useState<Agent>(agent ?? NEW_AGENT);
  const id = agent?.id ?? toId(name);
  // A PUT adds or replaces, so a new agent must not take an existing id.
  const clash = !agent && taken.includes(id);
  const save = useMutation({
    mutationFn: () => saveAgent(client, { ...draft, id, role: draft.role.trim() }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["agents"] });
      onDone();
    },
  });

  return (
    <form
      aria-label={agent ? `Edit agent ${agent.id}` : "New agent"}
      className="space-y-3 rounded border border-slate-400 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      {agent ? (
        <h2 className="font-medium break-all">Edit {agent.id}</h2>
      ) : (
        <Field
          label="Name"
          hint={
            clash
              ? `An agent named ${id} already exists; edit it instead.`
              : id
                ? `Saved as ${id}`
                : "Letters, digits, - and _; it becomes the agent's file name."
          }
        >
          {(fieldId) => (
            <input
              id={fieldId}
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={FIELD}
            />
          )}
        </Field>
      )}
      <Field
        label="Role"
        hint="The kind of work it takes, e.g. backend. The lead agent matches tasks to agents by role."
      >
        {(fieldId) => (
          <input
            id={fieldId}
            required
            value={draft.role}
            onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value }))}
            className={FIELD}
          />
        )}
      </Field>
      <AgentFields agent={draft} onChange={(change) => setDraft((d) => ({ ...d, ...change }))} />
      <div className="flex gap-2">
        <button
          type="submit"
          className={BUTTON}
          disabled={save.isPending || !id || clash || !draft.role.trim()}
        >
          Save
        </button>
        <button type="button" className={BUTTON} onClick={onDone}>
          Cancel
        </button>
      </div>
      {save.error && <p role="alert">{problem(save.error)}</p>}
    </form>
  );
}
