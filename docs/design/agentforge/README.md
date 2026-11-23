AgentForge is a local Windows desktop app for supervising AI coding agents. A person watches runs that last minutes to hours, reads agents' diffs, and approves, rejects, pauses, cancels, retries or recovers work. The interface is a calm, dense instrument panel: quiet neutrals everywhere, and colour spent only where a person needs to act.

**Who it is for.** People who do not code: they ask for something in their own words, the lead agent plans it, they approve the plan, and the team of agents builds it. People who do code can still customize, fine-tune or edit anything and feel at home. Lead every screen with the plain path in plain words ("May change files", not `allowed_operations`) and keep each technical control one click away under **More options** or a "for developers" section, never removed. On first start a welcome screen (M6 slice 7) lets each person choose whether those sections start open, and the **View** switch at the bottom of the side list changes it later. The welcome screen and its tour have no design of their own yet.

## Principles

1. **The person is in control, so "Needs you" is the loudest thing on screen.** A diff waiting for review gets the amber `needs-*` treatment: a 2px `needs-edge` border on its card, a bordered badge, and the review band open at the foot of its attempt. Nothing else in the app uses amber except the "No token" status bar, the Interrupted run marker and the live-updates notice, which also need the person.
2. **Status is always a word.** Colour and icon only repeat it. Never show a dot, colour or icon alone.
3. **Colour only where it means something.** Graphite for the interface, petrol for actions and work in progress, amber for "needs you", red for trouble. Waiting, paused, done and cancelled tasks stay neutral and are told apart by word and icon shape. Grounds are `canvas`, `panel` and `surface`; dividers are `line`. No shadows, gradients, blur or glows. Hierarchy comes from type weight, colour and borders, not size alone.
4. **Untrusted text stays plain.** Diffs, agent reports, reasons and server messages render as plain text in `code-block`, never as Markdown or HTML, and they wrap or scroll inside their box without moving the layout.
5. **Every control says what it acts on.** "Pause task build", not "Pause", in the accessible name; the visible label can be short inside the task's own card.

## Voice and copy

- Plain English, sentence case, no exclamation marks, no emoji, no em dashes. Say what happens, specifically; no marketing words ("seamless", "supercharge") and no slogans in threes.
- Buttons are verb first and name their object: "Approve diff", "Reject diff", "Pause run", "Recover run". Inside a task card the visible label may drop the object ("Pause") only if `aria-label` carries it ("Pause task build").
- Confirmations ask a question that says what happens, then two answers that are actions: "Stop task build? Its worker stops now; you can retry it." [Yes, cancel] [Keep it]. Never [OK] / [Cancel].
- Server messages are quoted, not rephrased: "Could not load run X: <server's message>", "Server refused: <detail>".
- Status words in badges are the status in sentence case: `AWAITING_APPROVAL` shows as "Awaiting approval". The raw code appears only in the History table's monospace column.
- Ids (run ids, task ids, agent ids) are set in `code` (monospace).

## Colour

The palette is AgentForge's own, defined in OKLCH and stored as hex: a faintly green-grey **graphite** (hue 200) for grounds and text, **petrol** (hue 218) for action and work, **amber** for the person, **brick red** for trouble, and a muted **green** only for the Done check and added diff lines. None of it is Tailwind's default palette, and the Tailwind setup removes those defaults so they can't creep back in.

Two themes: **Light** (default; white `canvas`, graphite `ink`) and **Dark** (graphite, not navy; no glows), set with `data-theme="dark"` on `<html>`. Dark is optional: ship it only if it follows the Windows setting; there is no toggle. Every token is defined in both. All text pairs below meet WCAG AA in both themes (4.5:1); edges, the focus ring and control borders meet 3:1 (160 pairs checked). The closest: light `needs-edge` on `needs-soft` 3.3:1, dark `line-strong` on `needs-soft` 3.5:1.

### Grounds and text

| Use | Token | Rule |
|---|---|---|
| Main page (selected run) | `canvas` | Text in `ink` or `ink-muted`. |
| Status bar, sidebar, sticky table header | `panel` | Same text tokens as `canvas`. |
| Task cards, inputs, secondary buttons | `surface` | Same. Cards carry a 1px `line` border. |
| Hover on list items and secondary buttons | `hover` | `ink` only. |
| Selected run in the sidebar | `selected` (petrol tint) + a 3px `accent` bar | `ink` only, semibold. |
| Diff and long-text boxes | `code-bg` | `diff-ctx-ink` for context lines, `ink` for reports. |
| Dividers and card borders | `line` | Decorative only. |
| Input, textarea and secondary-button borders | `line-strong` | 3:1 against `canvas`, `panel`, `surface`. |

