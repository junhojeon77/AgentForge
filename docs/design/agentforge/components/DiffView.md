# DiffView

A monospace, read-only view of a unified Git diff in a fixed-height box that scrolls both ways; colour only repeats the `+`, `-` and `@@` already in the text.

**Consumer provides:** the diff text (plain, untrusted), an accessible label ("Diff for task build, attempt 2"), and optional file and line counts for the bar above it.

- Box: `code-bg`, 1px `line` border, `radius-md`, `max-height: diff-max-h`, `overflow: auto`. It is focusable (`tabindex="0"`, `role="region"`) so the keyboard can scroll it.
- Lines in `code-block` (12/18 mono), `white-space: pre`, never wrapped. An inner `inline-block` with `min-width: 100%` makes line backgrounds extend across the whole scroll width.
- Tones come from `diffLines(diff)`, which tracks where it is: from a `diff --git` line until the next `@@`, every line is a file header; inside a hunk, `+`, `-` and `@@` decide. A per-line prefix test is not enough: a removed `-- comment` line reads `--- comment` and must still be a removed line. Tones: file header `diff-file-soft`/`diff-file-ink` semibold; hunk `diff-hunk-soft`/`diff-hunk-ink`; added `diff-add-soft`/`diff-add-ink`; removed `diff-del-soft`/`diff-del-ink`; context `diff-ctx-ink`.
- Bar above: changed files and +/− counts in `meta`, and a ghost "Copy diff" button (A13).
- Empty diff: "No changes." with a short reason, in `body` sans, inside the same box.
- Very large diffs (10,000 lines): render as plain text lines; no syntax highlighting, no side-by-side. Measure before adding anything; only if rendering is slow, propose showing the first 2,000 lines with a "Show all 10,412 lines" button.
- Never render as HTML or Markdown; escape everything.
