**English** | [简体中文](README.zh.md) | [繁體中文](README.zh-hant.md) | [日本語](README.ja.md) | [العربية](README.ar.md) | [Русский](README.ru.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Español](README.es.md)

# Diple — highlight and comment on chat passages for the AI (Hermes Desktop plugin)

Highlight a passage in a Hermes Desktop conversation, optionally write a comment on it, and send a batch of them with your next message; the AI answers every comment one by one and you can jump between each answer and its passage.

> **The name.** A *diple* (›) is the mark ancient Greek scribes put in the margin to point a line to its commentary — the ancestor of the quotation mark. The Chinese name 圈批 means “mark up and comment”.

> **Unofficial.** This is a community plugin. It is not made, reviewed or supported by Nous Research or the Hermes Agent project.

## Features

- **Annotate a selection** — select text in any chat message and an **Annotate** button appears just below-right of where you release the mouse, right next to the pointer (or press <kbd>⌘⇧E</kbd>). It keeps working even if the app clears the selection a moment later. The passage keeps its origin: which session, which message, who said it.
- **Highlight or comment** — every passage you add is an *annotation*. Write a comment on it and it is a *comment* (the AI must answer it); leave it blank and it is a *highlight* (background material only).
- **Comment in place** — a small editor opens where the button was, below the passage (above it when there is no room below): the passage on top (Markdown rendered), your comment below, and **Save** / **Save and send** at the bottom, with an icon button to replace the passage with the current selection.
- **Pins on the original** — annotated text is shaded (comments also underlined) and gets a numbered pin on its top-right corner. Hover a pin for a card with three buttons: **Edit** (or **Add comment** on a highlight), **Copy** and **Delete**; a sent annotation only offers **Copy**.
- **A strip above the composer** — saved annotations wait there per session as numbered chips until you send. Click a chip to go back to its passage; remove, clear (with undo) or preview; the list survives reloads.
- **Send N ▾** — send with your next message, or press **Send N** to send just the annotations. The ▾ menu has **Send now** and **Copy for AI** (Markdown, nothing is sent).
- **Response markers** — the AI marks each paragraph that answers a comment; the app shows it as a small “↩ Comment 2” chip that jumps back to the passage.
- **Missed-answer notice** — when a reply skips a comment, you are told (“Comment 2 got no answer”) and can put it back in the pending list with one click.
- **Calm two-way locate** — going back to a passage scrolls only if it is off screen and keeps it deepened, with no flash.
- **Queue while busy** — while the AI is still answering, “Send after reply” queues the batch and sends it when the turn ends.
- **Preview before sending** — see exactly what the chat bubble will show and what the AI will receive, with a size estimate against the host's context limits.

The plugin UI is available in every Hermes Desktop language: **English, 简体中文, 繁體中文, 日本語, العربية, Русский, Français, Deutsch and Español** (Arabic right-to-left). It follows the app language by default; you can also pick one in the plugin's settings. The instructions sent to the AI stay in Chinese for the two Chinese UIs and in English for every other language.

## Screenshots

The editor below the selected passage, opened where the **Annotate** button was (Simplified Chinese UI):

![The comment editor below the selected passage: the passage on top, the comment box, and the save and send buttons at the bottom (in Chinese)](docs/screenshots/editor.png)

Numbered pins on the top-right corner of each passage; neighbouring pins step aside (Chinese UI and sample text):

![Shaded passages with numbered pins 1, 2 and 3](docs/screenshots/pins.png)

The card shown when hovering a pin, with Edit · Copy · Delete:

![A pin card with the comment and three buttons](docs/screenshots/pin-card.png)

The strip above the composer and the Send N ▾ menu (Send now, Copy for AI):

![Numbered chips above the composer, and the open send menu](docs/screenshots/strip-send-menu.png)

The screenshots were taken in a sandbox with made-up conversations.

## Install

The plugin has two halves: a desktop plugin (`plugin.js`) and a small Python backend (`plugins/diple/`). Both are needed. In the commands below `~/.hermes` is your Hermes home; for a named profile use `~/.hermes/profiles/<name>` instead.

### Option A: download a release

