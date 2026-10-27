# Roadmap

This file and the [issues](https://github.com/waiclay-349687/hermes-diple/issues) are how the project is tracked. Both are updated with every push to this repository.

Status words: **in progress**, **planned**, **designing** (being shaped, discussion welcome, nothing built yet), **discussing** (no decision yet), **blocked** (waits for the host), **tracking** (an upstream change we follow).

What has already shipped is in [CHANGELOG.md](CHANGELOG.md).

## Now

Being built for the next minor version, after v0.1.0.

| Item | Status | Issue |
| --- | --- | --- |
| The selection button appears just below-right of where the mouse is released, next to the pointer | in progress | _(issue not filed yet)_ |
| Companion Markdown plugin: collapsible annotation list, a status bar in the page margin, previous / next unresolved, a bottom bar in narrow windows | in progress | _(issue not filed yet)_ |
| The comment editor opens directly below the selected passage (chat and the companion Markdown plugin) | in progress | _(issue not filed yet)_ |

## Next

| Item | Status | Issue |
| --- | --- | --- |
| One-click follow-up for comments the AI did not answer (built by code, never sent automatically) | designing | _(issue not filed yet)_ |
| Four optional intents for a comment: question, disagree, change this, unsure | designing | _(issue not filed yet)_ |
| Cheap, explainable checks on each response: too short, quote not found in the passage | designing | _(issue not filed yet)_ |
| The AI's response shown under each annotation, with a per-batch summary | designing | _(issue not filed yet)_ |
| Companion Markdown plugin: suggested edits, applied by code or by the AI and then checked | planned | _(issue not filed yet)_ |
| Append-only export of annotations to Markdown notes | planned | _(issue not filed yet)_ |
| First-run onboarding, including the keyboard shortcuts (the surfaces you work in show no keycaps) | planned | _(issue not filed yet)_ |
| Publish the companion plugin for reviewing Markdown documents (annotations kept per file, sent through this plugin's pending list); the receiving side of its hand-off protocol is already in this repository | planned | — |

## Later

| Item | Status | Issue |
| --- | --- | --- |
| Cross-session annotation library: filter, search, jump back | planned | _(issue not filed yet)_ |
| A second review round carries over what is still unresolved | planned | _(issue not filed yet)_ |
| Reference earlier annotations from the composer's `@` completions | planned | _(issue not filed yet)_ |
| Side question on a single annotation (needs a new session with an id, see Blocked) | blocked | _(issue not filed yet)_ |
| A weekly to-do review of what is still open (unanswered, missed, unresolved, passage changed) | planned | — |
| Suggest a saved tag or rule when the same kind of comment keeps coming back | planned | — |
| Turn an unresolved "change this" comment into a task card, after you confirm | planned | — |
| Show which earlier annotations an answer used, when the AI cites their ids | planned | — |
| One comment attached to several passages (for example to compare A and B) | planned | — |
| Exported data aligned with the W3C Web Annotation selectors | planned | — |

Improvements that come out of the [known limitations](docs/known-limitations.md):

| Item | Status | Issue |
| --- | --- | --- |
| Pending list safe against two windows writing at the same instant (atomic storage from the host, or keep the list in the plugin backend) | planned | _(issue not filed yet)_ |
| Accept old references after the host rotates a session id (needs the session lineage from the host) | blocked | _(issue not filed yet)_ |
| Verify annotations taken during streaming when the session's runtime id was unknown | planned | _(issue not filed yet)_ |
| Recognise the rare CommonMark forms the marker scanner skips (HTML blocks, link reference definitions, setext headings, wide tabs) | planned | — |
| Finish a queued send for a window that closed mid-way, instead of leaving the batch in that window's list | planned | — |

## Blocked

Waiting for an extension point or API from Hermes Desktop.

| Item | Status | Issue |
| --- | --- | --- |
| Right-click entry, once Hermes Desktop offers a context-menu extension point for plugins | blocked | _(issue not filed yet)_ |
| "New session" as a send target, and side questions, once the SDK can create a session and return its id (`newChat()` only opens a draft today) | blocked | _(issue not filed yet)_ |

## Upstream tracking

Changes in Hermes Agent / Hermes Desktop that affect this plugin.

| Upstream | What it means here | Status | Issue |
| --- | --- | --- | --- |
| [hermes-agent #144421](https://github.com/NousResearch/hermes-agent/issues/144421) — chat selection cleared about 1 s after selecting | The selection button and the annotate shortcut can lose the selection; keep the range at mouse-up and add a regression test | tracking | _(issue not filed yet)_ |
| [hermes-agent #144170](https://github.com/NousResearch/hermes-agent/pull/144170) — long transcripts unmount middle messages | Shading and pins must be redrawn after a remount; add a regression test | tracking | _(issue not filed yet)_ |
| [hermes-agent #145012](https://github.com/NousResearch/hermes-agent/pull/145012) — official quote-reply for chat messages | Overlaps with highlights; this plugin focuses on numbered comments, response markers and the missed-answer check | tracking | _(issue not filed yet)_ |

## Internal design debt

From the internal design review (D1, codebase-design). No user-visible change; done when a change touches the area anyway.

| Item | Status | Issue |
| --- | --- | --- |
| Document selections: one projection that converts both ways between the rendered text and the Markdown source (companion plugin) | planned | — |
| Companion plugin backend: a safe-read module separate from the SQLite lifecycle | planned | — |
| A shared adapter for the optional SDK display components (not a general UI module) | discussing | — |
| Companion plugin: one interface for a document's session and lifecycle | planned | — |
