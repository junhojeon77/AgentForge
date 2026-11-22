# ReviewBox

The panel under a waiting diff where the person approves it or rejects it with a required reason: the most important moment in the app.

**Consumer provides:** the task id, the checks that run on approve, and the approve and reject handlers (reject receives the reason).

- Placement: the last thing in the waiting attempt, directly after the DiffView, so the decision sits where the reading ends.
- It is a band, not a box: `needs-soft` runs edge to edge across the bottom of the card, with a 2px `needs-edge` rule on top and no radius of its own. Never put it in its own bordered panel inside the card.
- Default: a heading "This diff waits for your review", one helper sentence naming the checks, then **Approve diff** (primary) and **Reject diff** (destructive outline).
- Reject opens a form in place (no dialog): a `textarea` directly on the band (`surface` fill, `line-strong` border), labelled "Why reject? The next attempt is told this.", helper text tied by `aria-describedby`, then **Reject diff** (confirm, disabled until the reason has non-space text) and **Keep reviewing** (ghost). Focus moves to the textarea; Escape returns to the default.
- Pending: both buttons disabled; the clicked one shows `aria-busy` and the static arc. A refusal appears directly under the buttons (see Feedback) and the form keeps the typed reason.
- Several diffs can wait at once; each card has its own ReviewBox and its own pending and refusal state.
