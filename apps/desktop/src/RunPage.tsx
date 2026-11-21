import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useId, useState } from "react";
import { ApiError, type Client } from "./api/client";
import { followEvents, type Transition } from "./api/events";
import { log } from "./log";
import {
  diffTone,
  type RunAction,
  type RunReport,
  sendControl,
  type TaskAction,
  type TaskAttempt,
  taskActions,
  type TaskState,
} from "./runs";

export const BUTTON =
  "rounded border border-slate-400 px-3 py-1 hover:bg-slate-100 disabled:opacity-50 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700";

export const FIELD =
  "rounded border border-slate-400 p-1 text-sm focus-visible:outline-2 focus-visible:outline-blue-700";

// Color only repeats the +/- that the line already shows.
const TONES = { added: "bg-green-50 text-green-900", removed: "bg-red-50 text-red-900", hunk: "text-blue-800" };

const LABELS = { pause: "Pause", resume: "Resume", retry: "Retry" } as const;

export function problem(error: unknown): string {
  if (error instanceof ApiError) return error.detail ?? error.kind;
  // A check made before sending, such as a plan that is not JSON.
  return error instanceof Error ? error.message : "the request failed";
}

interface Control {
  action: TaskAction | RunAction;
  task?: string;
  reason?: string;
}

/** One control area: its own pending state and refusal; afterwards the run and the list reload. */
function useControl(client: Client, runId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ action, task, reason }: Control) =>
      sendControl(client, runId, action, task, reason),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["run", runId] }),
        queryClient.invalidateQueries({ queryKey: ["runs"] }),
      ]),
  });
}

export function RunPage({
  client,
  runId,
  live,
  interrupted,
}: {
  client: Client;
  runId: string;
  live: boolean;
  interrupted: boolean;
}) {
  const queryClient = useQueryClient();
  const report = useQuery({
    queryKey: ["run", runId],
    queryFn: ({ signal }) =>
      client.request<RunReport>(`/runs/${encodeURIComponent(runId)}`, { signal }),
    retry: false,
  });
  const [stopped, setStopped] = useState<string | null>(null);

  useEffect(() => {
    if (!live) return;
    setStopped(null);
    const controller = new AbortController();
    // Events carry no diffs or messages, so each one only says "reload the report".
    const changed = () => void queryClient.invalidateQueries({ queryKey: ["run", runId] });
    followEvents(client, runId, changed, { signal: controller.signal })
      .then(changed)
      .catch((e: unknown) => {
        const status = e instanceof ApiError ? (e.status ?? e.kind) : "error";
        log.warn(`events for run ${runId} stopped: ${status}`);
        setStopped(problem(e));
      });
    return () => controller.abort();
  }, [client, runId, live, queryClient]);

  const run = report.data;
  const state = live ? "Active" : interrupted ? "Interrupted" : "Finished";
  const paused = run?.tasks.some((t) => t.status === "PAUSED") ?? false;

  return (
    <section aria-labelledby="run-title" className="space-y-4">
      <RunHeader client={client} runId={runId} state={state} paused={paused} />
      {live && stopped && <p role="alert">Live updates stopped: {stopped}</p>}
      {report.error && (
        <p role="alert">
          Could not load run {runId}: {problem(report.error)}
        </p>
      )}
      {!run ? (
        !report.error && <p>Loading run…</p>
      ) : (
        <>
          <h2 className="font-semibold">Tasks</h2>
          <ul className="space-y-3">
            {run.tasks.map((task) => (
              <TaskCard
                key={task.task.id}
                client={client}
                runId={runId}
                live={live}
                state={task}
                attempts={run.attempts.filter((a) => a.task_id === task.task.id)}
              />
            ))}
          </ul>
          <h2 className="font-semibold">History</h2>
          <History transitions={run.transitions} />
        </>
      )}
    </section>
  );
}

