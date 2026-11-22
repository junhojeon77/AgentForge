# PageHeader

The top of the run page: the run id as the title, the run's state in words, a one-line summary, and the run controls.

**Consumer provides:** the run id, its state (Active, Interrupted, Finished), a summary line, and the controls that apply.

- Title: `page-title`, wraps anywhere, never truncated. No label above it: the run id already starts with "run-", and the sidebar says which section this is.
- State: a run-state badge (Active = Working, Interrupted = Needs you, Finished = neutral) followed by a `meta` summary, e.g. "5 tasks · 1 completed · 2 waiting for you".
- Controls, right-aligned, wrapping under the title on narrow windows:
  - Active: Pause run, Resume run (only when a task is paused), Cancel run (destructive outline, asks first).
  - Interrupted: Recover run, the page's one primary button.
  - Finished: none.
- Accessible names include the run id: "Cancel run run-2026-11-20-login-flow".
- A refusal for a run control appears directly below the header as a Problem alert (see Feedback); the confirm for Cancel run replaces the controls in place (see InlineConfirm).
