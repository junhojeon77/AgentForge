# M3 — Worktrees, edit-capable workers, diffs and real validation

## Delivered behavior

A worker can now change code without touching your checkout:

1. `agentforge.worktrees.WorktreeExecutor` gives each task its own Git worktree.
2. A task that allows `"edit"` lets the Claude Code worker edit files there. A task that also
   allows `"check"` lets it run its own check commands, and no other command (added 2026-11-15).
3. AgentForge records the diff itself, with Git, after the worker finishes.
4. `agentforge.validation.CommandValidator` runs the task's check commands in the worktree. It
   ignores what the worker claims to have checked.

No new dependency was added; Git and `asyncio` subprocesses do the work. The scheduler is unchanged.

## Contract

| Item | Behavior |
|---|---|
| `WorktreeExecutor(inner, root)` | Wraps any `WorkerExecutor`. Creates a worktree at `root/<run_id>/<task_id>/<attempt>` (the attempt folder was added in [M4](M4-orchestration.md)) from `TaskSpec.repository_reference` at `TaskSpec.base_commit` (empty means `HEAD`), runs `inner` with `workspace_reference` set to it, then sets `workspace` and `diff` on the result |
| `worktrees.create(repo, base_commit, path)` | `git worktree add --detach`; `path` must be absolute. The commit is resolved first, so an unknown commit or a value starting with `-` is rejected |
| `worktrees.diff(path)` | `git add -A -f`, then `git diff --cached --no-ext-diff --no-textconv HEAD`: every change since the base commit, new files included. Files in ignored paths are included too (`-f`), because the checks still run them |
| `worktrees.remove(repo, path)` | `git worktree remove --force`: deletes the worktree and its uncommitted changes |
| `worktrees.remove_run(repo, root, run_id)` | Deletes every worktree under `root/<run_id>` (all tasks, all attempts) with `remove`, then the empty folders, and returns the removed paths. Nothing calls it automatically; call it after the run has finished. A folder Git does not know as a worktree is left in place and named in a `RuntimeError`, after the real worktrees are removed. The run id must be a safe id |
| `python -m agentforge clean <run_id> --repo <repo> --root <root>` | The same from the command line: prints each removed path. Exit 1 when a folder was kept, 2 for an unsafe run id |
| `TaskSpec.allowed_operations` | `"edit"` gives the Claude Code worker `--tools Read,Glob,Grep,Edit,Write` and `--permission-mode acceptEdits`. Without it the worker is read-only, as in M2 |
| `"check"` in `allowed_operations` | Needs `"edit"` too. For each `check:<name>` constraint the worker gets the `Bash` tool and one exact rule, `--allowedTools Edit Write "Bash(<command>)"`, in `--permission-mode dontAsk`, which refuses every command without a rule. The prompt lists the exact commands. AgentForge still runs every check itself afterwards and ignores what the worker ran |
| `ClaudeCodeExecutor(..., checks={name: argv})` | The same mapping `CommandValidator` gets. The command line is `shlex.join(argv)`. A `"check"` task whose check has no command, or whose command contains `*`, `(` or `)` (rule syntax, a `*` would widen the rule), raises `ValueError` before Claude starts |
| `WorkerResult.workspace`, `WorkerResult.diff` | Set by `WorktreeExecutor`, never by the model; both are left out of the schema the model fills in |
| `CommandValidator(checks={name: argv}, timeout=600)` | For each `check:<name>` in `TaskSpec.execution_constraints`, runs `argv` (no shell) in `result.workspace`, or in `task.workspace_reference` when that is unset |

Outcome mapping:

- Run and task ids may use only `A-Z a-z 0-9 - _`, so a worktree can never land outside `root`.
  Anything else, a missing `repository_reference`, or any Git failure raises →
  `EXECUTOR_EXCEPTION`.
- A worktree path that already exists (the same run id, task id and attempt number again) is a
  Git failure. Nothing is overwritten. The one exception, since [M4](M4-orchestration.md): an
  attempt the scheduler resumes after a pause reuses its own worktree.
- A check that exits non-zero, times out, or is not in `checks` → the task is rejected
  (`VALIDATION_REJECTED`) with the check's name and the last 2,000 characters of its output.
- No workspace folder → rejected. A check program that cannot be started → `VALIDATOR_EXCEPTION`.
- A timed-out or cancelled check is killed.
- A task with no `check:` constraints is accepted.

## Limits and risks

- **Worktrees isolate changes, not execution.** A check such as pytest runs code the worker just
  wrote, with your user rights and environment. There is no sandbox or resource limit. Since
  [M5](M5-api.md) the API makes a person approve each diff before its checks run
  (`Scheduler(review_edits=True)`); a `"check"` task's worker has already run its own checks by
  then.
