// V3-D: the panel resize handle (desktop-kit ResizeHandle, research B §6.1 B1)
// through its interface: drag → live widths then one commit, a click
// collapses, a double click restores the default, drag below the collapse
// line collapses, the keyboard steps 16px, RTL mirrors the direction.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
for (const k of ['window', 'document', 'navigator', 'MutationObserver', 'HTMLElement', 'Node', 'getComputedStyle']) Object.defineProperty(globalThis, k, { value: k === 'window' ? dom.window : dom.window[k], configurable: true, writable: true })
globalThis.IS_REACT_ACT_ENVIRONMENT = true

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true })
const dir = fs.mkdtempSync(path.join(ROOT, 'dist', '.kit-resize-'))
fs.writeFileSync(path.join(dir, 'sdk.mjs'), 'export const nothing = 1\n')
await build({ entryPoints: [path.join(ROOT, 'packages/desktop-kit/src/index.js')], bundle: true, format: 'esm', platform: 'node', outfile: path.join(dir, 'kit.mjs'), alias: { '@hermes/plugin-sdk': path.join(dir, 'sdk.mjs') }, external: ['react'], logLevel: 'silent' })
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }))
const kit = await import(pathToFileURL(path.join(dir, 'kit.mjs')).href)
const React = await import('react')
const { act } = React
const { createRoot } = await import('react-dom/client')

const W = dom.window
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))

test('resizeWidth: the panel on the inline end grows as the pointer moves toward the content; RTL mirrors; clamped', () => {
  const o = { min: 260, max: 560 }
  assert.equal(kit.resizeWidth({ start: 340, dx: -40, ...o }), 380)
  assert.equal(kit.resizeWidth({ start: 340, dx: 40, ...o }), 300)
  assert.equal(kit.resizeWidth({ start: 340, dx: 40, rtl: true, ...o }), 380)
  assert.equal(kit.resizeWidth({ start: 340, dx: -900, ...o }), 560)
  assert.equal(kit.resizeWidth({ start: 340, dx: 900, ...o }), 260)
  assert.equal(kit.resizeWidth({ start: 340, dx: 250, raw: true, ...o }), 90, 'raw: unclamped, for the collapse test')
})

async function mount(props = {}) {
  const calls = { live: [], commit: [], collapse: 0 }
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  const render = (p) =>
    act(async () =>
      root.render(
        React.createElement(kit.ResizeHandle, {
          width: 340,
          min: 260,
          max: 560,
          def: 340,
          collapseBelow: 156,
          label: 'resize',
          onLive: (w) => calls.live.push(w),
          onCommit: (w) => calls.commit.push(w),
          onCollapse: () => calls.collapse++,
          ...props,
          ...p
        })
      )
    )
  await render()
  const handle = el.querySelector('[role="separator"]')
  const ptr = (type, x) => act(async () => handle.dispatchEvent(new W.MouseEvent(type, { bubbles: true, clientX: x, button: 0 })))
  return { el, handle, calls, ptr, render, unmount: () => act(async () => root.unmount()) }
}

test('a separator with its value and range, keyboard focusable', async () => {
  const m = await mount()
  assert.equal(m.handle.getAttribute('aria-orientation'), 'vertical')
  assert.equal(m.handle.getAttribute('aria-valuenow'), '340')
  assert.equal(m.handle.getAttribute('aria-valuemin'), '260')
  assert.equal(m.handle.getAttribute('aria-valuemax'), '560')
  assert.equal(m.handle.getAttribute('aria-label'), 'resize')
  assert.equal(m.handle.tabIndex, 0)
  await m.unmount()
})

test('drag: live widths while moving, one commit on release', async () => {
  const m = await mount()
  await m.ptr('pointerdown', 500)
  await m.ptr('pointermove', 480)
  await m.ptr('pointermove', 440)
  await act(async () => tick(40))
  await m.ptr('pointerup', 440)
  assert.ok(m.calls.live.length >= 1 && m.calls.live.at(-1) === 400, JSON.stringify(m.calls.live))
  assert.deepEqual(m.calls.commit, [400])
  assert.equal(m.calls.collapse, 0)
  await m.unmount()
})

test('drag below the collapse line collapses instead of committing a width', async () => {
  const m = await mount()
  await m.ptr('pointerdown', 500)
  await m.ptr('pointermove', 700)
  await m.ptr('pointerup', 700)
  assert.equal(m.calls.collapse, 1)
  assert.deepEqual(m.calls.commit, [])
  await m.unmount()
})

test('a click (moved ≤ 4px) collapses; a double click restores the default width instead', async () => {
  const m = await mount({ width: 480 })
  await m.ptr('pointerdown', 500)
  await m.ptr('pointerup', 503)
  await act(async () => tick(320))
  assert.equal(m.calls.collapse, 1)
  await m.ptr('pointerdown', 500)
  await m.ptr('pointerup', 500)
  await m.ptr('pointerdown', 500)
  await m.ptr('pointerup', 500)
  await act(async () => tick(320))
  assert.equal(m.calls.collapse, 1, 'the double click did not collapse')
  assert.deepEqual(m.calls.commit, [340])
  await m.unmount()
})

test('keyboard: ← widens and → narrows by 16px (mirrored in RTL), Enter collapses', async () => {
  const m = await mount()
  const key = (k) => act(async () => m.handle.dispatchEvent(new W.KeyboardEvent('keydown', { key: k, bubbles: true })))
  await key('ArrowLeft')
  await key('ArrowRight')
  assert.deepEqual(m.calls.commit, [356, 324])
  await key('Enter')
  assert.equal(m.calls.collapse, 1)
  m.el.setAttribute('dir', 'rtl')
  m.el.style.direction = 'rtl'
  await key('ArrowLeft')
  assert.equal(m.calls.commit.at(-1), 324, 'RTL: ← narrows')
  await m.unmount()
})

test('RESIZE_HANDLE_CSS: host tokens only, a col-resize cursor, motion off under reduced motion', () => {
  const css = kit.RESIZE_HANDLE_CSS
  assert.match(css, /cursor:\s*col-resize/)
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|\brgba?\(/)
  assert.match(css, /prefers-reduced-motion/)
})
