import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ApiError, type Client } from "./api/client";
import { followEvents, type Transition } from "./api/events";
import { Icon } from "./Icon";
import { log } from "./log";
import {
  attemptStartsOpen,
  type DiffTone,
  diffLines,
  diffStats,
  failureLabel,
  type Group,
  type RunAction,
  type RunReport,
  retriesLeft,
  reviewAttempt,
  runSummary,
  STATUS,
  sendControl,
  stripAnsi,
  type TaskAction,
  type TaskAttempt,
  type TaskState,
  type TaskStatus,
  taskActions,
} from "./runs";
import {
  Alert,
  type BadgeGroup,
  Button,
  Confirm,
  CopyButton,
  FIELD,
  problem,
  ReasonForm,
  StatusBadge,
} from "./ui";

/** The run report query; the side list shares it for the active run's waiting-diffs count. */
export const runQuery = (client: Client, runId: string) =>
  queryOptions({
    queryKey: ["run", runId],
    queryFn: ({ signal }) =>
      client.request<RunReport>(`/runs/${encodeURIComponent(runId)}`, { signal }),
    retry: false,
  });

// Colour only repeats the +, -, @@ and header text that the line already shows.
const TONES: Record<DiffTone, string> = {
  file: "bg-diff-file-soft text-diff-file-ink font-semibold",
  hunk: "bg-diff-hunk-soft text-diff-hunk-ink",
  added: "bg-diff-add-soft text-diff-add-ink",
  removed: "bg-diff-del-soft text-diff-del-ink",
};

const INK: Record<Group, string> = {
  needs: "text-needs-ink",
  working: "text-working-ink",
  problem: "text-problem-ink",
  waiting: "text-waiting-ink",
  held: "text-held-ink",
  done: "text-done-ink",
  stopped: "text-stopped-ink",
};

const WORDS: Record<TaskAction | RunAction, string> = {
  pause: "Pause",
  resume: "Resume",
  cancel: "Cancel",
  recover: "Recover",
  approve: "Approve diff",
  reject: "Reject diff",
  retry: "Retry",
};

type RunState = "Active" | "Interrupted" | "Finished";
const RUN_GROUP: Record<RunState, BadgeGroup> = {
  Active: "working",
  Interrupted: "needs",
  Finished: "finished",
};

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

type ControlState = ReturnType<typeof useControl>;

/** The server's refusal, under the control group that was used, until dismissed or clicked again. */
function Refusal({ control, object }: { control: ControlState; object: string }) {
  if (!control.error || !control.variables) return null;
  return (
    <Alert
      title={`Server refused ${WORDS[control.variables.action]} for ${object}:`}
      text={problem(control.error)}
      onDismiss={() => control.reset()}
    />
  );
}

function Code({ children }: { children: ReactNode }) {
  return <code className="font-mono">{children}</code>;
}

/** A `meta` line: items joined by " · ", empty ones left out. */
function Meta({ items, className = "" }: { items: ReactNode[]; className?: string }) {
  const shown = items.filter(Boolean);
  return (
    <span className={`text-meta text-ink-muted wrap-anywhere ${className}`}>
      {shown.map((item, i) => (
        // Items never move, so their position is a stable key.
        <Fragment key={i}>
          {i > 0 && " · "}
          {item}
        </Fragment>
      ))}
    </span>
  );
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
  const report = useQuery(runQuery(client, runId));
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
  const state: RunState = live ? "Active" : interrupted ? "Interrupted" : "Finished";

  return (
    <section aria-labelledby="run-title" className="space-y-6">
      <RunHeader client={client} runId={runId} state={state} run={run} />
      {live && stopped && (
        <Alert
          tone="needs"
          title="Live updates stopped:"
          text={`${stopped}. What you see may be out of date.`}
        />
      )}
      {report.error && (
        <Alert title={`Could not load run ${runId}:`} text={problem(report.error)}>
          <Button small onClick={() => void report.refetch()}>
            Try again
          </Button>
        </Alert>
      )}
      {!run ? (
        !report.error && <Loading />
      ) : (
        <>
          <section aria-labelledby="tasks-title" className="space-y-3">
            <h2 id="tasks-title" className="text-section font-semibold">
              Tasks · {run.tasks.length}
            </h2>
            {/* The plan's order: live updates never move what the person is reading. */}
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
          </section>
          <History transitions={run.transitions} tasks={run.tasks.map((t) => t.task.id)} />
        </>
      )}
    </section>
  );
}

