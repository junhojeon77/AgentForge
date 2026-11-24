// The pieces every screen shares, styled from the design (docs/design/agentforge).
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  useContext,
  useId,
  useState,
} from "react";
import { ApiError } from "./api/client";
import { Icon, type IconName } from "./Icon";
import { log } from "./log";
import type { Group } from "./runs";

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function problem(error: unknown): string {
  if (error instanceof ApiError) return error.detail ?? error.kind;
  // A check made before sending, such as a plan that is not JSON.
  return error instanceof Error ? error.message : "the request failed";
}

const KIND = {
  primary: "bg-accent text-on-accent enabled:hover:bg-accent-hover",
  secondary: "border border-line-strong bg-surface text-ink enabled:hover:bg-hover",
  // Outlined, so a destructive button never competes with the primary one.
  destructive: "border border-danger bg-surface text-danger enabled:hover:bg-danger-soft",
  confirm: "bg-danger text-on-danger enabled:hover:bg-danger-hover",
  ghost: "text-ink enabled:hover:bg-hover",
};
type Kind = keyof typeof KIND;

const BASE =
  "inline-flex shrink-0 items-center gap-2 rounded-md text-control font-semibold " +
  "disabled:cursor-not-allowed disabled:border disabled:border-line disabled:bg-panel " +
  "disabled:text-ink-muted";

const buttonClass = (kind: Kind, small: boolean) =>
  `${BASE} ${small ? "h-7 px-2" : "h-8 px-3"} ${KIND[kind]}`;

export const FIELD = "rounded-md border border-line-strong bg-surface px-2 py-1.5 text-ink";

/** A page's title and its one-line lede. */
export const PAGE_TITLE = "font-display text-page-title font-semibold wrap-anywhere";
export const LEDE = "max-w-[62ch] text-ink-muted";

/** A native button. While its request is in flight it shows the static arc; the label stays. */
export function Button({
  kind = "secondary",
  small = false,
  busy = false,
  icon,
  className = "",
  children,
  ...props
}: ComponentProps<"button"> & {
  kind?: Kind;
  small?: boolean;
  busy?: boolean;
  icon?: IconName;
}) {
  const shown = busy ? "working" : icon;
  return (
    <button
      type="button"
      {...props}
      aria-busy={busy || undefined}
      className={`${buttonClass(kind, small)} ${className}`}
    >
      {shown && <Icon name={shown} />}
      {children}
    </button>
  );
}

export type BadgeGroup = Group | "finished";

// Only Needs you, Working and Problem are filled; the others differ by word and icon shape.
const BADGES: Record<BadgeGroup, { style: string; icon: IconName }> = {
  needs: { style: "border border-needs-edge bg-needs-soft text-needs-ink", icon: "needs-you" },
  working: { style: "bg-working-soft text-working-ink", icon: "working" },
  problem: { style: "bg-problem-soft text-problem-ink", icon: "problem" },
  waiting: { style: "border border-line text-waiting-ink", icon: "waiting" },
  held: { style: "border border-line text-held-ink", icon: "held" },
  done: { style: "border border-line text-ink", icon: "done" },
  stopped: { style: "border border-line text-stopped-ink", icon: "stopped" },
  finished: { style: "border border-line text-ink", icon: "finished" },
};

/** A status in words; its colour and icon only repeat the word. */
export function StatusBadge({ group, label }: { group: BadgeGroup; label: string }) {
  const { style, icon } = BADGES[group];
  return (
    <span
      className={`inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full pr-2 pl-1.5 text-meta font-semibold whitespace-nowrap ${style}`}
    >
      <Icon name={icon} className={`size-3.5 ${group === "done" ? "text-done-ink" : ""}`} />
      {label}
    </span>
  );
}

/** How many things need the person, as a small amber count; its meaning is in `label`. */
export function NeedsCount({ count, label }: { count: number; label: string }) {
  if (count === 0) return null;
  return (
    <span
      title={label}
      className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full border border-needs-edge bg-needs-soft px-1 text-meta font-semibold text-needs-ink tabular-nums"
    >
      <span className="sr-only">{label}</span>
      <span aria-hidden="true">{count}</span>
    </span>
  );
}

const TONES = {
  problem: "border-problem-edge bg-problem-soft text-problem-ink",
  needs: "border-needs-edge bg-needs-soft text-needs-ink",
};

/** A refusal or error (problem), or a notice that needs the person (needs). The server's
 * message is quoted as plain text. */
