# HistoryTable

A table of every change in the run, in order: number, task id, new status and the plain reason; it scrolls inside its own box with a sticky header.

**Consumer provides:** the transitions (number, task id, new status code, reason text) and, optionally, a task filter.

- Native `table` inside a focusable scroll box (`max-height: history-max-h`, 1px `line` border, `radius-md`, `surface` ground).
- Header row sticky, `panel` ground, `meta` semibold `ink-muted`.
- Columns: # (right-aligned, tabular numerals, `ink-muted`); Task (`code`); New status (the raw code in `code`, coloured with its group's `*-ink`, since the column's header already says what it is); Reason (wraps anywhere).
- Oldest first, the order changes happened. On a live run, when the person is already scrolled to the bottom, keep them pinned to the bottom as rows arrive; otherwise don't move the scroll.
- 500+ rows are fine as a plain table; no pagination.
- Optional filter (A13, cheap): a small "Show task" `select` above the table.
