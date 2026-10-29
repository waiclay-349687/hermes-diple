// R11-L: the send menu's Esc, from the R11e review (menu-probe.mjs) as tests.
//   XR11e-03: the stack of open menus is shared between bundles (each plugin
//             bundles the kit): on window[Symbol.for('diple.desktop-kit.menus')],
//             one document listener, one Esc closes only the top menu.
//   XR11e-04: an Esc that ends an IME composition is the IME's, not the menu's.
//   XR11e-05: an Esc whose focus is in a host modal that does not contain the menu
//             is the host's (ADR 0014, supplement).
// Two independent ESM instances of send-menu.js stand for the two plugin bundles.
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
for (const k of ['window', 'document', 'navigator', 'MutationObserver', 'HTMLElement', 'Node']) Object.defineProperty(globalThis, k, { value: k === 'window' ? dom.window : dom.window[k], configurable: true, writable: true })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { act, createElement: h } = React
const url = pathToFileURL(path.join(ROOT, 'packages/desktop-kit/src/send-menu.js')).href
const A = await import(url + '?bundle=chat')
const B = await import(url + '?bundle=docs')
const W = dom.window
const KEY = Symbol.for('diple.desktop-kit.menus')
const sections = [{ key: 'x', items: [{ key: 'a', label: 'a', onSelect() {} }] }]

/** Menus a (module M1) and b (module M2) open in that order; returns helpers. */
async function two(M1, M2) {
  const el = document.createElement('div')
  document.body.append(el)
  const root = createRoot(el)
  const log = []
  const open = { a: true, b: false }
  const render = () =>
    root.render(h(React.Fragment, null,
      open.a && h(M1.SendMenu, { label: 'a', attrs: { 'data-m': 'a' }, sections, onClose: (r) => (log.push('a:' + r), (open.a = false), render()) }),
      open.b && h(M2.SendMenu, { label: 'b', attrs: { 'data-m': 'b' }, sections, onClose: (r) => (log.push('b:' + r), (open.b = false), render()) })))
  await act(async () => render())
  await act(async () => ((open.b = true), render()))
  const left = () => [...el.querySelectorAll('[data-send-menu]')].map((m) => m.getAttribute('data-m'))
  const done = async () => (await act(async () => root.unmount()), el.remove())
  return { log, left, done, el }
}
const esc = (more = {}) => new W.KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true, ...more })

test('XR11e-03: two bundles share one stack — Esc closes only the top menu (b), a stays; the next Esc closes a', async () => {
  for (const [M1, M2, what] of [[A, A, 'same bundle'], [A, B, 'two bundles'], [B, A, 'two bundles, docs first']]) {
    const t = await two(M1, M2)
    try {
      assert.equal(W[KEY]?.length, 2, what)
      const e = esc()
      await act(async () => document.activeElement.dispatchEvent(e))
      assert.deepEqual(t.log, ['b:escape'], what)
      assert.deepEqual(t.left(), ['a'], what)
      assert.ok(e.defaultPrevented)
      await act(async () => document.activeElement.dispatchEvent(esc()))
      assert.deepEqual(t.log, ['b:escape', 'a:escape'], what)
      assert.equal(W[KEY].length, 0)
    } finally {
      await t.done()
    }
  }
})

test('XR11e-03: one document Esc listener for both bundles, registered by the first opener; an outer listener never sees a handled Esc', async () => {
  const added = []
  const orig = document.addEventListener
  document.addEventListener = function (type, fn, opts) {
    if (type === 'keydown') added.push(fn)
    return orig.call(this, type, fn, opts)
  }
  const outer = []
  const outerEsc = (e) => e.key === 'Escape' && outer.push('outer')
  orig.call(document, 'keydown', outerEsc)
  let t
  try {
    t = await two(A, B)
    assert.equal(added.length, 1, 'one listener for the two bundles')
    await act(async () => document.body.dispatchEvent(esc()))
    assert.deepEqual(t.log, ['b:escape'])
    assert.deepEqual(outer, [], 'stopImmediatePropagation')
  } finally {
    document.addEventListener = orig
    document.removeEventListener('keydown', outerEsc)
    await t?.done()
  }
})

test('XR11e-04: Esc during an IME composition (isComposing / keyCode 229) is left alone: not prevented, no menu closes', async () => {
  const t = await two(A, B)
  try {
    for (const more of [{ isComposing: true, keyCode: 229 }, { isComposing: true }, { keyCode: 229 }]) {
      const e = esc(more)
      await act(async () => document.activeElement.dispatchEvent(e))
      assert.equal(e.defaultPrevented, false, JSON.stringify(more))
      assert.deepEqual(t.log, [])
      assert.deepEqual(t.left(), ['a', 'b'])
    }
    await act(async () => document.activeElement.dispatchEvent(esc()))
    assert.deepEqual(t.log, ['b:escape'], 'composition over: Esc is the menu’s again')
  } finally {
    await t.done()
  }
})

test('XR11e-05: focus in a host modal that does not contain the menu → the host handles Esc, the menus stay', async () => {
  const t = await two(A, B)
  const host = document.createElement('div')
  const hostSeen = []
  const listener = (e) => e.key === 'Escape' && hostSeen.push(e.defaultPrevented ? 'prevented' : 'escape')
  try {
    for (const attrs of [{ role: 'dialog', 'aria-modal': 'true' }, { role: 'dialog' }, { 'aria-modal': 'true' }]) {
      for (const n of [...host.getAttributeNames()]) host.removeAttribute(n)
      for (const [k, v] of Object.entries(attrs)) host.setAttribute(k, v)
      host.innerHTML = '<input>'
      document.body.append(host)
      document.addEventListener('keydown', listener)
      host.firstChild.focus()
      const e = esc()
      await act(async () => host.firstChild.dispatchEvent(e))
      document.removeEventListener('keydown', listener)
      assert.equal(e.defaultPrevented, false, JSON.stringify(attrs))
      assert.deepEqual(hostSeen.splice(0), ['escape'], JSON.stringify(attrs))
      assert.deepEqual(t.log, [])
      assert.deepEqual(t.left(), ['a', 'b'])
    }
    // a dialog that contains the menu is the menu's own context: Esc closes the menu
    host.remove()
    host.setAttribute('role', 'dialog')
    host.innerHTML = ''
    document.body.append(host)
    host.append(t.el)
    t.el.querySelector('[data-m="b"] [data-send-item]').focus()
    await act(async () => document.activeElement.dispatchEvent(esc()))
    assert.deepEqual(t.log, ['b:escape'])
  } finally {
    await t.done()
    host.remove()
  }
})

test('XR11e-05 boundary (recorded, not guaranteed): a host capture listener registered first runs before the menu closes', async () => {
  const order = []
  const hostCapture = (e) => e.key === 'Escape' && order.push('host-capture')
  document.addEventListener('keydown', hostCapture, true) // before any menu has opened (stack empty → no menu listener yet)
  const t = await two(A, B)
  try {
    assert.equal(W[KEY].length, 2)
    const n = t.log.length
    const e = esc()
    await act(async () => document.activeElement.dispatchEvent(e))
    order.push(...t.log.slice(n))
    // today's order: the host's earlier capture listener sees the Esc first; then the menu
    // closes b and swallows the event. The menu cannot change this (ADR 0014, supplement).
    assert.deepEqual(order, ['host-capture', 'b:escape'])
    assert.ok(e.defaultPrevented)
  } finally {
    document.removeEventListener('keydown', hostCapture, true)
    await t.done()
  }
})
