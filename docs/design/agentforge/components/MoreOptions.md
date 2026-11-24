# MoreOptions

A fold that keeps technical fields one click away: a summary row ("More options" and a hint), then the fields, indented. Every screen uses it.

**Consumer provides:** the fields, a hint naming what is inside with the current values ("Run name run-20261122-0130 · 2 revisions"), and whether it starts open.

- **Starts folded or open by the person's View:** Plain starts folded, Technical starts open. It can always be toggled by hand, and a hand toggle lasts until the screen is left; it never changes the View setting.
- Native `details`/`summary`. The summary is one 32px row: chevron (`ink-muted`, turns 90° when open, no animation), "More options" in `ink` semibold 13px, then the hint in `meta`/`ink-muted`, cut with an ellipsis. The hint hides while open.
- A 1px `line` rule above the summary marks where the plain fields end. No box and no left rule: the open body is indented `space-6`, to the label's left edge, so it reads as part of the same form.
- States: hover gives the summary a `hover` fill; keyboard focus shows the `focus` ring on the summary; disabled is not used (fold the fields' own disabled states instead); errors inside open it automatically, so a field error is never hidden.
- Keyboard: Tab reaches the summary, Enter or Space toggles.
- Copy: always "More options". The hint is values, not instructions.
- Change to what ships: the app's `MoreOptions` uses `border-l-2 border-line pl-3`. Replace the left rule with the `space-6` indent and add the hint; a coloured or grey left rule on a box reads as decoration.
