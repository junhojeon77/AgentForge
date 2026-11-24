# ViewFooter

A quiet strip at the bottom of the side list: the View choice (Plain or Technical) and a small "Show the guide again" button. It is not a settings screen.

**Consumer provides:** the current View, and the change and show-guide handlers.

- Sits under the Runs or Plans list, pinned to the bottom of the side list; a `line` rule above, padding `space-2` `space-3`, on the side list's `panel` ground.
- A `fieldset` with the legend "View" (12px semibold `ink-muted`) and two native radios, "Plain" and "Technical" (12px), on one line; they wrap under the legend in the 200px side list.
- **"Show the guide again"**: a small underlined text button in `ink-muted` (12px), `ink` with a `hover` fill on hover, the focus ring on focus. It opens the Welcome screen.
- Changing View applies at once: every MoreOptions not yet toggled by hand opens or folds to match. Nothing else changes.
- No icons, no gear, nothing in the status bar.
- Keyboard: Tab reaches the radio group (arrow keys choose), then the guide button.
