# InlineConfirm

A small panel that replaces a destructive button in place and asks before acting: used for Cancel (task) and Cancel run.

**Consumer provides:** the question, the confirm label, the keep label, and the two handlers.

- Ground `danger-soft`, 1px `danger` border, `radius-lg`; question in `ink` semibold 13px; buttons: confirm (`danger` fill) then secondary.
- Copy: "Stop task build? Its worker stops now; you can retry it." [Yes, cancel] [Keep it]. "Stop run <id>? Every running worker stops now." [Yes, cancel] [Keep running].
- It replaces only the button group it belongs to; the rest of the card or header stays usable.
- On open, focus goes to the keep button (the safe answer). Escape keeps. After "Yes, cancel", the panel becomes the pending state of that button group until the server answers.
- `role="group"` with an `aria-label` naming the object.
- Chosen over a modal dialog: it keeps the person's place on a long page and never hides the diff they were reading.
