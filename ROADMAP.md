# Roadmap

This file and the [issues](https://github.com/waiclay-349687/hermes-diple/issues) are how the project is tracked. Both are updated with every push to this repository.

Status words: **in progress**, **planned**, **designing** (being shaped, discussion welcome, nothing built yet), **discussing** (no decision yet), **blocked** (waits for the host), **tracking** (an upstream change we follow), **moved** (now tracked in the other repository).

What has already shipped is in [CHANGELOG.md](CHANGELOG.md). The document side of the family, [Diple Docs](https://github.com/waiclay-349687/hermes-diple-docs), has its own roadmap: [Diple Docs's ROADMAP](https://github.com/waiclay-349687/hermes-diple-docs/blob/main/ROADMAP.md).

## Now

Being built for the next minor version, after v0.2.2.

| Item | Status | Issue |
| --- | --- | --- |
| Fixes from a full check of what every click and key does in the chat, kept small (see the CHANGELOG's Unreleased section when they land) | in progress | — |

## Next

| Item | Status | Issue |
| --- | --- | --- |
| One-click follow-up for comments the AI did not answer (built by code, never sent automatically) | designing | [#12](https://github.com/waiclay-349687/hermes-diple/issues/12) |
| Four optional intents for a comment: question, disagree, change this, unsure | designing | [#13](https://github.com/waiclay-349687/hermes-diple/issues/13) |
| Cheap, explainable checks on each response: too short, quote not found in the passage | designing | [#14](https://github.com/waiclay-349687/hermes-diple/issues/14) |
| The AI's response shown under each annotation, with a per-batch summary | designing | [#15](https://github.com/waiclay-349687/hermes-diple/issues/15) |
| Suggested edits for Markdown documents: now tracked in [Diple Docs's repository](https://github.com/waiclay-349687/hermes-diple-docs/issues) | moved | [#16](https://github.com/waiclay-349687/hermes-diple/issues/16) |
| Append-only export of annotations to Markdown notes | planned | [#18](https://github.com/waiclay-349687/hermes-diple/issues/18) |
| First-run onboarding, including the keyboard shortcuts (the surfaces you work in show no keycaps) | planned | [#22](https://github.com/waiclay-349687/hermes-diple/issues/22) |

## Later

| Item | Status | Issue |
| --- | --- | --- |
| Cross-session annotation library: filter, search, jump back | planned | [#17](https://github.com/waiclay-349687/hermes-diple/issues/17) |
| A second review round carries over what is still unresolved | planned | [#19](https://github.com/waiclay-349687/hermes-diple/issues/19) |
| Reference earlier annotations from the composer's `@` completions | planned | [#20](https://github.com/waiclay-349687/hermes-diple/issues/20) |
| Side question on a single annotation (needs a new session with an id, see Blocked) | blocked | [#21](https://github.com/waiclay-349687/hermes-diple/issues/21) |
| A weekly to-do review of what is still open (unanswered, missed, unresolved, passage changed) | planned | — |
| Suggest a saved tag or rule when the same kind of comment keeps coming back | planned | — |
| Turn an unresolved "change this" comment into a task card, after you confirm | planned | — |
| Show which earlier annotations an answer used, when the AI cites their ids | planned | — |
| One comment attached to several passages (for example to compare A and B) | planned | — |
| Exported data aligned with the W3C Web Annotation selectors | planned | — |

Improvements that come out of the [known limitations](docs/known-limitations.md):

| Item | Status | Issue |
| --- | --- | --- |
| Pending list safe against two windows writing at the same instant (atomic storage from the host, or keep the list in the plugin backend) | planned | [#6](https://github.com/waiclay-349687/hermes-diple/issues/6) |
| Accept old references after the host rotates a session id (needs the session lineage from the host) | blocked | [#7](https://github.com/waiclay-349687/hermes-diple/issues/7) |
| Verify annotations taken during streaming when the session's runtime id was unknown | planned | [#8](https://github.com/waiclay-349687/hermes-diple/issues/8) |
| Recognise the rare CommonMark forms the marker scanner skips (HTML blocks, link reference definitions, setext headings, wide tabs) | planned | — |
| Finish a queued send for a window that closed mid-way, instead of leaving the batch in that window's list | planned | — |

## Blocked

Waiting for an extension point or API from Hermes Desktop.

| Item | Status | Issue |
| --- | --- | --- |
| Right-click entry, once Hermes Desktop offers a context-menu extension point for plugins | blocked | [#4](https://github.com/waiclay-349687/hermes-diple/issues/4) |
| "New session" as a send target, and side questions, once the SDK can create a session and return its id (`newChat()` only opens a draft today) | blocked | [#5](https://github.com/waiclay-349687/hermes-diple/issues/5) |

## Upstream tracking

Changes in Hermes Agent / Hermes Desktop that affect this plugin.

| Upstream | What it means here | Status | Issue |
| --- | --- | --- | --- |
| [hermes-agent #144421](https://github.com/NousResearch/hermes-agent/issues/144421) — chat selection cleared about 1 s after selecting | The selection button and the annotate shortcut can lose the selection; keep the range at mouse-up and add a regression test | tracking | [#9](https://github.com/waiclay-349687/hermes-diple/issues/9) |
| [hermes-agent #144170](https://github.com/NousResearch/hermes-agent/pull/144170) — long transcripts unmount middle messages | Shading and pins must be redrawn after a remount; add a regression test | tracking | [#10](https://github.com/waiclay-349687/hermes-diple/issues/10) |
| [hermes-agent #145012](https://github.com/NousResearch/hermes-agent/pull/145012) — official quote-reply for chat messages | Overlaps with highlights; this plugin focuses on numbered comments, response markers and the missed-answer check | tracking | [#11](https://github.com/waiclay-349687/hermes-diple/issues/11) |

## Internal design debt

From the internal design review (D1, codebase-design). No user-visible change; done when a change touches the area anyway.

| Item | Status | Issue |
| --- | --- | --- |
| A shared adapter for the optional SDK display components (not a general UI module) | discussing | — |

The document page's own design debt is listed in [Diple Docs's ROADMAP](https://github.com/waiclay-349687/hermes-diple-docs/blob/main/ROADMAP.md).
