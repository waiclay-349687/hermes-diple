// V2-T: the selection toolbar (design §2.3). Driven directly, no plugin build:
// it is a plain-DOM module with injected rules.
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'

import { setupDom } from './harness.mjs'

const w = setupDom(`<!doctype html><html><head></head><body>
<div id="msg"><p id="p">先更新数据库，再删除缓存。第二句话在这里。</p></div>
<div id="menu">复制</div>
</body></html>`)
const { installSelectionToolbar } = await import('../../plugins/diple/desktop/src/capture/selection-toolbar/index.js')

const textNode = () => document.getElementById('p').firstChild
function select(from = 0, to = 6) {
  const r = document.createRange()
  r.setStart(textNode(), from)
  r.setEnd(textNode(), to)
  const s = document.getSelection()
  s.removeAllRanges()
  s.addRange(r)
  document.dispatchEvent(new w.Event('selectionchange'))
}
const mouse = (type, button = 0, target = document.getElementById('p'), extra = {}) =>
  target.dispatchEvent(new w.MouseEvent(type, { bubbles: true, cancelable: true, button, ...extra }))
// A deterministic clock (V3-D2-I): these tests used to wait on the wall clock
// and failed under a loaded full run ("took 337 ms"). Now frames are a queue
// the test flushes ("the next frame comes"), and setTimeout runs on node:test's
// mock timers, advanced by tick(ms). Same meaning, no dependence on load.
const frames = new Map()
let frameId = 0
w.requestAnimationFrame = (fn) => {
  frames.set(++frameId, fn)
  return frameId
}
w.cancelAnimationFrame = (id) => frames.delete(id)
// jsdom also fires its own (trusted) selectionchange for each change, on a real
// timer, so it lands at an arbitrary point of the mock clock and restarts the
// rest timer. select() already sends the event at the moment of the change:
// drop jsdom's echo.
w.addEventListener('selectionchange', (e) => e.isTrusted && e.stopImmediatePropagation(), true)
const realTimeout = globalThis.setTimeout
const settle = async () => {
  await new Promise((r) => realTimeout(r, 0))
  for (let i = 0; i < 5; i++) await Promise.resolve()
}
/** One frame passes: the callbacks queued before it run (not those they queue). */
async function frame() {
  const due = [...frames]
  frames.clear()
  for (const [, fn] of due) fn(0)
  await settle()
}
/** The clock moves `ms` forward: due timers fire in order, and a frame
 *  passes every 16 ms of it (as in a browser). */
async function tick(ms = 0) {
  await settle()
  for (let left = ms; left > 0; left -= 16) {
    mock.timers.tick(Math.min(16, left))
    await settle()
    if (left >= 16) await frame()
  }
  await settle()
}
test.beforeEach(() => {
  frames.clear()
  mock.timers.enable({ apis: ['setTimeout'] })
})
test.afterEach(() => mock.timers.reset())

function install(over = {}) {
  const activated = []
  const tb = installSelectionToolbar({
    doc: document,
    enabled: () => true,
    canCapture: (sel) => !sel.isCollapsed && document.getElementById('msg').contains(sel.anchorNode),
    onActivate: () => activated.push(1),
    label: () => '标注',
    ...over
  })
  return { tb, activated, el: () => document.querySelector('[data-diple-toolbar]'), shown: () => document.querySelector('[data-diple-toolbar]')?.hasAttribute('data-shown') }
}

test('mouse: appears on the frame after the release (no settle delay), not during the drag', async () => {
  const { tb, shown } = install()
  mouse('mousedown')
  select()
  await tick(80)
  assert.equal(shown(), false, 'not while the button is down')
  mouse('mouseup')
  assert.equal(frames.size, 1, 'the release asks for the next frame')
  await frame()
  // the very next frame, with the clock not moved at all: no settle timer.
  // The < 50 ms budget is measured in the real app (tests/e2e/v2t-*.mjs).
  assert.equal(shown(), true, 'up on the frame after the release')
  await tick(10_000)
  assert.equal(shown(), true, 'and no timer takes it down again')
  tb.dispose()
})

