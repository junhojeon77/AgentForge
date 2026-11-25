# BoardScreen

A running plan as a board in the whole window: the page header with the run controls, the lead agent's node, a group per role with its agent's tile and live output, and the Board/List pill at the bottom. See AgentTile, BoardGroup and BoardBar.

- Fits the window and scrolls; no pan or zoom. The board's faint dot grid (`line` dots every 20px, no fade) marks it as a board; forms and lists never get it.
- At 1000px: two groups per row beside the side list. At 640px: one per row, and the lines from the lead agent run down the middle behind the groups like a trunk.
- The group with a diff waiting comes first, so the person's next step is at the top.
