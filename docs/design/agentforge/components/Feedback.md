# Feedback

Alerts and loading states: a refusal next to a control, a page-level error, a notice that live updates stopped, and the loading placeholder.

**Consumer provides:** the server's message (plain text, quoted as is), and for refusals the control group it belongs to.

- **Refusal** (`problem-soft`, `problem-ink`, 1px `problem-edge`, `role="alert"`): directly below the button group that was used, inside the same card or header. Text: "**Server refused <action> for <object>:** <detail>". A ghost Dismiss button; the alert also clears on the next click in that group.
- **Page error** (same colours): replaces the run page body: "**Could not load run <id>:** <message>", with a small "Try again" button.
- **Notice** (`needs-soft`, `needs-ink`, 1px `needs-edge`, `role="status"`): under the page header, full width: "**Live updates stopped:** <reason>. What you see may be out of date." It stays until live updates resume.
- **Loading**: "Loading run…" with the static arc in `ink-muted`, plus two or three `hover`-coloured skeleton blocks shaped like the header and cards. No spinner animation.
- Messages wrap anywhere and keep their line breaks (`pre-wrap`).
