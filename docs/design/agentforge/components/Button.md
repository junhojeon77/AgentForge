# Button

A native `button` in five kinds (primary, secondary, destructive, confirm, ghost) and two sizes, each with hover, focus, disabled and pending states.

**Consumer provides:** the label (verb first, naming the object), an `aria-label` when the visible label drops the object, an optional icon, and `disabled` / `aria-busy` while a request is in flight.

- **Primary** (`accent` / `on-accent`): Approve diff, Recover run. At most one per header or card.
- **Secondary** (`surface`, `line-strong` border, `ink`): Pause, Resume, Retry, Reconnect, Keep it.
- **Destructive** (outline: `danger` border and text, `danger-soft` on hover): Cancel run, Cancel, Reject diff. It opens a confirm or a reason form; it never acts on the first click.
- **Confirm** (`danger` / `on-danger`): only "Yes, cancel" and the final "Reject diff" inside the reject form.
- **Ghost**: Copy diff, Dismiss; low-emphasis actions inside boxes and alerts.
- Size: `control-h` (32px) in headers and forms, `control-h-sm` (28px) inside cards and alerts.
- Focus: `focus` outline, 2px, offset 2px, every kind.
- Disabled: `panel` fill, `line` border, `ink-muted` text.
- Pending: the whole control group is disabled; the clicked button adds `aria-busy="true"` and the static working arc before its label. The label does not change.
- Icons are 16px, `aria-hidden`, and never replace the label.
