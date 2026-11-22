# StatusBadge

A pill that shows a task status or run state in words, with its group's colour and icon repeating the word.

**Consumer provides:** the status code (one of the 11 in A7, or a run state); the badge maps it to its label, group and icon.

- Label: the status in sentence case ("Awaiting approval"), `badge` style. Never only a colour or icon.
- Only three groups get a fill: **Needs you** (`needs-soft`, `needs-ink`, plus a 1px `needs-edge` border, the loudest badge), **Working** (`working-soft`, `working-ink`) and **Problem** (`problem-soft`, `problem-ink`).
- **Waiting, Held, Done and Stopped** are outline badges: no fill, a 1px `line` border, text in their `*-ink`. Their icon shape (clock, pause bars, check, stop square) tells them apart. Done's check is `done-ink` green; its word stays `ink`.
- Icon: the group's icon at 14px in the badge's text colour, `aria-hidden`.
- Groups: Needs you (Awaiting approval), Working (Assigned, Running, Validating), Waiting (Pending, Ready), Held (Paused), Done (Completed), Problem (Failed, Blocked), Stopped (Cancelled).
- Run states: Active = Working, Interrupted = Needs you, Finished = outline with a flag icon.
- Why so few colours: on a page of 20 tasks, colour should point at the cards that need the person or are in trouble. If every status had its own pastel, nothing would stand out.
- Do not use badges as buttons or filters.
