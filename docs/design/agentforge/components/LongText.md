# LongText

A plain-text box for agent reports, check output, agent errors and reject reasons: monospace, wraps long lines, scrolls when tall.

**Consumer provides:** the text (untrusted, plain), a label shown above it, and an accessible name.

- `code-block` (12/18 mono), `white-space: pre-wrap`, `overflow-wrap: anywhere` so a 400-character token wraps instead of widening the page.
- `code-bg`, 1px `line` border, `radius-md`, padding `space-2` `space-3`, `max-height: longtext-max-h`, vertical scroll; focusable as a region.
- Text in `ink`. Odd characters, ANSI codes or HTML show as their literal text; strip ANSI escape sequences, never interpret them.
- Label above in `meta` semibold `ink-muted`: "Check output · unit", "Agent report", "Your reason", "Agent error".
- Use DiffView, not this, for diffs.
