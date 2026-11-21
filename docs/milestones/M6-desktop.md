# M6 — Desktop dashboard (in progress)

M6 gives AgentForge a window: a Tauri 2 desktop app to follow runs live, approve plans and
diffs, control tasks and edit agents on screen. It is built in slices.

| Slice | Scope | Status |
|---|---|---|
| 1 | API additions the app needs: agent endpoints, lists, checks, CORS | Implemented on 2026-11-15 |
| 2 | App shell (`apps/desktop`): token, API client, live events, connection states | Implemented on 2026-11-18 |
| 3 | Runs: list, run page, controls, diff review | Planned |
| 4 | Proposals: list, detail, new from a request or by hand, approve with rights | Planned |
| 5 | Agent editor | Planned |

Slice 1 is the API side; slice 2 is the app's shell. The app has no run, proposal or agent
screens yet.

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
`GET /runs/{id}/events` and lists each transition: sequence, task, status and reason. If the
stream drops or the server goes away, it reconnects with `Last-Event-ID` and gets only the
transitions it missed. It stops at the `end` event.

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

### The desktop app (slice 2)

| Question | Where the answer is |
|---|---|
| Why does the app say "No token yet"? | The token file is missing: start `serve`. The console line names the path |
| Why "Server offline" while `serve` runs? | It must listen on `127.0.0.1:8765`; check the server's port |
| Why "Token refused"? | The file holds a token the server does not accept, even after re-reading: a second server, or a file written by hand |
| Why did the live list stop? | The message under the run title says why (an unknown run or a refused token); a drop reconnects by itself |
| What did the app do, in order? | The webview's developer console (right-click, Inspect, in `tauri dev`): lines starting `agentforge.desktop:` |

| Console level | Line |
|---|---|
| debug | `connection: connecting` / `connection: connected` |
| warn | `connection: no-token` / `offline` / `unauthorized` / `failed` |
| debug | `token re-read after 401` |
| warn | `<method> <path> refused the token` |
| debug | `<method> <path> answered <status>`: the status only, never the `detail` |
| debug | `token file %APPDATA%\AgentForge\api-token could not be read` |
| debug | `events for run <id> dropped after <sequence>; reconnecting` / `events for run <id> ended after <sequence>` |
| warn | `events for run <id> stopped: <status or kind>` |

The token, response bodies and transition details are never logged.

## Limits

- **A persona file broken by hand stops new plans and runs** until it is fixed or removed; the
  400 names the file. `DELETE /agents/{id}` still works on it.
- **The origins are fixed in code.** There is no command-line option to add another.
- **Agent edits are not locked against a text editor** changing the same file at the same time;
  the last write wins.
- **You start the server yourself** before or after opening the app; the app does not start or
  stop it (M8).
- **The app polls every 2 seconds** to notice a lost server; the live events come by stream.
- **Only the active run is shown,** and only while it is active: its list clears when it ends.
  Finished runs come with slice 3.
- **The token path is fixed** to the real `%APPDATA%`. A server started with a different
  `APPDATA` writes a token the app cannot see.
- **The app is run with `tauri dev`;** no installer is built (M8).

## Not implemented yet

| Deferred | Waits for |
|---|---|
| Run, proposal and agent screens | Slices 3–5 |
| A command-line option for allowed origins | When a second client needs it |

## Acceptance checks

Run the pytest and Ruff commands in the root README, plus `npm --prefix apps/desktop test` and
`npm --prefix apps/desktop run build`. Slice 2's tests (Vitest, a fake `fetch` and token reader,
no timers):

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
