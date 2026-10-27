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

This repository is exported from a private monorepo that also holds an unpublished companion plugin (Markdown document review). Tests that load that plugin's code were left out:

- desktop: `review*.test.mjs`, the document-page tests `v2d-*.test.mjs`, the document half of the mark-style check (`v2x-marks-docs.test.mjs`), the cross-plugin hand-off timing tests `handoff-r3…r6.test.mjs` and their rigs; two side-by-side locale cases in `locale-runtime.test.mjs` are skipped here (they need both plugins);
- Python: `test_review_*.py`, `test_handoff_r6.py`, the Review half of the differential protocol test (`itemOutcomes`) and one cross-plugin case in `test_handoff_r5.py`.

The receiving side of the hand-off protocol, which lives in this plugin, is still covered here by `packages/core/test/handoff-*.test.mjs`, `tests/desktop/send*.test.mjs` and `tests/python/test_handoff_*.py`. Real-app end-to-end scripts (an isolated Hermes Desktop sandbox driven over CDP) are not published either.

## Conventions

- Sources may use JSX; esbuild bundles them into one plain ESM `plugin.js`. No hard-coded colors (theme variables only).
- UI strings live in `messages.js` files; every key must exist in every language (a test enforces it).
- While an IME is composing, Enter never submits.
- Every user-visible change goes into `CHANGELOG.md` under **Unreleased**, and the README, ROADMAP and issues are kept in step with each push.
