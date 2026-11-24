import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import {
  type Agent,
  PERSONA_LIMIT,
  REASONING,
  removeAgent,
  saveAgent,
  toId,
} from "./agents";
import { type Client, fieldErrors } from "./api/client";
import { Icon } from "./Icon";
import {
  Alert,
  Button,
  Confirm,
  FIELD,
  Field,
  LEDE,
  MoreOptions,
  PAGE_TITLE,
  problem,
} from "./ui";

const NEW_AGENT: Agent = { id: "", role: "", model: null, reasoning: "medium", persona: "" };
// The counter turns amber here, so the limit never comes as a surprise.
const NEAR_LIMIT = 9_500;
// A server field error names the field as it appears on screen.
const LABELS: Record<string, string> = {
  id: "Name",
  role: "Role",
  persona: "How it should work",
  model: "Model",
  reasoning: "Reasoning",
};
const MORE = ["model", "reasoning"];
const GRID = "grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3";
const count = (n: number) => n.toLocaleString("en-US");

/** How an agent works, then model and reasoning under More options. The plan page uses it for
 * the lead's new agents too; there the role stays as proposed, since the plan's tasks need it. */
export function AgentFields({
  agent,
  onChange,
  openMore = false,
  autoFocus = false,
}: {
  agent: Agent;
  onChange: (change: Partial<Agent>) => void;
  /** A field error inside More options opens it. */
  openMore?: boolean;
  autoFocus?: boolean;
}) {
  const near = agent.persona.length > NEAR_LIMIT;
  return (
    <>
      <Field
        label="How it should work"
        hint={
          <div className="flex items-baseline justify-between gap-3">
            <span>Plain words: what it does, how carefully, and what it must never do.</span>
            <span
              className={`shrink-0 tabular-nums ${near ? "rounded-sm bg-needs-soft px-1 text-needs-ink" : ""}`}
            >
              {count(agent.persona.length)} of {count(PERSONA_LIMIT)} characters
            </span>
          </div>
        }
      >
        {(id, hint) => (
          <textarea
            id={id}
            aria-describedby={hint}
            autoFocus={autoFocus}
            maxLength={PERSONA_LIMIT}
            value={agent.persona}
            onChange={(e) => onChange({ persona: e.target.value })}
            className={`min-h-[160px] resize-y ${FIELD}`}
          />
        )}
      </Field>
      <MoreOptions
        open={openMore}
        hint={`${agent.model ?? "default model"} · ${agent.reasoning} reasoning`}
      >
        <Field
          label="Model"
          hint="Empty uses the default model. Otherwise a model id or an alias such as opus."
        >
          {(id, hint) => (
            <input
              id={id}
              aria-describedby={hint}
              spellCheck={false}
              placeholder="default model"
              value={agent.model ?? ""}
              onChange={(e) => onChange({ model: e.target.value.trim() || null })}
              className={`font-mono text-control ${FIELD}`}
            />
          )}
        </Field>
        <Field
          label="Reasoning"
          hint="How hard it thinks: low, medium, high, xhigh or max. Higher is slower and costs more."
        >
          {(id, hint) => (
            <select
              id={id}
              aria-describedby={hint}
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

/** An agent at a glance: its id, role, model and how it should work. `full` shows the whole
 * persona; otherwise its first three lines, the rest being in Edit. */
export function AgentSummary({
  agent,
  full = false,
  heading: Heading = "h3",
}: {
  agent: Agent;
  full?: boolean;
  heading?: "h2" | "h3";
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Heading className="font-mono text-[14px] leading-5 font-semibold wrap-anywhere">
        {agent.id}
      </Heading>
      <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-meta text-ink-muted">
        <span className="wrap-anywhere">
          Role <b className="font-semibold text-ink">{agent.role}</b>
        </span>
        <span>
          {agent.model ?? "default model"} · {agent.reasoning} reasoning
        </span>
      </p>
      {/* A persona is text written by a person or the lead agent: plain text, never HTML. */}
      {agent.persona ? (
        <p
          className={`text-[13px] leading-[18px] whitespace-pre-wrap wrap-anywhere ${full ? "" : "line-clamp-3"}`}
        >
          {agent.persona}
        </p>
      ) : (
        <p className="text-[13px] leading-[18px] text-ink-muted">
          No instructions yet: it works from its role alone.
        </p>
      )}
    </div>
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
  // Where focus goes when the editor closes: that agent's Edit, or "" for Add an agent.
  const [back, setBack] = useState<string | null>(null);
  const add = useRef<HTMLButtonElement>(null);
  const team = agents.data?.agents;
  const roles = [...new Set(team?.map((a) => a.role))];
  const close = () => {
    setBack(editing);
    setEditing(null);
  };
  useEffect(() => {
    if (editing === null && back === "") add.current?.focus();
  }, [editing, back]);

  return (
    <section aria-labelledby="team-title" className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h1 id="team-title" className={PAGE_TITLE}>
            Your team
          </h1>
          <Button
            ref={add}
            kind="primary"
            disabled={editing === "" || !team}
            onClick={() => setEditing("")}
          >
            Add an agent
          </Button>
        </div>
        <p className={LEDE}>
          These agents do the work. The lead agent gives each task to the agent with the matching
          role, and can suggest a new agent when no role fits; you approve it with the plan.
          Changes apply from the next run.
        </p>
      </header>
      {agents.error && <Alert title="Could not read the team:" text={problem(agents.error)} />}
      {!team ? (
        !agents.error && (
          <div className="flex flex-col gap-3">
            <p role="status" className="flex items-center gap-2">
              <Icon name="working" className="size-4 shrink-0 text-working-edge" />
              Loading the team…
            </p>
            <div aria-hidden="true" className={GRID}>
              <div className="h-[132px] rounded-lg bg-hover" />
              <div className="h-[132px] rounded-lg bg-hover" />
            </div>
          </div>
        )
      ) : (
        <ul className={GRID}>
          {editing === "" && (
            <Wide>
              <Editor
                client={client}
                taken={team.map((a) => a.id)}
                roles={roles}
                onEdit={setEditing}
                onDone={close}
              />
            </Wide>
          )}
          {team.map((agent) =>
            editing === agent.id ? (
              <Wide key={agent.id}>
                <Editor
                  client={client}
                  agent={agent}
                  roles={roles}
                  onEdit={setEditing}
                  onDone={close}
                />
              </Wide>
            ) : (
              <AgentCard
                key={agent.id}
                client={client}
                agent={agent}
                only={team.length === 1}
                focus={back === agent.id}
                onEdit={() => setEditing(agent.id)}
              />
            ),
          )}
        </ul>
      )}
    </section>
  );
}

/** A list item across the whole grid, for an open editor. */
function Wide({ children }: { children: ReactNode }) {
  return <li className="col-span-full">{children}</li>;
}

function AgentCard({
  client,
  agent,
  only,
  focus,
  onEdit,
}: {
  client: Client;
  agent: Agent;
  /** The last agent: the server refuses to remove it, since an empty team brings back the
   * seven defaults. */
  only: boolean;
  /** Takes the focus back when its editor closes. */
  focus: boolean;
  onEdit: () => void;
}) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => removeAgent(client, agent.id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["agents"] }),
  });
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-lg border border-line bg-surface px-4 py-3">
      <AgentSummary agent={agent} heading="h2" />
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        <Button small autoFocus={focus} aria-label={`Edit agent ${agent.id}`} onClick={onEdit}>
          Edit
        </Button>
        <Confirm
          small
          label="Remove"
          name={`Remove agent ${agent.id}`}
          question={`Remove agent ${agent.id}? Runs from now on will not use it.`}
          yes="Yes, remove"
          keep="Keep it"
          busy={remove.isPending}
          disabled={only || remove.isPending}
          onConfirm={() => remove.mutate()}
        />
      </div>
      {only && (
        <p className="text-meta text-ink-muted">Your only agent. Add another before removing it.</p>
      )}
      {remove.error && <Alert title="Could not remove it:" text={problem(remove.error)} />}
    </li>
  );
}

