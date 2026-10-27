# Architecture

Diple has a desktop half and a Python half, plus two shared packages bundled into it: a pure core and a small desktop kit.

```text
Hermes Desktop (renderer)                     Hermes backend (Python)
┌───────────────────────────────┐             ┌──────────────────────────────────┐
│ plugin.js                     │  ctx.rest   │ python/ (plugin backend)         │
│  capture/  selection → item,  │ ──────────▶ │  dashboard/plugin_api.py  routes │
│            editor, pins, marks│ ◀────────── │  store.py   SQLite (batches,     │
│  shared/   list store, batch  │ plugin      │             hand-off claims)     │
│            catalog, settings  │ events      │  provider.py  @-reference expand │
│  send/     the send module,   │             └──────────────────────────────────┘
│            strip, markers     │                          ▲ host calls expand()
└───────────────────────────────┘                          │ when a turn is sent
          ▲ bundled in                                     │
┌───────────────────────────────┐ ┌──────────────────────┐ the model receives the full version
│ packages/core (pure logic)    │ │ packages/desktop-kit │
│  pending-list  envelope       │ │  locales, i18n + dir │
│  markers  anchor  handoff     │ │  settings store      │
└───────────────────────────────┘ └──────────────────────┘
```

## Desktop plugin (`plugins/diple/desktop/src`)

- `capture/` — reads the selection as Markdown, splits it per message, finds its origin (session, message row, role), the editor beside the passage, numbered pins, transcript marks and locate.
- `shared/` — the pending-list store over plugin storage (command-level merge across windows), the **batch catalog** (`batch-catalog.js`: the only module that knows how sent batches are recorded locally, with the backend as fallback — markers, marks and locate read through it), settings rules, i18n bundles, the REST client, live events.
- `send/` — the **send module** (`sending.js`). Its interface is split by role:
  - the UI (strip, receipt row, preview, markers) gets `request / preview / get / subscribe / resolve` and nothing else;
  - the host wiring (turn events, `batch.sent`, hand-off broadcasts, focus, reconnect, resume, the composer middleware) goes through `bindSending`;
  - inside, the protocol implementation (`send-flow.js`: compose, register, submit, confirm from the persisted turn, queue while busy, answer check, the outbox for final results; `handoff.js`: the hand-off receiver) is not reachable from the UI — nothing outside can forge a final result.

  Plus the composer strip, the session drawer, response markers and the settings page.

Only `@hermes/plugin-sdk`, `react` and `react/jsx-runtime` are imported at runtime; everything else is bundled by esbuild (`scripts/build.mjs`). The export that produces this repository checks that every import resolves inside it.

## Desktop kit (`packages/desktop-kit`)

What the plugins of this family share beyond pure logic, bundled into each plugin separately (one source, independent instances, never shared at run time):

- `locale-ids.js` — the host's locale list, endonyms, RTL, the AI-facing language;
- `createLocaleRuntime` — follow the app or a pinned language, en fallback, `dir` on the plugin's roots (including ones added later), graceful on older hosts without plugin i18n;
- `createSettingsStore` — read, persist, notify; each plugin brings its own rules.

Plugin ids, texts and settings rules stay in the plugin.

## Shared core (`packages/core`)

Pure functions without DOM or host access, tested directly:

- `pending-list.js` — the list model and identity rules;
- `envelope.js` — display version, full version, token estimate;
- `markers.js` — `::ann{…}` generation, parsing (code-aware) and reconciliation;
- `anchor.js` — remembering a passage's position and finding it again after edits;
- `handoff-protocol.js` — the hand-off state machines (ledger, receiver, sender) shared with the Python twin, which is checked against the same case files and a differential test. The core entry (`Handoff`) exposes only what the plugins run; the reference models (the ledger, the settled derivations) are imported from the module itself by the tests.

## Python backend (`plugins/diple/python`)

- `provider.py` — a context-reference provider for `@diple:<batch id>`; it returns the full version and broadcasts `batch.sent`.
- `store.py` — SQLite through the host's `plugin_db` (`<hermes home>/plugin-data/diple/data.db`): batches, their status, hand-off claims and settled results.
- `dashboard/plugin_api.py` — REST routes under `/api/plugins/diple/` used by the desktop half.

## Decisions

The reasons behind these choices are in the [ADRs](adr/README.md): one action for highlight and comment (0001), the names (0008), markers written by the AI and everything else by code (0002), plugin events between plugins (0004), plugin SQLite (0005), delivery through a context reference (0006), the hand-off state machines (0007), and the desktop kit, batch catalog and role-split send interface (0009).
