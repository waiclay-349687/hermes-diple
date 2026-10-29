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
// No wall clock (R11-L): each step waits for its condition, under one loose deadline;
// a load that is slow cannot fail a step, only a missing state can. The waits left
// (settle) come before NEGATIVE checks only — a late answer that must change nothing:
// a slow machine can make them pass vacuously, never fail.
const DEADLINE_MS = 15000
async function until(cond, what) {
  const end = Date.now() + DEADLINE_MS
  for (;;) {
    let ok = false
    try {
      ok = cond()
    } catch {}
    if (ok) return
    if (Date.now() > end) assert.fail(`timed out waiting for: ${what}`)
    await tick(5)
  }
}
const settle = () => tick(20)
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
  const origin = () => h.ctx.storage.get('list.s1', { items: [] }).items[0].origin
  await until(() => origin(), 'the capture is stored')
  const complete = (u, a) => h.emit('message.complete', { session_id: 'runtime1', status: 'complete', persisted_turn: { user_row_id: u, final_assistant_row_id: a, row_ids: [u, a] } })
  return { h, gates, origin, complete }
}

test('XE4-01: T1 pins its rows synchronously, before its history read finishes', async () => {
  const { h, gates, origin, complete } = await rig()
  complete(11, 12)
  // synchronous: no await between the completion and these checks
  assert.equal(origin().bind.mode, 'rows', 'pinned and persisted before any history response')
  assert.deepEqual(origin().bind.rows, [11, 12])
  await until(() => gates.length >= 1, 'T1 history read in flight')
  assert.equal(gates.length, 1, 'one read for T1')
  assert.deepEqual(origin().bind.rows, [11, 12], 'still pinned while the read is pending')
  h.dispose()
})

/** T1 then T2 complete, each with its history read in flight (gates[0], gates[1]). */
async function twoTurns({ gates, complete }) {
  complete(11, 12)
  await until(() => gates.length >= 1, 'T1 history read in flight')
  complete(21, 22)
  await until(() => gates.length >= 2, 'T2 history read in flight')
  assert.equal(gates.length, 2)
}

test('XE4-01: T1 history pending, T2 completes; T1 fails, then T2’s read succeeds → row 12, never 22', async () => {
  const r = await rig()
  const { h, gates, origin } = r
  await twoTurns(r)
  gates[0].reject(new Error('T1 history timed out'))
  await until(() => gates.length >= 3, 'T1’s fallback read (by runtime id)')
  for (const g of gates.slice(2)) g.reject(new Error('runtime-id fallback also down'))
  await settle()
  assert.deepEqual(origin().bind.rows, [11, 12], 'still pinned to T1')
  gates[1].resolve({ messages: ROWS })
  await until(() => origin().verified === true, 'T2’s read answered and verified')
  const o = origin()
  assert.ok(!o.verified || o.rowId === 12, `verified against the wrong row: ${o.rowId}`)
  assert.notEqual(o.rowId, 22)
  h.dispose()
})

test('XE4-01: reverse order — T2’s read succeeds first, T1’s late failure/success cannot rebind', async () => {
  const r = await rig()
  const { h, gates, origin } = r
  await twoTurns(r)
  gates[1].resolve({ messages: ROWS })
  await until(() => origin().verified === true, 'verified by T2’s read')
  assert.equal(origin().rowId, 12, 'bound to its own turn’s row')
  const n = gates.length
  gates[0].reject(new Error('T1 history timed out late'))
  await until(() => gates.length > n, 'T1’s fallback read (by runtime id)')
  for (const g of gates.slice(2)) g.resolve({ messages: ROWS.map((r) => (r.row_id === 12 ? { ...r, text: '别的' } : r)) })
  await settle()
  const o = origin()
  assert.equal(o.rowId, 12, 'a stale write-back never replaces the verified origin')
  assert.equal(o.verified, true)
  h.dispose()
})

test('XE4-01: T1 succeeds while T2’s read is pending; T2’s late answer is dropped', async () => {
  const r = await rig()
  const { h, gates, origin } = r
  await twoTurns(r)
  gates[0].resolve({ messages: ROWS })
  await until(() => origin().verified === true, 'verified by T1’s read')
  assert.equal(origin().rowId, 12)
  // T2's read returns history where row 12 no longer matches: its 'never'
  // verdict is for an origin snapshot that is gone, so it is discarded.
  gates[1].resolve({ messages: ROWS.map((r) => (r.row_id === 12 ? { ...r, text: '别的' } : r)) })
  await settle()
  assert.equal(origin().rowId, 12)
  assert.equal(origin().verified, true)
  h.dispose()
})
