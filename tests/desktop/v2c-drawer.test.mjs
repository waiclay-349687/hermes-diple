// V2-C — the session drawer (design §2.7) and the cross-session confirm
// (§2.10b), through register(ctx) with the SDK stub and the fake backend.
import test from 'node:test'
import assert from 'node:assert/strict'

import { act, cleanupAll, click, fresh, mount, origin, sdk, seed, tick } from './v2c-rig.mjs'

test.afterEach(cleanupAll)

const drawerEl = () => document.querySelector('[data-diple-drawer]')
const rows = () => [...document.querySelectorAll('[data-diple-record]')]

async function sendAndAnswer(h, view, answer) {
  await click(view.q('[data-diple-send]'))
  const put = h.backend.puts().at(-1)
  const b = put.path.split('/')[2]
  h.backend.expand(b)
  await h.fire('message.start', {})
  await h.fire('plugin.diple.batch.sent', { v: 1, batchId: b, sessionId: 'stored-1', items: [] }, '')
  await h.fire('message.complete', { status: 'complete', text: answer(b), persisted_turn: { user_row_id: 9, row_ids: [9, 10] } })
  return b
}

test('drawer: pending, sent, answered and missing; filter; a row goes back to the original', async () => {
  const h = fresh()
  await seed(h, 'stored-1', [
    { id: 'a', origin: origin(1), text: '第一段 **重点**', comment: '为什么？' },
    { id: 'b', origin: origin(1), text: '第二段' },
    { id: 'c', origin: origin(2), text: '第三段', comment: '数据呢？' }
  ])
  const view = await mount(h)
  await sendAndAnswer(h, view, (b) => `::ann{b="${b}" n="1"}\n\n回答一`)
  await seed(h, 'stored-1', [{ id: 'p', origin: origin(3), text: '还没发的一段', comment: '待会儿发' }])
  await click(view.q('[data-diple-drawer-open]'))
  await act(async () => tick(10))
  assert.ok(drawerEl(), 'drawer open')
  assert.deepEqual(
    rows().map((r) => r.getAttribute('data-status')),
    ['pending', 'sent', 'answered', 'missing'],
    'sections by state'
  )
  assert.deepEqual([...document.querySelectorAll('[data-diple-section]')].map((x) => x.getAttribute('data-diple-section')), ['pending', 'sent', 'answered', 'missing'])
  const count = (f) => document.querySelector(`[data-diple-filter="${f}"] .diple-drawer-filter-n`).textContent
  assert.deepEqual(['all', 'pending', 'sent', 'answered', 'missing'].map(count), ['4', '1', '1', '1', '1'])
  await click(document.querySelector('[data-diple-filter="missing"]'))
  assert.deepEqual(rows().map((r) => r.textContent.includes('第三段')), [true])
  const calls = []
  h.deps.uiBus.onLocate(async (id, o) => (calls.push([id, o]), 'shown'))
  await click(rows()[0])
  assert.deepEqual(calls, [['c', { edit: false }]], 'a sent annotation is shown, not edited')
  await click(document.querySelector('[data-diple-filter="pending"]'))
  await click(rows()[0])
  assert.deepEqual(calls.at(-1), ['p', { edit: true }])
})

test('V2-X: after a send the strip is empty; the receipt row under the composer opens the drawer', async () => {
  const h = fresh()
  await seed(h, 'stored-1', [{ id: 'a', origin: origin(1), text: '第一段', comment: '为什么？' }])
  const view = await mount(h)
  await sendAndAnswer(h, view, (b) => `::ann{b="${b}" n="1"}\n\n回答一`)
  await act(async () => tick(10))
  assert.equal(view.q('[data-diple-send]'), null, 'the strip has nothing left')
  const open = view.q('[data-diple-under] [data-diple-drawer-open]')
  assert.ok(open, 'the receipt row offers 本会话')
  await click(open)
  await act(async () => tick(10))
  assert.deepEqual(rows().map((r) => r.getAttribute('data-status')), ['answered'])
  // annotations again: the strip has its own 本会话, the receipt row drops its copy
  await seed(h, 'stored-1', [{ id: 'z', origin: origin(2), text: '再加一条' }])
  await act(async () => tick(10))
  assert.equal(document.querySelectorAll('[data-diple-drawer-open]').length, 1)
})

test('drawer: copy as Markdown writes what is shown; Esc closes', async () => {
  const h = fresh()
  await seed(h, 'stored-1', [{ id: 'a', origin: origin(2), text: '原文 **加粗**', comment: '意见' }])
  const view = await mount(h)
  let copied = null
  Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText: async (t) => (copied = t) }, configurable: true })
  await click(view.q('[data-diple-drawer-open]'))
  await act(async () => tick(10))
  await click(document.querySelector('[data-diple-drawer-copy]'))
  assert.equal(copied, ['# 本会话标注（1）', '', '## 待发', '', '1. 第 2 条回复', '', '   > 原文 **加粗**', '', '   意见', ''].join('\n'))
  assert.match(sdk.notifications.at(-1).title, /已复制 1 条/)
  await act(async () => document.dispatchEvent(new globalThis.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  assert.equal(drawerEl(), null)
})

test('cross-session: sending a list that is not the focused session asks first, naming it', async () => {
  const h = fresh()
  sdk.request = async (m) => (m === 'session.active_list' ? { sessions: [] } : Promise.reject(new Error('no gateway'))) // stored-2 has no turn running
  await seed(h, 'stored-2', [{ id: 'x', origin: origin(1, { sessionId: 'stored-2' }), text: '分屏里的原文' }])
  const main = await mount(h, 'slot-main')
  const tile = await mount(h, 'slot-tile')
  assert.equal(main.q('[data-diple-chip]'), null)
  // cancel: nothing is registered or submitted
  await click(tile.q('[data-diple-send]'))
  await act(async () => tick(10))
  const dlg = document.querySelector('[data-diple-confirm-target="stored-2"]')
  assert.ok(dlg, 'confirm shown')
  assert.match(dlg.textContent, /「迁移 nanostores」/)
  await click(dlg.querySelector('[data-diple-confirm-cancel]'))
  assert.equal(sdk.submits.length, 0)
  assert.equal(h.backend.puts().length, 0)
  assert.equal(tile.q('[data-diple-chip]') !== null, true, 'the list is untouched')
  // confirm: the one send flow, to that session
  await click(tile.q('[data-diple-send]'))
  await act(async () => tick(10))
  await click(document.querySelector('[data-diple-confirm-ok]'))
  await act(async () => tick(10))
  assert.equal(sdk.submits.length, 1)
  assert.equal(sdk.submits[0].sessionId, 'stored-2')
})

test('cross-session: the focused session sends without asking', async () => {
  const h = fresh()
  await seed(h, 'stored-1', [{ id: 'x', origin: origin(1), text: '原文' }])
  const view = await mount(h)
  await click(view.q('[data-diple-send]'))
  assert.equal(document.querySelector('[data-diple-confirm-target]'), null)
  assert.equal(sdk.submits.length, 1)
})