export function Alert({
  tone = "problem",
  title,
  text = "",
  onDismiss,
  children,
}: {
  tone?: keyof typeof TONES;
  title?: string;
  text?: string;
  onDismiss?: () => void;
  children?: ReactNode;
}) {
  return (
    <div
      role={tone === "problem" ? "alert" : "status"}
      className={`flex flex-wrap items-start gap-2 rounded-md border px-3 py-2 text-[13px] ${TONES[tone]}`}
    >
      <Icon name={tone === "problem" ? "problem" : "needs-you"} className="mt-0.5 size-4 shrink-0" />
      <p className="min-w-0 flex-1 basis-48 whitespace-pre-wrap wrap-anywhere">
        {title && <strong className="font-semibold">{title} </strong>}
        {text}
      </p>
      {children}
      {onDismiss && (
        <Button kind="ghost" small onClick={onDismiss}>
          Dismiss
        </Button>
      )}
    </div>
  );
}

/** Copies text and says how it went. A failure is logged by name only: a diff can hold secrets. */
export async function copyText(
  text: string,
  what: string,
  clipboard: Pick<Clipboard, "writeText"> | undefined = globalThis.navigator?.clipboard,
): Promise<string> {
  try {
    if (!clipboard) throw new TypeError("this window has no clipboard");
    await clipboard.writeText(text);
    return "Copied.";
  } catch (error) {
    log.warn(`copy ${what} failed: ${error instanceof Error ? error.name : "error"}`);
    return `Could not copy: ${error instanceof Error ? error.message : "the clipboard refused"}`;
  }
}

export function CopyButton({
  text,
  what,
  label,
  name,
}: {
  text: string;
  what: string;
  label: string;
  name?: string;
}) {
  const [said, setSaid] = useState("");
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        kind="ghost"
        small
        icon="copy"
        aria-label={name}
        onClick={async () => setSaid(await copyText(text, what))}
      >
        {label}
      </Button>
      <span role="status" className="text-meta">
        {said}
      </span>
    </span>
  );
}

/** A button that asks first, in place. Focus goes to the safe answer; Escape keeps things as they
 * are and returns focus to the button. */
