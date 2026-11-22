# StatusBar

The always-visible strip at the top of the window that says, in words, whether the app can reach its local server; it has one button, Reconnect.

**Consumer provides:** the connection state and its exact text (A5), and the Reconnect handler.

- Height `statusbar-h`; text in `control` size, one line, ellipsis when too long (full text in `title`).
- Connected and Connecting are quiet: `panel` ground, icon in `done-edge` or `working-edge`.
- No token is a "needs you" moment: `needs-soft` ground, `needs-ink` text, `needs-edge` bottom border. The command is set in `code`.
- Offline, Token refused and Server error use `problem-soft`, `problem-ink`, `problem-edge`.
- The text is a `role="status"` live region, so changes are announced. Reconnect stays enabled in every state, including Connected; while its request is in flight it is disabled with `aria-busy`.
- Do not add more buttons or a settings link: there is no settings screen.