### Actions

- **Primary** (petrol `accent` fill, `on-accent` text): Approve diff, Recover run, and the one main action of an empty or disconnected screen. At most one primary per card or header.
- **Secondary** (`surface` fill, `line-strong` border, `ink` text): Pause, Resume, Retry, Reconnect, Keep it.
- **Destructive** (`surface` fill, `danger` border and text; `danger-soft` on hover): Cancel run, Cancel, Reject diff. Destructive buttons are outlined so they never compete with the primary.
- **Destructive confirm** (`danger` fill, `on-danger` text): only the "Yes, cancel" and "Reject diff" buttons that finish a confirm or a reject form.
- **Focus** is `focus`: a 2px solid outline with a 2px offset on every control, in both themes, on every ground (3:1 or more).

### Status groups (A7)

Every task status belongs to one group. Only three groups get a colour: the ones a person should notice on a page of 20 cards.

| Group | Statuses (badge label) | Badge | Icon |
|---|---|---|---|
| Needs you | Awaiting approval | `needs-soft` fill, `needs-ink` text, 1px `needs-edge` border | person |
| Working | Assigned, Running, Validating | `working-soft` fill, `working-ink` text | arc |
| Problem | Failed, Blocked | `problem-soft` fill, `problem-ink` text | triangle |
| Waiting | Pending, Ready | outline: 1px `line`, `waiting-ink` text | clock |
| Held | Paused | outline, `held-ink` text | pause bars |
| Done | Completed | outline, `ink` text, check in `done-ink` | check |
| Stopped | Cancelled | outline, `stopped-ink` text | stop square |

Run states use the same groups: **Active** = Working, **Interrupted** = Needs you (it waits for Recover run), **Finished** = outline with a flag icon (the tasks say how it went).

Done and Problem are never told apart by colour: Done has no fill and Problem has a red one, the word is always there, and the icons (check and triangle) have different shapes.

### Failure reasons

Show the plain label, with the code in `code` after it: "A check failed · `validation_rejected`". Labels: The agent reported a failure (`worker_failure`); The agent could not run (`executor_exception`); The agent ran out of time (`worker_timeout`); The agent's answer was not valid (`invalid_result`); A check failed (`validation_rejected`); A check could not run, not retried (`validator_exception`); You rejected the diff (`review_rejected`).

### Diff lines

| Line | Starts with | Tokens |
|---|---|---|
| File header | `diff --git`, `index`, `---`, `+++` | `diff-file-soft`, `diff-file-ink`, semibold |
| Hunk header | `@@` | `diff-hunk-soft`, `diff-hunk-ink` |
| Added | `+` | `diff-add-soft`, `diff-add-ink` |
| Removed | `-` | `diff-del-soft`, `diff-del-ink` |
| Context | anything else | `code-bg`, `diff-ctx-ink` |

File headers are the lines from `diff --git` to the first `@@` of each file; inside a hunk only the first character decides, so a removed line that starts with `--` is still a removed line. The `+` and `-` stay in the text; colour only repeats them.

## Type

System fonts only (the window blocks web fonts): `sans` is Segoe UI Variable Text, `display` is Segoe UI Variable Display, `mono` is Cascadia Mono, falling back to Consolas.

- `page-title` (20/28 semibold, display): the run id in the page header. Wraps with `overflow-wrap: anywhere`.
- `section-title` (15/20 semibold): "Tasks", "History", task card titles.
- `body` (14/20): default text.
- `control` (13/16 semibold): buttons, tabs, sidebar items.
- `meta` (12/16): the card's meta line, helper text, in `ink-muted`.
- `badge` (12/16 semibold): status badges and run-state chips.
- `code` (13/20 mono): ids and commands.
- `code-block` (12/18 mono): diffs, agent reports, check output.

Use tabular numerals (`font-variant-numeric: tabular-nums`) for history numbers and attempt counts.

## Layout

