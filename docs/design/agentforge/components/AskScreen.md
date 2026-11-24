# AskScreen

The whole window with Ask for something open, wide in the Plain view and narrow (a 640px main area) in the Technical view with the billing question showing. A composition of AskForm, MoreOptions, ForDevelopers and the side list; see those guides.

- "Ask for something" in the side list is the current page (it stays the side list's filled button; its current state is `aria-current="page"`).
- The form keeps `form-max-w` even on wide windows, so the request field does not stretch past a comfortable line length.
- At 640px nothing changes but the side list width; every field already fits one column.
