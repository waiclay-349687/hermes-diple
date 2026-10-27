// fix-r3 — R3 XE-02 through register(ctx): the first completed turn of the
// capture's session pins its rows; a history outage then only retries THOSE
// rows, never a later turn's (the reviewer's r3-capture-integration timing).
import test from 'node:test'
import assert from 'node:assert/strict'

import { setupDom, loadPlugin, makeCtx, fakeDipleBackend, tick, loadEntry } from './harness.mjs'

const w = setupDom(`<!doctype html><html><head></head><body><div data-chat-surface="" data-composer-target="main" data-session-anchor="workspace"><div data-slot="aui_thread-viewport"><div data-slot="aui_thread-content">
<div data-slot="aui_assistant-message-root" data-role="assistant" data-message-id="assistant-stream-T1"><div data-slot="aui_assistant-message-content"><p id="capture">重复输出</p></div></div>
</div></div></div></body></html>`)
w.location.hash = '#/s1'
const plugin = await loadPlugin('diple')
const M = await loadEntry('diple', 'tests/desktop/fixtures/diple-modules.js')
const sdk = globalThis.__sdk

function fresh() {
  sdk.state.focusedStoredSessionId.set('s1')
  sdk.state.focusedSessionId.set('runtime1')
  sdk.state.busy.set(true)
  sdk.state.busyBySession.set({ runtime1: true })
  const env = { unavailable: false, rows: [] }
  sdk.request = async (method) => {
    if (method === 'session.active_list') return { sessions: [{ id: 'runtime1', session_key: 's1', status: 'working' }] }
    if (env.unavailable) throw new Error('temporary history outage')
    return { messages: env.rows }
  }
  const h = makeCtx({ rest: fakeDipleBackend().rest })
  h.registerI18n('diple')
  plugin.register(h.ctx)
  return { h, env }
}
const capture = async (h) => {
  const range = document.createRange()
  range.selectNodeContents(document.getElementById('capture'))
  document.getSelection().removeAllRanges()
  document.getSelection().addRange(range)
  h.contributions.find((c) => c.area === 'keybinds' && c.data?.id === 'diple.add').data.run()
  await tick(60)
}
const originOf = (h) => h.ctx.storage.get('list.s1', { items: [] }).items[0].origin
const turn = (h, ids, user, final) => h.emit('message.complete', { session_id: 'runtime1', status: 'complete', persisted_turn: { user_row_id: user, final_assistant_row_id: final, row_ids: ids } })

test('XE-02 (R3): own turn’s history unreadable, the next turn repeats the text — not bound to the next turn', async () => {
  const { h, env } = fresh()
  await capture(h)
  env.rows = [
    { row_id: 11, role: 'user', timestamp: 9, text: '问题一' },
    { row_id: 12, role: 'assistant', timestamp: 10, text: '重复输出' }
  ]
  env.unavailable = true
  turn(h, [11, 12], 11, 12)
  await tick(60)
  assert.equal(originOf(h).verified, false)
  env.unavailable = false
  env.rows.push({ row_id: 21, role: 'user', timestamp: 19, text: '问题二' }, { row_id: 22, role: 'assistant', timestamp: 20, text: '重复输出' })
  turn(h, [21, 22], 21, 22)
  await tick(60)
  const o = originOf(h)
  assert.notEqual(o.rowId, 22, 'never a later turn’s row')
  assert.equal(o.rowId, 12, 'retried with its own turn’s rows once history is back')
  assert.equal(o.verified, true)
  h.dispose()
})

test('XE-02 (R3): the pinned rows no longer hold the text — stays unverified, never the later row', async () => {
  const { h, env } = fresh()
  await capture(h)
  env.rows = [{ row_id: 12, role: 'assistant', timestamp: 10, text: '别的内容' }]
  env.unavailable = true
  turn(h, [11, 12], 11, 12)
  await tick(60)
  env.unavailable = false
  env.rows.push({ row_id: 22, role: 'assistant', timestamp: 20, text: '重复输出' })
  turn(h, [21, 22], 21, 22)
  await tick(60)
  const o = originOf(h)
  assert.equal(o.verified, false)
  assert.equal(o.rowId, undefined)
  h.dispose()
})

test('XE-02 (R3) resolver: pinned rows survive an outage; retries use only them', async () => {
  let unavailable = true
  const history = [{ row_id: 12, role: 'assistant', timestamp: 10, text: '重复输出' }]
  const resolver = M.createOriginResolver({ run: 'r3', history: async () => { if (unavailable) throw new Error('down'); return history } })
  let origin = await resolver.capture({ sessionId: 's1', role: 'assistant', pending: true, messageId: 'assistant-stream-T1' }, '重复输出', { busy: true })
  const own = resolver.pinTurn(origin, { row_ids: [11, 12], final_assistant_row_id: 12 }, 's1')
  assert.ok(own, 'the origin changes: its rows are pinned, synchronously')
  assert.deepEqual(own.bind.rows, [11, 12])
  assert.equal(own.verified, false)
  assert.equal(await resolver.verifyPinned(own, '重复输出'), null, 'history down: untouched, stays pinned')
  origin = own
  // a later turn never re-pins a pinned origin; retries use only its rows
  assert.equal(resolver.pinTurn(origin, { row_ids: [21, 22], final_assistant_row_id: 22 }, 's1'), null)
  unavailable = false
  history.push({ row_id: 22, role: 'assistant', timestamp: 20, text: '重复输出' })
  const bound = await resolver.verifyPinned(origin, '重复输出')
  assert.equal(bound.rowId, 12)
  // a reload in a later run retries the same pinned rows too
  const later = M.createOriginResolver({ run: 'r4', history: async () => history })
  const viaReload = await later.onReload(own, '重复输出', { busy: true })
  assert.equal(viaReload.rowId, 12)
})
