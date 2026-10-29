// V2.1 #8 (chat): the strip's send button names the count and has a small ▾
// menu — 直接发送 (the same send as the button, ⌘⇧↩) and 复制给 AI (Markdown).
// The target is always this session: no target list.
import test from 'node:test'
import assert from 'node:assert/strict'

import { act, cleanupAll, click, fresh, mount, origin, sdk, seed, tick, w } from './v2c-rig.mjs'

test.afterEach(cleanupAll)

const two = [
  { id: 'a', origin: origin(2), text: '原文一\n第二行', comment: '意见一' },
  { id: 'b', origin: origin(3), text: '原文二', comment: '' }
]

test('the send button says 发送 2 条; ▾ opens 直接发送 / 复制给 AI, no target list', async () => {
  const h = fresh()
  await seed(h, 'stored-1', two)
  const view = await mount(h)
  assert.equal(view.q('[data-diple-send]').textContent, '发送 2 条')
  const toggle = view.q('[data-diple-send-menu-toggle]')
  assert.ok(toggle, 'the ▾')
  assert.equal(toggle.getAttribute('aria-haspopup'), 'menu')
  assert.match(toggle.getAttribute('aria-label'), /发送选项/)
  await click(toggle)
  const menu = view.q('[data-diple-send-menu]')
  assert.ok(menu)
  assert.equal(toggle.getAttribute('aria-expanded'), 'true')
  assert.deepEqual([...menu.querySelectorAll('[role="menuitem"]')].map((b) => [b.getAttribute('data-send-item'), b.textContent]), [['send', '直接发送'], ['copy', '复制给 AI']])
  assert.equal(menu.querySelectorAll('[role="menuitemradio"]').length, 0, 'no scope or target to pick')
})

test('直接发送 in the menu is the strip send: one batch with every annotation', async () => {
  const h = fresh()
  await seed(h, 'stored-1', two)
  const view = await mount(h)
  await click(view.q('[data-diple-send-menu-toggle]'))
  await click(view.q('[data-diple-send-menu] [data-send-item="send"]'))
  await act(async () => tick(20))
  const batches = [...h.backend.batches.values()]
  assert.equal(batches.length, 1)
  assert.deepEqual(batches[0].items.map((x) => x.text), ['原文一\n第二行', '原文二'])
  assert.equal(sdk.submits.length, 1)
  assert.equal(view.q('[data-diple-send-menu]'), null, 'the menu closed')
})

test('复制给 AI copies the list as one Markdown prompt (the pin card\'s block per annotation); nothing is sent', async () => {
  const h = fresh()
  await seed(h, 'stored-1', two)
  const view = await mount(h)
  let copied = null
  Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText: async (t) => (copied = t) }, configurable: true })
  await click(view.q('[data-diple-send-menu-toggle]'))
  await click(view.q('[data-diple-send-menu] [data-send-item="copy"]'))
  await act(async () => tick(10))
  assert.equal(copied, ['# 本会话标注（2）', '', '## ① 第 2 条回复', '', '> 原文一', '> 第二行', '', '意见一', '', '## ② 第 3 条回复', '', '> 原文二', ''].join('\n'))
  assert.equal(h.backend.batches.size, 0)
  assert.match(sdk.notifications.at(-1)?.title ?? '', /已复制/)
})

test('Esc closes the menu and gives focus back to the ▾', async () => {
  const h = fresh()
  await seed(h, 'stored-1', two)
  const view = await mount(h)
  const toggle = view.q('[data-diple-send-menu-toggle]')
  await click(toggle)
  await act(async () => document.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  assert.equal(view.q('[data-diple-send-menu]'), null)
  assert.equal(document.activeElement, toggle)
})

// R11-K: a press outside closes the menu and leaves focus where the user put it
test('the menu open, a click in the composer closes it and focus stays in the composer; 复制给 AI gives it back to the ▾', async () => {
  const h = fresh()
  await seed(h, 'stored-1', two)
  const view = await mount(h)
  const toggle = view.q('[data-diple-send-menu-toggle]')
  const composer = document.getElementById('composer')
  await click(toggle)
  assert.ok(view.q('[data-diple-send-menu]'))
  await act(async () => {
    composer.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    composer.focus()
  })
  await tick()
  assert.equal(view.q('[data-diple-send-menu]'), null, 'closed')
  assert.equal(document.activeElement, composer, 'focus stays in the composer')
  await click(toggle)
  await click(view.q('[data-diple-send-menu] [data-send-item="copy"]'))
  assert.equal(view.q('[data-diple-send-menu]'), null)
  assert.equal(document.activeElement, toggle, 'a pick gives focus back to the ▾')
})

test('Esc with focus outside the menu (on <body>) still closes it', async () => {
  const h = fresh()
  await seed(h, 'stored-1', two)
  const view = await mount(h)
  await click(view.q('[data-diple-send-menu-toggle]'))
  document.activeElement.blur()
  await act(async () => document.body.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  assert.equal(view.q('[data-diple-send-menu]'), null)
  assert.equal(document.activeElement, view.q('[data-diple-send-menu-toggle]'))
})
