# AskForm

The screen where a person starts: they say what they want built, name the project folder, and ask the lead agent for a plan.

**Consumer provides:** the request text, the project folder (remembered from last time), the run name (prefilled `run-YYYYMMDD-HHMM`) and revisions (default 2), and the plan and save handlers.

- Layout: `af-page` padding, one column at most `form-max-w` (720px). Title "Ask for something" in `page-title`, one lede line in `ink-muted`.
- **"What do you want built?" is the heart of the screen:** the first field, a 14px semibold label, a `field-tall-h` (160px) textarea in 14/20 sans, resizable, with a helper line that says how to write it. Focus starts here.
- "Project folder": a `mono` input with the example in the helper. No browse button: a folder picker would need a new Tauri plugin.
- MoreOptions: "Run name" (`mono`) and "Revisions" (number, 0 to 5). The folded hint shows both values.
- **Plan it** is the one primary button. It is disabled until the request has text, with the reason beside it ("Say what you want built first.").
- **Asks first, in place:** the button turns into a plain confirm (`panel` ground, `line-strong` border; not the red destructive one, because planning is billed, not destructive): "Plan this with the lead agent? It uses your Claude account, so it is billed." [Yes, plan it] (primary) [Not now] (focused first; Escape answers it).
- **Busy:** a Working panel (`working-soft`, `working-ink`, `working-edge` border, `role="status"`, static arc): "The lead agent is planning… this can take a few minutes." and a meta line with the time since it started. Every field and button is disabled while it plans; nothing animates.
- **Failure:** a Problem alert quoting the server's reason, then each draft: "Draft 2, found by the lead agent's review:" and its issues as bullets (plain text, wrapping). Below it, "Plan it again" (primary) with "You can change your request first. Each try is billed." The fields keep what was typed.
- Below the form, ForDevelopers "Write the plan yourself", folded.
- Keyboard: Tab order is request, folder, More options, Plan it, then the developer section. In the confirm, Tab moves between the two answers.
- Draft numbers count from 1 for people: the server's revision 0 is "Draft 1".
