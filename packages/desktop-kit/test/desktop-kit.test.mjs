// packages/desktop-kit (D1 L1, ADR 0009) through its own interface:
// createLocaleRuntime and createSettingsStore with plain data, the host SDK
// stubbed (or missing). The plugins' wiring of it is covered in
// tests/desktop/locale-runtime.test.mjs and i18n-locales.test.mjs.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
for (const k of ['window', 'document', 'navigator', 'MutationObserver', 'HTMLElement', 'Node']) Object.defineProperty(globalThis, k, { value: k === 'window' ? dom.window : dom.window[k], configurable: true, writable: true })
globalThis.IS_REACT_ACT_ENVIRONMENT = true

/** The kit bundled the plugins' way, against an SDK module (the stub, or one without exports). */
async function kitWith(sdkSource) {
  fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true })
  const dir = fs.mkdtempSync(path.join(ROOT, 'dist', '.kit-test-'))
  const sdk = path.join(dir, 'sdk.mjs')
  fs.writeFileSync(sdk, sdkSource)
  const out = path.join(dir, 'kit.mjs')
  await build({ entryPoints: [path.join(ROOT, 'packages/desktop-kit/src/index.js')], bundle: true, format: 'esm', platform: 'node', outfile: out, alias: { '@hermes/plugin-sdk': sdk }, external: ['react'], logLevel: 'silent' })
  process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }))
  return import(pathToFileURL(out).href)
}
const kit = await kitWith("export function usePluginI18n(id) { return (k) => 'host:' + id + ':' + k }\n")
const bare = await kitWith('export const nothing = 1\n') // an older host: no usePluginI18n
const React = await import('react')
const { createRoot } = await import('react-dom/client')

const LOCALES = kit.mergeBundles(
  { common: { zh: { langProbe: 'zh', hi: '你好' }, en: { langProbe: 'en', hi: 'hi', n: (n) => `${n} items` } } },
  { ar: { common: { langProbe: 'ar', hi: 'مرحبا' } }, ja: { common: { langProbe: 'ja' } } }
)
const settingsOf = (language = 'auto') => kit.createSettingsStore({ get: (k, d) => (k === 'settings' ? { language } : d), set() {} }, (raw) => ({ language: kit.LANGUAGE_SETTINGS.includes(raw?.language) ? raw.language : 'auto' }))
function hostCtx(appLocale = () => 'zh') {
  const disposers = []
  const subs = new Set()
  let bundles = {}
  return {
    ctx: {
      onDispose: (fn) => disposers.push(fn),
      i18n: { register: (b) => (bundles = b), t: (key) => kit.translateIn(bundles, appLocale(), key), onLocaleChange: (fn) => (subs.add(fn), () => subs.delete(fn)) }
    },
    changed: () => subs.forEach((f) => f()),
    dispose: () => disposers.splice(0).forEach((f) => f()),
    subs
  }
}

test('translateIn: the locale, else en, else the key; functions get the args; mergeBundles keeps namespaces', () => {
  assert.equal(kit.translateIn(LOCALES, 'ja', 'common.hi'), 'hi')
  assert.equal(kit.translateIn(LOCALES, 'ar', 'common.hi'), 'مرحبا')
  assert.equal(kit.translateIn(LOCALES, 'zh', 'common.n', [3]), '3 items')
  assert.equal(kit.translateIn(LOCALES, 'xx', 'no.key'), 'no.key')
  assert.deepEqual(Object.keys(LOCALES).sort(), ['ar', 'en', 'ja', 'zh'])
  assert.deepEqual(kit.messageKeys(LOCALES.en).sort(), ['common.hi', 'common.langProbe', 'common.n'])
})

test('locale policy: ids, endonyms, RTL, envelope language, BCP-47 tags', () => {
  assert.deepEqual(kit.LOCALE_IDS, ['en', 'zh', 'zh-hant', 'ja', 'ar', 'ru', 'fr', 'de', 'es'])
  assert.equal(kit.dirOf('ar'), 'rtl')
  assert.equal(kit.dirOf('he'), 'ltr', 'only what we ship')
  assert.equal(kit.envelopeLangOf('zh-hant'), 'zh')
  assert.equal(kit.envelopeLangOf('ja'), 'en')
  assert.equal(kit.localeFromTag('zh-TW'), 'zh-hant')
  assert.equal(kit.localeFromTag('pt-BR'), null)
  assert.deepEqual(kit.languageOptions('Auto')[0], { id: 'auto', label: 'Auto' })
  assert.deepEqual(kit.languageOptions('Auto').find((o) => o.id === 'ar'), { id: 'ar', label: 'العربية', lang: 'ar', dir: 'rtl' })
})

