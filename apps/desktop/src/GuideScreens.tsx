// The welcome screen, the tour and the side list's view switch; guide.ts keeps the choices.
import { useId, useLayoutEffect, useRef, useState } from "react";
import type { View } from "./guide";
import { log } from "./log";
import { Button } from "./ui";

const VIEWS: { view: View; label: string; means: string }[] = [
  { view: "plain", label: "Plain", means: "Technical options start folded under More options." },
  { view: "technical", label: "Technical", means: "Technical options start open." },
];

/** The first screen: how AgentForge works, the view choice, then whether to take the tour. */
export function Welcome({
  view,
  onDone,
}: {
  view: View;
  onDone: (view: View, takeTour: boolean) => void;
}) {
  const [picked, setPicked] = useState(view);
  const name = useId();
  return (
    <main className="flex-1 overflow-y-auto p-8">
      <div className="max-w-[560px] space-y-5">
        <h1 className="font-display text-[18px] leading-6 font-semibold">Welcome to AgentForge</h1>
        <p className="text-ink-muted">
          Ask for something in plain words and a team of AI agents builds it on this computer.
          Nothing starts and no change is accepted without your OK.
        </p>
        <section aria-labelledby={`${name}-how`} className="space-y-2">
          <h2 id={`${name}-how`} className="text-section font-semibold">
            How it works
          </h2>
          <ol className="list-decimal space-y-1 pl-5">
            <li>You ask for something in your own words.</li>
            <li>The lead agent turns it into a plan; you look it over and approve it.</li>
            <li>Your team builds it, each task in its own copy of your project.</li>
            <li>You review each change and approve or reject it.</li>
          </ol>
        </section>
        <fieldset className="space-y-2">
          <legend className="text-section font-semibold">How should the app look?</legend>
          {VIEWS.map((v) => (
            <label key={v.view} className="flex items-start gap-2">
              <input
                type="radio"
                name={name}
                checked={picked === v.view}
                onChange={() => setPicked(v.view)}
                className="mt-1"
              />
              <span>
                <span className="font-semibold">{v.label}</span>{" "}
                <span className="text-ink-muted">{v.means}</span>
              </span>
            </label>
          ))}
          <p className="text-meta text-ink-muted">
            You can change this later at the bottom of the side list.
          </p>
        </fieldset>
        <p>Want a short tour? It points at each part of the window in turn.</p>
        <div className="flex flex-wrap gap-2">
          <Button kind="primary" onClick={() => onDone(picked, true)}>
            Take the tour
          </Button>
          <Button onClick={() => onDone(picked, false)}>Skip the tour</Button>
        </div>
      </div>
    </main>
  );
}

// `target` matches a `data-tour` attribute in App; `place` picks the card's side in index.css.
const STEPS = [
  {
    target: "ask",
    place: "right",
    title: "Ask for something",
    text: "Start here: say what you want built, in plain words. The lead agent turns it into a plan.",
  },
  {
    target: "plans",
    place: "right",
    title: "Plans",
    text: "Plans from the lead agent wait here for your OK. An amber count says how many are waiting.",
  },
  {
    target: "runs",
    place: "right",
    title: "Runs",
    text: "An approved plan becomes a run. Open one to watch the team work and review each change.",
  },
  {
    target: "team",
    place: "right",
    title: "Your team",
    text: "The agents who do the work. Change how each one works, add one or remove one.",
  },
  {
    target: "status",
    place: "below",
    title: "Connection",
    text: "Says whether the app can reach the AgentForge server on this computer. Press Reconnect if it can't.",
  },
  {
    target: "view",
    place: "right-up",
    title: "Plain or technical",
    text: "Technical options sit under More options. Choose here whether they start open, or show this guide again.",
  },
] as const;

/** A card beside each part of the window in turn. The window waits while it is open; Esc or
 * End tour stops it. Every target is part of the connected frame, so App shows it only then. */
export function Tour({ onEnd }: { onEnd: (finished: boolean) => void }) {
  const [index, setIndex] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const id = useId();
  const step = STEPS[index];
  const last = index === STEPS.length - 1;

  // Opened before the step's effect below, so Next takes the focus, not the first button.
  useLayoutEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);

  // The ring and the anchor the card sits beside (index.css) follow the step.
  useLayoutEffect(() => {
    log.debug(`guide: tour step ${index + 1} of ${STEPS.length} (${step.target})`);
    const target = document.querySelector(`[data-tour="${step.target}"]`);
    target?.setAttribute("data-tour-current", "");
    next.current?.focus();
    return () => target?.removeAttribute("data-tour-current");
  }, [index, step.target]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      data-place={step.place}
      // Esc closes the dialog, and Chromium may skip `cancel`, so `close` ends the tour. The
      // buttons end it without closing; the dialog then leaves with the component.
      onClose={() => onEnd(false)}
      className="tour-card w-80 max-w-[calc(100vw-32px)] space-y-2 rounded-lg border border-line-strong bg-surface p-4 text-ink"
    >
      <p className="text-meta text-ink-muted tabular-nums">
        Step {index + 1} of {STEPS.length}
      </p>
      <div aria-live="polite" className="space-y-1">
        <h2 id={`${id}-title`} className="text-section font-semibold">
          {step.title}
        </h2>
        <p>{step.text}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 pt-2">
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
    <div data-tour="view" className="space-y-1 border-t border-line p-2">
      <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 text-control">
        <legend className="pb-1 text-meta font-semibold text-ink-muted">View</legend>
        {VIEWS.map((v) => (
          <label key={v.view} title={v.means} className="flex items-center gap-1.5">
            <input
              type="radio"
              name={name}
              checked={view === v.view}
              onChange={() => onView(v.view)}
            />
            {v.label}
          </label>
        ))}
      </fieldset>
      <Button kind="ghost" small onClick={onShowAgain}>
        Show the guide again
      </Button>
    </div>
  );
}