function Editor({
  client,
  agent,
  taken = [],
  roles,
  onEdit,
  onDone,
}: {
  client: Client;
  agent?: Agent; // none: a new agent
  taken?: string[];
  /** The team's roles, offered as suggestions. */
  roles: string[];
  /** Opens another agent's editor, for a name that is already taken. */
  onEdit: (id: string) => void;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const start = agent ?? NEW_AGENT;
  const [name, setName] = useState("");
  const [draft, setDraft] = useState<Agent>(start);
  const listId = useId();
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
  const errors = fieldErrors(save.error).map((e) => ({ ...e, field: e.loc[e.loc.length - 1] }));
  const lines =
    errors.length > 0
      ? errors.map((e) => `${LABELS[e.field] ?? e.loc.join(".")}: ${e.msg}`)
      : save.error
        ? [problem(save.error)]
        : [];
  const changed = name !== "" || JSON.stringify(draft) !== JSON.stringify(start);

  return (
    <form
      aria-label={agent ? `Edit agent ${agent.id}` : "Add an agent"}
      className="flex flex-col gap-4 rounded-lg border border-accent bg-surface p-4"
      // Escape cancels only while nothing was changed, so no typing is lost.
      onKeyDown={(e) => {
        if (e.key === "Escape" && !changed) onDone();
      }}
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-section font-semibold wrap-anywhere">
          {agent ? (
            <>
              Edit <code className="font-mono">{agent.id}</code>
            </>
          ) : (
            "Add an agent"
          )}
        </h2>
        {agent && <p className="text-meta text-ink-muted">Changes apply from the next run.</p>}
      </div>
      <fieldset disabled={save.isPending} className="flex min-w-0 flex-col gap-4">
        {!agent && (
          <Field
            label="Name"
            hint={
              clash ? (
                <span className="flex flex-wrap items-center gap-2 text-danger">
                  <span>
                    An agent named <code className="font-mono">{id}</code> already exists; edit it
                    instead.
                  </span>
                  <Button small onClick={() => onEdit(id)}>
                    Edit {id}
                  </Button>
                </span>
              ) : id ? (
                <>
                  Saved as <code className="font-mono text-ink">{id}</code>
                </>
              ) : (
                "Letters, digits, - and _; it becomes the agent's file name."
              )
            }
          >
            {(fieldId, hint) => (
              <input
                id={fieldId}
                aria-describedby={hint}
                aria-invalid={clash || undefined}
                autoFocus
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={`${FIELD} aria-invalid:border-danger`}
              />
            )}
          </Field>
        )}
        <Field
          label="Role"
          hint="The lead agent gives each task to an agent whose role matches the task's role, e.g. backend."
        >
          {(fieldId, hint) => (
            <>
              <input
                id={fieldId}
                aria-describedby={hint}
                list={listId}
                required
                spellCheck={false}
                value={draft.role}
                onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value }))}
                className={`font-mono text-control ${FIELD}`}
              />
              <datalist id={listId}>
                {roles.map((role) => (
                  <option key={role} value={role} />
                ))}
              </datalist>
            </>
          )}
        </Field>
        <AgentFields
          agent={draft}
          autoFocus={agent !== undefined}
          openMore={errors.some((e) => MORE.includes(e.field))}
          onChange={(change) => setDraft((d) => ({ ...d, ...change }))}
        />
      </fieldset>
      {lines.length > 0 && (
        <Alert title="The server did not save it:">
          <ul className="basis-full list-disc pl-10 text-[13px] whitespace-pre-wrap wrap-anywhere">
            {lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          kind="primary"
          busy={save.isPending}
          disabled={save.isPending || !id || clash || !draft.role.trim()}
        >
          {agent ? "Save changes" : "Add agent"}
        </Button>
        <Button kind="ghost" disabled={save.isPending} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