test('runtime: two runtimes are independent; a pin wins; dispose ends the observer and the subscriptions', async () => {
  const h1 = hostCtx()
  const h2 = hostCtx()
  const s1 = settingsOf('ar')
  const s2 = settingsOf()
  const a = kit.createLocaleRuntime(h1.ctx, s1, { pluginId: 'one', locales: LOCALES, roots: '[data-one]' })
  const b = kit.createLocaleRuntime(h2.ctx, s2, { pluginId: 'two', locales: LOCALES, roots: '[data-two]' })
  const r1 = document.createElement('div')
  r1.setAttribute('data-one', '')
  const r2 = document.createElement('div')
  r2.setAttribute('data-two', '')
  document.body.append(r1, r2)
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(r1.getAttribute('dir'), 'rtl')
  assert.equal(r2.getAttribute('dir'), 'ltr')
  assert.equal(a.t('common.hi'), 'مرحبا', 'pinned: translated from the bundles')
  assert.equal(b.t('common.hi'), '你好', 'auto: the host translates')
  assert.equal(a.lang(), 'en')
  assert.equal(b.envelopeLang(), 'zh')
  assert.equal(h1.subs.size, 1)
  h1.dispose()
  assert.equal(h1.subs.size, 0, 'host locale subscription ended')
  const late = document.createElement('div')
  late.setAttribute('data-one', '')
  document.body.append(late)
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(late.getAttribute('dir'), null, 'no observer after dispose')
  h2.dispose()
  for (const el of [r1, r2, late]) el.remove()
})

test('runtime on an older host: no ctx.i18n → translates itself; no SDK usePluginI18n → useT is t', async () => {
  const s = settingsOf()
  const nav = Object.getOwnPropertyDescriptor(globalThis.navigator, 'language')
  Object.defineProperty(globalThis.navigator, 'language', { value: 'ar-EG', configurable: true })
  try {
    const i = bare.createLocaleRuntime({}, s, { pluginId: 'p', locales: LOCALES, roots: '[data-p]' })
    assert.equal(i.locale(), 'ar')
    assert.equal(i.t('common.hi'), 'مرحبا')
    assert.equal(i.onLocaleChange(() => {}), undefined)
    // with a host i18n but an SDK without usePluginI18n: useT falls back to t
    const h = hostCtx(() => 'zh')
    const j = bare.createLocaleRuntime(h.ctx, s, { pluginId: 'p', locales: LOCALES, roots: '[data-p]' })
    const el = document.createElement('div')
    document.body.append(el)
    const root = createRoot(el)
    function Probe() {
      return React.createElement('b', null, j.useT()('common.hi'))
    }
    await React.act(async () => root.render(React.createElement(Probe)))
    assert.equal(el.textContent, '你好')
    await React.act(async () => root.unmount())
    el.remove()
    h.dispose()
  } finally {
    if (nav) Object.defineProperty(globalThis.navigator, 'language', nav)
    else delete globalThis.navigator.language
  }
})

test('runtime with the SDK hook: useT uses the host hook unless pinned', async () => {
  const s = kit.createSettingsStore({ get: (k, d) => d, set() {} }, (raw) => ({ language: kit.LANGUAGE_SETTINGS.includes(raw?.language) ? raw.language : 'auto' }))
  const h = hostCtx()
  const i = kit.createLocaleRuntime(h.ctx, s, { pluginId: 'p', locales: LOCALES, roots: '[data-p]' })
  const el = document.createElement('div')
  document.body.append(el)
  const root = createRoot(el)
  function Probe() {
    return React.createElement('b', null, i.useT()('common.hi'))
  }
  await React.act(async () => root.render(React.createElement(Probe)))
  assert.equal(el.textContent, 'host:p:common.hi')
  await React.act(async () => s.set({ language: 'ar' }))
  assert.equal(el.textContent, 'مرحبا')
  await React.act(async () => root.unmount())
  el.remove()
  h.dispose()
})

test('settings store: normalize on read and on every set; persisted before subscribers; storage that throws is not swallowed', () => {
  const writes = []
  const st = kit.createSettingsStore({ get: (k, d) => ({ language: 'nope', x: 1 }), set: (k, v) => writes.push([k, v]) }, (raw) => ({ language: raw?.language === 'de' ? 'de' : 'auto' }))
  assert.deepEqual(st.get(), { language: 'auto' })
  const seen = []
  st.subscribe((v) => seen.push([v, writes.length]))
  st.set({ language: 'de' })
  assert.deepEqual(writes, [['settings', { language: 'de' }]])
  assert.deepEqual(seen, [[{ language: 'de' }, 1]])
  const bad = kit.createSettingsStore({ get: (k, d) => d, set() { throw new Error('quota') } }, (raw) => ({ language: raw?.language ?? 'auto' }))
  let told = 0
  bad.subscribe(() => told++)
  assert.throws(() => bad.set({ language: 'fr' }), /quota/)
  assert.equal(told, 0)
})

