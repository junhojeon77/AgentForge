// The welcome screen, the tour and the side list's view switch; guide.ts keeps the choices.
import { useId, useLayoutEffect, useRef, useState } from "react";
import type { View } from "./guide";
import { log } from "./log";
import { Button } from "./ui";

const VIEWS: { view: View; label: string; means: string }[] = [
  { view: "plain", label: "Plain", means: "Technical options start folded under More options." },
  { view: "technical", label: "Technical", means: "Technical options start open." },
];

const HOW = [
  "You ask for something in your own words.",
  "The lead agent turns it into a plan; you look it over and approve it.",
  "Your team builds it, each task in its own copy of your project.",
  "You review each change and approve or reject it.",
];

/** The first screen: how AgentForge works, the view choice, then whether to take the tour. The
 * view is saved as soon as it is chosen. */
export function Welcome({
  view,
  onView,
  onDone,
}: {
  view: View;
  onView: (view: View) => void;
  onDone: (takeTour: boolean) => void;
}) {
  const name = useId();
  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="grid min-h-full grid-cols-[minmax(0,1fr)_minmax(0,380px)] content-center gap-x-14 gap-y-8 px-16 py-14 max-[720px]:grid-cols-1 max-[720px]:px-6 max-[720px]:py-8">
        <div>
          <p className="mb-6 font-display font-semibold text-ink-muted">AgentForge</p>
          <h1 className="font-display text-welcome font-semibold">Welcome to AgentForge</h1>
          <p className="mt-3 mb-8 max-w-[52ch] text-[15px] leading-[22px]">
            Ask for something in plain words and a team of AI agents builds it on this computer.
            Nothing starts and no change is accepted without your OK.
          </p>
          <section aria-labelledby={`${name}-how`}>
            <h2 id={`${name}-how`} className="mb-3 text-section font-semibold">
              How it works
            </h2>
            <ol className="flex flex-col gap-3">
              {HOW.map((step, i) => (
                <li key={step} className="grid grid-cols-[24px_minmax(0,1fr)] gap-2">
                  <span aria-hidden="true" className="font-semibold text-accent tabular-nums">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </section>
        </div>
        {/* Top-aligned with the first step on a wide window. */}
        <div className="flex flex-col gap-6 pt-[60px] max-[720px]:pt-0">
          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className="mb-2 text-section font-semibold">How should the app look?</legend>
            {VIEWS.map((v) => (
              <label
                key={v.view}
                className="group grid cursor-pointer grid-cols-[18px_minmax(0,1fr)] gap-x-2 gap-y-0.5 rounded-md border border-line-strong bg-surface px-3 py-2 has-checked:border-accent has-checked:bg-selected has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus"
              >
                <input
                  type="radio"
                  name={name}
                  checked={view === v.view}
                  onChange={() => onView(v.view)}
                  // The row shows the focus ring instead.
                  className="mt-0.5 size-4 focus-visible:outline-none"
                />
                <span className="font-semibold">{v.label}</span>
                <span className="col-start-2 text-[13px] leading-[18px] text-ink-muted group-has-checked:text-ink">
                  {v.means}
                </span>
              </label>
            ))}
            <p className="text-meta text-ink-muted">
              You can change this later at the bottom of the side list.
            </p>
          </fieldset>
          <div className="flex flex-col gap-3">
            <p>Want a short tour? It points at each part of the window in turn.</p>
            <div className="flex flex-wrap gap-2">
              <Button kind="primary" autoFocus onClick={() => onDone(true)}>
                Take the tour
              </Button>
              <Button kind="ghost" onClick={() => onDone(false)}>
                Skip the tour
              </Button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

export type Side = "right" | "left" | "below" | "above";
type Box = { top: number; left: number; width: number; height: number };
type Size = { width: number; height: number };

const GAP = 8; // between the card and its target
const EDGE = 8; // kept free at the window's edges
// The side tried first, then the ones tried after it when the window has no room.
const TRIES: Record<Side, Side[]> = {
  right: ["right", "left", "below", "above"],
  left: ["left", "right", "below", "above"],
  below: ["below", "above"],
  above: ["above", "below"],
};
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(value, high));

/** Where the tour card goes beside its target, and where along its edge the notch points. Measured
 * rather than left to CSS, because the notch must know which side the card ended up on. */
export function placeCard(target: Box, card: Size, view: Size, prefer: Side) {
  const bottom = target.top + target.height;
  const right = target.left + target.width;
  const fits: Record<Side, boolean> = {
    right: right + GAP + card.width <= view.width - EDGE,
    left: target.left - GAP - card.width >= EDGE,
    below: bottom + GAP + card.height <= view.height - EDGE,
    above: target.top - GAP - card.height >= EDGE,
  };
  const side = TRIES[prefer].find((s) => fits[s]) ?? prefer;
  const maxTop = view.height - card.height - EDGE;
  const maxLeft = view.width - card.width - EDGE;
  if (side === "right" || side === "left") {
    const middle = target.top + target.height / 2;
    const top = clamp(middle - 28, EDGE, maxTop);
    const left = side === "right" ? right + GAP : target.left - GAP - card.width;
    return {
      side,
      top,
      left: clamp(left, EDGE, maxLeft),
      notch: clamp(middle - top - 6, 12, card.height - 24),
    };
  }
  const top = side === "below" ? bottom + GAP : target.top - GAP - card.height;
  const left = clamp(target.left + 12, EDGE, maxLeft);
  // Near the start of a wide target (the status bar's words), the middle of a narrow one.
  const point = target.left + Math.min(40, target.width / 2);
  return {
    side,
    top: clamp(top, EDGE, maxTop),
    left,
    notch: clamp(point - left - 6, 12, card.width - 24),
  };
}

// `target` matches a `data-tour` attribute in App; `side` is where the card goes first.
const STEPS: { target: string; side: Side; title: string; text: string }[] = [
  {
    target: "ask",
    side: "right",
    title: "Ask for something",
    text: "Start here. Say what you want built in your own words; the lead agent turns it into a plan you approve before any work starts.",
  },
  {
    target: "plans",
    side: "right",
    title: "Plans",
    text: "Plans waiting for your OK show here, marked in amber. Open one to read its tasks and decide what each task may do.",
  },
  {
    target: "runs",
    side: "right",
    title: "Runs",
    text: "Each approved plan becomes a run. Follow its tasks as they work, and review every change before it is accepted.",
  },
  {
    target: "team",
    side: "right",
    title: "Your team",
    text: "The agents that do the work. Change how each one should work, or add a new one.",
  },
  {
    target: "status",
    side: "below",
    title: "The status bar",
    text: "Shows whether the app can reach the AgentForge server on this computer. If it can't, the steps to start it appear below.",
  },
  {
    target: "view",
    side: "above",
    title: "View and guide",
    text: "Switch between the Plain and Technical view here, or open this guide again.",
  },
];

// The notch is a square turned 45°; the two borders facing the target show.
const NOTCH: Record<Side, string> = {
  right: "-left-[7px] border-t-0 border-r-0",
  left: "-right-[7px] border-b-0 border-l-0",
  below: "-top-[7px] border-r-0 border-b-0",
  above: "-bottom-[7px] border-t-0 border-l-0",
};

type Placed = ReturnType<typeof placeCard>;

/** A card beside each part of the window in turn. The window waits while it is open; Esc or
 * End tour stops it. Every target is part of the connected frame, so App shows it only then. */
export function Tour({ onEnd }: { onEnd: (finished: boolean) => void }) {
  const [index, setIndex] = useState(0);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const id = useId();
  const step = STEPS[index];
  const last = index === STEPS.length - 1;

  // Opened before the step's effect below, so Next takes the focus, not the first button.
  useLayoutEffect(() => {
    const before = document.activeElement;
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
    return () => {
      // Focus goes back where it was. Deferred: while the modal is still in the page,
      // everything outside it is inert.
      if (before instanceof HTMLElement) setTimeout(() => before.isConnected && before.focus());
    };
  }, []);

  // The highlight and the card's place follow the step, and the window's size.
  useLayoutEffect(() => {
    log.debug(`guide: tour step ${index + 1} of ${STEPS.length} (${step.target})`);
    const target = document.querySelector(`[data-tour="${step.target}"]`);
    target?.setAttribute("data-tour-current", "");
    next.current?.focus();
    const place = () => {
      const card = dialog.current?.getBoundingClientRect();
      const view = { width: window.innerWidth, height: window.innerHeight };
      setPlaced(target && card ? placeCard(target.getBoundingClientRect(), card, view, step.side) : null);
    };
    place();
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("resize", place);
      target?.removeAttribute("data-tour-current");
    };
  }, [index, step]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      // Esc closes the dialog, and Chromium may skip `cancel`, so `close` ends the tour. The
      // buttons end it without closing; the dialog then leaves with the component.
      onClose={() => onEnd(false)}
      // Without a target it stays where the browser centres a modal.
      style={placed ? { margin: 0, inset: "auto", top: placed.top, left: placed.left } : undefined}
      // No shadow: its border and ground set it apart. The notch sits outside its box.
      className="tour-card w-tour max-w-[calc(100vw-16px)] overflow-visible rounded-lg border border-line-strong bg-surface p-4 text-ink"
    >
      {placed && (
        <span
          aria-hidden="true"
          style={
            placed.side === "right" || placed.side === "left"
              ? { top: placed.notch }
              : { left: placed.notch }
          }
          className={`absolute size-3 rotate-45 border border-line-strong bg-surface ${NOTCH[placed.side]}`}
        />
      )}
      <p className="text-meta text-ink-muted tabular-nums">
        Step {index + 1} of {STEPS.length}
      </p>
      <div aria-live="polite">
        <h2 id={`${id}-title`} className="mt-1 mb-2 text-section font-semibold">
          {step.title}
        </h2>
        <p className="mb-4">{step.text}</p>
      </div>
      <div className="flex items-center gap-2">
        <Button kind="ghost" small onClick={() => onEnd(false)}>
          End tour
        </Button>
        <span className="grow" />
        <Button small disabled={index === 0} onClick={() => setIndex(index - 1)}>
          Back
        </Button>
        <Button
          ref={next}
          kind="primary"
          small
          onClick={() => (last ? onEnd(true) : setIndex(index + 1))}
        >
          {last ? "Finish" : "Next"}
        </Button>
      </div>
    </dialog>
  );
}

/** The bottom of the side list: the view switch and the way back to the guide. */
export function ViewFooter({
  view,
  onView,
  onShowAgain,
}: {
  view: View;
  onView: (view: View) => void;
  onShowAgain: () => void;
}) {
  const name = useId();
  return (
    <div data-tour="view" className="flex flex-col gap-1 border-t border-line px-3 pt-2 pb-3">
      <fieldset className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
        <legend className="float-left mr-1 text-meta leading-5 font-semibold text-ink-muted">
          View
        </legend>
        {VIEWS.map((v) => (
          <label
            key={v.view}
            title={v.means}
            className="inline-flex cursor-pointer items-center gap-1.5 text-meta"
          >
            <input
              type="radio"
              name={name}
              checked={view === v.view}
              onChange={() => onView(v.view)}
              className="size-3.5"
            />
            {v.label}
          </label>
        ))}
      </fieldset>
      <button
        type="button"
        onClick={onShowAgain}
        className="-ml-1 self-start rounded-sm px-1 py-0.5 text-meta text-ink-muted underline underline-offset-2 hover:bg-hover hover:text-ink"
      >
        Show the guide again
      </button>
    </div>
  );
}