function RunHeader({
  client,
  runId,
  state,
  paused,
}: {
  client: Client;
  runId: string;
  state: "Active" | "Interrupted" | "Finished";
  paused: boolean;
}) {
  const control = useControl(client, runId);
  const send = (action: RunAction) => control.mutate({ action });
  const busy = control.isPending;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <h1 id="run-title" className="text-lg font-semibold break-all">
        Run {runId}
      </h1>
      <span>· {state}</span>
      {state === "Active" && (
        <>
          <button type="button" className={BUTTON} disabled={busy} onClick={() => send("pause")}>
            Pause run
          </button>
          {paused && (
            <button type="button" className={BUTTON} disabled={busy} onClick={() => send("resume")}>
              Resume run
            </button>
          )}
          <Confirm
            label="Cancel run"
            question={`Stop run ${runId}? Every running worker stops now.`}
            keep="Keep running"
            disabled={busy}
            onConfirm={() => send("cancel")}
          />
        </>
      )}
      {state === "Interrupted" && (
        <button type="button" className={BUTTON} disabled={busy} onClick={() => send("recover")}>
          Recover run
        </button>
      )}
      {control.error && (
        <p role="alert" className="w-full">
          {problem(control.error)}
        </p>
      )}
    </div>
  );
}

function TaskCard({
  client,
  runId,
  live,
  state,
  attempts,
}: {
  client: Client;
  runId: string;
  live: boolean;
  state: TaskState;
  attempts: TaskAttempt[];
}) {
  const control = useControl(client, runId);
  const titleId = useId();
  const { task, status } = state;
  const busy = control.isPending;
  const send = (action: TaskAction, reason?: string) =>
    control.mutate({ action, task: task.id, reason });
  const actions = taskActions(status, live);
  const checks = task.execution_constraints
    .filter((c) => c.startsWith("check:"))
    .map((c) => c.slice("check:".length));
  const rights = task.allowed_operations.includes("edit") ? "may edit" : "read-only";

  return (
    <li aria-labelledby={titleId} className="rounded border border-slate-300 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={titleId} className="font-medium break-all">
          {task.title}
        </h3>
        <span className="text-sm text-slate-700 break-all">
          {task.id} · {task.role}
        </span>
        <span className="font-mono text-sm">{status}</span>
        {(["pause", "resume", "retry"] as const)
          .filter((action) => actions.includes(action))
          .map((action) => (
            <button
              key={action}
              type="button"
              className={BUTTON}
              aria-label={`${LABELS[action]} task ${task.id}`}
              disabled={busy}
              onClick={() => send(action)}
            >
              {LABELS[action]}
            </button>
          ))}
        {actions.includes("cancel") && (
          <Confirm
            label="Cancel"
            name={`Cancel task ${task.id}`}
            question={`Stop task ${task.id}? Its worker stops now; you can retry it.`}
            keep="Keep it"
            disabled={busy}
            onConfirm={() => send("cancel")}
          />
        )}
      </div>
      <p className="text-sm text-slate-700">
        attempt {state.attempt_number} of {task.max_attempts} · {rights}
        {checks.length > 0 && ` · checks on approve: ${checks.join(", ")}`}
      </p>
      {(state.failure_reason || state.message) && (
        <p className="text-sm break-words">
          {state.failure_reason && `${state.failure_reason}: `}
          {state.message}
        </p>
      )}
      {control.error && (
        <p role="alert" className="text-sm">
          {problem(control.error)}
        </p>
      )}
      {attempts.map((attempt) => {
        const review = actions.includes("approve") && attempt.number === state.attempt_number;
        return (
          <Attempt key={attempt.number} attempt={attempt} open={review}>
            {review && (
              <Review
                taskId={task.id}
                disabled={busy}
                onApprove={() => send("approve")}
                onReject={(reason) => send("reject", reason)}
              />
            )}
          </Attempt>
        );
      })}
    </li>
  );
}

function Attempt({
  attempt,
  open,
  children,
}: {
  attempt: TaskAttempt;
  open: boolean;
  children?: ReactNode;
}) {
  const result = attempt.result;
  return (
    <details open={open} className="mt-2">
      <summary className="cursor-pointer text-sm">
        Attempt {attempt.number} · {attempt.status}
        {attempt.failure_reason && ` · ${attempt.failure_reason}`} · {attempt.worker_id}
      </summary>
      {attempt.message && <TextBlock label="Reason" text={attempt.message} />}
      {result?.message && <TextBlock label="Worker's report" text={result.message} />}
      {result &&
        (result.diff ? <DiffView diff={result.diff} /> : <p className="text-sm">No changes.</p>)}
      {children}
    </details>
  );
}