// V2.1 #8: the send menu's behaviour (both plugins open it)
test('SendMenu: focus on the default item, arrows move, a scope keeps it open, a target selects and closes; Esc closes', async () => {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { act, createElement: h } = React
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const log = []
  let scope = 'all'
  const render = () =>
    root.render(
      h(kit.SendMenu, {
        label: '发送',
        attrs: { 'data-x': '' },
        onClose: (why) => log.push('close'),
        sections: [
          { key: 'scope', title: '范围', items: [{ key: 'one', label: '这一条', checked: scope === 'one', keep: true, onSelect: () => ((scope = 'one'), log.push('scope:one'), render()) }, { key: 'all', label: '全部', checked: scope === 'all', keep: true, onSelect: () => log.push('scope:all') }] },
          { key: 'to', title: '发送到', items: [{ key: 's1', label: '当前会话', default: true, onSelect: () => log.push('to:s1') }, { key: 's2', label: '另一个', onSelect: () => log.push('to:s2') }, { key: 'off', label: '不可用', disabled: true, onSelect: () => log.push('nope') }] }
        ]
      })
    )
  await act(async () => render())
  const menu = host.querySelector('[data-send-menu]')
  assert.equal(menu.getAttribute('role'), 'menu')
  assert.ok(menu.hasAttribute('data-x'))
  assert.equal(document.activeElement.getAttribute('data-send-item'), 's1', 'the default target has focus')
  assert.deepEqual([...menu.querySelectorAll('[role="menuitemradio"]')].map((b) => [b.getAttribute('data-send-item'), b.getAttribute('aria-checked')]), [['one', 'false'], ['all', 'true']])
  const key = (k) => act(async () => document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })))
  await key('ArrowDown')
  assert.equal(document.activeElement.getAttribute('data-send-item'), 's2', 'disabled items are skipped')
  await key('ArrowDown')
  assert.equal(document.activeElement.getAttribute('data-send-item'), 'one', 'wraps')
  await act(async () => menu.querySelector('[data-send-item="one"]').click())
  assert.deepEqual(log, ['scope:one'], 'a scope does not close')
  assert.equal(host.querySelector('[data-send-item="one"]').getAttribute('aria-checked'), 'true')
  await act(async () => host.querySelector('[data-send-item="off"]').click())
  assert.deepEqual(log, ['scope:one'], 'disabled does nothing')
  await act(async () => host.querySelector('[data-send-item="s2"]').click())
  assert.deepEqual(log, ['scope:one', 'to:s2', 'close'])
  host.querySelector('[data-send-item="s1"]').focus()
  await key('Escape')
  assert.equal(log.at(-1), 'close')
  await act(async () => document.body.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true })))
  assert.equal(log.filter((x) => x === 'close').length, 3, 'a click outside closes')
  await act(async () => root.unmount())
  host.remove()
})

// R11-K: onClose says why; Esc is caught on the document wherever focus is, and swallowed
test('SendMenu: onClose(reason) — select, escape, tab, outside, scroll; Esc with focus on <body> closes; an outer Esc listener never sees it', async () => {
  const { act, createElement: h } = React
  const W = document.defaultView
  const list = document.createElement('div')
  list.style.overflow = 'auto'
  const wrap = document.createElement('span')
  list.append(wrap)
  document.body.append(list)
  const root = createRoot(wrap)
  const reasons = []
  const outer = []
  const outerEsc = (e) => e.key === 'Escape' && outer.push(e.target.tagName)
  document.addEventListener('keydown', outerEsc)
  list.addEventListener('keydown', outerEsc)
  let open = true
  const render = () =>
    root.render(open ? h(kit.SendMenu, { label: 'x', onClose: (why) => ((reasons.push(why), (open = false)), render()), sections: [{ key: 'to', items: [{ key: 'a', label: 'A', onSelect() {} }, { key: 'off', label: 'Off', disabled: true, onSelect() {} }] }] }) : null)
  const reopen = () => act(async () => ((open = true), render()))
  const keyOn = (el, k) => act(async () => el.dispatchEvent(new W.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })))
  try {
    await reopen()
    await act(async () => wrap.querySelector('[data-send-item="a"]').click())
    await reopen()
    await keyOn(document.activeElement, 'Escape')
    await reopen()
    await keyOn(document.activeElement, 'Tab')
    await reopen()
    await act(async () => document.body.dispatchEvent(new W.MouseEvent('mousedown', { bubbles: true })))
    await reopen()
    // the scroll reason fires only for a menu that left its box
    wrap.querySelector('[data-send-menu]').setAttribute('data-fixed', '')
    await act(async () => list.dispatchEvent(new W.Event('scroll')))
    assert.deepEqual(reasons, ['select', 'escape', 'tab', 'outside', 'scroll'])
    // focus left the menu (a press on a disabled item lands on <body>): Esc still closes it
    await reopen()
    document.activeElement.blur()
    assert.equal(document.activeElement, document.body)
    const esc = new W.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    await act(async () => document.body.dispatchEvent(esc))
    assert.equal(reasons.at(-1), 'escape')
    assert.equal(wrap.querySelector('[data-send-menu]'), null, 'closed')
    assert.ok(esc.defaultPrevented)
    assert.deepEqual(outer, [], 'no Esc reached a listener under the menu (the list, the document)')
    // closed: Esc goes through again
    await keyOn(document.body, 'Escape')
    assert.deepEqual(outer, ['BODY'])
    assert.equal(reasons.length, 6)
  } finally {
    document.removeEventListener('keydown', outerEsc)
    list.removeEventListener('keydown', outerEsc)
    await act(async () => root.unmount())
    list.remove()
  }
})

