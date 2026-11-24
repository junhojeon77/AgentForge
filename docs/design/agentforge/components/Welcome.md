# Welcome

The first screen on first start (and from "Show the guide again"): what AgentForge does, how it works in four steps, which view to use, and whether to take the tour.

**Consumer provides:** the current View (Plain by default), and the tour and skip handlers. It needs nothing from the server, so it shows even when the server is off.

- **Fills the window:** no side list, no status bar. `canvas` ground, content left-aligned from 64px, not centered. Two columns at 1000px (story on the left, the two choices on the right, top-aligned to the first step), one column below 720px.
- A small "AgentForge" mark in `ink-muted` display type, then "Welcome to AgentForge" in `welcome-title` (28/36, the one new type style; the window is otherwise empty and 20px gets lost), and the one-line promise in 15/22 `ink`.
- "How it works": a numbered list of four short lines, numbers in `accent` semibold tabular figures. No icons, cards or art: the steps are the content.
- **"How should the app look?"**: a `fieldset` with two large radio rows (`surface`, 1px `line-strong` border, `radius-md`): "Plain" / "Technical options start folded under More options." (checked by default) and "Technical" / "Technical options start open." The checked row takes `selected` ground and an `accent` border, and the radio itself stays visible. Helper: "You can change this later at the bottom of the side list." The choice saves at once.
- **"Want a short tour? It points at each part of the window in turn."** then [Take the tour] (the screen's one primary; focus starts here) and [Skip the tour] (ghost, so the pair is not a filled-and-outlined twin). Skip opens Ask for something, or the run that is going.
- Keyboard: Tab reaches the radio group (arrows choose), then Take the tour, then Skip. Escape does nothing here: it is a choice screen, not a dialog.
- Voice: calm and specific; no hero art, no feature cards, no slogans.
