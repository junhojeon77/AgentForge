# M6 — Desktop dashboard

M6 gives AgentForge a window: a Tauri 2 desktop app to follow runs live, approve plans and
diffs, control tasks and edit agents on screen. It was built in eight slices and is implemented within the limits below.

The app is for people who do not code as well as those who do ([who it is
for](../../README.md)): every screen leads with the plain path in plain words and keeps each
technical control one click away, under **More options** or a "for developers" section.

| Slice | Scope | Status |
|---|---|---|
| 1 | API additions the app needs: agent endpoints, lists, checks, CORS | Implemented on 2026-11-15 |
| 2 | App shell (`apps/desktop`): token, API client, live events, connection states | Implemented on 2026-11-18 |
| 3 | Runs: list, run page, controls, diff review | Implemented on 2026-11-20; styled in slice 6 |
| 4 | Proposals: list, detail, new from a request or by hand, approve with rights | Implemented on 2026-11-20; styled in slice 8 |
| 5 | Agent editor ("Your team"), and new agents the lead agent proposes with a plan | Implemented on 2026-11-20; styled in slice 8 |
| 6 | Visual design of the frame and the run screens, from a Claude Design pass | Implemented on 2026-11-21 |
| 7 | Welcome screen, the plain or technical view (whether **More options** starts open) and a tour, changeable later | Implemented on 2026-11-22; styled in slice 8 |
| 8 | Visual design of Ask for something, the plan page, Your team, the welcome screen and the tour, from a second Claude Design pass | Implemented on 2026-11-23 |

Slice 1 is the API side, slice 2 the app's shell, slice 3 the run screens, slice 4 the proposal
screens, slice 5 the agent editor, slice 6 the visual design of the frame and the run screens,
slice 7 the welcome screen, the view choice and the tour, and slice 8 the visual design of every
screen slice 6 left plain.

## Reviews and fix plans on screen (added on 2026-11-24)

Built after slice 8, with the API's reviews and fix plans ([M5 doc](M5-api.md#reviews-and-fix-plans-added-on-2026-11-24)):

- **Approve and start** says "After each task you let edit, the reviewer checks its change."
  The `review-<id>` tasks then show on the run's page like any task, with the reviewer's report
  under **Agent report**.
