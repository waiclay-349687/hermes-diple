// V2-T: the two appended settings keys (design §4: marksQuiet, marksKeepSent).
import test from 'node:test'
import assert from 'node:assert/strict'

import { loadModule } from './harness.mjs'

// bundled the plugin's way (it imports @diple/desktop-kit)
const { createSettings, DEFAULT_SETTINGS, normalizeSettings } = await loadModule('diple', 'plugins/diple/desktop/src/shared/settings.js')

const mem = (init = {}) => {
  const m = new Map(Object.entries(init))
  return { get: (k, d) => (m.has(k) ? m.get(k) : d), set: (k, v) => m.set(k, v), remove: (k) => m.delete(k), m }
}

test('defaults: marks are loud (not quiet) and sent marks are kept', () => {
  assert.equal(DEFAULT_SETTINGS.marksQuiet, false)
  assert.equal(DEFAULT_SETTINGS.marksKeepSent, true)
  // an older stored value (before V2) gains the defaults; the old keys keep their values
  const s = createSettings(mem({ settings: { enabled: false, language: 'en', selectionButton: false } }))
  assert.deepEqual(s.get(), { enabled: false, language: 'en', selectionButton: false, marksQuiet: false, marksKeepSent: true })
})

test('the two keys persist and reject non-booleans', () => {
  const st = mem()
  const s = createSettings(st)
  s.set({ marksQuiet: true, marksKeepSent: false })
  assert.equal(st.m.get('settings').marksQuiet, true)
  assert.equal(createSettings(st).get().marksKeepSent, false)
  assert.equal(normalizeSettings({ marksQuiet: 'yes', marksKeepSent: 0 }).marksQuiet, false)
  assert.equal(normalizeSettings({ marksQuiet: 'yes', marksKeepSent: 0 }).marksKeepSent, true)
})
