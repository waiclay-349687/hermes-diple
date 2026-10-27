// V2-T: the selection toolbar (design §2.3). Driven directly, no plugin build:
// it is a plain-DOM module with injected rules.
import test from 'node:test'
import assert from 'node:assert/strict'

import { setupDom, tick } from './harness.mjs'

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
const frame = () => new Promise((r) => w.requestAnimationFrame(() => r()))

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
  const t0 = performance.now()
  mouse('mouseup')
  await frame()
  await frame()
  assert.equal(shown(), true)
  // two frames, not a settle timer; the < 50 ms budget is measured in the real app (tests/e2e/v2t-*.mjs)
  assert.ok(performance.now() - t0 < 150, `took ${performance.now() - t0} ms`)
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
  select(0, 5) // still extending
  await tick(200)
  assert.equal(shown(), false, 'still moving')
  await tick(150)
  assert.equal(shown(), true)
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
  document.getSelection().removeAllRanges()
  document.dispatchEvent(new w.Event('selectionchange'))
  assert.equal(shown(), false, 'collapsed')
  tb.dispose()
  const off = install({ enabled: () => false })
  mouse('mousedown')
  select()
  mouse('mouseup')
  await tick(80)
  assert.equal(off.shown(), false)
  off.tb.dispose()
})

test('placement: centred 8 px above the selection, clamped 8 px from the edges, below when no room', async () => {
  const { place } = await import('../../plugins/diple/desktop/src/capture/selection-toolbar/index.js')
  const vp = { width: 1000, height: 700 }
  const size = { width: 80, height: 28 }
  assert.deepEqual(place({ left: 400, right: 600, top: 300, bottom: 320 }, size, vp), { left: 460, top: 264, side: 'top' })
  assert.deepEqual(place({ left: 0, right: 20, top: 300, bottom: 320 }, size, vp), { left: 8, top: 264, side: 'top' })
  assert.deepEqual(place({ left: 960, right: 1000, top: 300, bottom: 320 }, size, vp), { left: 912, top: 264, side: 'top' })
  assert.deepEqual(place({ left: 400, right: 600, top: 20, bottom: 40 }, size, vp), { left: 460, top: 48, side: 'bottom' })
})
