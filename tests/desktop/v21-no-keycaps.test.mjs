// V2.1 #3: no shortcut keycaps on the surfaces the user works in. The keys
// still work; teaching them is the later onboarding (ROADMAP). In scope:
// selection toolbar, editor, pin preview, strip + send button + its menu,
// drawer, Diple Docs list / cards / send menu, and their tooltips and aria
// texts. Out of scope (kept on purpose): the settings page — its component
// and the `*.settings.*` message namespaces may show ⌘ ⇧ ↩ ↵ — and the
// response marker's ↩ (a reply glyph, not a key).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { ROOT } from './harness.mjs'
import { loadI18n, PLUGINS } from '../../scripts/i18n-gaps.mjs'

const SYMBOLS = /[⌘⇧↩↵⏎]/
const SETTINGS_FILES = new Set(['plugins/diple/desktop/src/send/settings-page.jsx'])
const NOT_A_KEY = new Set(['send.markerLabel']) // "↩ 批注 ①": the response marker

function sources() {
  const out = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(js|jsx)$/.test(e.name)) out.push(path.relative(ROOT, p))
    }
  }
  for (const id of PLUGINS) walk(path.join(ROOT, 'plugins', id, 'desktop/src'))
  for (const pkg of ['core', 'desktop-kit']) walk(path.join(ROOT, 'packages', pkg, 'src'))
  return out
}

const codeOf = (src) =>
  src
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n')

test('no production code outside the settings page creates a kbd element or styles diple-kbd', () => {
  const bad = []
  for (const f of sources()) {
    if (SETTINGS_FILES.has(f) || /\/locales\/|messages\.js$/.test(f)) continue
    const code = codeOf(fs.readFileSync(path.join(ROOT, f), 'utf8'))
    for (const re of [/createElement\(\s*['"]kbd['"]/i, /\bh\(\s*['"]kbd['"]/, /<kbd\b/i, /\bdiple-kbd\b/, /pick\(\s*['"]Kbd['"]\s*\)/])
      if (re.test(code)) bad.push(`${f}: ${re}`)
    // a shortcut glyph in a string literal (tooltips / aria built in code)
    for (const m of code.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)) {
      const s = m[2].replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      if (SYMBOLS.test(s) && !/ARROW/.test(code.slice(Math.max(0, m.index - 20), m.index))) bad.push(`${f}: ${JSON.stringify(s)}`)
    }
  }
  assert.deepEqual(bad, [])
})

test('no UI text outside settings carries ⌘ ⇧ ↩ ↵ ⏎ — in all 9 locales', async () => {
  const bad = []
  for (const id of PLUGINS) {
    const { LOCALES, LOCALE_IDS } = await loadI18n(id)
    assert.equal(LOCALE_IDS.length, 9)
    const walk = (o, prefix, l) => {
      for (const [k, v] of Object.entries(o)) {
        const key = prefix ? `${prefix}.${k}` : k
        if (v && typeof v === 'object') walk(v, key, l)
        else {
          if (/(^|\.)settings(\.|$)/.test(key) || NOT_A_KEY.has(key)) continue
          const s = typeof v === 'function' ? String(v('X', 'Y', 'Z', 'W')) : String(v)
          if (SYMBOLS.test(s)) bad.push(`${id} ${l} ${key}: ${s}`)
        }
      }
    }
    for (const l of LOCALE_IDS) walk(LOCALES[l] ?? {}, '', l)
  }
  assert.deepEqual(bad, [])
})
