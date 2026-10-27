// fix-r4 — R4 XE4-01 through register(ctx): two completed turns whose history
// reads overlap. The origin is pinned to ITS turn's rows synchronously, before
// any history I/O, and a stale write-back can never replace a newer state, so
// it is only ever verified against its own turn's row (12), never T2's (22).
import test from 'node:test'
import assert from 'node:assert/strict'

import { setupDom, loadPlugin, makeCtx, fakeDipleBackend, tick } from './harness.mjs'

const w = setupDom(`<!doctype html><html><head></head><body><div data-chat-surface="" data-composer-target="main" data-session-anchor="workspace"><div data-slot="aui_thread-viewport"><div data-slot="aui_thread-content">
<div data-slot="aui_assistant-message-root" data-role="assistant" data-message-id="assistant-stream-T1"><div data-slot="aui_assistant-message-content"><p id="capture">重复输出</p></div></div>
</div></div></div></body></html>`)
w.location.hash = '#/s1'
const plugin = await loadPlugin('diple')
const sdk = globalThis.__sdk

const ROWS = [
  { row_id: 11, role: 'user', timestamp: 9, text: 'T1' },
  { row_id: 12, role: 'assistant', timestamp: 10, text: '重复输出' },
  { row_id: 21, role: 'user', timestamp: 19, text: 'T2' },
  { row_id: 22, role: 'assistant', timestamp: 20, text: '重复输出' }
]
const deferred = () => {
  let resolve, reject
  const promise = new Promise((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}

async function rig() {
  sdk.state.focusedStoredSessionId.set('s1')
  sdk.state.focusedSessionId.set('runtime1')
  sdk.state.busy.set(true)
  sdk.state.busyBySession.set({ runtime1: true })
  const gates = []
  sdk.request = async (method) => {
    if (method === 'session.active_list') return { sessions: [{ id: 'runtime1', session_key: 's1', status: 'working' }] }
    const d = deferred()
    gates.push(d)
    return d.promise
  }
  const h = makeCtx({ rest: fakeDipleBackend().rest })
  h.registerI18n('diple')
  plugin.register(h.ctx)
  const range = document.createRange()
  range.selectNodeContents(document.getElementById('capture'))
  document.getSelection().removeAllRanges()
  document.getSelection().addRange(range)
  h.contributions.find((c) => c.area === 'keybinds' && c.data?.id === 'diple.add').data.run()
  await tick(30)
  const origin = () => h.ctx.storage.get('list.s1', { items: [] }).items[0].origin
  const complete = (u, a) => h.emit('message.complete', { session_id: 'runtime1', status: 'complete', persisted_turn: { user_row_id: u, final_assistant_row_id: a, row_ids: [u, a] } })
  return { h, gates, origin, complete }
}

test('XE4-01: T1 pins its rows synchronously, before its history read finishes', async () => {
  const { h, gates, origin, complete } = await rig()
  complete(11, 12)
  await tick(10)
  assert.equal(gates.length, 1, 'T1 history read in flight')
  assert.equal(origin().bind.mode, 'rows', 'pinned and persisted before any history response')
  assert.deepEqual(origin().bind.rows, [11, 12])
  h.dispose()
})

test('XE4-01: T1 history pending, T2 completes; T1 fails, then T2’s read succeeds → row 12, never 22', async () => {
  const { h, gates, origin, complete } = await rig()
  complete(11, 12)
  await tick(10)
  complete(21, 22)
  await tick(10)
  assert.equal(gates.length, 2)
  gates[0].reject(new Error('T1 history timed out'))
  await tick(10)
  for (const g of gates.slice(2)) g.reject(new Error('runtime-id fallback also down'))
  await tick(10)
  assert.deepEqual(origin().bind.rows, [11, 12], 'still pinned to T1')
  gates[1].resolve({ messages: ROWS })
  await tick(20)
  const o = origin()
  assert.ok(!o.verified || o.rowId === 12, `verified against the wrong row: ${o.rowId}`)
  assert.notEqual(o.rowId, 22)
  h.dispose()
})

test('XE4-01: reverse order — T2’s read succeeds first, T1’s late failure/success cannot rebind', async () => {
  const { h, gates, origin, complete } = await rig()
  complete(11, 12)
  await tick(10)
  complete(21, 22)
  await tick(10)
  gates[1].resolve({ messages: ROWS })
  await tick(20)
  assert.equal(origin().rowId, 12, 'bound to its own turn’s row')
  assert.equal(origin().verified, true)
  gates[0].reject(new Error('T1 history timed out late'))
  await tick(10)
  for (const g of gates.slice(2)) g.resolve({ messages: ROWS.map((r) => (r.row_id === 12 ? { ...r, text: '别的' } : r)) })
  await tick(20)
  const o = origin()
  assert.equal(o.rowId, 12, 'a stale write-back never replaces the verified origin')
  assert.equal(o.verified, true)
  h.dispose()
})

test('XE4-01: T1 succeeds while T2’s read is pending; T2’s late answer is dropped', async () => {
  const { h, gates, origin, complete } = await rig()
  complete(11, 12)
  await tick(10)
  complete(21, 22)
  await tick(10)
  gates[0].resolve({ messages: ROWS })
  await tick(20)
  assert.equal(origin().rowId, 12)
  // T2's read returns history where row 12 no longer matches: its 'never'
  // verdict is for an origin snapshot that is gone, so it is discarded.
  gates[1].resolve({ messages: ROWS.map((r) => (r.row_id === 12 ? { ...r, text: '别的' } : r)) })
  await tick(20)
  assert.equal(origin().rowId, 12)
  assert.equal(origin().verified, true)
  h.dispose()
})
