# Known limitations

Each entry says what happens, why, and what would remove it. Most come from host facts a plugin cannot change. Entries with an issue link are tracked there.

## Pending list across windows

Plugin storage in Hermes Desktop is the app's `localStorage`, and it sends no change notifications. Before every change the plugin re-reads the session's list; if another window changed it, the plugin rebuilds from storage and applies only this command (add, remove, edit a comment…), so one window never overwrites the whole list of another. Other windows refresh on the browser `storage` event and when they get focus.

- **Remaining:** two windows writing the same list at the very same instant can still lose one write: `localStorage` has no compare-and-set. [#6](https://github.com/waiclay-349687/hermes-diple/issues/6)
- Send state (queue, in-flight batches) is kept per window and is not merged across windows.

## `@diple:` references and sessions

The host does not pass the session to a context-reference provider, but the desktop gateway sets the turn's session in task-local context before expanding references, and the provider reads that.

- A batch that was already delivered can only be expanded again in the session that registered it; elsewhere the provider answers "belongs to another session" without content. The first expansion is not checked: it is the send itself, and only the sender knows the batch id before it.
- Without session context (for example from the CLI) the check is skipped.
- If the host gives the same conversation a new session id (for example after context compression), re-expanding an old reference is refused as "another session". Normal sending is not affected. [#7](https://github.com/waiclay-349687/hermes-diple/issues/7)

## Delivery confirmation

After a batch is expanded, the list is cleared and a pending-confirmation record is kept until a persisted turn whose user row carries `@diple:<batch id>` settles it. While the history cannot be read, the record stays, the receipt line says it is still confirming, and the check is retried with backoff (5 s up to 5 min). After 5 minutes without an answer the user chooses: put back, or count as delivered.

- **Remaining:** after "count as delivered", a batch that did not in fact reach the history is not put back automatically.

## Origins of annotations taken while a session is busy

An annotation is tied only to a row that can only be its message. When it is taken while the session is busy (or its busy state is unknown), it waits for the first turn of that session that completes after the capture, and is verified against that turn's rows only — never a later turn's.

- **Remaining:** if the session's runtime id is unknown at capture time and cannot be looked up later, the annotation stays "unverified" (never bound to a wrong message) and is not re-verified by later turns. [#8](https://github.com/waiclay-349687/hermes-diple/issues/8)

## Busy state of background sessions

The host keys its busy state by runtime id; the plugin maps stored and runtime ids from the focused pair and from the gateway's active-session list. When neither knows, the session is treated as busy: the send is queued and re-checked every 4 seconds. Context-size checks are only possible for the focused session (the host still refuses anything over 50% of the context).

## Response markers in code

Markers inside code are not counted. The scanner follows CommonMark block structure (block quotes, list items and their content columns, fences and indented code ending with their container; lazy continuation lines). It does not cover HTML blocks, link reference definitions, setext headings or tabs wider than 4 columns.

## Display version

An `@` copied into the display version (passage openings, comments, titles) gets an invisible WORD JOINER after it, so the host never expands it. It looks the same, but searching the bubble text for `@file` will not find it (`file:` will).

## Hand-offs from a companion plugin

The plugin can receive annotations from a companion plugin through plugin events (ADR 0007).

- If a window closes before posting the final result of a hand-off, the result is later derived by the backend from the batch state.
- A window that takes over an abandoned hand-off does not finish the "send after reply" queue of the window that died; it only answers that the batch was queued.
- A queue cancelled before its batch was registered settles every hand-off in it as cancelled, including one that had been removed — the conclusion is still "not sent", never a false "sent".

## Host features not available to plugins

- **No right-click entry:** Hermes Desktop has no context-menu extension point for plugins. [#4](https://github.com/waiclay-349687/hermes-diple/issues/4)
- **No "new session" send target:** the companion plugin's send menu offers the current session, recent sessions and the chat's pending list, but not a new session. The SDK's `newChat()` only opens a draft and returns no stored session id, so a hand-off has nowhere to go. Start the conversation in Hermes first; it then shows among the recent sessions. [#5](https://github.com/waiclay-349687/hermes-diple/issues/5)
