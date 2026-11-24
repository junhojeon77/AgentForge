# AgentCard

One agent on "Your team": its id, role, model and reasoning, the start of how it should work, and Edit and Remove.

**Consumer provides:** the agent (id, role, model or null, reasoning, persona), whether it is the only agent, and the edit and remove handlers.

- Card: `surface`, 1px `line` border, `radius-lg`, padding `space-3` `space-4`. In a grid of `minmax(300px, 1fr)` columns: two side by side beside the side list at 1000px, one at 640px. 5 to 10+ agents scan in two columns.
- **Id first,** in `mono` 14px semibold (the name people gave it, saved as an id). Then a `meta` line: "Role **backend** · default model · medium reasoning".
- **The first three lines of "How it should work"** in 13/18 `ink`, `pre-wrap`, clamped to 3 lines (`line-clamp: 3`) with the rest reachable in Edit. Empty: "No instructions yet: it works from its role alone." in `ink-muted`.
- Actions at the bottom: Edit (secondary, small) and Remove (destructive outline, small). Accessible names include the id ("Remove agent qa").
- **Remove asks first, in place:** the actions become the red InlineConfirm: "Remove agent frontend? Runs from now on will not use it." [Yes, remove] [Keep it]; focus goes to Keep it, Escape keeps.
- **The last agent:** Remove is disabled, with the reason under it: "Your only agent. Add another before removing it." (the server refuses it, because an empty team brings the five defaults back).
- States: hover gives the card nothing (it is not clickable as a whole); its buttons have their own hover and focus. Busy: while a remove is in flight, the confirm's buttons are disabled and "Yes, remove" shows `aria-busy`. A refusal shows under the card's actions as a Problem alert.
- Loading: "Loading the team…" (`role="status"`, static arc) above two skeleton cards in `hover`. Error: a page Problem alert, "Could not read the team: <reason>".