- **Edit mode was checked live once, with one model.** `--restricted` confines the file tools
  to the working folder and lets only a person approve writes to settings, Git and
  tool-configuration files, and `--permission-prompts none` denies anything that would prompt.
  The [live check](#live-check-2026-11-14-claude-code-cli-21323) below confirmed this for two
  writes; it is not proof for every path or every CLI version.
- **A `"check"` worker can also run commands the CLI counts as read-only**, inside its folder
  (seen: `cat`, `ls`, `git status`, `git diff`; see the live check below). Its own checks run
  code it wrote, with your user rights, like the validator's.
- **Files a check run creates show up in the diff.** The diff includes ignored paths, so a
  worker's test run can add files such as `__pycache__/*.pyc` to it.
- An `"edit"` task run without `WorktreeExecutor` edits `workspace_reference` in place.
- Worktrees are kept after a run, for validation and review. Nothing removes them automatically,
  by decision: `worktrees.remove_run` or `python -m agentforge clean` deletes a finished run's
  worktrees when you ask.
- `diff` stages the worktree's changes in the worktree's own index. Your checkout's index is not
  touched.
- A timeout kills only the started check process, not processes it spawned.
- Diffs are kept in memory with no size cap.
- Use one `WorktreeExecutor` per repository for all workers: it serializes `git worktree add`.

## Live check (2026-11-14, Claude Code CLI 2.1.323)

Two approved live calls in a scratch repository, with `claude-haiku-5-5`, through
`WorktreeExecutor`, `ClaudeCodeExecutor` and `CommandValidator`, confirmed:

- an `"edit"` task is offered `Edit`, `Glob`, `Grep`, `Read`, `Write` and the built-in
  `StructuredOutput`, in permission mode `acceptEdits`, and no tool that runs commands;
- `Edit` and `Write` succeed inside the worktree with no prompt;
- a `Write` to a file outside the worktree is refused, and the file is not created;
- a `Write` to the worktree's own `.git` file is refused ("Permission for this tool use was
  denied... this session has no approval surface");
- the whole path works: the edit shows up in the recorded diff, a real check passes on it, the
  task completes, and the original checkout stays clean.

The two calls cost $0.0052 together. In the first, the worker reported `success: false` because
its task included steps that were refused; the task failed as `WORKER_FAILURE` and its checks
never ran, which is the intended order.

Not confirmed live: reading a file outside the worktree, edits by other models, resuming an
edit-mode session, and a retry of an edit task.

## Live check (2026-11-15, Claude Code CLI 2.1.323): workers running their own checks

Four approved calls with `claude-haiku-5-5`, about $0.014 in total.

Three probes ran the CLI directly with `--tools ...,Bash` and one exact rule,
`--allowedTools "Bash(python check.py)"`, and asked the worker to try other commands. Marker files
showed what really ran.

- In `acceptEdits` mode the exact command ran, but so did `touch`, `echo hi > file`,
  `git status` and `whoami`, none of them allowed. That mode approves file commands on its own.
- In `dontAsk` mode, which AgentForge uses for `"check"` tasks, the exact command ran. Refused:
  the same command with an extra argument, another script, `&&` and `;` chains, `touch`,
  `echo > file`, `sort -o`, `find -exec`, `python -c`, a `git` alias that runs a program,
  `printenv` and `echo $VAR`, and `cat`, `head` and `grep` of a file outside the folder.
- Still ran without a rule, in `dontAsk` mode: commands the CLI counts as read-only, inside the
  folder: `cat` of a file there, `ls`, `pwd`, `date`, `whoami`, `git status`, `git log`,
  `git diff` and `git config --get`. They read what the worker's Read, Glob and Grep tools can
  already read. This list is what was seen, not a complete list.

One end-to-end call through `WorktreeExecutor`, `ClaudeCodeExecutor(checks=...)` and
`CommandValidator`: the worker ran its check, saw it fail, fixed the code, ran the check again
and reported success; its extra `python -c` command was refused; AgentForge's own check then
accepted the task.

## Not implemented yet

| Deferred | Waits for |
|---|---|
| Merging worktrees back | M7 (integration) |
| Checking natural-language acceptance criteria | Later; the validator runs commands only |
| A sandbox or resource limits for checks | A sandbox decision; see Limits |

## Acceptance checks

Run the pytest and Ruff commands in the root README. Git tests use disposable repositories in the
pytest temp folder. They cover:

- `test_worktrees.py`: checkout at a base commit, the `HEAD` default, bad commits, relative
  paths, the diff of modified, new and ignored files, removal of one worktree and of a whole run
  (another run's worktrees kept, a folder Git does not know kept and named, the `clean` command),
  unsafe ids, a missing repository, an
  existing worktree, two workers at once, and a full run in which a fake Claude edit shows up in
  the diff, passes a real check and leaves the original checkout clean.
- `test_validation.py`: passing, failing and unknown checks, false worker claims, which
  workspace is used, a missing workspace, and a timeout and a cancellation that kill the check.
- `test_claude_code.py`: an `"edit"` task gets the edit flags and prompt; other tasks stay
  read-only. A `"check"` task gets the shell tool, `dontAsk` and one exact rule per check, the
  commands in its prompt and only check names in the log; one that cannot be limited (no
  `"edit"`, a check with no command, a `*` in a command) never starts a process.
