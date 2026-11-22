# EmptyState

What fills the main area when there is nothing to show: the disconnected screen (how to start the server) and the "No runs yet" page.

**Consumer provides:** which case applies, and for the disconnected case the Reconnect handler.

- Left-aligned in the main area with `space-8` padding, at most 560px wide; title in 18/24 semibold display, text in `body` `ink-muted`.
- **Disconnected** (any status bar state except Connected): "AgentForge can't reach its server", three numbered steps with the command in a copyable `code` row, and **Reconnect** as the one primary button. The sidebar is hidden while disconnected; the status bar still shows the exact state.
- **No token** uses the same screen; the status bar already says which case it is.
- **No runs yet** (connected): "No runs yet" and the sentence from the brief, plus how to start one today.
- No illustrations or emoji.
