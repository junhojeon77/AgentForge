# AgentEditor

The form that edits an agent in place of its card, or adds a new one at the top of the team. The plan page uses the same fields for agents the lead agent proposes.

**Consumer provides:** the agent (or none when adding), the ids already taken, the existing roles, and the save and cancel handlers; for a proposed agent, a fixed role.

- It replaces its card and spans the whole grid row (`grid-column: 1 / -1`), with a 1px `accent` border to show what is being edited. Heading: "Edit `backend`" with "Changes apply from the next run." beside it, or "Add an agent".
- **Name** (adding only): plain text. Under it, live, "Saved as `email-sender`" (the id made from the name: lowercase letters, digits, - and _). On a clash it turns into a field error: "An agent named `backend` already exists; edit it instead." with a small "Edit backend" button that opens that agent, and the add button is disabled.
- **Role:** `mono` input with a native `datalist` of the team's roles, and the helper "The lead agent gives each task to an agent whose role matches the task's role, e.g. backend." For an agent the lead agent proposed, the role is read-only (the plan's tasks need it).
- **How it should work:** `field-tall-h` textarea, 14/20 sans, `maxlength="10000"`, a helper that says what to write, and a live counter "1,204 of 10,000 characters". Past 9,500 the counter gets a Needs-you fill so the limit never surprises.
- MoreOptions: **Model** (`mono`, placeholder "default model"; "Empty uses the default model. Otherwise a model id or an alias such as opus.") and **Reasoning** (a `select` of low, medium, high, xhigh, max; "Higher is slower and costs more."). The folded hint shows both values.
- Actions: "Save changes" or "Add agent" (primary) and "Cancel" (ghost). Escape is Cancel when focus is in the form and nothing was changed; with changes, Escape does nothing (no lost work).
- **Field errors from the server** show above the actions as one Problem alert with one readable line per field ("How it should work: at most 10,000 characters (this one has 10,214)."), and MoreOptions opens itself if an error is inside it.
- Busy: every field disabled, the primary shows `aria-busy` and the static arc.
- Keyboard: focus goes to Name (adding) or How it should work (editing) when the editor opens, and back to the card's Edit button when it closes.
