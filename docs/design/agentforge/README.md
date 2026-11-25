AgentForge is a local-first Windows app where one lead agent coordinates specialized coding agents. It ships with seven, and any of them can be added, removed or fully customized. A person watches runs that last minutes to hours on a board of agent tiles, reads agents' diffs, and approves, rejects, pauses, cancels, retries or recovers work. The interface is a calm, dense board: warm dark neutrals everywhere, and colour spent only where a person needs to act.

**Who it is for.** People who do not code: they ask for something in their own words, the lead agent plans it, they approve the plan, and the team of agents builds it. People who do code can still customize, fine-tune or edit anything and feel at home. Lead every screen with the plain path in plain words ("May change files", not `allowed_operations`) and keep each technical control one click away under **More options** or a "for developers" section, never removed. A first-start survey and guide (M6 slice 7) lets each person choose whether those sections start open.

## Principles

1. **The person is in control, so "Needs you" is the loudest thing on screen.** A diff waiting for review gets the yellow `needs-*` treatment: a 2px `needs-edge` border on its card, a bordered badge, and the review band open at the foot of its attempt. Nothing else in the app uses yellow except the "No token" status bar, the Interrupted run marker and the live-updates notice, which also need the person.
2. **Status is always a word.** Colour and icon only repeat it. Never show a dot, colour or icon alone.
3. **Colour only where it means something.** Warm charcoal for the interface, coral for actions and work in progress, yellow for "needs you", rose for trouble. Waiting, paused, done and cancelled tasks stay neutral and are told apart by word and icon shape. Grounds are `canvas`, `panel` and `surface`; dividers are `line`. No shadows, gradients, blur or glows. Hierarchy comes from type weight, colour and borders, not size alone.
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

The palette is AgentForge's own, defined in OKLCH and stored as hex: a warm **charcoal** (hue 55) for grounds and text, **coral** (hue 40) for action and work, **yellow** (hue 85) for the person, **rose** (hue 10 to 15) for trouble, and a muted **green** only for the Done check and added diff lines. Coral and rose sit close in hue, so they are never the only difference: trouble always carries its word and the triangle icon, and destructive buttons are outlined while coral buttons are filled. None of it is Tailwind's default palette, and the Tailwind setup removes those defaults so they can't creep back in.

The look is a board of tiles: a warm near-black `canvas`, a darker `panel` for the side list and status bar, cards one step lighter (`surface`) with a darker title strip (`code-bg`), thin `line` borders, pill buttons, and small uppercase mono counters. No glows, gradients, blur or shadows.

Two themes: **Dark** (the default) and **Light** (warm off-white, the same roles), set with `data-theme="light"` on `<html>`; the app starts dark, and the Theme choice under the side list (ViewFooter) switches it to light. Every token is defined in both. All text pairs below meet WCAG AA in both themes (4.5:1); edges, the focus ring and control borders meet 3:1 (164 pairs checked). The closest: light `accent` on `panel` 4.8:1, dark `line-strong` on `needs-soft` 3.3:1, light `needs-edge` on `needs-soft` 3.35:1.

### Grounds and text

| Use | Token | Rule |
|---|---|---|
| Main page (selected run) | `canvas` | Text in `ink` or `ink-muted`. |
| Status bar, sidebar, sticky table header | `panel` | Same text tokens as `canvas`. |
| Task cards, inputs, secondary buttons | `surface` | Same. Cards carry a 1px `line` border. |
| Hover on list items and secondary buttons | `hover` | `ink` only. |
| Selected run in the sidebar | `selected` (coral tint) + a 3px `accent` bar | `ink` only, semibold. |
| Diff and long-text boxes | `code-bg` | `diff-ctx-ink` for context lines, `ink` for reports. |
| Dividers and card borders | `line` | Decorative only. |
| Input, textarea and secondary-button borders | `line-strong` | 3:1 against `canvas`, `panel`, `surface`. |

### Actions