export function Confirm({
  label,
  name,
  question,
  yes = "Yes, cancel",
  keep,
  icon,
  small = false,
  destructive = true,
  disabled,
  busy = false,
  onConfirm,
}: {
  label: string;
  name?: string;
  question: string;
  yes?: string;
  keep: string;
  icon?: IconName;
  small?: boolean;
  // Not destructive: a question such as billing consent, not a danger.
  destructive?: boolean;
  disabled: boolean;
  busy?: boolean;
  onConfirm: () => void;
}) {
  const [step, setStep] = useState<"idle" | "asking" | "kept">("idle");
  if (step !== "asking") {
    return (
      <Button
        kind={destructive ? "destructive" : "primary"}
        small={small}
        icon={icon}
        busy={busy}
        aria-label={name}
        autoFocus={step === "kept"}
        disabled={disabled}
        onClick={() => setStep("asking")}
      >
        {label}
      </Button>
    );
  }
  return (
    <div
      role="group"
      aria-label={question}
      onKeyDown={(e) => {
        if (e.key === "Escape") setStep("kept");
      }}
      className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 ${
        destructive ? "border-danger bg-danger-soft" : "border-line-strong bg-panel"
      }`}
    >
      <span className="text-[13px] font-semibold text-ink">{question}</span>
      <Button
        kind={destructive ? "confirm" : "primary"}
        small
        onClick={() => {
          setStep("idle");
          onConfirm();
        }}
      >
        {yes}
      </Button>
      <Button small autoFocus onClick={() => setStep("kept")}>
        {keep}
      </Button>
    </div>
  );
}

/** A required reason and its submit button, e.g. for a reject. With `onKeep` it also offers
 * "Keep reviewing" (and Escape) to go back without sending. */
export function ReasonForm({
  label,
  hint,
  button,
  name,
  kind = "confirm",
  disabled,
  busy = false,
  onSubmit,
  onKeep,
}: {
  label: string;
  hint?: string;
  button: string;
  // Outlined where the form is always open, so it does not compete with the page's primary.
  kind?: "confirm" | "destructive";
  name?: string;
  disabled: boolean;
  busy?: boolean;
  onSubmit: (reason: string) => void;
  onKeep?: () => void;
}) {
  const [reason, setReason] = useState("");
  const reasonId = useId();
  const hintId = useId();
  return (
    <form
      className="space-y-2"
      onKeyDown={(e) => {
        if (onKeep && e.key === "Escape") onKeep();
      }}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(reason.trim());
      }}
    >
      <label htmlFor={reasonId} className="block text-[13px] font-semibold">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="text-meta">
          {hint}
        </p>
      )}
      <textarea
        id={reasonId}
        required
        autoFocus={onKeep !== undefined}
        aria-describedby={hint ? hintId : undefined}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className={`block min-h-16 w-full ${FIELD}`}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          kind={kind}
          icon="reject"
          busy={busy}
          aria-label={name}
          disabled={disabled || !reason.trim()}
        >
          {button}
        </Button>
        {onKeep && (
          <Button kind="ghost" onClick={onKeep}>
            Keep reviewing
          </Button>
        )}
      </div>
    </form>
  );
}

/** True in the technical view: every More options section starts open. */
export const TechnicalView = createContext(false);

const SUMMARY = "cursor-pointer list-none [&::-webkit-details-marker]:hidden";
// Keyed to the fold's own details, unlike `group-open:`, which any open ancestor would match.
const CHEVRON = "size-4 shrink-0 text-ink-muted [details[open]>summary>&]:rotate-90";

/** A fold: a summary row with a hint of what is inside, then its content indented, not boxed. A
 * hand toggle lasts until the screen is left; `open` (a field error inside) always opens it. */
export function Fold({
  label,
  hint,
  startOpen,
  open: force = false,
  rule = true,
  children,
}: {
  label: string;
  hint?: string;
  startOpen: boolean;
  open?: boolean;
  /** The line above that marks where the plain fields end. */
  rule?: boolean;
  children: ReactNode;
}) {
  const [hand, setHand] = useState<boolean>();
  const open = force || (hand ?? startOpen);
  return (
    <details
      open={open}
      // Fired for React's own changes too; only a toggle that differs from the render is a hand's.
      onToggle={(e) => {
        if (e.currentTarget.open !== open) setHand(e.currentTarget.open);
      }}
      className={rule ? "border-t border-line" : undefined}
    >
      <summary
        className={`${SUMMARY} my-1 -ml-2 flex min-h-8 items-center gap-2 rounded-md px-2 text-[13px] hover:bg-hover`}
      >
        <Icon name="chevron" className={CHEVRON} />
        <span className="font-semibold whitespace-nowrap text-ink">{label}</span>
        {hint && (
          <span className="min-w-0 truncate text-meta text-ink-muted [details[open]>summary>&]:hidden">
            {hint}
          </span>
        )}
      </summary>
      <div className="flex flex-col gap-3 pb-4 pl-6">{children}</div>
    </details>
  );
}

// Technical controls stay one click away; the view chosen on the welcome screen decides
// whether they start open.
export function MoreOptions(props: {
  hint?: string;
  open?: boolean;
  rule?: boolean;
  children: ReactNode;
}) {
  return <Fold label="More options" startOpen={useContext(TechnicalView)} {...props} />;
}

/** Work only developers do, such as writing a plan as JSON. Folded in both views: a large editor
 * open by default would push the plain path down. */
export function ForDevelopers({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="rounded-lg border border-line bg-canvas">
      <summary
        className={`${SUMMARY} flex flex-wrap items-center gap-2 rounded-lg px-4 py-3 font-semibold hover:bg-hover [details[open]>&]:rounded-b-none [details[open]>&]:border-b [details[open]>&]:border-line`}
      >
        <Icon name="chevron" className={CHEVRON} />
        {title}
        <span className="rounded-full border border-line px-1.5 font-mono text-[11px] leading-4 font-normal text-ink-muted">
          for developers
        </span>
      </summary>
      <div className="flex flex-col gap-3 p-4">{children}</div>
    </details>
  );
}

/** A labelled field; `children` gets the input's id and the hint's, for `aria-describedby`. */
export function Field({
  label,
  hint,
  lead = false,
  children,
}: {
  label: string;
  hint?: ReactNode;
  /** The screen's main field: a larger label. */
  lead?: boolean;
  children: (id: string, hintId: string | undefined) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label
        htmlFor={id}
        className={`font-semibold text-ink ${lead ? "text-body" : "text-control"}`}
      >
        {label}
      </label>
      {children(id, hintId)}
      {hint && (
        <div id={hintId} className="text-meta text-ink-muted">
          {hint}
        </div>
      )}
    </div>
  );
}
