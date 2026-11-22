# Tailwind v4 setup

Paste this into the app's main stylesheet (`apps/desktop/src/index.css` or wherever `@import "tailwindcss"` lives). It is generated from `tokens.json`; when a token changes here, regenerate it rather than hand-editing.

- Each colour becomes a utility: `bg-surface`, `text-ink`, `border-line-strong`, `bg-needs-soft text-needs-ink border-needs-edge`, `outline-focus`.
- Spacing needs no setup: the system's steps are Tailwind's default 4px scale (`p-3` = `space-3`, `gap-2` = `space-2`).
- Tailwind's default colours are removed (`--color-*: initial`), so `bg-indigo-500` or `text-slate-600` simply don't exist. Use the AgentForge names.
- Dark mode is one attribute: set `data-theme="dark"` on `<html>` (for example from `prefers-color-scheme` or a later setting) and use plain utilities; no `dark:` variants are needed for these colours because the variables switch.
- Nothing loads from the network: the font stacks name system fonts only.

```css
@import "tailwindcss";

/* AgentForge tokens: light (default) */
:root {
  --af-canvas: #ffffff;
  --af-panel: #f4f8f8;
  --af-surface: #ffffff;
  --af-hover: #eaf0f0;
  --af-selected: #d4eff7;
  --af-code-bg: #f5f9f9;
  --af-line: #dae1e2;
  --af-line-strong: #6d7777;
  --af-ink: #151f1f;
  --af-ink-muted: #515c5c;
  --af-accent: #005e73;
  --af-accent-hover: #004b5f;
  --af-on-accent: #ffffff;
  --af-focus: #006991;
  --af-danger: #aa2a27;
  --af-danger-hover: #8d1b19;
  --af-on-danger: #ffffff;
  --af-danger-soft: #fff1ef;
  --af-needs-soft: #ffefc7;
  --af-needs-ink: #683c0b;
  --af-needs-edge: #c26f00;
  --af-working-soft: #ddf3fa;
  --af-working-ink: #00475a;
  --af-working-edge: #0a7b93;
  --af-problem-soft: #ffeae8;
  --af-problem-ink: #882424;
  --af-problem-edge: #c83a35;
  --af-done-ink: #286037;
  --af-done-edge: var(--af-done-ink);
  --af-waiting-ink: var(--af-ink-muted);
  --af-waiting-edge: var(--af-line-strong);
  --af-held-ink: var(--af-ink);
  --af-held-edge: var(--af-ink-muted);
  --af-stopped-ink: var(--af-ink-muted);
  --af-stopped-edge: var(--af-line-strong);
  --af-diff-add-soft: #e6fae9;
  --af-diff-add-ink: #194f29;
  --af-diff-del-soft: #ffefed;
  --af-diff-del-ink: #862726;
  --af-diff-hunk-soft: var(--af-working-soft);
  --af-diff-hunk-ink: var(--af-working-ink);
  --af-diff-file-soft: #e0e8e8;
  --af-diff-file-ink: var(--af-ink);
  --af-diff-ctx-ink: var(--af-ink-muted);
}

/* AgentForge tokens: dark */
[data-theme="dark"] {
  --af-canvas: #141818;
  --af-panel: #0e1212;
  --af-surface: #1d2122;
  --af-hover: #2c3232;
  --af-selected: #163b45;
  --af-code-bg: #101414;
  --af-line: #323838;
  --af-line-strong: #788283;
  --af-ink: #ebeff0;
  --af-ink-muted: #aab3b3;
  --af-accent: #71c2d8;
  --af-accent-hover: #8ed4e8;
  --af-on-accent: #0b181c;
  --af-focus: #71d4ef;
  --af-danger: #f3827a;
  --af-danger-hover: #fe9b93;
  --af-on-danger: #1e1311;
  --af-danger-soft: #381e1c;
  --af-needs-soft: #3e2909;
  --af-needs-ink: #f8db94;
  --af-needs-edge: #efac44;
  --af-working-soft: #103039;
  --af-working-ink: #b3e0ee;
  --af-working-edge: #5fb6cd;
  --af-problem-soft: #451e1c;
  --af-problem-ink: #fdc9c4;
  --af-problem-edge: #f17871;
  --af-done-ink: #91d39f;
  --af-diff-add-soft: #1b301f;
  --af-diff-add-ink: #b7e5bf;
  --af-diff-del-soft: #3e211f;
  --af-diff-del-ink: #fdc9c4;
  --af-diff-file-soft: #2d3333;
  color-scheme: dark;
}

@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

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
  --radius-lg: 8px;

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
| Primary button | `inline-flex items-center gap-2 h-8 px-3 rounded-md bg-accent text-on-accent text-control font-semibold hover:bg-accent-hover disabled:bg-panel disabled:text-ink-muted disabled:border disabled:border-line` |
| Secondary button | `inline-flex items-center gap-2 h-8 px-3 rounded-md border border-line-strong bg-surface text-ink text-control font-semibold hover:bg-hover` |
| Destructive button | `inline-flex items-center gap-2 h-8 px-3 rounded-md border border-danger bg-surface text-danger text-control font-semibold hover:bg-danger-soft` |
| Confirm "Yes, cancel" | `h-7 px-2 rounded-md bg-danger text-on-danger text-control font-semibold hover:bg-danger-hover` |
| Status badge (needs you) | `inline-flex items-center gap-1 h-[22px] pl-1.5 pr-2 rounded-full border border-needs-edge bg-needs-soft text-needs-ink text-meta font-semibold` |
| Status badge (Working, Problem) | `inline-flex items-center gap-1 h-[22px] pl-1.5 pr-2 rounded-full bg-working-soft text-working-ink text-meta font-semibold` (or `problem`) |
| Status badge (Waiting, Held, Done, Stopped) | `inline-flex items-center gap-1 h-[22px] pl-1.5 pr-2 rounded-full border border-line text-waiting-ink text-meta font-semibold` (text `held-ink` / `ink` / `stopped-ink`; Done's icon `text-done-ink`) |
| Task card | `rounded-lg border border-line bg-surface` · waiting for you: `border-2 border-needs-edge` · never a shadow |
| Review band | `-mx-4 -mb-4 mt-1 px-4 pt-3 pb-4 border-t-2 border-needs-edge bg-needs-soft text-needs-ink` (edge to edge in the attempt, no radius) |
| Diff box | `font-mono text-code-block bg-code-bg border border-line rounded-md max-h-[420px] overflow-auto` |
| Diff line | `block px-3 whitespace-pre` + `bg-diff-add-soft text-diff-add-ink` / `bg-diff-del-soft text-diff-del-ink` / `bg-diff-hunk-soft text-diff-hunk-ink` / `bg-diff-file-soft text-diff-file-ink font-semibold` / `text-diff-ctx-ink` |
| Long text | `font-mono text-code-block whitespace-pre-wrap wrap-anywhere bg-code-bg border border-line rounded-md px-3 py-2 max-h-[240px] overflow-auto` |
| Refusal alert | `flex gap-2 items-start px-3 py-2 rounded-md border border-problem-edge bg-problem-soft text-problem-ink text-[13px]` |
| Sidebar item | `flex items-center gap-2 w-full min-h-9 px-2 py-1.5 rounded-md text-left text-[13px] hover:bg-hover aria-[current=true]:bg-selected aria-[current=true]:font-semibold` |