- **Primary** (coral `accent` fill, `on-accent` text, pill-shaped like every button): Approve diff, Recover run, and the one main action of an empty or disconnected screen. At most one primary per card or header.
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

- `welcome-title` (28/36 semibold, display): "Welcome to AgentForge" only. Added in the second pass: the welcome screen has no side list or status bar, and 20px is lost in an empty 1000×700 window.
- `page-title` (20/28 semibold, display): the run id in the page header; "Ask for something", "Plan `<id>`" and "Your team". Wraps with `overflow-wrap: anywhere`.
- `section-title` (15/20 semibold): "Tasks", "History", task card titles.
- `body` (14/20): default text.
- `control` (13/16 semibold): buttons, tabs, sidebar items.
- `meta` (12/16): the card's meta line, helper text, in `ink-muted`.
- `badge`: status badges and run-state chips are now set as small mono chips (11px, uppercase, `0.06em` tracking), like a terminal tag. The word is unchanged.
- `label-mono` (11/16 mono, uppercase, `0.08em` tracking): counters and labels on technical surfaces only: "RUNS · 132", "TASKS 4 · 1 WAITS FOR YOU", table headers, "STEP 5 OF 6". Never an eyebrow above a heading, never a sentence.
- `code` (13/20 mono): ids and commands.
- `code-block` (12/18 mono): diffs, agent reports, check output.

Use tabular numerals (`font-variant-numeric: tabular-nums`) for history numbers and attempt counts.

## Layout

```
┌ status bar · statusbar-h 36 · panel ·························· [Reconnect] ┐
├ sidebar · sidebar-w 248 · panel ┬ main · canvas · padding space-6 ─────────┤
│ [ Ask for something ]           │ Page header: run id · state · run controls│
│  Your team                      │ (notice: live updates stopped)           │
│ [Runs] [Plans 1]                │ Tasks · cards, gap space-4               │
│ ▌run-2026-11-20-login  Active   │ History · table in a scroll box          │
│  …scrolls                       │                                           │
│ View ◉ Plain ○ Technical        │                                           │
│ Show the guide again            │                                           │
└─────────────────────────────────┴───────────────────────────────────────────┘
```

- The status bar is always visible; only the area under it changes.
- The sidebar, top to bottom: **Ask for something** (its one filled button) and **Your team** (a side item); a tab row, **Runs** and **Plans** (proposals are called plans on screen), with the count of plans waiting for your OK on the Plans tab; the chosen list, which scrolls on its own; and the ViewFooter (View: Plain or Technical, and "Show the guide again"), pinned to the bottom. Decided in the second pass: Ask for something and Your team stay above the tabs because they are places, not lists.
- The main page scrolls on its own. Its content stops at `content-max-w` on wide windows.
- Below 900px window width the sidebar narrows to `sidebar-w-narrow` and the page header's controls wrap under the title. At 800px everything still fits without horizontal scrolling of the page (only the diff box scrolls sideways).
- Spacing uses the 4px steps: `space-2` between buttons, `space-4` inside and between cards, `space-6` around the page and between sections.
- Radius: `radius-sm` for inline code and tiles, `radius-md` for inputs and boxes, `radius-lg` (10px) for cards and the tour card, `radius-full` for buttons, badges, counts and dots. Never one radius on everything.
- Forms and prose (Ask for something, Your team's lede, the plan's decision text) stop at `form-max-w` (720px), so lines stay readable; task cards, the rights table and the team grid use the full content width.
- Nesting: one level of box at most inside a card (a diff or long-text box). The review band and attempts are full-width rows of the card, not boxes inside it.

## Plain and Technical views

People who don't code come first; people who do keep every control. Every screen leads with the plain path in plain words, and technical controls sit one click away, never removed:

