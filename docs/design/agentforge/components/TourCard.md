# TourCard

One step of the six-step tour: a small card beside the part of the window it explains, with a highlight on that part.

**Consumer provides:** the step number, the target element, and the back, next, finish and end handlers.

- A modal native `dialog` opened with `showModal()`, so focus stays in the card; its `::backdrop` is transparent, so the whole window stays visible and the target is not covered.
- **No shadow, so border and ground separate it:** `surface` ground, 1px `line-strong` border, `radius-lg`, padding `space-4`, width `tour-w` (340px). A notch (a 12px square turned 45°, same ground and border) points at the target.
- Placement: beside the target with a `space-2` gap, on the side with room: right of side-list items; below the status bar (the full-width one); above and to the right of the side-list footer. It flips to the other side when the window has no room, and the notch moves with it. It never covers its target.
- Content: "Step 5 of 6" in `meta`, a title in 15px semibold, one or two sentences in `body`. Footer: [End tour] (ghost) on the left; [Back] (secondary, disabled on step 1) and [Next] (primary) on the right; [Finish] replaces Next on step 6.
- **The target's highlight is a 2px dashed `accent` outline drawn inside the element** (a `::after` layer with a dashed border, `inset: 0`, `pointer-events: none`; not an outline, so it never replaces the focus ring). The focus ring is solid `focus` and outside. Pattern and position tell them apart, so a target that also has focus shows both clearly. This changes today's solid inside outline to dashed.
- Keyboard: focus starts on Next (Finish on the last step). Tab cycles inside the card; Enter on Next goes on; Escape is End tour. Ending or finishing puts focus back on what had it before the tour.
- Steps and copy:
  1. Ask for something: "Start here. Say what you want built in your own words; the lead agent turns it into a plan you approve before any work starts."
  2. Plans: "Plans waiting for your OK show here, marked in yellow. Open one to read its tasks and decide what each task may do."
  3. Runs: "Each approved plan becomes a run. Follow its tasks as they work, and review every change before it is accepted."
  4. Your team: "The agents that do the work. Change how each one should work, or add a new one."
  5. The status bar: "Shows whether the app can reach the AgentForge server on this computer. If it can't, the steps to start it appear below."
  6. View and guide: "Switch between the Plain and Technical view here, or open this guide again."
- If the server is off, steps 1 to 4 point at the side list, which is hidden then; the tour shows step 5 first, and the other steps wait until it connects.
