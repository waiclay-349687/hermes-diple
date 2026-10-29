// P2 → L1 (D1 §3 L1, §7.2): the locale and settings behaviour both plugins
// share, characterised before it moves into packages/desktop-kit. Both
// plugins' own i18n entries (built against the SDK stub, as the host loads
// them) run side by side in one document:
//   - a pin in one plugin changes only that plugin's texts and roots' dir
//   - auto follows the app locale; a locale the plugins do not ship → en
//   - roots added later get dir (RTL for ar); dispose stops exactly that plugin
//   - an older host without ctx.i18n (no SDK i18n) still translates, from
//     the pin or navigator.language
//   - settings: invalid values → defaults, set persists then notifies once,
//     snapshots stable; the host storage's corrupt JSON → defaults
// Computed loads reviewed: see the override in publish/public-export-manifest.json.
import test from 'node:test'
import assert from 'node:assert/strict'

import path from 'node:path'

import { setupDom, loadModule, tick } from './harness.mjs'
import { loadI18n, PLUGINS } from '../../scripts/i18n-gaps.mjs'

const w = setupDom()
const React = await import('react')
const { act, createElement } = React
const { createRoot } = await import('react-dom/client')

// every plugin of this tree; the side-by-side cases need both (private tree only)
const load = async (id) => ({ id, ...(await loadI18n(id)), ...(await loadModule(id, path.join('plugins', id, 'desktop/src/shared/settings.js'))) })
const MODS = await Promise.all(PLUGINS.map(load))
const chat = MODS.find((m) => m.id === 'diple')
const docs = MODS.find((m) => m.id !== 'diple')
const BOTH = docs ? false : 'needs both plugins (the public tree has only the chat plugin)'
const sdk = globalThis.__sdk
sdk.i18n ??= new Map()
const ROOTS = { diple: '[data-diple-ui]', 'diple-docs': '.er-page' }

function memoryStorage(init = {}) {
  const map = new Map(Object.entries(init))
  return { map, get: (k, d) => (map.has(k) ? structuredClone(map.get(k)) : d), set: (k, v) => map.set(k, structuredClone(v)), remove: (k) => map.delete(k) }
}

/** A host ctx for one plugin: its i18n registered with the host (as plugin.ts does). */
function hostCtx(id, { i18n = true } = {}) {
  const disposers = []
  const bundles = {}
  const listeners = new Set()
  const ctx = {
    onDispose: (fn) => disposers.push(fn),
    ...(i18n
      ? {
          i18n: {
            register: (b) => Object.assign(bundles, b),
            t: (key, ...args) => {
              for (const l of [sdk.locale.get(), 'en']) {
                let v = bundles[l]
                for (const p of key.split('.')) v = v?.[p]
                if (typeof v === 'string') return v
                if (typeof v === 'function') return v(...args)
              }
              return key
            },
            onLocaleChange: (fn) => (listeners.add(fn), () => listeners.delete(fn))
          }
        }
      : {})
  }
  if (i18n) sdk.i18n.set(id, ctx.i18n)
  return { ctx, dispose: () => disposers.splice(0).forEach((f) => f()), localeChanged: () => listeners.forEach((f) => f()) }
}

function install(mod, id, opts) {
  const storage = memoryStorage()
  const settings = mod.createSettings(storage)
  const host = hostCtx(id, opts)
  const i18n = mod.createI18n(host.ctx, settings)
  return { settings, i18n, storage, ...host }
}

const root = (id) => {
  const el = document.createElement('div')
  if (id === 'diple') el.setAttribute('data-diple-ui', '')
  else el.className = 'er-page'
  document.body.append(el)
  return el
}

test('two plugins side by side: a pin in one changes only its texts and its roots\' dir', { skip: BOTH }, async () => {
  sdk.locale.set('zh')
  const a = install(chat, 'diple')
  const b = install(docs, 'diple-docs')
  const ra = root('diple')
  const rb = root('diple-docs')
  await tick(0)
  assert.equal(ra.getAttribute('dir'), 'ltr')
  a.settings.set({ language: 'ar' })
  await tick(0)
  assert.equal(a.i18n.locale(), 'ar')
  assert.equal(b.i18n.locale(), 'zh', 'the other plugin still follows the app')
  assert.equal(ra.getAttribute('dir'), 'rtl')
  assert.equal(rb.getAttribute('dir'), 'ltr')
  assert.equal(a.i18n.envelopeLang(), 'en')
  assert.equal(b.i18n.envelopeLang(), 'zh')
  assert.equal(b.i18n.t('common.langProbe'), 'zh')
  // the app goes Arabic: the docs plugin follows, the chat pin stays
  b.settings.set({ language: 'auto' })
  sdk.locale.set('ar')
  b.localeChanged()
  await tick(0)
  assert.equal(b.i18n.locale(), 'ar')
  assert.equal(rb.getAttribute('dir'), 'rtl')
  a.settings.set({ language: 'en' })
  await tick(0)
  assert.equal(ra.getAttribute('dir'), 'ltr')
  assert.equal(rb.getAttribute('dir'), 'rtl')
  a.dispose()
  b.dispose()
  ra.remove()
  rb.remove()
  sdk.locale.set('zh')
})

