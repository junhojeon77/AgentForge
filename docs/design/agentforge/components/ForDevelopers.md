# ForDevelopers

A folded section for work only developers do, such as writing a plan as JSON. Unlike MoreOptions it can hold a large editor, so it is a bordered section of its own, below the plain path.

**Consumer provides:** a title naming the task ("Write the plan yourself"), the body (usually an editor, a hint and one action), and whether it starts open.

- **Starts folded in both views.** Technical opens MoreOptions, not this: a 360px editor open by default would push the plain path's result off screen. A person opens it by hand.
- Native `details`; 1px `line` border, `radius-lg`, `canvas` ground. Summary row: chevron, the title (14px semibold) and a small outline tag "for developers" in `mono` 11px. Open: a `line` rule under the summary, body padded `space-4`.
- Editor: a native `textarea`, `mono` 12/18, `white-space: pre`, `tab-size: 2`, `spellcheck="false"`, `code-bg`, `line-strong` border, at least `editor-min-h` (360px), resizable taller. It scrolls both ways inside itself.
- Hint under the editor in `meta`, with field names in inline code.
- One action ("Save the plan", secondary: the screen's primary belongs to the plain path). A refusal shows below it as a Problem alert quoting the server.
- States: hover fill on the summary; focus ring on summary, editor and button; busy disables the editor and the button (`aria-busy` on the button).
- Keyboard: Tab reaches the summary; inside the editor Tab moves focus on (it does not insert a tab), so the keyboard never gets trapped.