```
┌ status bar · statusbar-h 36 · panel ·························· [Reconnect] ┐
├ sidebar · sidebar-w 248 · panel ┬ main · canvas · padding space-6 ─────────┤
│ [Runs] [Proposals] [Agents]     │ Page header: run id · state · run controls│
│ Runs · 132                      │ (notice: live updates stopped)           │
│ ▌run-2026-11-20-login  Active   │ Tasks · cards, gap space-4               │
│  run-2026-11-19-schema  Interr. │ History · table in a scroll box          │
│  …scrolls                       │                                           │
└─────────────────────────────────┴───────────────────────────────────────────┘
```

- The status bar is always visible; only the area under it changes.
- The sidebar has a tab row at the top for its sections. Since slice 5 it shows the **Ask for something** and **Your team** buttons, then the "Runs" and "Plans" lists (proposals are called plans on screen, agents "Your team"); whether these become tabs is for the design pass to decide. The run list scrolls on its own.
- The main page scrolls on its own. Its content stops at `content-max-w` on wide windows.
- Below 900px window width the sidebar narrows to `sidebar-w-narrow` and the page header's controls wrap under the title. At 800px everything still fits without horizontal scrolling of the page (only the diff box scrolls sideways).
- Spacing uses the 4px steps: `space-2` between buttons, `space-4` inside and between cards, `space-6` around the page and between sections.
- Radius: `radius-sm` for inline code and tiles, `radius-md` for controls and boxes, `radius-lg` for cards, `radius-full` for badges and dots only. Never one radius on everything.
- Nesting: one level of box at most inside a card (a diff or long-text box). The review band and attempts are full-width rows of the card, not boxes inside it.

## Interaction states

- **Hover**: `hover` fill for secondary and list items; `accent-hover` / `danger-hover` for filled buttons; `danger-soft` for outlined destructive buttons.
- **Focus**: the `focus` outline, always visible with the keyboard (`:focus-visible`), never removed.
- **Disabled**: `panel` fill, `line` border, `ink-muted` text, `cursor: not-allowed`. Use `disabled`, not just a style.
- **Pending (a request in flight)**: every button of that control group is disabled; the clicked one keeps its label, gains `aria-busy="true"` and a static arc icon before its label. Other cards and the header stay usable.
- **Asks first (Cancel run, Cancel task)**: the button is replaced in place by an inline confirm panel (`danger-soft`, 1px `danger` border, `radius-lg`). Focus moves to "Keep it"/"Keep running" (the safe answer). Escape answers "Keep".
- **Refused**: the server's message appears directly under the control group that was used, as a Problem alert with a Dismiss button. It stays until dismissed or the next click of that group. Announce it with `role="alert"`.
- **Long text**: ids and titles truncate with an ellipsis in the sidebar and card meta, and show in full on focus/hover (`title` plus the full text in the accessible name). Page titles and messages wrap instead.

## Iconography

Small inline SVGs, 16px, drawn on a 24-unit grid with a 2-unit round stroke in `currentColor`; no icon library. Every icon sits beside a text label and is `aria-hidden="true"`. The set is in the Icons asset group: one icon per status group, plus run-state, connection and control icons. Every icon is stroke only, at one weight: no filled shapes mixed in, and no icon on its own coloured tile. In badges the icon takes the badge's text colour (Done's check takes `done-ink`); on neutral grounds it takes the group's `*-edge`.

## Motion

None by default. Live updates replace content in place without animation. The pending arc icon is static (no spinning), so `prefers-reduced-motion` needs nothing extra.

## Accessibility checklist

- Status text, run state and the status bar text are always visible words.
- The status bar text is a `role="status"` live region; refusals are `role="alert"`.
- Every control is a native `button`, `input`, `textarea`, `select` or `summary`, reachable with Tab, with a visible `focus` outline.
- Accessible names include the object: "Approve diff for task build", "Cancel run run-2026-11-20-login".
- Attempts are `details`/`summary`; the latest attempt is `open` while it waits for review.
- The diff box and long-text boxes are focusable (`tabindex="0"`, `role="region"`, an `aria-label` such as "Diff for task build, attempt 2") so they can be scrolled with the keyboard.
- The reject reason is a labelled `textarea` with helper text tied by `aria-describedby`; "Reject diff" stays disabled until it has text.