1. Download `plugin.js`, `plugin.js.sha256`, `diple-python-0.2.1.zip` and `diple-python-0.2.1.zip.sha256` from the [latest release](https://github.com/waiclay-349687/hermes-diple/releases), and check them:

   ```bash
   shasum -a 256 -c plugin.js.sha256
   shasum -a 256 -c diple-python-0.2.1.zip.sha256
   ```

2. Put them in place:

   ```bash
   mkdir -p ~/.hermes/desktop-plugins/diple ~/.hermes/plugins
   cp plugin.js ~/.hermes/desktop-plugins/diple/plugin.js
   unzip -o diple-python-0.2.1.zip -d ~/.hermes/plugins/
   ```

3. Enable the backend and restart Hermes Desktop:

   ```bash
   hermes plugins enable diple
   ```

### Option B: from source

Needs Node.js 22 or newer.

```bash
git clone https://github.com/waiclay-349687/hermes-diple.git
cd hermes-diple
npm install
node scripts/install.mjs --home ~/.hermes --no-enable
hermes plugins enable diple
```

`scripts/install.mjs` builds `plugin.js` and copies both halves into the Hermes home given by `--home` (it never guesses one). Restart Hermes Desktop afterwards: the Python half loads only at app start.

## Usage

1. Select text in a chat message and click **Annotate** next to the pointer (or press <kbd>⌘⇧E</kbd>). The editor opens below the selection.
2. Optionally type a comment, then press <kbd>Enter</kbd> or **Save**; an empty comment saves a highlight. The annotation gets a numbered pin and a chip above the composer. Add as many as you like, from this or other sessions.
3. Type your message and send it as usual, or click **Send N** (or press <kbd>⌘⇧↩</kbd>) to send just the annotations. A receipt line under your message (“3 annotations attached · View what the AI received”) shows what went out.
4. In the answer, click a “↩ Comment n” chip to jump back to its passage. If a comment was skipped, use **Put back** on the notice.

**Copy** on a pin card copies a highlight's text, and a comment as Markdown: the passage as a quote (`> ` before each line), a blank line, then your comment — the same format as **Copy as Markdown** in “This session's annotations”. To turn a comment back into a highlight, clear its comment and save.

While the AI is answering, <kbd>Enter</kbd> steers the current turn and annotations never ride along with a steer; use **Send after reply** instead.

### Shortcuts

| Action | Default | Notes |
| --- | --- | --- |
| Add the selection to the pending list | <kbd>⌘⇧E</kbd> | Rebindable in the app's keyboard-shortcut settings |
| Send the pending list | <kbd>⌘⇧↩</kbd> | Rebindable |
| Send from the strip | <kbd>⌘↩</kbd> | While focus is in the strip above the composer |

The surfaces you work in (button, editor, pins, strip, menus) do not show these keycaps; the plugin's settings page lists them.

On Windows and Linux, <kbd>⌘</kbd> is <kbd>Ctrl</kbd>. The command palette (<kbd>⌘K</kbd>) also has “Add to pending”, “Diple: Send pending annotations”, “Diple: Preview what the AI will receive”, “Diple: This session's annotations” and “Diple: Settings” (in your UI language).

## Settings

Open them from the command palette (“Diple: Settings”) or from Settings in the app.

| Setting | Default | What it does |
| --- | --- | --- |
| Enable Diple | on | Master switch. Off stops the shortcuts, the strip, the shading of added passages and marker interaction; data is kept. |
| Show the toolbar on selection | on | The **Annotate** button next to a selection. Off: use <kbd>⌘⇧E</kbd> or the command palette. |
| Language | Follow app | Follow app, or one of the nine languages, each shown in its own name. Affects the plugin UI; the instructions sent to the AI are in Chinese for 简体中文 / 繁體中文 and in English otherwise. |
| Quiet mode: pins only on the original | off | Annotated passages get no shading or underline, only a numbered pin beside them. |
| Keep marks after sending | on | Sent annotations keep a faded mark on the original, with answered / not answered shown on the pin. |
| Shortcuts | — | Opens the app's keyboard-shortcut settings to rebind the two actions. |
| Reset | — | Restores the defaults (keeps the language). |

## How it works

### What the AI receives

Your chat bubble stays short: your text, then one line per annotation (number, origin, the first ~40 characters, your comment) and a last line `@diple:<batch id>`. That line is a Hermes context reference: when the turn is sent, the plugin's backend expands it into the **full version** — every annotation's full text, origin, speaker and comment, plus short response rules (answer each comment; highlights are background only). A single passage over 4000 characters keeps its first and last 1500. Use **Preview** before sending, or **View what the AI received** afterwards, to see both versions.

### Response markers

The response rules ask the AI to put a marker such as `::ann{b="<batch id>" n="1,3"}` in front of each paragraph that answers comments 1 and 3. Hermes Desktop renders these directives; the plugin draws them as “↩ Comment 1, 3” chips and checks the reply for comments that got no marker. Markers inside code are ignored.

### Where data is stored

- The pending list and send state: the desktop plugin storage of Hermes Desktop (local app storage, keys prefixed `hermes.plugin.diple.`).
- Sent batches (needed to expand `@diple:` references and to show what the AI received): SQLite at `~/.hermes/plugin-data/diple/data.db`.

Design decisions are recorded in [docs/adr](docs/adr/README.md) and the overall structure in [docs/architecture.md](docs/architecture.md).

## Privacy

Everything stays on your machine. The plugin makes no network requests of its own, has no telemetry and stores nothing outside your Hermes home and the app's local storage. Annotations reach your model provider only as part of a message you send, exactly like text you type.

## Known limitations

The main ones (full list with reasons in [docs/known-limitations.md](docs/known-limitations.md)):

- Two windows writing the same session's pending list at the very same moment can lose one of the two writes.
- An annotation taken while the session is busy is verified against the turn that produced it; if that cannot be established it stays marked “unverified” rather than being guessed.
- After the host rotates a session id (for example after context compression), re-expanding an old `@diple:` reference in the new session is refused.
- There is no right-click entry yet: Hermes Desktop has no context-menu extension point for plugins.

## Compatibility

Tested with Hermes Agent **v0.22.5 (2026.9.24)**, commit `bf0203a` (2026-10-22), on macOS. It needs Hermes Desktop (the CLI alone does not load desktop plugins). Other versions may work but have not been tested; please report what you find.

## How this differs

The curated catalog has a related desktop plugin, **quote-ask** (`hermes plugins info quote-ask`): select text, and it lands in the composer as a Markdown quote. It is light and stateless. Diple is for reviewing a long answer: it keeps a pending list across sends, gives each comment a number the AI must answer, checks for missed answers, links answers and passages both ways, and sends the full text through a context reference while the chat bubble stays short. Diple adapts quote-ask's selection-to-Markdown converter (MIT, see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)). The plugin ids differ (`quote-ask` vs `diple`), so both can be installed side by side.

## Roadmap and issues

- [ROADMAP.md](ROADMAP.md) — what is being worked on now, next and later.
- [Issues](https://github.com/waiclay-349687/hermes-diple/issues) — open questions, design discussions and known limitations.
- [CHANGELOG.md](CHANGELOG.md) — what changed in each version.
- [CONTRIBUTING.md](CONTRIBUTING.md) — building and testing.

## License

[MIT](LICENSE). Third-party code: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
