# RunScreen

The whole 1000×700 window in the **List view** (chosen with the BoardBar; the Board view is the default, see BoardScreen) for checklist state 3: an active run with a diff waiting and its review open. It shows how the frame, sidebar, header, cards, attempt, diff and review panel fit together.

**Consumer provides:** nothing; this is a composition of the other components, for reference.

- Frame: StatusBar on top; under it the RunList sidebar (`sidebar-w`) and the main page, each scrolling on its own.
- Main page: PageHeader, then the "Tasks" section (cards, `space-3` apart), then "History" below the cards (scroll down).
- The waiting task's card has the `needs-edge` border, its latest attempt open, the diff, then the ReviewBox; attempt 1 stays listed, collapsed.
- Resume run is absent because no task is paused.
- At 800px wide: the sidebar narrows to `sidebar-w-narrow`, the header's controls wrap below the title, and the diff box keeps scrolling sideways inside the card.
