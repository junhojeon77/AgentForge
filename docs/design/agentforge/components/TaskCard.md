# TaskCard

One card per task in a run: title, status in words, id, agent role, attempt count, rights, the latest note, the task's buttons, and its attempts below.

**Consumer provides:** the task (title, id, role, status, attempt n of max, rights, latest note, failure reason, dependencies), the actions that apply right now (from `taskActions(task, live)`), and the task's attempts as children.

- Ground `surface`, 1px `line` border, `radius-lg`. A task that waits for review (Awaiting approval) gets a 2px `needs-edge` border: it is the only card style that changes, so a person scanning 20 cards finds it at once.
- Head: title in `section-title` (wraps), the status badge top-right, then a `meta` line: Task `id` · Agent `role` · Attempt n of m · rights ("May edit · checks on approve: unit, lint" or "Read-only") · After `deps`.
- Note: the task's latest reason as plain text, prefixed "Note:", in `ink`. It can be long; it wraps.
- Failed: the plain failure label and code in `problem-ink` on the meta line ("A check failed · `validation_rejected`"); the "why" text lives in the attempt.
- Buttons (small size), only the ones that apply: Pause, Resume, Cancel (destructive, asks first), Retry. Approve diff and Reject diff live in the review panel of the waiting attempt, not here.
- Retry shows how many attempts remain ("2 more attempts allowed (5 at most)") so a refusal is rarely a surprise.
- Every button's accessible name includes the task id: "Retry task build".
- Order cards by the plan's order; do not re-sort when statuses change (live updates must not move what the person is reading).
