# RunList

The sidebar's list of runs, newest first, with the run id and a state marker in words; it scrolls on its own and can hold hundreds of runs.

**Consumer provides:** the run ids (newest first), which one is Active and which are Interrupted, the selected id, and an `onSelect` handler. Optional: the count of diffs waiting on the active run (A13, cheap).

- Width `sidebar-w` (`sidebar-w-narrow` below 900px). Ground `panel`, right border `line`.
- Heading "Runs" with the total count in `meta` / `ink-muted`.
- Each item is a `button` with `aria-current="true"` when selected. The id is in `code` (12px mono), one line with an ellipsis; the full id is in `title` and the accessible name.
- Markers are badges in words: **Active** (Working colours), **Interrupted** (Needs you colours). Finished runs show no marker.
- Selected: `selected` fill, semibold, and a 3px `accent` bar inside the left edge. Hover: `hover`. Focus: the `focus` outline.
- The waiting-diffs count is a small Needs-you pill (`needs-soft`, `needs-ink`, `needs-edge` border) with its meaning in text for screen readers ("2 diffs wait for you").
- Default selection: the active run, else the newest.
- Empty: since slice 4 the app opens **Ask for something** when there is no run, so the list is simply empty.
- Later (the design pass): a tab row above the heading may switch between Runs, Plans and Your team; each tab keeps its own scroll position and selection.
