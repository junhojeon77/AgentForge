# PlanPage

One plan: who wrote it, its status, how the lead agent fixed it, its tasks, and, while it waits for the person's OK, the decision to approve and start it or reject it.

**Consumer provides:** the proposal (id, source, status, reason, rounds, tasks, proposed agents), the server's checks, the project folder from Ask for something, and the approve, reject and open-run handlers.

- Layout: `af-page`; prose and forms stay within `form-max-w`, task cards and the rights table use the full content width.
- **Header:** "Plan `run-20261122-0130`" in `page-title` with the id in `mono`, and a status badge: **Waiting for your OK** (Needs you, yellow: the only yellow here), **Approved** (outline, check in `done-ink`), **Rejected** (outline, stop icon). Under it in `meta`: "Written by the lead agent · 4 tasks" or "Written by hand · …".
  - Approved: "Approved: it runs as run `run-…`." with a check icon and an **Open run** secondary button.
  - Rejected: "Your reason for rejecting it" and the reason quoted in a plain-text box (`code-bg`, `line`, `pre-wrap`).
- **"What the lead agent fixed along the way"**: a MoreOptions-style fold, always starting folded (in both views; it is history, not a setting), hint "2 drafts, 3 issues fixed". Inside, "Draft 1, found by the rule check:" or "found by the lead agent's review:" and the issues as bullets, plain text. Drafts count from 1.
- **Tasks** ("in the order they start"): one card each (`surface`, `line`, `radius-lg`), numbered 1 to 10 in `ink-muted` tabular figures so "after api" is easy to follow. Title in 15px semibold; a `meta` line with `id`, role and "after `schema`"; then two columns: the objective (14px `ink`) with the description under it (13px `ink-muted`), and "Done when" with its bullets. One column below 600px. All text plain, wrapping.
- **Approve and start** (pending only), after a `line` rule:
  - heading, then "A task left as it is can only read your files. Tick what each task may do."
  - "Project folder" (`mono`), prefilled from Ask for something, helper "The Git repository the team works in. It starts as the folder you asked about."
  - TaskRights (the table), its checks legend and its summary line or "no task may change files" notice.
  - "New agents for this plan" only when the lead agent proposed some: its sentence, then each agent in an AgentEditor without its own buttons. Its role is read-only ("Set by the plan: task api needs an agent with this role."); How it should work, Model and Reasoning can be changed. "Added to your team when you approve." beside its id.
  - **Approve and start**: the one primary on the page. A refusal shows under it as a Problem alert quoting the server, with what to do if the app knows ("Wait for it to finish, or cancel it, then approve again.").
  - Busy: the whole decision is locked; the button shows `aria-busy` and the static arc. Success opens the run.
- **Reject**, after another `line` rule: the labelled textarea "Or reject it: why? This is kept with the plan.", then **Reject plan** (destructive outline), disabled until the reason has text. The required reason is the confirmation; it does not ask again.
- Side list: a pending plan carries the Waiting for your OK badge and counts in the Plans tab, as it does now.
- Keyboard: Tab order follows the page: Open run or the fold, task cards are not focusable (nothing to do there), then the folder, the table row by row, the new agents, Approve and start, the reject reason and Reject plan.
