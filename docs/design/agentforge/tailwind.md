# Tailwind v4 setup

Paste this into the app's main stylesheet (`apps/desktop/src/index.css` or wherever `@import "tailwindcss"` lives). It is generated from `tokens.json`; when a token changes here, regenerate it rather than hand-editing.

- Each colour becomes a utility: `bg-surface`, `text-ink`, `border-line-strong`, `bg-needs-soft text-needs-ink border-needs-edge`, `outline-focus`.
- Spacing needs no setup: the system's steps are Tailwind's default 4px scale (`p-3` = `space-3`, `gap-2` = `space-2`).
- Tailwind's default colours are removed (`--color-*: initial`), so `bg-indigo-500` or `text-slate-600` simply don't exist. Use the AgentForge names.
- **Dark is the default.** Light applies with `data-theme="light"` on `<html>`; the app sets it from the Theme choice in the ViewFooter (dark until the person picks light).
- Use plain utilities: the variables switch with the theme, so no `dark:` or `light:` variants are needed for these colours.
- Nothing loads from the network: the font stacks name system fonts only.

```css
@import "tailwindcss";

/* AgentForge tokens: dark (the default look) */
:root {
  --af-canvas: #100e0c;
  --af-panel: #0b0907;
  --af-surface: #1a1614;
  --af-hover: #282421;
  --af-selected: #3f2116;
  --af-code-bg: #0d0b09;
  --af-line: #2f2a28;
  --af-line-strong: #7c746f;
  --af-ink: #ede9e4;
  --af-ink-muted: #a8a29b;
  --af-accent: #eb7a52;
  --af-accent-hover: #f69370;
  --af-on-accent: #1d0d07;
  --af-focus: #f9c59c;
  --af-danger: #f36e88;
  --af-danger-hover: #fd8a9e;
  --af-on-danger: #1d0c0f;
  --af-danger-soft: #36161c;
  --af-needs-soft: #322405;
  --af-needs-ink: #fade88;
  --af-needs-edge: #f0bb3b;
  --af-working-soft: #351b12;
  --af-working-ink: #faccb6;
  --af-working-edge: #eb7a52;
  --af-problem-soft: #36161c;
  --af-problem-ink: #fdc0c8;
  --af-problem-edge: #ec5a76;
  --af-done-ink: #7cd591;
  --af-done-edge: var(--af-done-ink);
  --af-waiting-ink: var(--af-ink-muted);
  --af-waiting-edge: var(--af-line-strong);
  --af-held-ink: var(--af-ink);
  --af-held-edge: var(--af-ink-muted);
  --af-stopped-ink: var(--af-ink-muted);
  --af-stopped-edge: var(--af-line-strong);
  --af-diff-add-soft: #102515;
  --af-diff-add-ink: #a7e2b2;
  --af-diff-del-soft: #31151a;
  --af-diff-del-ink: #fbbfc6;
  --af-diff-hunk-soft: var(--af-working-soft);
  --af-diff-hunk-ink: var(--af-working-ink);
  --af-diff-file-soft: #2a2523;
  --af-diff-file-ink: var(--af-ink);
  --af-diff-ctx-ink: var(--af-ink-muted);
  color-scheme: dark;
}

/* AgentForge tokens: light, kept for a later setting.
   To follow Windows instead, wrap this block's selector in @media (prefers-color-scheme: light) { :root { ... } }. */
[data-theme="light"] {
  --af-canvas: #ffffff;
  --af-panel: #f8f4f2;
  --af-surface: #ffffff;
  --af-hover: #f1ece8;
  --af-selected: #ffe3d7;
  --af-code-bg: #f9f6f4;
  --af-line: #e4dedb;
  --af-line-strong: #7a736e;
  --af-ink: #201a16;
  --af-ink-muted: #615953;
  --af-accent: #b64925;
  --af-accent-hover: #9e3a19;
  --af-on-accent: #ffffff;
  --af-focus: #953920;
  --af-danger: #b6143f;
  --af-danger-hover: #9c0232;
  --af-on-danger: #ffffff;
  --af-danger-soft: #ffeeef;
  --af-needs-soft: #fef0c3;
  --af-needs-ink: #6b4300;
  --af-needs-edge: #bb7200;
  --af-working-soft: #ffe9de;
  --af-working-ink: #7d3317;
  --af-working-edge: #c25430;
  --af-problem-soft: #ffe7e8;
  --af-problem-ink: #931f37;
  --af-problem-edge: #cb304f;
  --af-done-ink: #236436;
  --af-diff-add-soft: #e6fae9;
  --af-diff-add-ink: #194f29;
  --af-diff-del-soft: #ffeeef;
  --af-diff-del-ink: #8f2639;
  --af-diff-file-soft: #ebe5e1;
  color-scheme: light;
}

@custom-variant light (&:where([data-theme="light"], [data-theme="light"] *));

@theme inline {
  /* drop Tailwind's default palette (slate, indigo, emerald…): only AgentForge colours exist */
  --color-*: initial;
  --color-transparent: transparent;
  --color-current: currentColor;
  --color-canvas: var(--af-canvas);
  --color-panel: var(--af-panel);
  --color-surface: var(--af-surface);
  --color-hover: var(--af-hover);
  --color-selected: var(--af-selected);
  --color-code-bg: var(--af-code-bg);
  --color-line: var(--af-line);
  --color-line-strong: var(--af-line-strong);
  --color-ink: var(--af-ink);
  --color-ink-muted: var(--af-ink-muted);
  --color-accent: var(--af-accent);
  --color-accent-hover: var(--af-accent-hover);
  --color-on-accent: var(--af-on-accent);
  --color-focus: var(--af-focus);
  --color-danger: var(--af-danger);
  --color-danger-hover: var(--af-danger-hover);
  --color-on-danger: var(--af-on-danger);
  --color-danger-soft: var(--af-danger-soft);
  --color-needs-soft: var(--af-needs-soft);
  --color-needs-ink: var(--af-needs-ink);
  --color-needs-edge: var(--af-needs-edge);
  --color-working-soft: var(--af-working-soft);
  --color-working-ink: var(--af-working-ink);
  --color-working-edge: var(--af-working-edge);
  --color-problem-soft: var(--af-problem-soft);
  --color-problem-ink: var(--af-problem-ink);
  --color-problem-edge: var(--af-problem-edge);
  --color-done-ink: var(--af-done-ink);
  --color-done-edge: var(--af-done-edge);
  --color-waiting-ink: var(--af-waiting-ink);
  --color-waiting-edge: var(--af-waiting-edge);
  --color-held-ink: var(--af-held-ink);
  --color-held-edge: var(--af-held-edge);
  --color-stopped-ink: var(--af-stopped-ink);
  --color-stopped-edge: var(--af-stopped-edge);
  --color-diff-add-soft: var(--af-diff-add-soft);
  --color-diff-add-ink: var(--af-diff-add-ink);
  --color-diff-del-soft: var(--af-diff-del-soft);
  --color-diff-del-ink: var(--af-diff-del-ink);
  --color-diff-hunk-soft: var(--af-diff-hunk-soft);
  --color-diff-hunk-ink: var(--af-diff-hunk-ink);
  --color-diff-file-soft: var(--af-diff-file-soft);
  --color-diff-file-ink: var(--af-diff-file-ink);
  --color-diff-ctx-ink: var(--af-diff-ctx-ink);

  --font-sans: "Segoe UI Variable Text", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
  --font-display: "Segoe UI Variable Display", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
  --font-mono: "Cascadia Mono", Consolas, ui-monospace, monospace;

  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 10px;
  --radius-pill: 9999px;

  --text-page-title: 20px;
  --text-page-title--line-height: 28px;
  --text-section: 15px;
  --text-section--line-height: 20px;
  --text-body: 14px;
  --text-body--line-height: 20px;
  --text-control: 13px;
  --text-control--line-height: 16px;
  --text-meta: 12px;
  --text-meta--line-height: 16px;
  --text-welcome: 28px;
  --text-welcome--line-height: 36px;
  --container-form: 720px;
  --container-content: 1120px;
  --container-tour: 340px;
  --container-drawer: 480px;
  --text-label: 11px;
  --text-label--line-height: 16px;
  --text-label--letter-spacing: 0.08em;
  --text-label--font-weight: 500;
  --text-code-block: 12px;
  --text-code-block--line-height: 18px;
}

@layer base {
  html { background: var(--color-canvas); color: var(--color-ink); font-family: var(--font-sans); font-size: 14px; line-height: 20px; }
  :where(button, a, input, textarea, select, summary, [tabindex]):focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation: none !important; transition: none !important; }
  }
}
```

