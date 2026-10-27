// V2-C (design §2.10c): at load the plugin checks the SDK exports it uses; a
// missing one is reported once (per distinct set), and the plugin degrades.
import test from 'node:test'
import assert from 'node:assert/strict'

import { checkSdk, reportSdk, REQUIRED } from '../../plugins/diple/desktop/src/send/sdk-check.js'

const fullSdk = () => {
  const s = {}
  for (const k of REQUIRED) s[k] = k.endsWith('AREA') ? 'x' : k === 'COMPOSER_AREAS' ? { top: 'composer.top', middleware: 'm' } : () => {}
  for (const k of ['MessageTextContent', 'Streamdown', 'Button', 'Tip', 'Dialog', 'DialogContent', 'DialogTitle', 'ConfirmDialog', 'ToggleRow', 'ListRow', 'SegmentedControl', 'Kbd']) s[k] = () => {}
  return s
}

const memStorage = () => {
  const m = new Map()
  return { get: (k, d) => (m.has(k) ? m.get(k) : d), set: (k, v) => m.set(k, v), remove: (k) => m.delete(k) }
}
const t = (k, ...a) => `${k}(${a.join('|')})`

test('a complete SDK: nothing missing, nothing reported', () => {
  assert.deepEqual(checkSdk(fullSdk()), { missing: [], degraded: [] })
  const notes = []
  reportSdk({ sdk: fullSdk(), storage: memStorage(), notify: (n) => notes.push(n), t })
  assert.equal(notes.length, 0)
})

test('a missing required export is a warning, an optional one names what degrades; each set once', () => {
  const sdk = fullSdk()
  delete sdk.MessageTextContent
  delete sdk.Streamdown
  delete sdk.ConfirmDialog
  sdk.COMPOSER_AREAS = { middleware: 'm' } // no `top`: the strip cannot mount
  const r = checkSdk(sdk)
  assert.deepEqual(r.missing, ['COMPOSER_AREAS.top'])
  assert.deepEqual(r.degraded, ['MessageTextContent', 'Streamdown', 'ConfirmDialog'])
  const storage = memStorage()
  const notes = []
  const notify = (n) => notes.push(n)
  reportSdk({ sdk, storage, notify, t })
  assert.equal(notes.length, 1)
  assert.equal(notes[0].kind, 'warning')
  assert.equal(notes[0].title, 'send.sdk.title()')
  assert.match(notes[0].message, /send\.sdk\.missing\(COMPOSER_AREAS\.top\)/)
  assert.match(notes[0].message, /send\.sdk\.degraded\(MessageTextContent, Streamdown, ConfirmDialog\)/)
  // the next load with the same SDK says nothing again
  reportSdk({ sdk, storage, notify, t })
  assert.equal(notes.length, 1)
  // a different gap is news
  delete sdk.host
  reportSdk({ sdk, storage, notify, t })
  assert.equal(notes.length, 2)
})

test('only optional exports missing: they have fallbacks — no notice, the check still says which', () => {
  const sdk = fullSdk()
  delete sdk.Tip
  const notes = []
  const r = reportSdk({ sdk, storage: memStorage(), notify: (n) => notes.push(n), t })
  assert.deepEqual(r.degraded, ['Tip'])
  assert.equal(notes.length, 0)
})
