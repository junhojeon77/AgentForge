# M6 — Desktop dashboard (in progress)

M6 gives AgentForge a window: a Tauri 2 desktop app to follow runs live, approve plans and
diffs, control tasks and edit agents on screen. It is built in slices.

| Slice | Scope | Status |
|---|---|---|
| 1 | API additions the app needs: agent endpoints, lists, checks, CORS | Implemented on 2026-11-15 |
| 2 | App shell (`apps/desktop`): token, API client, live events, connection states | Planned |
| 3 | Runs: list, run page, controls, diff review | Planned |
| 4 | Proposals: list, detail, new from a request or by hand, approve with rights | Planned |
| 5 | Agent editor | Planned |

The desktop app does not exist yet. Everything below describes slice 1, the API side.

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

## Limits

- **A persona file broken by hand stops new plans and runs** until it is fixed or removed; the
  400 names the file. `DELETE /agents/{id}` still works on it.
- **The origins are fixed in code.** There is no command-line option to add another.
- **Agent edits are not locked against a text editor** changing the same file at the same time;
  the last write wins.

## Not implemented yet

| Deferred | Waits for |
|---|---|
| The desktop app itself | Slices 2–5 |
| A command-line option for allowed origins | When a second client needs it |

## Acceptance checks

Run the pytest and Ruff commands in the root README. Slice 1's tests:

- `test_api.py`: the new routes refuse a missing or wrong token; agents listed (writing
  nothing), added with the defaults kept, edited and removed, logged by id without the persona;
  a mismatched id, a bad id, a too-long persona, an unknown agent and the last agent refused; an
  edit reaching the next run but not the active one, with the start logged; a broken persona
  file answering 400 with its name and its text kept out of the log; runs, proposals and checks
  listed; a preflight from each allowed origin accepted and from another refused.
- `test_store.py`: runs and proposals listed newest first by saving order.