function Loading() {
  return (
    <div className="space-y-3">
      <p role="status" className="flex items-center gap-2 text-ink-muted">
        <Icon name="working" />
        Loading run…
      </p>
      <div aria-hidden="true" className="space-y-3">
        <div className="h-24 rounded-lg bg-hover" />
        <div className="h-24 rounded-lg bg-hover" />
      </div>
    </div>
  );
}

function RunHeader({
  client,
  runId,
  state,
  run,
}: {
  client: Client;
  runId: string;
  state: RunState;
  run: RunReport | undefined;
}) {
  const control = useControl(client, runId);
  const busy = control.isPending;
  const doing = busy ? control.variables?.action : undefined;
  const send = (action: RunAction) => control.mutate({ action });
  const paused = run?.tasks.some((t) => t.status === "PAUSED") ?? false;
  return (
    <header className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {/* Ids such as req-20261121-093000 do not say "run", so the title does. */}
            <h1 id="run-title" className="font-display text-page-title font-semibold wrap-anywhere">
              Run {runId}
            </h1>
            <CopyButton
              text={runId}
              what="run id"
              label="Copy run id"
              name={`Copy run id ${runId}`}
            />
          </div>
          <p className="flex flex-wrap items-center gap-2">
            <StatusBadge group={RUN_GROUP[state]} label={state} />
            {run && <Meta items={[runSummary(run.tasks)]} />}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {state === "Active" && (
            <>
              <Button
                icon="held"
                aria-label={`Pause run ${runId}`}
                disabled={busy}
                busy={doing === "pause"}
                onClick={() => send("pause")}
              >
                Pause run
              </Button>
              {paused && (
                <Button
                  icon="resume"
                  aria-label={`Resume run ${runId}`}
                  disabled={busy}
                  busy={doing === "resume"}
                  onClick={() => send("resume")}
                >
                  Resume run
                </Button>
              )}
              <Confirm
                label="Cancel run"
                name={`Cancel run ${runId}`}
                icon="cancel"
                question={`Stop run ${runId}? Every running worker stops now.`}
                keep="Keep running"
                disabled={busy}
                busy={doing === "cancel"}
                onConfirm={() => send("cancel")}
              />
            </>
          )}
          {state === "Interrupted" && (
            <Button
              kind="primary"
              icon="retry"
              aria-label={`Recover run ${runId}`}
              disabled={busy}
              busy={doing === "recover"}
              onClick={() => send("recover")}
            >
              Recover run
            </Button>
          )}
        </div>
      </div>
      <Refusal control={control} object={`run ${runId}`} />
    </header>
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
  const doing = busy ? control.variables?.action : undefined;
  const send = (action: TaskAction, reason?: string) =>
    control.mutate({ action, task: task.id, reason });
  const actions = taskActions(status, live, state.attempt_number);
  const checks = task.execution_constraints
    .filter((c) => c.startsWith("check:"))
    .map((c) => c.slice("check:".length));
  const waiting = status === "AWAITING_APPROVAL";
  const failure = state.failure_reason;
  const reviewing =
    control.variables?.action === "approve" || control.variables?.action === "reject";
  const banded = reviewAttempt(state, live, attempts);
  // A review refusal shows in the band only while the band is on screen.
  const inBand = reviewing && banded !== null;
  const finished = status === "FAILED" || status === "CANCELLED";
  const newestFirst = [...attempts].sort((a, b) => b.number - a.number);

  return (
    <li
      aria-labelledby={titleId}
      className={`rounded-lg bg-surface p-4 ${waiting ? "border-2 border-needs-edge" : "border border-line"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 id={titleId} className="min-w-0 text-section font-semibold wrap-anywhere">
          {task.title}
        </h3>
        <StatusBadge {...STATUS[status]} />
      </div>
      <p className="mt-1">
        <Meta
          items={[
            <>
              Task <Code>{task.id}</Code>
            </>,
            <>
              Agent <Code>{task.role}</Code>
            </>,
            state.attempt_number
              ? `Attempt ${state.attempt_number} of ${task.max_attempts}`
              : "No attempts yet",
            task.allowed_operations.includes("edit") ? "May edit" : "Read-only",
            checks.length > 0 && `checks on approve: ${checks.join(", ")}`,
            task.dependencies.length > 0 && (
              <>
                After{" "}
                {task.dependencies.map((d, i) => (
                  <Fragment key={d}>
                    {i > 0 && ", "}
                    <Code>{d}</Code>
                  </Fragment>
                ))}
              </>
            ),
          ]}
        />
      </p>
      {failure && (
        <p className="text-meta text-problem-ink wrap-anywhere">
          {failureLabel(failure) && `${failureLabel(failure)} · `}
          <Code>{failure}</Code>
        </p>
      )}
      {state.message && (
        <p className="mt-2 whitespace-pre-wrap wrap-anywhere">Note: {state.message}</p>
      )}
      {(finished || actions.some((a) => a !== "approve" && a !== "reject")) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {actions.includes("pause") && (
            <Button
              small
              icon="held"
              aria-label={`Pause task ${task.id}`}
              disabled={busy}
              busy={doing === "pause"}
              onClick={() => send("pause")}
            >
              Pause
            </Button>
          )}
          {actions.includes("resume") && (
            <Button
              small
              icon="resume"
              aria-label={`Resume task ${task.id}`}
              disabled={busy}
              busy={doing === "resume"}
              onClick={() => send("resume")}
            >
              Resume
            </Button>
          )}
          {actions.includes("retry") && (
            <Button
              small
              icon="retry"
              aria-label={`Retry task ${task.id}`}
              disabled={busy}
              busy={doing === "retry"}
              onClick={() => send("retry")}
            >
              Retry
            </Button>
          )}
          {finished && (
            <span className="text-meta text-ink-muted">{retriesLeft(state.attempt_number)}</span>
          )}
          {actions.includes("cancel") && (
            <Confirm
              label="Cancel"
              name={`Cancel task ${task.id}`}
              icon="cancel"
              small
              question={`Stop task ${task.id}? Its worker stops now; you can retry it.`}
              keep="Keep it"
              disabled={busy}
              busy={doing === "cancel"}
              onConfirm={() => send("cancel")}
            />
          )}
        </div>
      )}
      {!inBand && (
        <div className="mt-2">
          <Refusal control={control} object={`task ${task.id}`} />
        </div>
      )}
      {newestFirst.length > 0 && (
        <div className="mt-3 divide-y divide-line border-t border-line">
          {newestFirst.map((attempt) => {
            const review = attempt.number === banded;
            const latest = attempt.number === state.attempt_number;
            return (
              <Attempt
                key={attempt.number}
                attempt={attempt}
                taskId={task.id}
                open={attemptStartsOpen(attempt.number, state)}
                running={latest && STATUS[status].group === "working" && !attempt.result}
                review={review}
              >
                {review && (
                  <ReviewBand
                    taskId={task.id}
                    checks={checks}
                    busy={busy}
                    doing={doing}
                    onApprove={() => send("approve")}
                    onReject={(reason) => send("reject", reason)}
                  >
                    {inBand && <Refusal control={control} object={`task ${task.id}`} />}
                  </ReviewBand>
                )}
              </Attempt>
            );
          })}
        </div>
      )}
    </li>
  );
}

function Attempt({
  attempt,
  taskId,
  open,
  running,
  review,
  children,
}: {
  attempt: TaskAttempt;
  taskId: string;
  open: boolean;
  running: boolean;
  review: boolean;
  children?: ReactNode;
}) {
  const { result, failure_reason: code } = attempt;
  const why =
    code === "review_rejected"
      ? "Your reason"
      : code === "validation_rejected"
        ? "Check output"
        : code
          ? "Agent error"
          : "Note";
  const where = `for task ${taskId}, attempt ${attempt.number}`;
  return (
    <details open={open} className="group py-2">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 [&::-webkit-details-marker]:hidden">
        <Icon name="chevron" className="size-4 text-ink-muted group-open:rotate-90" />
        <span className="font-semibold tabular-nums">Attempt {attempt.number}</span>
        <StatusBadge {...STATUS[attempt.status]} />
        <Meta
          items={[
            <>
              Agent <Code>{attempt.worker_id}</Code>
            </>,
            code && failureLabel(code),
            code && <Code>{code}</Code>,
          ]}
        />
      </summary>
      <div className="mt-2 space-y-3">
        {running && <p className="text-ink-muted">The agent is working on this attempt.</p>}
        {attempt.message && <LongText label={why} name={`${why} ${where}`} text={attempt.message} />}
        {result?.message && (
          <LongText label="Agent report" name={`Agent report ${where}`} text={result.message} />
        )}
        {result && <DiffView diff={result.diff} where={where} folded={!review} />}
        {children}
      </div>
    </details>
  );
}

// Agent output and reasons are untrusted: always plain text, never HTML.
function LongText({ label, name, text }: { label: string; name: string; text: string }) {
  return (
    <div className="space-y-1">
      <p className="text-meta font-semibold text-ink-muted">{label}</p>
      <pre
        tabIndex={0}
        role="region"
        aria-label={name}
        className="max-h-60 overflow-auto rounded-md border border-line bg-code-bg px-3 py-2 font-mono text-code-block whitespace-pre-wrap text-ink wrap-anywhere"
      >
        {stripAnsi(text)}
      </pre>
    </div>
  );
}

function DiffView({ diff, where, folded }: { diff: string; where: string; folded: boolean }) {
  if (!diff) {
    return (
      <p className="rounded-md border border-line bg-code-bg px-3 py-2 text-ink-muted">
        No changes. This attempt left the project's files as they were.
      </p>
    );
  }
  const { files, added, removed } = diffStats(diff);
  const stats = `${files} ${files === 1 ? "file" : "files"} · +${added} −${removed}`;
  const body = (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-meta text-ink-muted">{stats}</span>
        <CopyButton text={diff} what="diff" label="Copy diff" name={`Copy diff ${where}`} />
      </div>
      <pre
        tabIndex={0}
        role="region"
        aria-label={`Diff ${where}`}
        className="max-h-[420px] overflow-auto rounded-md border border-line bg-code-bg font-mono text-code-block"
      >
        {/* The inner block is as wide as the longest line, so line colours span the scroll. */}
        <code className="inline-block min-w-full py-1">
          {diffLines(diff).map(({ text, tone }, i) => (
            // Lines never move or change, so their position is a stable key.
            <span
              key={i}
              className={`block px-3 whitespace-pre ${tone ? TONES[tone] : "text-diff-ctx-ink"}`}
            >
              {text || " "}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
  if (!folded) {
    return (
      <div className="space-y-1">
        <p className="text-meta font-semibold text-ink-muted">Diff</p>
        {body}
      </div>
    );
  }
  return (
    <details>
      <summary className="cursor-pointer text-meta font-semibold text-ink-muted">
        Diff · {stats}
      </summary>
      <div className="mt-1">{body}</div>
    </details>
  );
}

/** The review: the band at the foot of the waiting attempt, edge to edge across the card. */
function ReviewBand({
  taskId,
  checks,
  busy,
  doing,
  onApprove,
  onReject,
  children,
}: {
  taskId: string;
  checks: string[];
  busy: boolean;
  doing: TaskAction | RunAction | undefined;
  onApprove: () => void;
  onReject: (reason: string) => void;
  children?: ReactNode;
}) {
  const [step, setStep] = useState<"review" | "reject" | "back">("review");
  return (
    <div
      role="group"
      aria-label={`Review the diff for task ${taskId}`}
      className="-mx-4 space-y-2 border-t-2 border-needs-edge bg-needs-soft px-4 pt-3 pb-4 text-needs-ink"
    >
      {step === "reject" ? (
        <ReasonForm
          label="Why reject? The next attempt is told this."
          hint="Your reason is kept with this attempt and given to the next one."
          button="Reject diff"
          name={`Reject diff for task ${taskId}`}
          disabled={busy}
          busy={doing === "reject"}
          onSubmit={onReject}
          onKeep={() => setStep("back")}
        />
      ) : (
        <>
          <p className="font-semibold">This diff waits for your review</p>
          <p className="text-[13px]">
            {checks.length > 0
              ? `Approve to run the checks named on the card: ${checks.join(", ")}.`
              : "Approve to accept it; this task has no checks to run."}{" "}
            Reject to fail this attempt; the next attempt starts from a clean copy and is told your
            reason.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              kind="primary"
              icon="approve"
              aria-label={`Approve diff for task ${taskId}`}
              disabled={busy}
              busy={doing === "approve"}
              onClick={onApprove}
            >
              Approve diff
            </Button>
            <Button
              kind="destructive"
              icon="reject"
              aria-label={`Reject diff for task ${taskId}`}
              autoFocus={step === "back"}
              disabled={busy}
              onClick={() => setStep("reject")}
            >
              Reject diff
            </Button>
          </div>
        </>
      )}
      {children}
    </div>
  );
}

const atBottom = (box: HTMLElement) => box.scrollHeight - box.scrollTop - box.clientHeight < 2;

function History({ transitions, tasks }: { transitions: Transition[]; tasks: string[] }) {
  const [only, setOnly] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const pinned = useRef(false);
  const rows = only ? transitions.filter((t) => t.task_id === only) : transitions;

  // New rows keep the person at the bottom only if they were already there.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    if (pinned.current) el.scrollTop = el.scrollHeight;
    pinned.current = atBottom(el);
  }, [rows.length]);

  return (
    <section aria-labelledby="history-title" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="history-title" className="text-section font-semibold">
          History · {transitions.length}
        </h2>
        {transitions.length > 0 && (
          <label className="flex items-center gap-2 text-meta text-ink-muted">
            Show task
            <select
              value={only}
              onChange={(e) => setOnly(e.target.value)}
              className={`${FIELD} py-1 text-meta`}
            >
              <option value="">All tasks</option>
              {tasks.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {transitions.length === 0 ? (
        <p className="text-ink-muted">Nothing has happened yet.</p>
      ) : (
        <div
          ref={box}
          tabIndex={0}
          role="region"
          aria-label="Run history"
          onScroll={(e) => {
            pinned.current = atBottom(e.currentTarget);
          }}
          className="max-h-[360px] overflow-auto rounded-md border border-line bg-surface"
        >
          <table className="w-full border-collapse text-left text-[13px]">
            <thead className="sticky top-0 bg-panel text-meta font-semibold text-ink-muted">
              <tr>
                <th scope="col" className="px-3 py-2 text-right">
                  #
                </th>
                <th scope="col" className="px-3 py-2">
                  Task
                </th>
                <th scope="col" className="px-3 py-2">
                  New status
                </th>
                <th scope="col" className="px-3 py-2">
                  Reason
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const known = STATUS[t.status as TaskStatus];
                return (
                  <tr key={t.sequence} className="border-t border-line align-top">
                    <td className="px-3 py-1.5 text-right text-ink-muted tabular-nums">
                      {t.sequence}
                    </td>
                    <td className="px-3 py-1.5 font-mono wrap-anywhere">{t.task_id}</td>
                    <td className={`px-3 py-1.5 font-mono ${known ? INK[known.group] : ""}`}>
                      {t.status}
                    </td>
                    <td className="px-3 py-1.5 whitespace-pre-wrap wrap-anywhere">{t.detail}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
