# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

Planned work is in [ROADMAP.md](ROADMAP.md).

## [0.1.0] - 2026-10-27

First public version.

### Added

**Annotating**

- Annotate a selection in a chat message: an **Annotate** button appears as soon as you release the mouse (fading in; after a short pause for keyboard selections), or press <kbd>⌘⇧E</kbd> (the host already uses <kbd>⌘⇧L</kbd>). The button only shows in message text — not in the composer, tool output or thinking — and hides on any mouse press, so it never overlaps the right-click menu. It can be switched off in the settings. The selection is captured as Markdown (code blocks, lists, emphasis, links) and split per message.
- One action for highlighting and commenting: an annotation with a comment is a *comment* the AI must answer; without one it is a *highlight*, background only (ADR 0001, terms in ADR 0008).
- Comment in place: a small editor opens beside the passage, with the passage rendered as Markdown on top and the comment box below. Its foot has an icon button to replace the passage with the current selection, then **Save** and **Save and send**; it wraps instead of overflowing in long languages. <kbd>Enter</kbd> saves (an empty comment saves a highlight), <kbd>Shift</kbd>+<kbd>Enter</kbd> adds a line, <kbd>⌘Enter</kbd> saves and sends, <kbd>Esc</kbd> discards a new annotation or undoes the current edit; an <kbd>Enter</kbd> that confirms an input-method candidate never saves. Clicking outside discards an empty new annotation, keeps a written draft (the editor shakes gently) and saves an edit to an existing one. Annotating the same passage again opens the existing annotation.
- Marks on the original passage through the CSS Custom Highlight API: a highlight is shaded, a comment is shaded and underlined, and each annotation gets a numbered pin on the top-right corner of its passage; neighbouring pins step aside. Pins follow scrolling and layout changes without drifting. A quiet mode shows pins only.
- A pin card on hover: the passage and comment (Markdown rendered) and three buttons — **Edit**, **Copy**, **Delete** on a comment; **Add comment**, **Copy**, **Delete** on a highlight; only **Copy** once sent. **Copy** copies a highlight's text, and a comment as a Markdown quote followed by the comment (the same format as **Copy as Markdown**).
- A strip above the composer, per session: a summary ("4 annotations · 3 comments"), numbered chips in send order (more than six fold into "+N"), **This session**, **Clear all**, **Preview** and **Send N ▾**. Hovering a chip previews it and deepens its passage; clicking one scrolls to the passage only if it is off screen, keeps it deepened (no flash) and opens the editor, with a "Back to the input" link for 5 seconds. Removing a chip or clearing all can be undone. Only saved annotations appear. The list survives reloads and merges changes from other windows command by command.
- **This session's annotations**: every annotation of the session grouped as pending, sent, answered and missed, with a state filter, jump-to-passage and **Copy as Markdown**.
- Locating an origin that is not on screen loads earlier messages first, or opens the other session in a new tab; a deleted or regenerated message is reported once as "Original changed".

**Sending**

- Write your message and press Enter as usual: the annotations go with it. Or press **Send N** (or <kbd>⌘⇧↩</kbd>) to send only the annotations. Its ▾ menu has **Send now** and **Copy for AI** (Markdown, nothing sent); the target is always the current session.
- The chat bubble shows a short display version ending in an `@diple:<batch id>` context reference, which the Python backend expands into the full version for the AI (ADR 0006). Sent batches are stored in the plugin's own SQLite database (ADR 0005). With four or more comments, the response rules ask the AI to work through them grouped by message.
- A size estimate against the host's context limits, a preview of what the AI will receive, and a receipt line under the sent message with "View what the AI received".
- Delivery is confirmed from the persisted turn; on an error, interruption or refusal the annotations go back to the pending list, and when delivery cannot be determined after 5 minutes the user decides.
- "Send after reply" queues a batch while the AI is answering; a steer never carries annotations. Sending from another session's annotations asks for confirmation, naming that session.
- After sending, marks stay faded on the original (dashed underline, hollow pin); an answered comment gets a ✓ on its pin, a missed one a warning dot. This can be switched off.

**Answers**

- Response markers `::ann{b="…" n="…"}` written by the AI and rendered as "↩ Comment n" chips that jump back to the passage; everything else (numbering, checking, linking) is done by code (ADR 0002). Markers inside code are ignored, following CommonMark block structure.
- A missed-answer notice ("Comment 2 got no answer") with **Put back** for comments a reply did not answer.
- Origins verified against the session's message rows; an annotation taken while a session is busy is bound only to the turn it came from, and otherwise stays unverified.

**Other**

- The UI in every Hermes Desktop language: English, Simplified and Traditional Chinese, Japanese, Arabic (right-to-left), Russian, French, German and Spanish. It follows the app language or can be set in the settings. The instructions sent to the AI are in Chinese for the two Chinese UIs and in English otherwise.
- A settings page: enable switch, language, selection button, quiet mode, keep marks after sending, shortcuts (rebindable in the app's keyboard settings), reset.
- Light and dark themes through the host's theme variables, the host's corner radius and input styling, and short transitions that are switched off under reduced motion.
- A start-up check of the plugin SDK: missing interfaces are reported once and the plugin degrades instead of failing silently.
- The receiving side of a hand-off protocol through plugin events, so a companion plugin can hand annotations to the pending list: claims with owner and generation, a stable batch id, receipts and per-item settled results, idempotent under replays (ADR 0004, ADR 0007).

### Changed

Compared with the pre-release builds used for testing:

- The surfaces you work in (selection button, editor, pins, strip, menus) show no shortcut keycaps; the shortcuts still work, and the settings page lists them.
- The pending list is a compact strip of numbered chips instead of large cards; comments are written in the editor beside the passage.
- Pins ride the top-right corner of their passage instead of the page margin.
- The pin card's highlight ↔ comment toggle is gone: clear the comment to make a highlight, or use **Add comment**.
- Locating a passage no longer flashes it; the passage stays deepened instead.
- An annotation never saved stays off the strip and its count; sending still saves it first.

### Fixed

- The selection button showed after a noticeable delay and could overlap the right-click menu.
- Passages, long URLs, code and tables could widen the editor and cards; they now wrap or scroll inside.
- Pins could cover the transcript's timeline marks in narrow windows and drift while scrolling.
- Send menus could open off screen inside the composer, close at once when focused, or run past the window's edge in right-to-left layouts.
- The settings switches ran out of the settings page in right-to-left layouts.
- A comment edited and then switched away from could be sent in an older version.

### Security

- Batch ids are 26-character base32 (130 random bits). A batch that was already delivered can only be expanded again in the session that registered it.
- Copied text in the display version is made inert, so an `@kind:` inside an annotation is never expanded by the host.
- The plugin makes no network requests of its own and has no telemetry.

[Unreleased]: https://github.com/waiclay-349687/hermes-diple/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/waiclay-349687/hermes-diple/releases/tag/v0.1.0