## Class recipes

| Element | Classes |
|---|---|
| Primary button | `inline-flex items-center gap-2 h-8 px-3.5 rounded-full bg-accent text-on-accent text-control font-semibold hover:bg-accent-hover disabled:bg-panel disabled:text-ink-muted disabled:border disabled:border-line` |
| Secondary button | `inline-flex items-center gap-2 h-8 px-3.5 rounded-full border border-line-strong bg-surface text-ink text-control font-semibold hover:bg-hover` |
| Destructive button | `inline-flex items-center gap-2 h-8 px-3.5 rounded-full border border-danger bg-surface text-danger text-control font-semibold hover:bg-danger-soft` |
| Confirm "Yes, cancel" | `h-7 px-3 rounded-full bg-danger text-on-danger text-control font-semibold hover:bg-danger-hover` |
| Status badge (needs you) | `inline-flex items-center gap-1 h-[22px] pl-1.5 pr-2 rounded-full border border-needs-edge bg-needs-soft text-needs-ink text-meta font-semibold` |
| Status badge (Working, Problem) | `inline-flex items-center gap-1 h-[22px] pl-1.5 pr-2 rounded-full bg-working-soft text-working-ink text-meta font-semibold` (or `problem`) |
| Status badge (Waiting, Held, Done, Stopped) | `inline-flex items-center gap-1 h-[22px] pl-1.5 pr-2 rounded-full border border-line text-waiting-ink text-meta font-semibold` (text `held-ink` / `ink` / `stopped-ink`; Done's icon `text-done-ink`) |
| Task card | `rounded-lg border border-line bg-surface` · waiting for you: `border-2 border-needs-edge` · never a shadow |
| Review band | `-mx-4 -mb-4 mt-1 px-4 pt-3 pb-4 border-t-2 border-needs-edge bg-needs-soft text-needs-ink` (edge to edge in the attempt, no radius) |
| Diff box | `font-mono text-code-block bg-code-bg border border-line rounded-md max-h-[420px] overflow-auto` |
| Diff line | `block px-3 whitespace-pre` + `bg-diff-add-soft text-diff-add-ink` / `bg-diff-del-soft text-diff-del-ink` / `bg-diff-hunk-soft text-diff-hunk-ink` / `bg-diff-file-soft text-diff-file-ink font-semibold` / `text-diff-ctx-ink` |
| Long text | `font-mono text-code-block whitespace-pre-wrap wrap-anywhere bg-code-bg border border-line rounded-md px-3 py-2 max-h-[240px] overflow-auto` |
| Refusal alert | `flex gap-2 items-start px-3 py-2 rounded-md border border-problem-edge bg-problem-soft text-problem-ink text-[13px]` |
| More options summary | `flex items-center gap-2 min-h-8 -ml-2 px-2 rounded-md cursor-pointer text-[13px] hover:bg-hover` · label `font-semibold text-ink` · hint `truncate text-meta text-ink-muted` · body `flex flex-col gap-3 pl-6 pb-4` (no left border) |
| For developers | `rounded-lg border border-line bg-canvas` · tag `font-mono text-[11px] text-ink-muted border border-line rounded-full px-1.5` · editor `font-mono text-code-block bg-code-bg min-h-[360px] whitespace-pre` |
| Form column | `max-w-form flex flex-col gap-4` |
| Tour card | `w-tour rounded-lg border border-line-strong bg-surface p-4` · `backdrop:bg-transparent` |
| Tour target | `relative after:absolute after:inset-0 after:rounded-[inherit] after:border-2 after:border-dashed after:border-accent after:pointer-events-none` (never an outline: the focus ring keeps working) |
| Mono label | `font-mono text-label uppercase text-ink-muted` (counters and title-strip status only; never an eyebrow above a heading) |
| Card title strip | `flex items-center gap-2 px-4 py-2 bg-code-bg border-b border-line rounded-t-lg` |
| Board ground | `relative min-h-full p-6 pb-22 bg-canvas bg-[radial-gradient(var(--color-line)_1px,transparent_1.2px)] bg-size-[20px_20px]` (board only) |
| Role group | `rounded-lg border border-line bg-panel px-2 pb-2` · waits for you `border-needs-edge` · running `border-[color-mix(in_oklch,var(--color-working-edge)_60%,var(--color-line))]` |
| Agent tile | `flex flex-col rounded-md border border-line bg-surface` · strip `flex items-center gap-2 px-3 py-1.5 bg-code-bg border-b border-line` · output `h-[152px] overflow-auto bg-code-bg px-3 py-2 font-mono text-[11.5px]/[17px] whitespace-pre-wrap wrap-anywhere` |
| Board lines | an `<svg class="absolute inset-0 pointer-events-none" aria-hidden="true">` of `path`s with `fill-none stroke-line-strong stroke-[1.5]` (or `stroke-working-edge`, `stroke-needs-edge`) |
| Task drawer | `<dialog>` with `absolute inset-y-0 right-0 left-auto w-[min(480px,100%)] m-0 bg-canvas border-l border-line-strong overflow-auto backdrop:bg-transparent` |
| Sidebar item | `flex items-center gap-2 w-full min-h-9 px-2 py-1.5 rounded-md text-left text-[13px] hover:bg-hover aria-[current=true]:bg-selected aria-[current=true]:font-semibold` |