test('SendMenu: a scrolling box that would cut it both ways → fixed at the trigger, inside the window; it closes when that box scrolls', async () => {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { act, createElement: h } = React
  const W = document.defaultView
  const box = (top, left, height, width) => ({ top, left, bottom: top + height, right: left + width, width, height, x: left, y: top, toJSON() {} })
  // a list (overflow auto) 300..500; the trigger at 380; the menu 260 tall would leave it below and above
  const list = document.createElement('div')
  list.style.overflow = 'auto'
  const wrap = document.createElement('span')
  wrap.style.position = 'relative'
  list.append(wrap)
  document.body.append(list)
  const proto = W.HTMLElement.prototype
  const real = proto.getBoundingClientRect
  proto.getBoundingClientRect = function () {
    if (this === list) return box(300, 0, 200, 400)
    if (this === wrap) return box(380, 360, 20, 20)
    if (this.hasAttribute?.('data-send-menu')) return this.style.position === 'fixed' ? box(parseFloat(this.style.top), parseFloat(this.style.left), 260, 220) : this.hasAttribute('data-up') ? box(116, 160, 260, 220) : box(404, 160, 260, 220)
    return real.call(this)
  }
  const ih = W.innerHeight
  Object.defineProperty(W, 'innerHeight', { configurable: true, value: 768 })
  const root = createRoot(wrap)
  let closed = 0
  try {
    await act(async () => root.render(h(kit.SendMenu, { label: 'x', onClose: () => closed++, sections: [{ key: 'to', items: [{ key: 'a', label: 'A', onSelect() {} }] }] })))
    const menu = wrap.querySelector('[data-send-menu]')
    assert.ok(menu.hasAttribute('data-fixed'), 'left the list')
    assert.equal(menu.style.position, 'fixed')
    assert.equal(menu.style.top, '404px', 'under the trigger: the window has room')
    assert.equal(menu.style.left, '160px', 'end edges aligned')
    await act(async () => list.dispatchEvent(new W.Event('scroll')))
    assert.equal(closed, 1, 'the list scrolled: closed')
  } finally {
    await act(async () => root.unmount())
    proto.getBoundingClientRect = real
    Object.defineProperty(W, 'innerHeight', { configurable: true, value: ih })
    list.remove()
  }
})

test('SendMenu: a menu that would run past the right edge of the window (RTL, trigger at the edge) is moved back inside', async () => {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { act, createElement: h } = React
  const W = document.defaultView
  const wrap = document.createElement('span')
  wrap.dir = 'rtl'
  document.body.append(wrap)
  const proto = W.HTMLElement.prototype
  const real = proto.getBoundingClientRect
  const iw = W.innerWidth
  proto.getBoundingClientRect = function () {
    if (this.hasAttribute?.('data-send-menu')) {
      const dx = parseFloat(this.style.translate || '0') || 0
      return { top: 100, bottom: 160, left: iw - 100 + dx, right: iw + 120 + dx, width: 220, height: 60, x: iw - 100 + dx, y: 100, toJSON() {} }
    }
    return real.call(this)
  }
  const root = createRoot(wrap)
  try {
    await act(async () => root.render(h(kit.SendMenu, { label: 'x', onClose() {}, sections: [{ key: 'to', items: [{ key: 'a', label: 'A', onSelect() {} }] }] })))
    const menu = wrap.querySelector('[data-send-menu]')
    const r = menu.getBoundingClientRect()
    assert.ok(r.right <= iw - 4 + 0.5 && r.left >= 4, `inside the window: ${r.left}..${r.right} of ${iw}`)
  } finally {
    await act(async () => root.unmount())
    proto.getBoundingClientRect = real
    wrap.remove()
  }
})
