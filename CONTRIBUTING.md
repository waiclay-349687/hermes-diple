# Contributing

Thanks for your interest. This is a small hobby project; issues with a clear reproduction or a concrete use case help most. For a larger change, please open an issue first.

## Layout

| Path | What |
| --- | --- |
| `packages/core/` | Pure shared logic: pending list, envelope (display/full version), response markers, anchors, hand-off protocol. No DOM, no host. |
| `plugins/diple/desktop/src/` | The desktop plugin (bundled into one `plugin.js`). Imports only `@hermes/plugin-sdk`, `react`, `react/jsx-runtime`. |
| `plugins/diple/python/` | The Python backend: `@diple:` context-reference provider, SQLite store, REST routes (`dashboard/plugin_api.py`). |
| `tests/desktop/` | jsdom tests that drive the plugin from `register(ctx)` against an SDK stub. |
| `tests/python/` | pytest for the backend (temp `HERMES_HOME`, never your real one). |
| `docs/adr/` | Architecture decision records (Chinese). |

## Build and test

```bash
npm install
npm test          # core + desktop tests (node --test)
npm run test:ci   # the same, one file at a time (what CI runs; avoids a timing flake)
npm run build     # → dist/diple/plugin.js
npm run test:py   # Python backend tests
```

Requirements: Node.js 22+, and for the Python tests a Hermes Agent checkout plus Python 3.11. The backend imports a few host modules (`agent.context_references`, `plugins.plugin_storage`, `hermes_cli.plugin_events`, `gateway.session_context`), so `scripts/pytest.sh` puts the checkout on `PYTHONPATH`:

- default: `~/.hermes/hermes-agent` and its venv (read only; pytest is installed into `tests/.pydeps`, not into the venv);
- otherwise: `HERMES_AGENT_ROOT=<checkout> PYTHON=<python with fastapi, httpx, pyyaml, ruamel.yaml, pytest> npm run test:py`.

CI does the second: it checks out Hermes Agent at the tested commit (`bf0203a`) and runs the whole Python suite, so nothing is skipped in CI.

Install into a Hermes home for manual testing (always pass `--home`; the script never guesses one):

```bash
node scripts/install.mjs --home <hermes home> --no-enable
hermes plugins enable diple
```

## Tests that are not in this repository

This repository is exported from a private monorepo that also holds the companion plugin for Markdown documents, [Diple Docs](https://github.com/waiclay-349687/hermes-diple-docs), which is published in its own repository. The shared packages (`packages/core`, `packages/desktop-kit`) are copied into both; a change to them is released in both.

Tests are split by what they load: a test that uses only this plugin (and the shared packages) is here, one that uses only Diple Docs is in its repository, and the shared-package tests are in both. Two side-by-side locale cases in `locale-runtime.test.mjs` are skipped here (they need both plugins), and `test_protocol_diff.py` / `test_handoff_r5.py` are cut down to this plugin's half. The tests that load both plugins at once stay in the private monorepo: `tests/desktop/handoff-r3.test.mjs`, `tests/desktop/handoff-r4.test.mjs`, `tests/desktop/handoff-r5.test.mjs`, `tests/desktop/v2x-marks-docs.test.mjs`.

The receiving side of the hand-off protocol, which lives in this plugin, is still covered here by `packages/core/test/handoff-*.test.mjs`, `tests/desktop/send*.test.mjs` and `tests/python/test_handoff_*.py`; the sending side by Diple Docs's own tests. Real-app end-to-end scripts (an isolated Hermes Desktop sandbox driven over CDP) are not published.

## Conventions

- Sources may use JSX; esbuild bundles them into one plain ESM `plugin.js`. No hard-coded colors (theme variables only).
- UI strings live in `messages.js` files; every key must exist in every language (a test enforces it).
- While an IME is composing, Enter never submits.
- Every user-visible change goes into `CHANGELOG.md` under **Unreleased**, and the README, ROADMAP and issues are kept in step with each push.
