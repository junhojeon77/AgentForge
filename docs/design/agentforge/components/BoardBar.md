# BoardBar

A pill at the bottom of the run page that switches between Board and List and counts the run's tasks by state, in words.

**Consumer provides:** the view (Board or List) and the task counts.

- Sticky to the bottom of the main area, centred, `space-4` from the edge; the page keeps 88px of padding at its foot so nothing hides under it.
- `surface`, 1px `line-strong` border, `radius-full`. Inside: a segmented switch (a `radiogroup` of two native radios) "Board" / "List" (the chosen one on `selected`), then the counts in `label-mono`, each with its dot: "1 working · 1 waits for you · 1 done · 1 waiting".
- The run controls stay in the page header in both views, so they never move.
- The choice is remembered per person (with the View setting), not per run. Board is the default; List is the same page as before, for anyone who prefers it or uses a screen reader.
- Keyboard: Tab reaches the switch; arrow keys choose. The counts are text, not buttons.