test('one button labelled 标注, no keycap (V2.1 #3); clicking it keeps focus and selection, then activates', async () => {
  const { tb, shown, el, activated } = install()
  mouse('mousedown')
  select()
  mouse('mouseup')
  await frame()
  await frame()
  const buttons = el().querySelectorAll('button')
  assert.equal(buttons.length, 1)
  assert.match(buttons[0].textContent, /标注/)
  assert.doesNotMatch(buttons[0].textContent, /⌘|⇧/)
  assert.equal(buttons[0].querySelector('kbd'), null, 'no keycap')
  assert.equal(buttons[0].getAttribute('aria-label'), '标注', 'aria names the action only')
  assert.equal(buttons[0].hasAttribute('title'), false, 'no native title (host DESIGN.md)')
  const md = new w.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })
  buttons[0].dispatchEvent(md)
  assert.equal(md.defaultPrevented, true)
  assert.equal(shown(), true, 'pressing its own button does not hide it')
  buttons[0].click()
  assert.equal(activated.length, 1)
  assert.equal(shown(), false)
  tb.dispose()
})

test('any mouse button pressed hides it at once; a right click never brings it back', async () => {
  const { tb, shown } = install()
  mouse('mousedown')
  select()
  mouse('mouseup')
  await frame()
  await frame()
  assert.equal(shown(), true)
  // right button: the host's context menu opens
  mouse('mousedown', 2)
  assert.equal(shown(), false, 'hidden in the same event, before the menu')
  w.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true }))
  mouse('mouseup', 2)
  await tick(80)
  assert.equal(shown(), false, 'not after the right button is released')
  // clicking a menu item (selection unchanged) does not restore it either
  mouse('mousedown', 0, document.getElementById('menu'))
  mouse('mouseup', 0, document.getElementById('menu'))
  await tick(80)
  assert.equal(shown(), false, 'menu closed: still hidden')
  // the next real selection shows it again
  mouse('mousedown')
  select(2, 8)
  mouse('mouseup')
  await frame()
  await frame()
  assert.equal(shown(), true)
  // ctrl+click (macOS secondary click) behaves like the right button
  mouse('mousedown', 0, document.getElementById('p'), { ctrlKey: true })
  document.getElementById('p').dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  mouse('mouseup', 0, document.getElementById('p'), { ctrlKey: true })
  await tick(80)
  assert.equal(shown(), false)
  tb.dispose()
})

test('keyboard selection: shows once the selection has rested 300 ms', async () => {
  const { tb, shown } = install()
  select(0, 3)
  await tick(150)
  select(0, 5) // still extending: the 300 ms start again
  await tick(299)
  assert.equal(shown(), false, 'still moving')
  await tick(1)
  assert.equal(shown(), true, 'exactly 300 ms after the last change')
  tb.dispose()
})

test('never outside capturable places; hides on Esc, typing, blur, collapse; the switch keeps it off', async () => {
  let ok = false
  const { tb, shown } = install({ canCapture: () => ok })
  mouse('mousedown')
  select()
  mouse('mouseup')
  await tick(80)
  assert.equal(shown(), false, 'canCapture said no')
  ok = true
  const show = async () => {
    mouse('mousedown')
    select()
    mouse('mouseup')
    await tick(80)
    assert.equal(shown(), true)
  }
  await show()
  document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  assert.equal(shown(), false, 'Esc')
  await show()
  document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true }))
  assert.equal(shown(), true, '⌘C keeps it')
  document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'x', bubbles: true }))
  assert.equal(shown(), false, 'typing')
  await show()
  w.dispatchEvent(new w.Event('blur'))
  assert.equal(shown(), false, 'window blur')
  await show()
  document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
  assert.equal(shown(), false, 'V3-T: any key (an arrow) hides it')
  await show()
  document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Shift', bubbles: true }))
  assert.equal(shown(), true, 'a modifier alone keeps it')
  mouse('mousedown')
  document.getSelection().removeAllRanges()
  document.dispatchEvent(new w.Event('selectionchange'))
  mouse('mouseup')
  await tick(80)
  assert.equal(shown(), false, 'a click that collapses it')
  tb.dispose()
  const off = install({ enabled: () => false })
  mouse('mousedown')
  select()
  mouse('mouseup')
  await tick(80)
  assert.equal(off.shown(), false)
  off.tb.dispose()
})