// Agent output and reasons are untrusted: always plain text, never HTML.
function TextBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="mt-2 text-sm">
      <p className="font-medium">{label}</p>
      <pre className="max-h-60 overflow-auto font-mono text-xs break-words whitespace-pre-wrap">
        {text}
      </pre>
    </div>
  );
}

function DiffView({ diff }: { diff: string }) {
  return (
    <pre className="mt-2 max-h-96 overflow-auto rounded border border-slate-300 p-2 font-mono text-xs">
      {diff.split("\n").map((line, i) => {
        const tone = diffTone(line);
        return (
          // Lines never move or change, so their position is a stable key.
          <span key={i} className={`block ${tone ? TONES[tone] : ""}`}>
            {line || " "}
          </span>
        );
      })}
    </pre>
  );
}

function Review({
  taskId,
  disabled,
  onApprove,
  onReject,
}: {
  taskId: string;
  disabled: boolean;
  onApprove: () => void;
  onReject: (reason: string) => void;
}) {
  return (
    <div className="mt-2 space-y-2">
      <button
        type="button"
        className={BUTTON}
        aria-label={`Approve diff of task ${taskId}`}
        disabled={disabled}
        onClick={onApprove}
      >
        Approve diff
      </button>
      <ReasonForm
        label="Why reject? The next attempt is told this."
        button="Reject diff"
        name={`Reject diff of task ${taskId}`}
        disabled={disabled}
        onSubmit={onReject}
      />
    </div>
  );
}

/** A required reason and its submit button, e.g. for a reject. */
export function ReasonForm({
  label,
  button,
  name,
  disabled,
  onSubmit,
}: {
  label: string;
  button: string;
  name?: string;
  disabled: boolean;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const reasonId = useId();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(reason.trim());
      }}
    >
      <label htmlFor={reasonId} className="w-full text-sm">
        {label}
      </label>
      <textarea
        id={reasonId}
        required
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className={`min-h-16 flex-1 ${FIELD}`}
      />
      <button
        type="submit"
        className={BUTTON}
        aria-label={name}
        disabled={disabled || !reason.trim()}
      >
        {button}
      </button>
    </form>
  );
}

/** A button that asks first, in place; focus returns to it if the person keeps things as they are. */
export function Confirm({
  label,
  name,
  question,
  yes = "Yes, cancel",
  keep,
  disabled,
  onConfirm,
}: {
  label: string;
  name?: string;
  question: string;
  yes?: string;
  keep: string;
  disabled: boolean;
  onConfirm: () => void;
}) {
  const [step, setStep] = useState<"idle" | "asking" | "kept">("idle");
  if (step !== "asking") {
    return (
      <button
        type="button"
        className={BUTTON}
        aria-label={name}
        autoFocus={step === "kept"}
        disabled={disabled}
        onClick={() => setStep("asking")}
      >
        {label}
      </button>
    );
  }
  return (
    <span role="group" aria-label={question} className="flex flex-wrap items-center gap-2">
      <span>{question}</span>
      <button
        type="button"
        className={BUTTON}
        autoFocus
        onClick={() => {
          setStep("idle");
          onConfirm();
        }}
      >
        {yes}
      </button>
      <button type="button" className={BUTTON} onClick={() => setStep("kept")}>
        {keep}
      </button>
    </span>
  );
}

function History({ transitions }: { transitions: Transition[] }) {
  if (transitions.length === 0) return <p>Nothing has happened yet.</p>;
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">Task</th>
          <th scope="col">Status</th>
          <th scope="col">Reason</th>
        </tr>
      </thead>
      <tbody>
        {transitions.map((t) => (
          <tr key={t.sequence} className="border-t border-slate-200 align-top">
            <td>{t.sequence}</td>
            <td className="break-all">{t.task_id}</td>
            <td className="font-mono">{t.status}</td>
            <td className="break-words">{t.detail}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
