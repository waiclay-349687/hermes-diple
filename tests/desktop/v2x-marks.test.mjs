// V2-X: the chat plugin's stylesheets use only host colours. (That a document
// marks the same state the same way is checked next to the document plugin,
// v2x-marks-docs.test.mjs — it stays with that plugin.)
import test from 'node:test'
import assert from 'node:assert/strict'

import { loadModule } from './harness.mjs'

const { CAPTURE_CSS } = await loadModule('diple', 'plugins/diple/desktop/src/capture/styles.js')
const { STRIP_CSS } = await loadModule('diple', 'plugins/diple/desktop/src/send/strip/styles.js')

test('no --ui-warning (not a host token) and no raw amber anywhere; the warning colour is --ui-yellow', () => {
  for (const css of [CAPTURE_CSS, STRIP_CSS]) {
    assert.doesNotMatch(css, /--ui-warning|amber|#f59e0b/)
  }
  assert.match(CAPTURE_CSS, /\.diple-pin-dot\{[^}]*var\(--ui-yellow\)/)
})