test('V3-T #144421: the host clearing the selection keeps the button, and 标注 gets the Range shown', async () => {
  const got = []
  const { tb, shown } = install({ onActivate: (cur) => got.push(cur) })
  mouse('mousedown')
  select(2, 8)
  mouse('mouseup')
  await frame()
  await frame()
  assert.equal(shown(), true)
  // what the host does about a second later
  document.getSelection().removeAllRanges()
  document.dispatchEvent(new w.Event('selectionchange'))
  await tick(50)
  assert.equal(shown(), true, 'still up after the host collapsed it')
  assert.equal(tb.current()?.range.toString(), '新数据库，再', 'tb.current() keeps the Range')
  document.querySelector('[data-diple-toolbar] button').click()
  assert.equal(got.length, 1)
  assert.equal(got[0].range.toString(), '新数据库，再', 'activation hands over the kept Range')
  assert.equal(typeof got[0].at.x, 'number', 'and where the editor opens')
  tb.dispose()
})

test('V3-T placement (scheme B): right of the release, 4 px under its line; backward above; RTL mirrored; edges; pins', async () => {
  const { place, lineBoxes } = await import('../../plugins/diple/desktop/src/capture/selection-toolbar/index.js')
  const vp = { width: 1000, height: 700 }
  const size = { width: 80, height: 28 }
  const lines = [{ left: 100, right: 700, top: 300, bottom: 320 }, { left: 100, right: 420, top: 322, bottom: 342 }]
  const inside = (p, pt) => pt.x >= p.left && pt.x <= p.left + size.width && pt.y >= p.top && pt.y <= p.top + size.height
  // single line / last line of several: 6 px right of the pointer, 4 px below the pointer's line
  const pt = { x: 410, y: 332 }
  const fwd = place({ lines, pointer: pt }, size, vp)
  assert.deepEqual(fwd, { left: 416, top: 346, side: 'bottom' })
  assert.equal(inside(fwd, pt), false, "the pointer's hot spot is never on the button")
  // backward drag: released on the first line → above that line
  assert.deepEqual(place({ lines, pointer: { x: 150, y: 310 }, backward: true }, size, vp), { left: 156, top: 268, side: 'top' })
  // RTL: left of the pointer
  assert.deepEqual(place({ lines, pointer: pt, rtl: true }, size, vp), { left: 324, top: 346, side: 'bottom' })
  // the window's edges: kept 8 px inside; no room below → above the line
  assert.equal(place({ lines, pointer: { x: 990, y: 332 } }, size, vp).left, 912)
  assert.equal(place({ lines, pointer: { x: 2, y: 332 }, rtl: true }, size, vp).left, 8)
  const low = [{ left: 100, right: 700, top: 660, bottom: 680 }]
  assert.deepEqual(place({ lines: low, pointer: { x: 300, y: 670 } }, size, vp), { left: 306, top: 628, side: 'top' })
  const high = [{ left: 100, right: 700, top: 10, bottom: 30 }]
  assert.deepEqual(place({ lines: high, pointer: { x: 300, y: 20 }, backward: true }, size, vp), { left: 306, top: 34, side: 'bottom' })
  // a pin in the way: moved past it; no room past it either → the other side of the line
  const pin = { left: 430, right: 448, top: 340, bottom: 358 }
  const off = place({ lines, pointer: pt }, size, vp, [pin])
  assert.deepEqual(off, { left: 450, top: 346, side: 'bottom' })
  const wall = { left: 400, right: 1000, top: 340, bottom: 380 }
  assert.equal(place({ lines, pointer: pt }, size, vp, [wall]).side, 'top')
  // lines from client rects: fragments of one line merge
  assert.deepEqual(lineBoxes([{ left: 100, right: 200, top: 300, bottom: 320, width: 100, height: 20 }, { left: 200, right: 260, top: 301, bottom: 319, width: 60, height: 18 }, { left: 100, right: 150, top: 322, bottom: 342, width: 50, height: 20 }, { left: 5, right: 5, top: 0, bottom: 0, width: 0, height: 0 }]), [
    { left: 100, right: 260, top: 300, bottom: 320 },
    { left: 100, right: 150, top: 322, bottom: 342 }
  ])
})

