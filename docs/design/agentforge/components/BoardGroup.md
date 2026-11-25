# BoardGroup

The board's structure: the lead agent's node on top, and one group per role in the run, each holding that role's agent tile and its other tasks. Lines run from the lead agent to every group.

**Consumer provides:** the plan (id, a one-line summary of the request), the run's tasks grouped by role, which agent is on which task (the report's workers), and the roles on the team that the run does not use.

- **Lead agent node:** centred above the groups, at most 380px wide. A `code-bg` strip with a dot and "LEAD AGENT" (`label-mono`) and the counts; then "Plan `run-…`", a one-line summary of the request (the first line of `Proposal.request`; "Fixes the reviews of run …" for a fix plan, "Written by hand." for a hand-written one), "Not in this run: `auditor`, `integration`, `reviewer`" (so all seven agents are accounted for), and Open plan (ghost).
- **Groups:** a grid of `minmax(300px, 1fr)` columns (two beside the side list at 1000px, one at 640px), `space-8` between rows so the lines have room. Each group is a `panel` box, 1px border, `radius-lg`, with a header: a status dot, the role in `label-mono` ("BACKEND"), and a count ("· 1 waits for you · 3 tasks").
- **Border colour says the group's state, the header says it in words:**
  - a task waits for you: `needs-edge`;
  - something is running: coral-tinted;
  - something failed: rose-tinted;
  - otherwise `line`.
  Priority: waits for you, then failed, then running.
- Inside: the agent tile for the task the agent is on (or its next task when resting), then the role's other tasks as compact rows: dot, `id`, title and "after …", and an outline badge. A row opens its task in the drawer.
- **Lines:** an SVG layer behind everything, one curve from the bottom centre of the lead node to the top centre of each group, with a small ring at each end. The curve takes its group's state colour (coral, yellow, rose for trouble) or `line-strong`. They are drawn from the elements' positions and redrawn on resize (a `ResizeObserver`; no library). `aria-hidden`: the lines add nothing a screen reader needs.
- Order: groups with something waiting for you first, then running, then the rest in plan order. A group never moves while the person is using it; reordering waits until focus leaves the board.
- Keyboard: Tab goes lead node, then group by group, tile by tile, button by button. Groups are a list (`ul` of `li` with headings), so a screen reader hears "Agents by role, list, 4 items".
