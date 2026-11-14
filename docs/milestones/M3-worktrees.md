# M3 — Worktrees, edit-capable workers, diffs and real validation

## Delivered behavior

A worker can now change code without touching your checkout:

1. `agentforge.worktrees.WorktreeExecutor` gives each task its own Git worktree.
2. A task that allows `"edit"` lets the Claude Code worker edit files there. It still cannot run
   commands.
3. AgentForge records the diff itself, with Git, after the worker finishes.
4. `agentforge.validation.CommandValidator` runs the task's check commands in the worktree. It
   ignores what the worker claims to have checked.

No new dependency was added; Git and `asyncio` subprocesses do the work. The scheduler is unchanged.

## Contract

| Item | Behavior |
|---|---|
| `WorktreeExecutor(inner, root)` | Wraps any `WorkerExecutor`. Creates a worktree at `root/<run_id>/<task_id>/<attempt>` (the attempt folder was added in [M4](M4-orchestration.md)) from `TaskSpec.repository_reference` at `TaskSpec.base_commit` (empty means `HEAD`), runs `inner` with `workspace_reference` set to it, then sets `workspace` and `diff` on the result |
| `worktrees.create(repo, base_commit, path)` | `git worktree add --detach`; `path` must be absolute. The commit is resolved first, so an unknown commit or a value starting with `-` is rejected |
| `worktrees.diff(path)` | `git add -A`, then `git diff --cached --no-ext-diff --no-textconv HEAD`: every change since the base commit, new files included, ignored files excluded |
| `worktrees.remove(repo, path)` | `git worktree remove --force`: deletes the worktree and its uncommitted changes |
| `TaskSpec.allowed_operations` | `"edit"` gives the Claude Code worker `--tools Read,Glob,Grep,Edit,Write` and `--permission-mode acceptEdits`. Without it the worker is read-only, as in M2 |
| `WorkerResult.workspace`, `WorkerResult.diff` | Set by `WorktreeExecutor`, never by the model; both are left out of the schema the model fills in |
| `CommandValidator(checks={name: argv}, timeout=600)` | For each `check:<name>` in `TaskSpec.execution_constraints`, runs `argv` (no shell) in `result.workspace`, or in `task.workspace_reference` when that is unset |

Outcome mapping:

- Run and task ids may use only `A-Z a-z 0-9 - _`, so a worktree can never land outside `root`.
  Anything else, a missing `repository_reference`, or any Git failure raises →
  `EXECUTOR_EXCEPTION`.
- A worktree path that already exists (the same run id, task id and attempt number again) is a
  Git failure. Nothing is overwritten.
- A check that exits non-zero, times out, or is not in `checks` → the task is rejected
  (`VALIDATION_REJECTED`) with the check's name and the last 2,000 characters of its output.
- No workspace folder → rejected. A check program that cannot be started → `VALIDATOR_EXCEPTION`.
- A timed-out or cancelled check is killed.
- A task with no `check:` constraints is accepted.

## Limits and risks

- **Worktrees isolate changes, not execution.** A check such as pytest runs code the worker just
  wrote, with your user rights and environment. There is no sandbox, resource limit or approval
  step yet; approvals are planned for M5.
- **Edit mode is not live-tested.** The flags come from the Claude Code CLI 2.1.323 `--help`
  text: `--restricted` confines the file tools to the working folder and lets only a person
  approve writes to settings, Git and tool-configuration files, and `--permission-prompts none`
  denies anything that would prompt. No live call has confirmed that edits succeed, or are
  confined, under this combination.
- An `"edit"` task run without `WorktreeExecutor` edits `workspace_reference` in place.
- Worktrees are kept after a run, for validation and review. Nothing removes them automatically.
- `diff` stages the worktree's changes in the worktree's own index. Your checkout's index is not
  touched.
- A timeout kills only the started check process, not processes it spawned.
- Diffs are kept in memory with no size cap.
- Use one `WorktreeExecutor` per repository for all workers: it serializes `git worktree add`.

## Not implemented yet

| Deferred | Waits for |
|---|---|
| Workers running commands (tests, builds) themselves | A sandbox decision. Until then only the validator runs commands |
| Retrying a task whose check failed | Done in [M4](M4-orchestration.md): set `TaskSpec.max_attempts` |
| Removing worktrees automatically; merging them back | M4 (recovery) and M7 (integration) |
| Checking natural-language acceptance criteria | Later; the validator runs commands only |
| Using `AgentConfig.permissions` | Still descriptive. Edit rights are per task, in `allowed_operations` |
| A per-task timeout for the worker itself | Later runtime work; checks have one, workers do not |

## Acceptance checks

Run the pytest and Ruff commands in the root README. Git tests use disposable repositories in the
pytest temp folder. They cover:

- `test_worktrees.py`: checkout at a base commit, the `HEAD` default, bad commits, relative
  paths, the diff of modified and new files, removal, unsafe ids, a missing repository, an
  existing worktree, two workers at once, and a full run in which a fake Claude edit shows up in
  the diff, passes a real check and leaves the original checkout clean.
- `test_validation.py`: passing, failing and unknown checks, false worker claims, which
  workspace is used, a missing workspace, and a timeout and a cancellation that kill the check.
- `test_claude_code.py`: an `"edit"` task gets the edit flags and prompt; other tasks stay
  read-only.