test('V3-T editor placement: under the passage on the toolbar\'s leading edge; above when no room; RTL mirrored', async () => {
  const { placeEditor } = await import('../../plugins/diple/desktop/src/capture/editor/index.js')
  const vp = { width: 1000, height: 700 }
  const size = { width: 320, height: 200 }
  const rect = { left: 100, right: 700, top: 300, bottom: 342 }
  // where the toolbar was: its top = the last line's bottom + 4
  assert.deepEqual(placeEditor(rect, size, vp, { lead: 416 }), { left: 416, top: 346, side: 'bottom' })
  // no toolbar (⌘⇧E without it, a pin, a capsule): under the passage's start
  assert.deepEqual(placeEditor(rect, size, vp), { left: 100, top: 346, side: 'bottom' })
  assert.deepEqual(placeEditor(rect, size, vp, { rtl: true }), { left: 380, top: 346, side: 'bottom' })
  assert.deepEqual(placeEditor(rect, size, vp, { lead: 404, rtl: true }), { left: 84, top: 346, side: 'bottom' })
  // kept on screen sideways
  assert.equal(placeEditor(rect, size, vp, { lead: 900 }).left, 672)
  // no room below → above the passage; no room either side → the roomier one, clamped
  assert.deepEqual(placeEditor({ ...rect, top: 560, bottom: 600 }, size, vp), { left: 100, top: 356, side: 'top' })
  assert.deepEqual(placeEditor({ ...rect, top: 100, bottom: 520 }, size, vp), { left: 100, top: 492, side: 'bottom' })
  assert.deepEqual(placeEditor({ ...rect, top: 200, bottom: 600 }, size, vp), { left: 100, top: 8, side: 'top' })
})

test('V3-T RTL: a paragraph whose first strong character is Arabic counts as right-to-left', async () => {
  const { isRtlAt } = await import('../../plugins/diple/desktop/src/capture/selection-toolbar/index.js')
  const p = document.createElement('p')
  p.textContent = '«هذه فقرة عربية» with English'
  const q = document.createElement('p')
  q.textContent = '中文 then عربي'
  document.body.append(p, q)
  assert.equal(isRtlAt(p.firstChild, w), true)
  assert.equal(isRtlAt(q.firstChild, w), false)
  p.remove()
  q.remove()
})

test('V3-T: text going in anywhere (input event: IME, paste, a scripted insert) hides it, the kept Range too', async () => {
  const { tb, shown } = install()
  mouse('mousedown')
  select(0, 4)
  mouse('mouseup')
  await frame()
  await frame()
  assert.equal(shown(), true)
  document.getSelection().removeAllRanges()
  document.dispatchEvent(new w.Event('selectionchange'))
  assert.equal(shown(), true)
  document.body.dispatchEvent(new w.Event('input', { bubbles: true }))
  assert.equal(shown(), false)
  assert.equal(tb.current(), null)
  tb.dispose()
})