- **Fixes from the reviews** (run page): on a finished run where a review found something that
  must be fixed, **Plan fixes from the reviews** asks first ("It uses your Claude account, so it
  is billed"), then asks the lead agent for a plan that fixes it. It can take minutes and gets a
  new run name (`newRunId`). When it
  is done the new plan opens, waiting for approval. A refusal shows under the button.
- **The plan's page** says "Fixes the reviews of run X" when the plan came from one.

## Delivered behavior (slice 8)

**The design's second pass.** Claude Design made the screens slice 6 had no design for. The copy
in [docs/design/agentforge](../design/agentforge/README.md) is now that second pass; the run
screens did not change. Forms and prose stop at a readable width (720px); task cards, the rights
table and the team use the full width.

**More options** is now a fold with a hint of what is inside and its values ("Run name
`req-20261123-013000` · 2 revisions"; "1 attempt · no time limit"; "default model · medium
reasoning"). The view decides whether it starts open; one you open or fold by hand stays that way
until you leave the page, even when the view changes. A field error inside it opens it.

**Ask for something.** "What do you want built?" comes first and has the focus. **Plan it** says
why it cannot be pressed yet ("Say what you want built first.", "Name the project folder
first.", "Give the run a name first (under More options).") and still asks first, because
planning is billed. While the lead agent plans, a panel says so with the time since it started
("Started 2 minutes ago."), and every field waits. If no plan was made, the server's reason is
quoted with each draft's issues (drafts count from 1: "Draft 1, found by the rule check:"), and
the button becomes **Plan it again** ("Each try is billed."). **Write the plan yourself (for
developers)** now starts folded in both views: the view opens only **More options**.

**A plan's page.** The header has the plan's id, its status as a badge and who wrote it ("Written
by the lead agent · 4 tasks"). An approved plan says "Approved: it runs as run `<id>`." with
**Open run**; a rejected one quotes your reason. "What the lead agent fixed along the way" is a
fold with a hint ("2 drafts, 3 issues fixed") and starts folded in both views. Each task is a
numbered card, in the plan's order: title, id, role and what it comes after, then what it must
do beside "Done when" (one column when the page is narrow).

- **The rights table.** One row per task: May change files, the checks, and under each row's
  More options running checks itself, attempts and a time limit. A bar on top says nothing is
  allowed until you tick it and offers **Let every task change files**, which ticks only that
  box. Each check's command is listed once, under the table. A line counts what will be granted
  ("3 of 4 tasks may change files · 6 checks run before work is accepted · up to 4 billed
  attempts."); while no task may change files it is an amber notice instead. The rows stack
  when the table is narrow.
- **New agents** proposed with the plan are shown as editors: the role cannot change ("Set by
  the plan: task api needs an agent with this role."), the rest can.
- A refused approve quotes the server; when a run is active it adds "Wait for it to finish, or
  cancel it, then approve again." **Reject plan** is an outlined button, enabled once the reason
  has text.

**Your team** is a grid of cards: the agent's id, its role, model and reasoning, and the first
three lines of how it should work (or "No instructions yet: it works from its role alone."), with
**Edit** and **Remove**. **Add an agent** is the page's main button. The last agent's Remove is
greyed out ("Your only agent. Add another before removing it."). The editor opens across the
grid:

- A new agent's name shows its id as you type ("Saved as `email-sender`"); a name already in the
  team says so and offers **Edit `<name>`**.
- **Role** suggests the team's roles. "How it should work" counts its characters and turns amber
  past 9,500 of 10,000.
- A refusal lists one line per field, named as on screen ("How it should work: <the server's
  message>").
- Escape cancels only while nothing was changed. The focus starts in the form and goes back to
  **Edit** or **Add an agent** when it closes.

**The welcome screen** fills the window in two columns (one in a narrow window): what AgentForge
does, the four steps, the view as two large choices, and **Take the tour**. The view is saved as
soon as you pick it.

**The tour.** The part each step explains gets a dashed accent line inside it, so the solid focus
ring stays recognisable. The card has a small pointer toward that part and sits on the side with
room (right of the side list, under the status bar, above the View switch), moving to another
side when the window is too small or is resized. When the tour ends, the focus goes back to
where it was. A tour chosen while the server is off still starts once the app connects.

**The View switch** under the side list is a quieter strip, and **Show the guide again** is a
small text button.

## Delivered behavior (slice 7)

**The welcome screen.** The first time the app opens, before anything else and even while the
server is off, it says what AgentForge does and how it works in four steps (ask, approve the
plan, the team builds, review each change). It then asks "How should the app look?":

- **Plain**: technical options start folded under **More options**. This is the default.
- **Technical**: they start open.

The view covers every **More options** section (and, until slice 8, **Write the plan yourself (for
developers)**, which now starts folded in both views).
A run's attempts, its diffs and "What the lead agent fixed along the way" are content, not
technical controls, so they open as before. Switching the view opens or folds every section on
screen at once; you can still open or fold one by hand (since slice 8, a section opened or
folded by hand keeps that state when the view changes).

**The tour.** The welcome screen ends with **Take the tour** or **Skip the tour**. The tour is
six cards, one at a time ("Step 2 of 6"):

1. **Ask for something**
2. **Plans**
3. **Runs**
4. **Your team**
5. The status bar
6. The **View** switch

Each card sits beside the part it explains, which gets an accent ring (a dashed line since slice
8). It is a modal dialog, so
the rest of the window waits until the tour ends. **Back** and **Next** move between cards, and
**Finish** on the last card ends the tour. **End tour** or Escape stops it early, and the focus
stays on **Next**. The cards point at the side list, which exists only while the app is
connected, so a tour chosen while the server is off starts once the app connects. If the
connection drops mid-tour, the tour starts again from step 1 after the reconnect.

**Saved, and changeable later.** The app keeps three things in the window's own storage
(`localStorage`, key `agentforge.guide`), with no server change:

- the view
- that the welcome screen was passed
- the tour's state: wanted, done or skipped

Neither the welcome nor a finished or skipped tour comes back on its own. A tour that was chosen
but not finished comes back after a restart. At the bottom of the side list, **View: Plain /
Technical** changes the view, and **Show the guide again** brings back the welcome screen
(keeping the view) and with it the offer of the tour. If the storage cannot be read or holds
something unexpected, the app starts as on a first start: plain view, welcome screen shown.

## Delivered behavior (slice 6)

**The design.** It comes from a Claude Design pass and is kept in
[docs/design/agentforge](../design/agentforge/README.md): the rules, tokens, a guide per component
and static previews. The app follows it:

- **Colour only where it means something.** Quiet graphite everywhere; petrol for actions and work
  in progress; amber only for what needs you (a diff waiting for review, a plan waiting for your
  OK, an interrupted run, No token, "Live updates stopped"); red for trouble. A status is always
  a word ("Awaiting approval"), and its colour and icon only repeat it. Only Needs you, Working
  and Problem badges are filled.
- **Dark when Windows is dark.** The theme follows the Windows app setting; there is no toggle.
- **System fonts only** (Segoe UI Variable, Cascadia Mono), so nothing loads from the network.
- **Every control can be reached with the keyboard** and shows a focus ring; every icon sits beside
  a word.

**The frame.** The status bar keeps its six states, now with an icon and colour per state; No
token now reads "No token yet: start the server (steps below)", since the short command it gave
fails without `--worktrees`;
**Reconnect** shows it is busy only for its own click. While the server cannot be reached (any
state but Connected and Connecting), the window says "AgentForge can't reach its server" with
three steps and a **Copy command** button for the full `serve` command. The side list has **Ask
for something**, **Your team**, then two tabs, **Runs** and **Plans** (arrow keys switch them).
Each tab shows an amber count of what waits for you: diffs on the active run, plans waiting for
your OK. Opening a run or a plan switches to its tab; each tab keeps its scroll position. The
active run's item shows its own count of waiting diffs.

**The run page.** The header shows "Run <id>" with **Copy run id**, the state as a badge and a
summary ("5 tasks · 1 completed · 2 waiting for you"), and the run's controls; **Recover run** is
the page's one primary button. Each task card shows its status in words, then Task, Role (each
attempt names its agent), Attempt, its rights, its checks and the tasks it waits for ("After `build`"), a failure in plain
words with its code ("A check failed · `validation_rejected`") and its latest note. A task
waiting for review has an amber border. **Retry** says how many attempts are left ("2 more
attempts allowed (5 at most)") and is not offered once all 5 are used, since the server would
refuse it.

- **Attempts, newest first.** The latest opens while it runs or waits for review; earlier ones
  open while the latest runs, so a reject reason stays readable. Each shows its reason ("Your
  reason", "Check output" or "Agent error"), the agent's report and the diff, folded unless it
  waits for review. Colour codes in output are removed, never interpreted.
- **The diff** has its own scroll box, a line count ("3 files · +40 −12") and **Copy diff**; file
  headers, hunks, added and removed lines each have their tone.
- **The review band** sits under the waiting diff: **Approve diff**, or **Reject diff**, which
  opens the reason box in place (Escape goes back; a refused reject keeps the text).
- **Cancel asks first** with the focus on the safe answer ("Keep it", "Keep running"); Escape
  keeps.
- **A refusal** shows under the buttons that were used, "Server refused Retry for task build:
  <detail>", until **Dismiss** or the next click there.
- **History** is a table in its own scroll box with a sticky header and a **Show task** filter;
  on a live run it stays at the bottom only if you were already there.

## Delivered behavior (slice 5)

**Your team.** A side-list item under **Ask for something** shows every agent the next run gets
(`GET /agents`): its name, role, model and reasoning, and the first lines of how it works. The
page says plainly that the lead agent gives each task to the agent with the matching role and
that changes apply from the next run.

- **Add an agent:** a name ("Saved as `my-agent`" shows the id it becomes: lowercase, `-` for
  spaces, other characters dropped), a **Role** and **How it should work** (the persona, with a
  "n of 10,000 characters" count). **Model** (empty: the default) and **Reasoning** sit under
  **More options**. A name already in the team is caught before saving, since a save replaces.
- **Edit** opens the same fields in place; the name stays fixed, because it is the file name.
- **Remove** asks first: "Remove agent qa? Runs from now on will not use it." The last agent
  cannot be removed; the server's reason is shown.
- Every save is `PUT /agents/{id}`, every removal `DELETE /agents/{id}`; a refusal shows the
  server's `detail` (or its field errors) under the form.

**The lead agent can make a new agent when no role fits.** With a plan it may propose new agents
(a name, a role and how it should work; never a model or reasoning). Plain code checks each one
before the plan is offered (see [the M4 doc](M4-orchestration.md#new-agents-from-the-lead)). On the
plan's page, **New agents for this plan** shows each one's name and role, with **How it should
work** (and **Model** and **Reasoning** under **More options**) to change before **Approve and
start**. The role stays as proposed, since the plan's tasks go to the agent by role. Approving adds them to your team and the run starts
with them; rejecting the plan makes none. After the decision the plan's page lists them,
read-only.

## Delivered behavior (slice 4)

**Ask for something.** The side list starts with **Ask for something**, and it is what the app
shows when there is no run yet. Say what you want and name your project folder; **Plan it** asks
first, because the lead agent is billed ("It uses your Claude account"), then calls
`POST /proposals/from-request`. While it plans, the page says so. A run name
(`req-YYYYMMDD-HHMMSS`, from the local time) and the number of revisions (default 2) are filled
in for you, under **More options**. If the lead agent cannot make a valid plan, the page shows
why and each round's issues.

**Write the plan yourself (for developers).** A collapsed section on the same page holds a JSON
editor, pre-filled with a one-task plan that uses your first agent's role. The app checks that
it is JSON; the server checks the rules (`POST /proposals`), and its answer is shown as is. Field
errors (a 422) read as `body.tasks.0.role: Field required`.

**Plans.** The side list shows every proposal, newest first, as **Waiting for your OK**,
**Approved** or **Rejected**, from `GET /proposals`, asked every 2 seconds with `GET /runs`. A
plan's page shows who wrote it (the lead agent or by hand), each task (title, id, role, what it
waits for, objective, description, "Done when") and, folded, what the lead agent fixed along the
way (each round's draft, whether the rule check or the review found it, and the issues).

**Approve with rights.** A waiting plan has an approve form. Nothing is granted by default: a
task left as it is can only read. Per task: **May change files**, and the **Checks to run before
its work is accepted** (from `GET /checks`, each shown with its command). Under **More options**:
let it run the checks itself (needs May change files, the server's rule), attempts (1–5) and a
time limit per attempt. The **Project folder** is required; the folder typed for a request fills
it in. **Approve and start** sends `POST /proposals/{id}/approve` and opens the run's page. A
refusal (a run already active, a broken rule) shows the server's `detail` under the form.

**Reject with a reason,** required and kept with the plan; its page then shows it. An approved
plan's page has **Open run**.


## Delivered behavior (slice 3)

**Every saved run is listed.** The side list shows each run newest first, marked **Active** or
**Interrupted** (saved with unfinished tasks, but not running: the server restarted). It comes
from the `GET /runs` the app already asks every 2 seconds. The page shows your pick, else the
active run, else the newest.

**A run page per run:** its state (Active, Interrupted or Finished), one card per task and the
run's history. The card shows the status, the attempt, the task's rights ("may edit", the checks
that run on approval) and the task's latest reason. Every attempt has its own section with its
reason (why it failed, or your reject reason), the worker's report and its diff. While the run is
active, each live event reloads the report (`GET /runs/{id}`), so the page follows the run
without a refresh button.

**Controls, shown only when they apply:**

| Control | Shown for |
|---|---|
| Pause run, Cancel run | The active run; Resume run too when a task is paused |
| Recover run | An interrupted run, while no other run is active |
| Pause, Cancel | A task of the active run that is waiting or working |
| Resume, Cancel | A paused task of the active run |
| Approve diff, Reject diff, Cancel | A task of the active run waiting for approval |
| Retry | A failed or cancelled task: in the active run, or in another run while no run is active (the API reopens a finished run, one run at a time) |

**A diff is reviewed where it is shown.** The waiting attempt opens with its diff, an Approve
diff button and a reject form whose reason is required; the next attempt is told it.

**Cancel asks first,** in place: "Stop task build? Its worker stops now; you can retry it."
Everything else acts at once. While a request is out, that card's buttons are disabled, and a
refusal (a 400, 404 or 409) shows the server's `detail` next to the control that was used.

**Diffs, worker reports and reasons are shown as plain text,** never as HTML.

## Delivered behavior (slice 2)

```powershell
npm --prefix apps/desktop install
npm --prefix apps/desktop run tauri dev     # with `python -m agentforge serve` running
```

**A window that shows whether the server answers.** The app asks `GET /runs` every 2 seconds and
shows one state at the top, in words and an icon (color only repeats it):

| State | Means |
|---|---|
| Connecting… | The first answer has not come yet |
| No token yet | `%APPDATA%\AgentForge\api-token` could not be read: the server has never started |
| Server offline | Nothing answers at `127.0.0.1:8765` |
| Token refused | The server refused the token even after the app read the file again |
| Server error | The server answered with another error; its status and `detail` are shown |
| Connected | The server answered |

**The token follows server restarts.** `serve` writes a new token at every start. After a 401
the app reads the file again and retries once. A restart brings it back to Connected with
nothing for you to do. **Reconnect** asks again at once.

**The active run, live.** While connected, the app follows the active run's
`GET /runs/{id}/events`. If the stream drops or the server goes away, it reconnects with
`Last-Event-ID` and gets only the transitions it missed. It stops at the `end` event. (Slice 2
listed the transitions themselves; since slice 3 each one reloads the run page.)

**The window can read one file and call one server.** The Tauri capability allows reading
`$DATA/AgentForge/api-token` and nothing else. The content security policy allows connections
only to the app itself and `http://127.0.0.1:8765`. Transition details are shown as text, never
as HTML.

## Delivered behavior (slice 1)

**Agents can be listed, added, edited and removed over the API.** The routes call the existing
`agentforge.personas` functions on the persona folder (`%APPDATA%\AgentForge\agents`).

**Edits apply from the next run.** The server reads the persona folder again for every plan
check and every run start, instead of once at startup. A run that is active keeps the agents it
started with, so its sessions and recovery are not disturbed.

**The last agent cannot be removed.** An empty folder means "use the seven defaults", so removing
the last agent would silently bring them back. Add the new agent first, then remove the old one.

**A browser client may call the API only from the desktop app's origins:**
`http://tauri.localhost` (the Tauri webview on Windows) and `http://localhost:1420` (its dev
server). The token is still required on every real request.

## Contract (added to [M5's](M5-api.md#contract))

| Method and path | Does |
|---|---|
| `GET /agents` | `{"agents": [AgentConfig]}`: the agents the next run gets (the folder's, or the seven defaults when it has none). Writes nothing |
| `PUT /agents/{id}` | Body: an `AgentConfig`. Adds or edits the agent's file; answers with the agent. 400 if the body's id differs from the path or the id breaks the rule; 422 if a field is invalid (a persona over 10,000 characters) |
| `DELETE /agents/{id}` | Removes the agent's file. 404 if unknown; 400 for the last agent |
| `GET /runs` | `{"active": id or null, "unfinished": [ids], "runs": [ids, newest first]}` |
| `GET /proposals` | `{"proposals": [Proposal]}`, newest first, decided ones included |
| `GET /checks` | `{"checks": {name: [argv]}}`: what each check a task can be given runs |

`PUT` and `DELETE` first copy the defaults into an empty folder (`personas.setup`), so editing
one default in a new profile keeps the other four.

`ApiSettings` gained `agents` (the persona folder, default `%APPDATA%\AgentForge\agents`) and
`origins` (the two origins above). `serve` uses both defaults. `RunStore` gained `runs()` and
`proposals()`, listed by saving order.

## How to debug a run

| Question | Where the answer is |
|---|---|
| Which agents did this run start with? | `workers` in `GET /runs/{id}` while it is active; the `api: run <id> starts with agents ...` log line |
| Why does my agent edit not show in the running run? | Edits apply from the next run; the active run keeps its agents |
| Why was a plan or a run start refused with 400? | The `detail` names the broken persona file and what is wrong with it |
| Why was an agent change refused? | The answer's `detail` (400) or the field errors (422) |
| Why does the app's call fail with a CORS error? | Its origin is not in `ApiSettings.origins`; the server answered the preflight with 400 |

| Logger | Level | Event |
|---|---|---|
| `agentforge.api` | DEBUG | `api: agent <id> saved` / `api: agent <id> removed`: the id only, never the persona |
| `agentforge.api` | DEBUG | `api: run <id> starts with agents <ids>` |
| `agentforge.api` | DEBUG | A refused agent request or a broken persona file: the existing `<method> <path> answered <status>`; the detail, which can quote the file, is never logged |

### The desktop app (slices 2 to 8)

| Question | Where the answer is |
|---|---|
| Why does the app say "No token yet"? | The token file is missing: start `serve`. The console line names the path |
| Why "Server offline" while `serve` runs? | It must listen on `127.0.0.1:8765`; check the server's port |
| Why "Token refused"? | The file holds a token the server does not accept, even after re-reading: a file written by hand, or a server started with another `APPDATA`. A second `serve` on the same port stops before writing its token ("port 8765 is in use") |
| Why did the page stop following the run? | "Live updates stopped:" under the run title says why (an unknown run or a refused token); a drop reconnects by itself |
| Why did my click do nothing? | The server refused it: its `detail` is shown next to the control, and the console has `POST <path> answered <status>` |
| Did the app send my approve, pause or retry? | The console's `POST /runs/<id>/tasks/<task>/<action> answered 200`; the run's History shows the server's reason, such as `approve_task was called` |
| Where did my reject reason go? | Under that attempt, as its reason (`TaskAttempt.message`); the next attempt is told it. It is never logged |
| Why is a button missing? | Controls show only when the server would accept them; see the table under slice 3's delivered behavior. A task that used all 5 attempts says "All 5 attempts used" instead of offering Retry. While another run is active, an older run's Retry and Recover are hidden and its header names the active run |
| Why did Copy not work? | The message next to the button ("Could not copy: …"); the console has `copy <what> failed: <error name>` |
| Why was my plan not made? | The message under **Plan it** and, under it, each round's issues (the 422's `rounds`); the console has `POST /proposals/from-request answered 422`. A run name already used is refused at once (409), before anything is billed |
| Why was my hand-written plan refused? | The message under **Save the plan**: `not valid JSON: …` (never sent), the rule that broke (400) or the field errors (422) |
| Why did Approve and start fail? | The `detail` under the form: a run already active (409), an unknown check or a missing folder (400). A hand-written plan's own `check:<name>` must be a check on the server too |
| Did the app send my approve or reject? | The console's `POST /proposals/<id>/approve answered 202` or `.../reject answered 200`; the plan's status in **Plans** |
| Why was my agent change refused? | The message under the form: the server's `detail` (a bad name, the last agent) or its field errors (a persona over 10,000 characters) |
| Did the app save or remove my agent? | The console's `PUT /agents/<id> answered 200` or `DELETE /agents/<id> answered 200`; the server logs `api: agent <id> saved` / `removed` |
| Why does the running run not use my edit? | Edits apply from the next run; the page says so |
| Why did the lead agent add an agent, or why was its agent refused? | The plan's page: its new agents, and under "What the lead agent fixed along the way" each rule its agents broke (the check's issues) |
| Why was a plan with new agents not approved? | The `detail` under the form: `keep the proposed agents: …` (400) or `agent … already exists` (409, made in the meantime) |
| Where did my plan's reject reason go? | On the plan's page (`Proposal.reason`). It is never logged |
| Why does the welcome screen show again? | The saved choices could not be read: the console has `guide: could not read the saved choices: <reason>` (`bad shape`, `no storage` or the error's name). Or someone pressed **Show the guide again** (`guide: shown again`) |
| Why does the tour start when I open the app? | It was chosen but not finished (`tour=wanted` in the `guide: welcome passed` line); finish it or press **End tour** |
| How do I see a first start again? | **Show the guide again**, or clear the window's local storage (right-click, Inspect, Application, Local storage) and reload |
| Why is there no **Plan fixes from the reviews** button? | It shows only on a finished run with a finished review whose report holds "Must fix" (`hasReviews` in `runs.ts`, as `_reviews` in `api.py` decides). A review that found nothing gives the lead nothing to plan |
| Why did planning the fixes fail? | The message under the button (the server's `detail`); the console has `POST /runs/<id>/fix-plan answered <status>` |
| What did the app do, in order? | The webview's developer console (right-click, Inspect, in `tauri dev`): lines starting `agentforge.desktop:` |

| Console level | Line |
|---|---|
| debug | `connection: connecting` / `connection: connected` |
| warn | `connection: no-token` / `offline` / `unauthorized` / `failed` |
| debug | `token re-read after 401` |
| warn | `<method> <path> refused the token` |
| debug | `<method> <path> answered <status>`: every change sent (`POST`, `PUT`, `DELETE`) and every refused request; the status only, never the body or the `detail`. Successful reads are not logged, since the connection poll reads every 2 seconds |
| debug | `token file %APPDATA%\AgentForge\api-token could not be read` |
| debug | `events for run <id> dropped after <sequence>; reconnecting` / `events for run <id> ended after <sequence>` |
| warn | `events for run <id> stopped: <status or kind>` |
| warn | `copy <what> failed: <error name>`: never the copied text, since a diff can hold secrets |
| debug | `guide: welcome passed, view=<view>, tour=<wanted or skipped>` / `guide: tour step <n> of 6 (<part>)` / `guide: tour <done or skipped>` / `guide: view=<view>` / `guide: shown again` |
| warn | `guide: could not read the saved choices: <reason>` / `guide: could not save the choices: <reason>`: `bad shape`, `no storage` or the error's name, never the saved text |

The token, request and response bodies (a reject reason, a request's text, a plan among them),
field errors, the lead agent's rounds, diffs, worker reports and transition details are never
logged. The welcome screen, view and tour happen in the app alone, with no run, so they have no
run report; the console lines above are their record.

## Limits

- **A persona file broken by hand stops new plans and runs** until it is fixed or removed; the
  400 names the file. `DELETE /agents/{id}` still works on it.
- **The origins are fixed in code.** There is no command-line option to add another.
- **Agent edits are not locked against a text editor** changing the same file at the same time;
  the last write wins.
- **You start the server yourself** before or after opening the app; the app does not start or
  stop it (M8).
- **The app polls every 2 seconds** to notice a lost server; the live events come by stream.
- **The run list shows ids and the Active or Interrupted marker only.** Anything more per run
  would cost one request per run; open a run for its tasks.
- **Each live event reloads the whole run report.** A newer reload cancels an older one, so a
  burst of events costs one answer; fine for runs of tens of tasks.
- **Diffs are plain text:** not highlighted by language, not side by side, and a very long diff
  is drawn in full inside a scrolling box.
- **Hand-written plans are JSON;** there is no form for them yet.
- **Per-task repository and base commit** can be set only through the API; the app sends one
  project folder for every task.
- **Planning holds the page:** the lead agent's answer can take minutes, and leaving the page
  while it plans loses the answer's display (the plan still appears under **Plans**).
- **The project folder is remembered only while the app is open.**
- **An agent cannot be renamed;** add one with the new name, then remove the old one.
- **The seven defaults cannot be restored from the app;** add them again by hand, or empty the
  agents folder yourself.
- **A new agent the lead proposes cannot be dropped at approval, nor its role changed;** change
  how it works, or reject the plan and ask again.
- **The view, the welcome and the tour are saved in this window only.** `tauri dev` and an
  installed build (M8) use different storage, so a choice made in one does not carry to the
  other. Clearing the WebView2 data starts over.
- **The tour points at the side list and the status bar only;** it does not open pages or show
  what a run looks like.
- **A plan's tasks are listed in the plan's order,** which need not be the order they start in;
  "after `api`" on each card says what it waits for.
- **The planning panel's time moves in whole minutes** and is checked every 15 seconds.
- **The active run's report is read every 2 seconds** for the waiting-diffs count, on top of the
  reloads its live events cause.
- **The theme follows Windows;** there is no light or dark switch in the app.
- **The token path is fixed** to the real `%APPDATA%`. A server started with a different
  `APPDATA` writes a token the app cannot see.
- **The app is run with `tauri dev`;** no installer is built (M8).

## Not implemented yet

| Deferred | Waits for |
|---|---|
| A command-line option for allowed origins | When a second client needs it |

## Acceptance checks

Run the pytest and Ruff commands in the root README, plus `npm --prefix apps/desktop test` and
`npm --prefix apps/desktop run build`. The tests for reviews and fix plans (2026-11-24):

- `proposals.test.ts`: `planFixes` sends the run's `fix-plan` path, encoded, with the new name.
- `runs.test.ts`: `hasReviews` is true for a finished review with "Must fix" findings, and false
  while it runs, for an empty report, for a review that found nothing to fix and for another
  role.

The button (with its billing question) and the plan page's line have no tests of their own (that would need a DOM library);
`tsc` covers them. Slice 8's tests:

- `proposals.test.ts`: the rights summary (none while no task may change files; tasks, checks and
  billed attempts counted; the singular for one); a draft's title counted from 1, by the rule
  check or the lead agent's review; the fixes hint; the time since planning started, in whole
  minutes.
- `client.test.ts`: each field error of a 422 read with the server's words, and none for a
  refusal in words, a lost server or another error.
- `guide.test.ts`: the tour card's place: right of a side-list item with its notch at the
  item's middle; below it when the window has no room on either side; below the status bar;
  above the footer, or below it when there is no room above; inside a window too small for any
  side; the notch kept within the card.

The new look, the folds, the rights table, the team grid and the tour's notch have no tests of
their own (that would need a DOM library); `tsc` and the window check cover them. Slice 7's
tests:

- `guide.test.ts`: the start (plain view, welcome shown) when nothing is saved; saved choices
  read back; text that is not JSON, an unknown view or tour state, a welcome flag that is not
  true or false, a value that is not an object, a storage that refuses, a storage that cannot
  even be reached (reading `localStorage` throws) and no storage at all, each falling back to the
  start with its reason logged and the saved text kept out of the log; a save written as JSON
  under `agentforge.guide`, and a refused, unreachable or missing storage warned about without
  throwing; passing the welcome with the tour wanted or skipped, ending the tour done or
  skipped, switching the view, and showing the guide again with the view kept, each with its
  console line.

The welcome screen, the tour and the footer have no tests of their own (that would need a DOM
library); `tsc` and the window check cover them. Slice 6's tests:

- `runs.test.ts`: every diff line's tone by where it is (outside a hunk a file header, `new
  file mode` included; inside one a removed `--- note` and an added `+++ x` stay changes); the
  file and line counts, those two lines included; the attempt whose review band is on screen,
  and none once the task left review (a refused approve then shows under the card); each of the 11 statuses'
  words and group; the seven failure labels and an unknown code; the run summary; Retry offered
  after 4 attempts and not after 5; the attempts-left text; colour codes removed with HTML kept
  as text; which attempts start open.
- `ui.test.ts`: a copy that works, and one that fails logged by the error's name, never the text.

The new look has no tests of its own; `tsc` and the window check cover it. Slice 5's tests:

- `test_lead.py`: a draft adding an agent for a role no agent has, accepted with the agent, the
  critique shown it, its count logged and its persona not; the check's issue for a bad name, a
  name already used, a name listed twice, a role that already has an agent, an agent no task
  uses and a persona over 10,000 characters; a role with a space at an end (the plan is
  rejected, not offered, with the issue logged as a count).
- `test_api.py`: a lead proposal carrying its agent; approving it with the person's edits makes
  the agent (listed, edited) and the run starts with it, with the personas never logged; the
  agents dropped or renamed (400), a changed role (400), an approval refused by a later check
  (bad rights) saving no agent, an agent made in the meantime (409, nothing overwritten, the
  plan still pending), and agents sent for a plan that proposes none (400); the refusals logged
  as `answered 400`, the persona not.
- `test_store.py`: a decision keeps the approved agents. `test_personas.py`: `check_id`.
- `agents.test.ts`: the id made from a name; the encoded path; a save as `PUT` with JSON, a
  removal as `DELETE`; a refusal reaching the caller. `proposals.test.ts`: the person's
  versions of the new agents sent, an empty list when there are none. `client.test.ts`: an agent save logged without its persona.

Slice 4's tests (Vitest, fakes, no timers):

- `proposals.test.ts`: the approve body (nothing granted by default; edit, check, checks,
  attempts and a timeout; checks-itself dropped without edit; a bad timeout refused instead of
  sent as "no limit"); a plan that is not JSON refused before sending; the run name from the
  local time; the template's task `run_id` matching its plan; ids encoded in paths; each request
  sent as JSON to its path; the lead agent's rounds read from a 422 and from nothing else.
- `client.test.ts`: field errors (a 422) turned into readable lines, the body kept on the error,
  and neither the plan nor the errors logged.

Slice 3's tests:

- `runs.test.ts`: which controls a task offers, for all 11 statuses with the run active and not;
  a control's path with its ids encoded; a reject sending its reason as JSON; a refusal reaching
  the caller; how each kind of diff line is marked.
- `client.test.ts`: a change logged with its status but never its body (a reject reason), and a
  successful read not logged.

The components have no tests of their own (that would need a DOM library); the `tsc` build
checks them. Slice 2's tests (a fake `fetch` and token reader, no timers):

- `client.test.ts`: the token sent as a bearer header to `127.0.0.1:8765`; a 401 re-reading the
  token and retrying once; a second 401 as `unauthorized`; no token file as `no-token` without a
  request; an unreachable server as `offline`; a 400 carrying its `detail` with the detail kept
  out of the log; the token never logged.
- `events.test.ts`: frames split across chunks, in both line endings; the `end` event stopping
  the stream; a drop and a lost server reconnecting with the last `Last-Event-ID`, logged with
  ids only and without the detail; a stream breaking mid-read reconnecting; an abort stopping
  without reconnecting; a 404 ending it without a retry.
- `connection.test.ts`: every answer and `ApiError` kind mapped to its state; a lost connection
  logged as a warning, a connection as progress.

Slice 1's tests:

- `test_api.py`: the new routes refuse a missing or wrong token; agents listed (writing
  nothing), added with the defaults kept, edited and removed, logged by id without the persona;
  a mismatched id, a bad id, a too-long persona, an unknown agent and the last agent refused; an
  edit reaching the next run but not the active one, with the start logged; a broken persona
  file answering 400 with its name and its text kept out of the log; runs, proposals and checks
  listed; a preflight from each allowed origin accepted and from another refused.
- `test_store.py`: runs and proposals listed newest first by saving order.
