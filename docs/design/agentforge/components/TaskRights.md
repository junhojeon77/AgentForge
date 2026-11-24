# TaskRights

The grant table on a plan's "Approve and start": one compact row per task, with what that task may do. Nothing is granted by default.

**Consumer provides:** the plan's tasks (title, id, role), the server's checks (name and command), and the rights state per task.

- One bordered block (`surface`, `line` border, `radius-lg`). A `panel` bar on top says "4 tasks · nothing is allowed until you tick it" and holds one ghost button, "Let every task change files", for plans of many tasks. It only ticks; it never grants checks, attempts or limits.
- **One row per task**, three columns on wide screens: the task (title 14px semibold, `id` and role in `meta`) · "May change files" · "Checks to run before its work is accepted" (one checkbox per check, by name). Below 600px of its own width the columns stack. Rows are separated by `line` rules, not boxed.
- **Each check's command is shown once, in a legend under the table** ("Checks on this server: **unit** `python -m pytest -q` …"), not repeated in every row. Ten rows of commands would be the wall of forms this avoids.
- Each row ends with MoreOptions: "Let it run the checks itself while it works (needs “May change files”)", disabled until May change files is ticked and cleared when it is unticked; "Attempts" (1 to 5, "Each attempt is billed."); "Time limit per attempt, in seconds" (empty means no limit). The folded hint shows the row's values ("1 attempt · no time limit"), so every task's choices stay readable without opening ten folds.
- **No checks on the server:** each row's checks cell says "No checks are set up on the server." and the legend is left out.
- Under the table, a summary line counts what will be granted ("3 of 4 tasks may change files · 6 checks … · up to 4 billed attempts"). When no task may change files, it becomes a Needs-you notice: "No task may change files, so the team can only read your project and report." This is the one mistake a person who doesn't code is likely to make.
- Checkboxes: native, 16px, `accent-color: accent`; each has an accessible name with the task id ("Task api may change files", "Run check lint on task api").
- Keyboard: Tab goes row by row: May change files, each check, the row's More options. Space ticks.
- Errors: the server's refusal shows under "Approve and start", not in the rows (see PlanPage).
