# TaskDrawer

A side panel that opens one task over the board: its full card, attempts, diff and review band, so reviewing on the board works exactly as in the list.

**Consumer provides:** the task id, and the same task card the List view shows (TaskCard, Attempt, DiffView, ReviewBox).

- Opens from a tile's Review diff or Open task, or a group's task row. It is a native `dialog` opened with `showModal()`, with a transparent backdrop: the board stays visible beside it and keeps updating.
- Pinned to the right edge of the main area, `drawer-w` (480px) wide and its full height (over the page header, which it repeats in its own head); full width when the main area is under 720px (a container query on the main area). `canvas` ground, a 1px `line-strong` rule on its left. No shadow.
- Head (sticky, `panel`): "Task `api` · Reset password endpoints" and a ghost Close button.
- Body: the task's card as in the List view; Review diff scrolls straight to the review band.
- Keyboard: focus goes to the review band's first button (Review diff) or the card's title (Open task). Tab stays inside. Escape or Close returns focus to the button that opened it.
- After Approve diff or Reject diff, it stays open, showing the result, so the person sees what happened before going back to the board.
