# AgentTile

The AI view: one agent on the run's board, like a small terminal: who it is, what it is working on, its live output, and the buttons for its task.

**Consumer provides:** the agent id, its current task (id, title, status, attempt n of max, time), the task's output lines as they arrive, and the task's actions (from `taskActions`).

- Tile: `surface`, 1px `line` border, `radius-md`, inside its role's group. Width follows the group; nothing in it sets a width.
- **Title strip** (`code-bg`): the agent id in `mono` 12px semibold and the task's status badge on the right. Under it, one line with the task's `id` and title (cut with an ellipsis, full text in `title`).
- **Live output:** a `pre` of `tile-output-h` (152px, about eight lines), `code-bg`, `mono` 11.5/17, `pre-wrap`, wrapping anywhere. Lines, plain text only:
  - a tool call: `ink-muted` with a coral `›` ("› Edit app/api/auth.py  (+14 −2)");
  - a tool's result, indented, `ink-muted`;
  - the agent's own words: `ink`;
  - a check that failed: `problem-ink`; a success: `done-ink`;
  - "Waiting for your review.": `needs-ink`, semibold; app notes ("Resting…", "Paused by you…") in italic `ink-muted`.
  While working, a static coral block marks the end. It does not blink.
- **Following:** the output stays pinned to the newest line. If the person scrolls up, it stops following; scrolling back to the bottom (or the End key) follows again. Nothing jumps while someone is reading.
- **Foot:** a `mono` meta line ("Attempt 1 of 3 · 3m 12s · live") and the task's small buttons: Pause and Cancel while working; **Review diff** (the board's primary) while waiting for you; Retry when failed; Resume when paused; Open task otherwise. Accessible names include the task id.
- States:
  - working: a coral-tinted border;
  - waiting for you: a 1px `needs-edge` border and a `needs-soft` title strip, the only yellow tile;
  - failed: a `problem-edge` border and a `problem-soft` strip;
  - paused and pending: neutral;
  - done: the output folds to its last lines (`af-tile__out--short`).
- **Before the server streams output** (it does not today): the tile says "Live output appears here when the server sends it." and shows the last attempt's report. Everything else works.
- Accessibility: the output is `role="log"` with `aria-live="off"`: a screen reader is not flooded. Status changes are announced once, by the page's own status region. The output box is focusable so it can be scrolled with the keyboard.
- Untrusted text: output is plain text, ANSI codes stripped, never HTML or Markdown.