test('roots added later get dir; disposing one plugin stops only its sync', { skip: BOTH }, async () => {
  sdk.locale.set('zh')
  const a = install(chat, 'diple')
  const b = install(docs, 'diple-docs')
  a.settings.set({ language: 'ar' })
  b.settings.set({ language: 'ar' })
  const late = root('diple')
  const lateDocs = root('diple-docs')
  await tick(0)
  assert.equal(late.getAttribute('dir'), 'rtl', 'a portal / new root of the chat plugin')
  assert.equal(lateDocs.getAttribute('dir'), 'rtl')
  a.dispose()
  const afterA = root('diple')
  const afterB = root('diple-docs')
  await tick(0)
  assert.equal(afterA.getAttribute('dir'), null, 'disposed: no observer left')
  assert.equal(afterB.getAttribute('dir'), 'rtl', 'the other plugin is untouched')
  a.settings.set({ language: 'en' })
  await tick(0)
  assert.equal(late.getAttribute('dir'), 'rtl', 'no settings subscription left either')
  b.dispose()
  for (const el of [late, lateDocs, afterA, afterB]) el.remove()
})

test('auto: a host locale the plugins do not ship → en; zh-hant → envelope zh', () => {
  for (const mod of MODS) {
    const a = install(mod, mod.id)
    sdk.locale.set('ko')
    assert.equal(a.i18n.locale(), 'en')
    sdk.locale.set('zh-hant')
    assert.equal(a.i18n.locale(), 'zh-hant')
    assert.equal(a.i18n.envelopeLang(), 'zh')
    assert.equal(a.i18n.lang(), 'zh')
    assert.equal(a.i18n.t('no.such.key'), 'no.such.key')
    a.dispose()
  }
  sdk.locale.set('zh')
})

test('an older host without ctx.i18n: the pin, else navigator.language, else en — t and useT both work', async () => {
  for (const mod of MODS) {
    const a = install(mod, 'old-host', { i18n: false })
    const nav = Object.getOwnPropertyDescriptor(w.navigator, 'language')
    Object.defineProperty(w.navigator, 'language', { value: 'fr-FR', configurable: true })
    try {
      assert.equal(a.i18n.locale(), 'fr')
      assert.equal(a.i18n.t('common.langProbe'), 'fr')
      a.settings.set({ language: 'ja' })
      assert.equal(a.i18n.t('common.langProbe'), 'ja')
      const el = document.createElement('div')
      document.body.append(el)
      const r = createRoot(el)
      function Probe() {
        const t = a.i18n.useT()
        return createElement('span', { 'data-dir': a.i18n.useDir() }, t('common.langProbe'))
      }
      await act(async () => r.render(createElement(Probe)))
      assert.equal(el.textContent, 'ja')
      await act(async () => a.settings.set({ language: 'ar' }))
      assert.equal(el.textContent, 'ar')
      assert.equal(el.firstChild.getAttribute('data-dir'), 'rtl')
      await act(async () => r.unmount())
      el.remove()
    } finally {
      if (nav) Object.defineProperty(w.navigator, 'language', nav)
      else delete w.navigator.language
    }
    a.dispose()
  }
})

test('settings: invalid values → defaults; set persists, then notifies once with a stable snapshot', () => {
  const DEFAULTS = { diple: { enabled: true, language: 'auto', selectionButton: true, marksQuiet: false, marksKeepSent: true }, 'diple-docs': { language: 'auto', autoCard: true } }
  for (const [mod, defaults] of MODS.map((m) => [m, DEFAULTS[m.id]])) {
    const storage = memoryStorage({ settings: { language: 'xx', enabled: 'yes', autoCard: 1, marksQuiet: null, extra: 1 } })
    const s = mod.createSettings(storage)
    assert.deepEqual(s.get(), defaults)
    assert.equal(s.get(), s.get(), 'the same snapshot until a set')
    const seen = []
    const off = s.subscribe((v) => seen.push([v, storage.map.get('settings')]))
    s.set({ language: 'de' })
    assert.equal(seen.length, 1)
    assert.equal(seen[0][0], s.get())
    assert.deepEqual(seen[0][1], s.get(), 'persisted before listeners run')
    off()
    s.set({ language: 'es' })
    assert.equal(seen.length, 1, 'unsubscribed')
    // a fresh store reads what was persisted
    assert.equal(mod.createSettings(storage).get().language, 'es')
  }
})

test('settings: the host storage returns its fallback for corrupt JSON → defaults; a throwing adapter is not swallowed (unchanged)', () => {
  for (const mod of MODS) {
    // ctx.storage.get of the host (apps/desktop/src/contrib/plugin.ts) never throws: corrupt → fallback
    const corrupt = { get: (k, d) => d, set() {}, remove() {} }
    assert.equal(mod.createSettings(corrupt).get().language, 'auto')
    // a storage that throws on write: the error reaches the caller, listeners are not told
    const store = { get: (k, d) => d, set() { throw new Error('quota') }, remove() {} }
    const s = mod.createSettings(store)
    let told = 0
    s.subscribe(() => told++)
    assert.throws(() => s.set({ language: 'de' }), /quota/)
    assert.equal(told, 0)
    assert.equal(s.get().language, 'de', 'the in-memory value already moved (as today)')
  }
})