- **MoreOptions** holds technical fields inside a form (run name, revisions, attempts, time limits, model, reasoning). The person's **View** decides how it starts: Plain starts folded, Technical starts open. A hand toggle lasts until the screen is left and never changes the View. A field error inside it opens it.
- **ForDevelopers** holds work only developers do (writing a plan as JSON). It starts folded in both views, because a large editor open by default would push the plain path's result off screen.
- "What the lead agent fixed along the way" also starts folded in both views: it is history, not a setting.
- The View is chosen on the Welcome screen and changed in the ViewFooter. Nothing else depends on it: switching views only opens or folds MoreOptions, so every control stays where it was.
- Ids (run, plan, task, agent) stay visible in `mono` in both views.

## Screens

| Screen | Components | Guide |
|---|---|---|
| Run page, Board view (default) | PageHeader, BoardGroup, AgentTile, BoardBar, TaskDrawer (which holds the List view's TaskCard) | BoardScreen, BoardReviewScreen |
| Run page, List view | PageHeader, TaskCard, Attempt, DiffView, LongText, ReviewBox, InlineConfirm, Feedback, HistoryTable, BoardBar | RunScreen |
| Ask for something | AskForm, MoreOptions, ForDevelopers | AskScreen |
| A plan's page | PlanPage, TaskRights, AgentEditor (for proposed agents), MoreOptions | PlanScreen, ApproveScreen |
| Your team | AgentCard, AgentEditor, MoreOptions | TeamScreen |
| Welcome (first start, and "Show the guide again") | Welcome | WelcomeScreen |
| The tour | TourCard, ViewFooter | TourScreen |
| Not connected | EmptyState | EmptyState |

Rules the second pass adds:

- **One primary per section.** Ask for something: Plan it. A plan: Approve and start. Your team: Add an agent (the open editor's Save is its own section's primary). Welcome: Take the tour. Tour card: Next or Finish.
- **Billed actions ask first, in place,** with the plain confirm (`panel`, `line-strong`), not the red one: billing is not destruction. Destructive actions keep the red confirm (Remove agent) or a required reason (Reject plan, Reject diff).
- **Long waits are watched, not animated:** a Working panel with the static arc, the time since it started, and every field locked.
- **Nothing granted by default.** The rights table starts empty, counts what will be granted, and warns in yellow when no task may change files.
- **The tour's highlight is a dashed `accent` line drawn inside its target, never an outline,** so it can't hide or be mistaken for the solid `focus` ring.

## The run board

A run opens as a board: the lead agent on top, one group per role below it, and in each group that role's agent as a tile with its live output. It is AgentForge's own take on a board of agent consoles, kept to what a person supervising a plan needs:

- **It fits the main area and scrolls.** No pan, zoom or dragging: the layout comes from the plan, so it is the same for everyone and works with the keyboard.
- **Structure:** the lead agent's node (the plan, a one-line summary, the agents not in this run), lines to each role group, and in each group the agent's tile, then the role's other tasks as rows. Groups with something waiting for you come first.
- **The tile is the AI view:** the agent, its task, its status and its live output, plain text in `mono`, pinned to the newest line until the person scrolls up. Its buttons are the task's own (Pause, Cancel, Review diff, Retry, Resume).
- **Reviewing stays the same:** Review diff opens the task in a drawer on the right, with exactly the List view's card, attempts, diff and review band.
- **The run controls stay in the page header** in both views. A pill at the bottom switches Board and List and counts the tasks in words.
- **Colour on the board** follows the same rule: the lines, group borders and tile strips take their state (coral working, yellow waits for you, rose trouble); everything else is charcoal. The faint dot grid belongs to the board only, never to forms or lists, and never fades.
- **Live output needs one server addition.** The server already reads each task's Claude Code event stream (`ClaudeCodeRunner.on_event`, keyed by task id) but does not pass it on. Forward it over the run's existing event stream as an `output` event, one per line, as plain text with ANSI codes stripped: `{task, attempt, kind: "tool" | "result" | "text" | "error", text}`. Keep the last 200 lines per task in memory (not in the store) so a reopened board can fill its tiles, and never log them. Until then, each tile shows the last attempt's report.

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
