# Attempt

A collapsible `details` section for one attempt at a task: a one-line summary, and a body with why it failed, the agent's report and the diff.

**Consumer provides:** the attempt (number, status, agent id, failure reason, failure text, report, diff) and whether it starts open.

- Summary line: chevron · "Attempt n" (semibold) · status badge · `meta` text: Agent `id` · plain failure label · code.
- Newest attempt first. The latest attempt is open while it runs or waits for review; earlier attempts stay in the list, open when the latest is running so the person can still read their reject reason.
- Body, in this order, each with a small `ink-muted` label:
  1. Why it failed: "Your reason" (review_rejected), "Check output" (validation_rejected) or "Agent error". Shown in a LongText box.
  2. Agent report, in a LongText box.
  3. Diff, in a DiffView. For attempts that are not waiting for review, the diff is itself collapsed by default.
- While an attempt runs, its body says so in one quiet line instead of empty boxes.
- The summary is the keyboard target (Enter/Space toggles). The chevron rotates 90° when open, with no animation.
