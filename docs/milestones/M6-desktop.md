# M6 — Desktop dashboard (in progress)

M6 gives AgentForge a window: a Tauri 2 desktop app to follow runs live, approve plans and
diffs, control tasks and edit agents on screen. It is built in slices.

The app is for people who do not code as well as those who do ([who it is
for](../../README.md)): every screen leads with the plain path in plain words and keeps each
technical control one click away, under **More options** or a "for developers" section.

| Slice | Scope | Status |
|---|---|---|
| 1 | API additions the app needs: agent endpoints, lists, checks, CORS | Implemented on 2026-11-15 |
| 2 | App shell (`apps/desktop`): token, API client, live events, connection states | Implemented on 2026-11-18 |
| 3 | Runs: list, run page, controls, diff review | Implemented on 2026-11-20, with plain styling |
| 4 | Proposals: list, detail, new from a request or by hand, approve with rights | Implemented on 2026-11-20, with plain styling |
| 5 | Agent editor ("Your team"), and new agents the lead agent proposes with a plan | Implemented on 2026-11-20, with plain styling |
| 6 | Visual design of every screen, from a Claude Design pass | Planned |
| 7 | First-start survey and guide: choose the plain or technical view (whether **More options** starts open), changeable later | Planned |

Slice 1 is the API side, slice 2 the app's shell, slice 3 the run screens, slice 4 the proposal
screens and slice 5 the agent editor. The app's look is deliberately plain until slice 6.

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
| Recover run | An interrupted run |
| Pause, Cancel | A task of the active run that is waiting or working |
| Resume, Cancel | A paused task of the active run |
| Approve diff, Reject diff, Cancel | A task of the active run waiting for approval |
| Retry | A failed or cancelled task, in any run (the API reopens a finished run) |

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

**The last agent cannot be removed.** An empty folder means "use the five defaults", so removing
the last agent would silently bring them back. Add the new agent first, then remove the old one.

**A browser client may call the API only from the desktop app's origins:**
`http://tauri.localhost` (the Tauri webview on Windows) and `http://localhost:1420` (its dev
server). The token is still required on every real request.

## Contract (added to [M5's](M5-api.md#contract))

| Method and path | Does |
|---|---|
| `GET /agents` | `{"agents": [AgentConfig]}`: the agents the next run gets (the folder's, or the five defaults when it has none). Writes nothing |
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

### The desktop app (slices 2 to 5)

| Question | Where the answer is |
|---|---|
| Why does the app say "No token yet"? | The token file is missing: start `serve`. The console line names the path |
| Why "Server offline" while `serve` runs? | It must listen on `127.0.0.1:8765`; check the server's port |
| Why "Token refused"? | The file holds a token the server does not accept, even after re-reading: a second server, or a file written by hand |
| Why did the page stop following the run? | "Live updates stopped:" under the run title says why (an unknown run or a refused token); a drop reconnects by itself |
| Why did my click do nothing? | The server refused it: its `detail` is shown next to the control, and the console has `POST <path> answered <status>` |
| Did the app send my approve, pause or retry? | The console's `POST /runs/<id>/tasks/<task>/<action> answered 200`; the run's History shows the server's reason, such as `approve_task was called` |
| Where did my reject reason go? | Under that attempt, as its reason (`TaskAttempt.message`); the next attempt is told it. It is never logged |
| Why is a button missing? | Controls show only when the server would accept them; see the table under slice 3's delivered behavior |
| Why was my plan not made? | The message under **Plan it** and, under it, each round's issues (the 422's `rounds`); the console has `POST /proposals/from-request answered 422` |
| Why was my hand-written plan refused? | The message under **Save the plan**: `not valid JSON: …` (never sent), the rule that broke (400) or the field errors (422) |
| Why did Approve and start fail? | The `detail` under the form: a run already active (409), an unknown check or a missing folder (400) |
| Did the app send my approve or reject? | The console's `POST /proposals/<id>/approve answered 202` or `.../reject answered 200`; the plan's status in **Plans** |
| Why was my agent change refused? | The message under the form: the server's `detail` (a bad name, the last agent) or its field errors (a persona over 10,000 characters) |
| Did the app save or remove my agent? | The console's `PUT /agents/<id> answered 200` or `DELETE /agents/<id> answered 200`; the server logs `api: agent <id> saved` / `removed` |
| Why does the running run not use my edit? | Edits apply from the next run; the page says so |
| Why did the lead agent add an agent, or why was its agent refused? | The plan's page: its new agents, and under "What the lead agent fixed along the way" each rule its agents broke (the check's issues) |
| Why was a plan with new agents not approved? | The `detail` under the form: `keep the proposed agents: …` (400) or `agent … already exists` (409, made in the meantime) |
| Where did my plan's reject reason go? | On the plan's page (`Proposal.reason`). It is never logged |
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

The token, request and response bodies (a reject reason, a request's text, a plan among them),
field errors, the lead agent's rounds, diffs, worker reports and transition details are never
logged.

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
- **The five defaults cannot be restored from the app;** add them again by hand, or empty the
  agents folder yourself.
- **A new agent the lead proposes cannot be dropped at approval, nor its role changed;** change
  how it works, or reject the plan and ask again.
- **Every technical control starts folded** until slice 7's survey lets each person choose.
- **The look is plain** until slice 6's design pass.
- **The token path is fixed** to the real `%APPDATA%`. A server started with a different
  `APPDATA` writes a token the app cannot see.
- **The app is run with `tauri dev`;** no installer is built (M8).

## Not implemented yet

| Deferred | Waits for |
|---|---|
| A visual design | Slice 6 |
| A first-start survey and guide (plain or technical view) | Slice 7 |
| A command-line option for allowed origins | When a second client needs it |

## Acceptance checks

Run the pytest and Ruff commands in the root README, plus `npm --prefix apps/desktop test` and
`npm --prefix apps/desktop run build`. Slice 5's tests:

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
