import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { agentsQuery } from "./agents";
import { ApiError, type Client } from "./api/client";
import { followEvents, type Transition } from "./api/events";
import { RunBoard } from "./RunBoard";
import { countWords } from "./board";
import type { RunView } from "./guide";
import { Icon } from "./Icon";
import { log } from "./log";
import { newRunId, planFixes, proposalsQuery } from "./proposals";
import {
  attemptStartsOpen,
  type DiffTone,
  diffLines,
  diffStats,
  failureLabel,
  type Group,
  hasReviews,
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
  atBottom,
  type BadgeGroup,
  Button,
  Code,
  Confirm,
  CopyButton,
  FIELD,
  LABEL,
  Meta,
  plural,
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

export function RunPage({
  client,
  runId,
  live,
  interrupted,
  otherRun,
  onOpenPlan,
  runView,
  onRunView,
}: {
  client: Client;
  runId: string;
  live: boolean;
  interrupted: boolean;
  /** Another run that is active; this one cannot be reopened until it ends. */
  otherRun: string | null;
  onOpenPlan: (id: string) => void;
  runView: RunView;
  onRunView: (view: RunView) => void;
}) {
  const queryClient = useQueryClient();
  const report = useQuery(runQuery(client, runId));
  const proposals = useQuery(proposalsQuery(client));
  const agents = useQuery(agentsQuery(client));
  const [stopped, setStopped] = useState<string | null>(null);
  // The task open in the drawer, and whether it opened at its review band.
  const [drawer, setDrawer] = useState<{ task: string; review: boolean } | null>(null);

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
  const otherActive = otherRun !== null;
  const card = (task: TaskState) => (
    <TaskCard
      client={client}
      runId={runId}
      live={live}
      otherActive={otherActive}
      state={task}
      attempts={run?.attempts.filter((a) => a.task_id === task.task.id) ?? []}
    />
  );
  const opened = drawer && run?.tasks.find((t) => t.task.id === drawer.task);
  const fixes = run && state === "Finished" && hasReviews(run) && (
    <FixPlan client={client} runId={runId} onOpenPlan={onOpenPlan} />
  );

  return (
    <section aria-labelledby="run-title" className="flex min-h-full flex-col">
      <div className="max-w-280 space-y-6">
        <RunHeader client={client} runId={runId} state={state} run={run} otherRun={otherRun} />
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
        {!run && !report.error && <Loading />}
        {runView === "board" && fixes}
      </div>
      {run &&
        (runView === "board" ? (
          <RunBoard
            run={run}
            runId={runId}
            live={live}
            proposal={proposals.data?.proposals.find((p) => p.id === runId)}
            agents={agents.data?.agents}
            onOpenPlan={onOpenPlan}
            onOpenTask={(task, review) => setDrawer({ task, review })}
            controls={(task, extra) => (
              <TileControls
                client={client}
                runId={runId}
                live={live}
                otherActive={otherActive}
                state={task}
              >
                {extra}
              </TileControls>
            )}
          />
        ) : (
          <div className="max-w-280 space-y-6 pt-6 pb-22">
            <section aria-labelledby="tasks-title" className="space-y-3">
              <h2
                id="tasks-title"
                className="flex flex-wrap items-baseline gap-x-2 text-section font-semibold"
              >
                Tasks <span className={LABEL}>{tasksLabel(run.tasks)}</span>
              </h2>
              {/* The plan's order: live updates never move what the person is reading. */}
              <ul className="space-y-3">
                {run.tasks.map((task) => (
                  <li key={task.task.id}>{card(task)}</li>
                ))}
              </ul>
            </section>
            {fixes}
            <History transitions={run.transitions} tasks={run.tasks.map((t) => t.task.id)} />
          </div>
        ))}
      {run && <BoardBar view={runView} onView={onRunView} counts={countWords(run.tasks)} />}
      {opened && drawer && (
        <TaskDrawer
          key={opened.task.id}
          state={opened}
          review={drawer.review}
          onClose={() => setDrawer(null)}
        >
          {card(opened)}
        </TaskDrawer>
      )}
    </section>
  );
}

/** "4 · 1 waits for you", after the Tasks heading. */
function tasksLabel(tasks: TaskState[]): string {
  const waits = tasks.filter((t) => t.status === "AWAITING_APPROVAL").length;
  return `${tasks.length}${waits ? ` · ${waits} ${waits === 1 ? "waits" : "wait"} for you` : ""}`;
}

/** The pill at the foot of the run page: Board or List (remembered with the view), and the
 * task counts in words. */
function BoardBar({
  view,
  onView,
  counts,
}: {
  view: RunView;
  onView: (view: RunView) => void;
  counts: string;
}) {
  const name = useId();
  return (
    // Sticky in the main area's scroll; the page keeps 88px at its foot so nothing hides under it.
    <div className="pointer-events-none sticky bottom-4 z-10 -mt-16 flex justify-center">
      <div
        role="group"
        aria-label="View and counts"
        className="pointer-events-auto flex max-w-[calc(100%-32px)] flex-wrap items-center gap-3 rounded-full border border-line-strong bg-surface py-1 pr-3 pl-1"
      >
        <div
          role="radiogroup"
          aria-label="Show the run as"
          className="inline-flex rounded-full border border-line bg-code-bg p-0.5"
        >
          {(["board", "list"] as const).map((v) => (
            <label
              key={v}
              className="relative inline-flex h-[26px] cursor-pointer items-center rounded-full px-3 text-[12px] font-semibold text-ink-muted has-checked:bg-selected has-checked:text-ink has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus"
            >
              <input
                type="radio"
                name={name}
                checked={view === v}
                onChange={() => onView(v)}
                className="absolute inset-0 m-0 cursor-pointer opacity-0"
              />
              {v === "board" ? "Board" : "List"}
            </label>
          ))}
        </div>
        {counts && <span className={LABEL}>{counts}</span>}
      </div>
    </div>
  );
}

/** One task over the board: the List view's own card, in a modal dialog with a see-through
 * backdrop, so the board stays in sight and keeps updating. */
function TaskDrawer({
  state,
  review,
  onClose,
  children,
}: {
  state: TaskState;
  review: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { task } = state;
  // Taken at the first render, not in the effect: StrictMode runs effects twice in development,
  // and by the second run the focus is already inside the drawer.
  const [before] = useState(() => document.activeElement);

  useLayoutEffect(() => {
    const box = dialog.current;
    if (box && !box.open) box.showModal();
    // Review diff lands on the review band's first button; Open task on the card's title.
    const band = review ? box?.querySelector<HTMLElement>("[data-review-band]") : null;
    if (band) {
      band.scrollIntoView({ block: "start" });
      band.querySelector<HTMLElement>("button")?.focus();
    } else {
      box?.querySelector<HTMLElement>("[data-card-title]")?.focus();
    }
    return () => {
      // Back to the button that opened it. Deferred: while the modal is still in the page,
      // everything outside it is inert.
      if (before instanceof HTMLElement) setTimeout(() => before.isConnected && before.focus());
    };
  }, [review, before]);

  return (
    <dialog
      ref={dialog}
      aria-label={`Task ${task.id}`}
      // Esc closes the dialog and so does Close, so `close` is the one way out.
      onClose={onClose}
      className="task-drawer"
    >
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-panel py-2 pr-2 pl-4">
        <h2 title={task.title} className="min-w-0 flex-1 truncate text-body font-semibold">
          Task <Code>{task.id}</Code> · {task.title}
        </h2>
        <Button
          kind="ghost"
          small
          aria-label={`Close task ${task.id}`}
          onClick={() => dialog.current?.close()}
        >
          Close
        </Button>
      </div>
      <div className="p-4">{children}</div>
    </dialog>
  );
}

/** The lead agent plans fixes from this run's reviews; the plan waits for approval like any. */
function FixPlan({
  client,
  runId,
  onOpenPlan,
}: {
  client: Client;
  runId: string;
  onOpenPlan: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const plan = useMutation({
    mutationFn: () => planFixes(client, runId, { run_id: newRunId(new Date()) }),
    onSuccess: async (proposal) => {
      await queryClient.invalidateQueries({ queryKey: ["proposals"] });
      onOpenPlan(proposal.id);
    },
  });
  return (
    <section aria-labelledby="fixes-title" className="max-w-form space-y-3">
      <h2 id="fixes-title" className="text-section font-semibold">
        Fixes from the reviews
      </h2>
      <p className="text-ink-muted">
        The lead agent reads what the reviewer found and plans fixes for what must be fixed. You
        look the plan over and approve it before any work starts. Planning can take a few minutes.
      </p>
      <Confirm
        label="Plan fixes from the reviews"
        name={`Plan fixes from the reviews of run ${runId}`}
        icon="retry"
        question="Plan fixes with the lead agent? It uses your Claude account, so it is billed."
        yes="Yes, plan the fixes"
        keep="Not now"
        destructive={false}
        disabled={plan.isPending}
        busy={plan.isPending}
        onConfirm={() => plan.mutate()}
      />
      {plan.error && (
        <Alert
          title="Could not plan the fixes:"
          text={problem(plan.error)}
          onDismiss={() => plan.reset()}
        />
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
  otherRun,
}: {
  client: Client;
  runId: string;
  state: RunState;
  run: RunReport | undefined;
  otherRun: string | null;
}) {
  const control = useControl(client, runId);
  const busy = control.isPending;
  const doing = busy ? control.variables?.action : undefined;
  const send = (action: RunAction) => control.mutate({ action });
  const paused = run?.tasks.some((t) => t.status === "PAUSED") ?? false;
  // Recover and Retry reopen this run, which the server allows only while no other run is active.
  const reopenable =
    state === "Interrupted" ||
    (run?.tasks.some((t) => t.status === "FAILED" || t.status === "CANCELLED") ?? false);
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
          {otherRun && reopenable && (
            <p className="text-meta text-ink-muted wrap-anywhere">
              Run <Code>{otherRun}</Code> is active. One run at a time, so this run's Retry and
              Recover wait until it ends.
            </p>
          )}
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
          {state === "Interrupted" && !otherRun && (
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
  otherActive,
  state,
  attempts,
}: {
  client: Client;
  runId: string;
  live: boolean;
  otherActive: boolean;
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
  const newestFirst = [...attempts].sort((a, b) => b.number - a.number);

  return (
    <article
      aria-labelledby={titleId}
      className={`rounded-lg bg-surface ${waiting ? "border-2 border-needs-edge" : "border border-line"}`}
    >
      {/* The title strip, like a terminal window's bar. */}
      <div
        className={`flex items-start justify-between gap-3 border-b border-line bg-code-bg px-4 py-2 ${waiting ? "rounded-t-[8px]" : "rounded-t-[9px]"}`}
      >
        <h3
          id={titleId}
          tabIndex={-1}
          data-card-title
          className="min-w-0 text-body font-semibold wrap-anywhere"
        >
          {task.title}
        </h3>
        <StatusBadge {...STATUS[status]} />
      </div>
      <div className="px-4 pt-3 pb-4">
      <p>
        <Meta
          items={[
            <>
              Task <Code>{task.id}</Code>
            </>,
            <>
              Role <Code>{task.role}</Code>
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
      <TaskControls
        state={state}
        live={live}
        otherActive={otherActive}
        control={control}
        className="mt-3"
      />
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
      </div>
    </article>
  );
}

/** A task's own buttons (Pause, Resume, Retry, Cancel) as its card shows them; the board's tiles
 * use them too, with `children` (Review diff, Open task) after them. */
function TaskControls({
  state,
  live,
  otherActive,
  control,
  left = true,
  className = "",
  children,
}: {
  state: TaskState;
  live: boolean;
  otherActive: boolean;
  control: ControlState;
  /** Say how many attempts are left beside Retry; a tile's foot has no room for it. */
  left?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const { task, status } = state;
  const busy = control.isPending;
  const doing = busy ? control.variables?.action : undefined;
  const send = (action: TaskAction) => control.mutate({ action, task: task.id });
  const actions = taskActions(status, live, state.attempt_number, otherActive);
  const finished = status === "FAILED" || status === "CANCELLED";
  if (!children && !finished && !actions.some((a) => a !== "approve" && a !== "reject")) {
    return null;
  }
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
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
      {finished && left && (
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
      {children}
    </div>
  );
}

/** A tile's buttons, with their own pending state and refusal, as a card has. */
function TileControls({
  client,
  runId,
  live,
  otherActive,
  state,
  children,
}: {
  client: Client;
  runId: string;
  live: boolean;
  otherActive: boolean;
  state: TaskState;
  children: ReactNode;
}) {
  const control = useControl(client, runId);
  return (
    <>
      <TaskControls
        state={state}
        live={live}
        otherActive={otherActive}
        control={control}
        left={false}
      >
        {children}
      </TaskControls>
      {control.error && (
        <div className="basis-full">
          <Refusal control={control} object={`task ${state.task.id}`} />
        </div>
      )}
    </>
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
  const stats = `${plural(files, "file", "files")} · +${added} −${removed}`;
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
      data-review-band
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
            <thead className={`sticky top-0 bg-panel ${LABEL}`}>
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
