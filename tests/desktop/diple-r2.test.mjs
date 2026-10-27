// fix-a2 — GPT code review R2 (an internal review report, not published), the
// Diple half. Each test reproduces one R2 finding (the reviewer's probe
// scenario where there is one) through the module's own interface.
import test from 'node:test'
import assert from 'node:assert/strict'

import { setupDom, loadEntry } from './harness.mjs'
import { flush, fixture as makeFixture, errors } from './flow-fixture.mjs'

const w = setupDom('<!doctype html><html><body></body></html>')
const M = await loadEntry('diple', 'tests/desktop/fixtures/diple-modules.js')
const { rangeToMarkdown, createHandoffReceiver, createLive } = M
const sdk = globalThis.__sdk
const fixture = (opts) => makeFixture(M, opts)

// -- XE-11 ---------------------------------------------------------------------
test('XE-11: blank lines at the end of selected code are kept', () => {
  const doc = w.document
  doc.body.innerHTML = '<pre><code id="c"></code></pre>'
  const c = doc.querySelector('#c')
  c.textContent = 'const x = 1;\n\n\n'
  const r = doc.createRange()
  r.selectNodeContents(c)
  // CommonMark: the fence's content is every line up to the closing fence
  assert.equal(rangeToMarkdown(r), '```\nconst x = 1;\n\n\n```')
})

// -- XE-04 / XE2-03: a take-over resumes the hand-off, never re-sends it --------------------
const handoff = { v: 1, handoffId: 'handoff-123', targetSessionId: 's1', items: [{ origin: { plugin: 'diple-docs', itemId: 'r1', revision: 1, path: '/a.md', line: 1 }, text: '原文', comment: '意见' }] }
const receiverFor = (f) => createHandoffReceiver({ deps: f.deps, flow: f.flow, sleep: async () => {}, now: f.now })
const complete = (f, rowId = 1, text = '已处理', status = 'complete') =>
  f.flow.handleEvent({ type: 'message.complete', session_id: 's1', payload: { status, text, persisted_turn: { user_row_id: rowId } } })

test('XE2-03: taking over a claim after a successful send whose receipt was lost sends nothing again', async () => {
  const receipts = { fail: true }
  const f = fixture({ receipts, findUserRow: async () => true })
  const p = { ...handoff, sendNow: true }
  const first = await receiverFor(f)(p)
  f.expand(first.batchId)
  await complete(f)
  assert.equal(f.submits.length, 1)
  receipts.fail = false
  f.setNow(131000)
  const retry = await receiverFor(f)(p)
  assert.equal(f.submits.length, 1, 'one hand-off, one submit')
  // the send already settled: the backend replays what its progress implies, and the settled
  assert.equal(retry.reason, 'replayed')
  assert.deepEqual(f.emitted.at(-1), { handoffId: 'handoff-123', accepted: ['r1'], batchId: first.batchId })
  assert.deepEqual(f.settled.at(-1), { handoffId: 'handoff-123', batchId: first.batchId, delivered: true })
  assert.equal(f.lists.get('s1').items.length, 0, 'the sent item is not added back')
})

test('XE2-03: a take-over after a send that went out but has no final word yet reports, never resends', async () => {
  const receipts = { fail: true }
  const f = fixture({ receipts, findUserRow: async () => null })
  const p = { ...handoff, sendNow: true }
  const first = await receiverFor(f)(p)
  f.expand(first.batchId) // expanded, the turn still running: nothing final
  receipts.fail = false
  f.setNow(131000)
  const other = createHandoffReceiver({ deps: f.deps, flow: f.flow, sleep: async () => {}, now: f.now, owner: 'B' })
  const retry = await other(p)
  assert.equal(f.submits.length, 1)
  assert.equal(retry.resumed, true)
  assert.equal(retry.batchId, first.batchId)
  assert.deepEqual(f.emitted.at(-1), { handoffId: 'handoff-123', accepted: ['r1'], batchId: first.batchId })
})

test('XE2-03: a take-over of a send that never reached the backend does not send either', async () => {
  const receipts = { fail: true }
  const f = fixture({ receipts })
  const p = { ...handoff, sendNow: true }
  // the first window recorded "sending" and died before registering the batch
  f.claimSet.set('handoff-123', { owner: 'dead', generation: 1, batchId: 'bdead', stage: 'sending', accepted: ['r1'], at: 100000, receipt: null, settled: null })
  receipts.fail = false
  f.setNow(131000)
  const r = await receiverFor(f)(p)
  assert.equal(f.submits.length, 0)
  assert.deepEqual(f.emitted.at(-1), { handoffId: 'handoff-123', accepted: ['r1'] })
  assert.equal(r.batchId, undefined)
  assert.deepEqual(f.settled, [{ handoffId: 'handoff-123', batchId: 'bdead', delivered: false, reason: 'lost' }])
  // the batch id is spent: the slow first window cannot register and send it now
  await assert.rejects(f.deps.api.putBatch('bdead', { sessionId: 's1', full: 'F', items: [] }))
})

test('XE2-03: without a recorded "sending" step the hand-off does not send', async () => {
  const f = fixture({ progress: { fail: true } })
  const r = await receiverFor(f)({ ...handoff, sendNow: true })
  assert.equal(f.submits.length, 0, 'cannot make the send idempotent: do not send')
  assert.deepEqual(r.accepted, ['r1'])
  assert.equal(f.lists.get('s1').items.length, 1, 'the item waits in the pending list')
  assert.deepEqual(f.emitted.at(-1), { handoffId: 'handoff-123', accepted: ['r1'] })
})

test('XE-04: a take-over before anything was sent finishes the hand-off once', async () => {
  const f = fixture()
  f.claimSet.set('handoff-123', { owner: 'dead', generation: 1, batchId: 'bdead', stage: 'added', accepted: ['r1'], at: 100000, receipt: null, settled: null })
  f.setNow(131000)
  const r = await receiverFor(f)({ ...handoff, sendNow: true })
  assert.equal(f.submits.length, 1)
  assert.equal(r.batchId, 'bdead', 'the batch id fixed at the first claim')
})

// -- XR-09 (receiving half): plugin.diple.handoff.settled -----------------------------------
test('XR-09: a sendNow hand-off whose turn then fails settles delivered:false', async () => {
  const f = fixture({ findUserRow: async () => true })
  const r = await receiverFor(f)({ ...handoff, sendNow: true })
  assert.deepEqual(f.emitted.at(-1), { handoffId: 'handoff-123', accepted: ['r1'], batchId: r.batchId }, 'receipt = received')
  assert.deepEqual(f.settled, [])
  f.expand(r.batchId)
  await f.flow.handleEvent({ type: 'error', session_id: 's1', payload: { message: 'provider failed' } })
  await flush()
  assert.deepEqual(f.settled, [{ handoffId: 'handoff-123', batchId: r.batchId, delivered: false, reason: 'turn-error' }])
})

test('XR-09: a delivered sendNow hand-off settles delivered:true; the claim replays it', async () => {
  const f = fixture({ findUserRow: async () => true })
  const r = await receiverFor(f)({ ...handoff, sendNow: true })
  f.expand(r.batchId)
  await complete(f)
  await flush()
  assert.deepEqual(f.settled, [{ handoffId: 'handoff-123', batchId: r.batchId, delivered: true }])
  const again = await receiverFor(f)({ ...handoff, sendNow: true })
  assert.equal(again.reason, 'replayed')
  assert.deepEqual(f.settled.at(-1), { handoffId: 'handoff-123', batchId: r.batchId, delivered: true })
  assert.equal(f.submits.length, 1)
})

test('XR-09: a queued sendNow hand-off settles when the queued send ends', async () => {
  const f = fixture({ busy: true, findUserRow: async () => true })
  const r = await receiverFor(f)({ ...handoff, sendNow: true })
  assert.deepEqual(f.emitted.at(-1), { handoffId: 'handoff-123', accepted: ['r1'], queued: true })
  f.setBusy(false)
  await complete(f, 5, '别的回答')
  await flush()
  assert.equal(f.submits.length, 1)
  const batchId = f.submits[0].text.match(/@diple:(\S+)/)[1]
  f.expand(batchId)
  await complete(f, 6)
  await flush()
  assert.deepEqual(f.settled, [{ handoffId: 'handoff-123', batchId, delivered: true }])
  void r
})

test('XR-09: a queued hand-off the user cancels settles delivered:false', async () => {
  const f = fixture({ busy: true })
  await receiverFor(f)({ ...handoff, sendNow: true })
  assert.equal(f.flow.queue.cancel('s1'), true)
  await flush()
  assert.equal(f.settled.length, 1)
  assert.equal(f.settled[0].delivered, false)
  assert.equal(f.settled[0].reason, 'cancelled')
})

// -- XE-01: a pending confirmation survives an unreachable backend or history -----------------
const CONFIRM = 5 * 60_000
const sendAndExpand = async (f) => {
  f.add()
  const r = await f.flow.start('s1')
  f.expand(r.batchId)
  return r.batchId
}

test('XE-01: reload while the plugin API is starting — a later turn error still puts the items back', async () => {
  const f = fixture()
  const id = await sendAndExpand(f)
  const g = fixture({ storage: f.map, batches: f.bs, now: 101000, findUserRow: async () => null })
  const get = g.deps.api.getBatch
  g.deps.api.getBatch = async () => {
    throw Object.assign(new Error('starting'), { status: 503 })
  }
  await g.flow.resume()
  g.deps.api.getBatch = get
  assert.equal(g.flow.isInflight(id), true, 'held, not skipped')
  await g.flow.handleEvent({ type: 'error', session_id: 's1', payload: { message: 'turn failed after reconnect' } })
  await flush()
  assert.equal(g.lists.get('s1').items.length, 1)
  assert.equal(errors(g).length, 1)
  assert.deepEqual(g.map.get('confirm.index'), [])
})

test('XE-01: API cold start with a locked list — the retry reattaches once the API is back', async () => {
  const f = fixture()
  f.add()
  const r = await f.flow.start('s1') // registered + submitted, never expanded; then reload
  const g = fixture({ storage: f.map, batches: f.bs, now: 101000 })
  const get = g.deps.api.getBatch
  g.deps.api.getBatch = async () => {
    throw Object.assign(new Error('starting'), { status: 503 })
  }
  await g.flow.resume()
  assert.equal(g.lists.get('s1').sending?.batchId, r.batchId, 'still locked while unknown')
  assert.ok(g.timers.size >= 1, 'a reattach retry is armed')
  await g.fireTimers()
  assert.equal(g.lists.get('s1').sending?.batchId, r.batchId, 'API still down: still held')
  g.deps.api.getBatch = get
  await g.fireTimers()
  assert.equal(g.lists.get('s1').sending, null, 'registered but never expanded: released')
  assert.equal(g.lists.get('s1').items.length, 1)
  assert.equal(g.flow.isInflight(r.batchId), false)
})

test('XE-01: the gateway reconnecting reattaches at once', async () => {
  const f = fixture()
  const id = await sendAndExpand(f)
  const g = fixture({ storage: f.map, batches: f.bs, now: 101000, findUserRow: async () => null })
  await g.flow.resume()
  assert.equal(g.flow.receipt.get('s1').delivered, false)
  g.env.findUserRow = async () => true
  await g.flow.reconnected()
  await flush()
  assert.equal(g.flow.isInflight(id), false)
  assert.equal(g.flow.receipt.get('s1').delivered, true)
})

test('XE-01: history unreadable at the confirm timer — still pending, not delivered; a late error restores', async () => {
  const f = fixture({ findUserRow: async () => null })
  const id = await sendAndExpand(f)
  f.setNow(100000 + CONFIRM)
  await f.fireTimers()
  assert.equal(f.flow.isInflight(id), true)
  assert.deepEqual(f.map.get('confirm.index'), [id], 'the recovery index is kept')
  assert.equal(f.flow.receipt.get('s1').delivered, false)
  assert.equal(f.flow.receipt.get('s1').unconfirmed, true, 'the user is offered a choice')
  await f.flow.handleEvent({ type: 'error', session_id: 's1', payload: { message: 'late rejection' } })
  await flush()
  assert.equal(f.lists.get('s1').items.length, 1)
  assert.equal(errors(f).length, 1)
})

test('XE-01: history unreadable again and again, then another reload — still pending; the user puts it back', async () => {
  const f = fixture({ findUserRow: async () => null })
  const id = await sendAndExpand(f)
  for (let i = 1; i <= 4; i++) {
    f.setNow(100000 + i * CONFIRM)
    await f.fireTimers()
    assert.equal(f.flow.isInflight(id), true, `retry ${i}`)
    assert.ok(f.timers.size >= 1, 'retried again later')
  }
  const g = fixture({ storage: f.map, batches: f.bs, now: 100000 + 5 * CONFIRM, findUserRow: async () => null })
  await g.flow.resume()
  assert.deepEqual(g.map.get('confirm.index'), [id])
  assert.equal(g.flow.receipt.get('s1').unconfirmed, true)
  assert.equal(g.lists.get('s1').items.length, 0)
  assert.equal(g.flow.pendingConfirm.putBack('s1', id), true)
  assert.equal(g.lists.get('s1').items.length, 1, 'back in the pending list')
  assert.equal(errors(g).length, 0, 'the user chose this: no error toast')
  assert.deepEqual(g.map.get('confirm.index'), [])
  assert.equal(g.flow.receipt.get('s1'), null)
})

test('XE-01: the user may also accept an unconfirmable batch as delivered', async () => {
  const f = fixture({ findUserRow: async () => null })
  const id = await sendAndExpand(f)
  f.setNow(100000 + CONFIRM)
  await f.fireTimers()
  assert.equal(f.flow.pendingConfirm.keep('s1', id), true)
  assert.equal(f.flow.receipt.get('s1').delivered, true)
  assert.deepEqual(f.map.get('confirm.index'), [])
  assert.equal(f.lists.get('s1').items.length, 0)
})

// -- XE-07: one row → batch rule for delivery and the answer check -----------------------------
test('XE-07: a turn whose user row is not the batch’s neither confirms nor answer-checks it', async () => {
  const f = fixture({ findUserRow: async () => false })
  const id = await sendAndExpand(f)
  await f.flow.handleEvent({ type: 'message.complete', session_id: 's1', payload: { status: 'complete', text: '另一个普通问题的答案', persisted_turn: { user_row_id: 7 } } })
  assert.equal(f.flow.isInflight(id), true)
  assert.deepEqual(f.answerCalls, [])
  assert.equal(f.bs.get(id).status, 'expanded')
  assert.deepEqual(f.flow.notices.get('s1'), [])
  // and a reload does not read anything into it
  const g = fixture({ storage: f.map, batches: f.bs, now: 101000, findUserRow: async () => false })
  await g.flow.resume()
  assert.notEqual(g.flow.receipt.get('s1')?.delivered, true)
  assert.equal(g.lists.get('s1').items.length, 1, 'no row carries it: the items come back')
})

test('XE-07: history unreadable and no in-turn expansion — no answer check', async () => {
  const old = { batchId: 'oldbatch', status: 'expanded', sessionId: 's1', expandedAt: 50, items: [{ comment: '必须回应', text: 'x' }] }
  const f = fixture({ batches: new Map([['oldbatch', old]]), findUserRow: async () => null })
  await f.flow.handleEvent({ type: 'message.complete', session_id: 's1', payload: { status: 'complete', text: '回答', persisted_turn: { user_row_id: 999 } } })
  assert.deepEqual(f.answerCalls, [])
  assert.equal(f.bs.get('oldbatch').status, 'expanded')
})

test('XE-07: the answer check runs for the batch its own turn carried', async () => {
  const f = fixture({ findUserRow: async (key, batchId, rowId) => rowId === 42 })
  const id = await sendAndExpand(f)
  await f.flow.handleEvent({ type: 'message.complete', session_id: 's1', payload: { status: 'complete', text: '回答', persisted_turn: { user_row_id: 42 } } })
  assert.equal(f.answerCalls.length, 1)
  assert.equal(f.bs.get(id).status, 'answered')
  assert.equal(f.flow.receipt.get('s1').delivered, true)
})

// -- XE-10: unknown busy state is not idle -------------------------------------------------------
test('XE-10: a background session never focused here is busy-unknown; session.active_list answers it', async () => {
  const st = sdk.state
  st.focusedStoredSessionId.set('stored-1')
  st.focusedSessionId.set('runtime-1')
  st.busyBySession.set({ 'runtime-1': false, 'runtime-9': true })
  st.busy.set(false)
  const live = createLive()
  assert.equal(live.isBusy('stored-9'), null, 'never seen: unknown, not idle')
  sdk.request = async (method) => {
    assert.equal(method, 'session.active_list')
    return { sessions: [{ id: 'runtime-9', session_key: 'stored-9', status: 'working' }, { id: 'runtime-7', session_key: 'stored-7', status: 'idle' }] }
  }
  assert.equal(await live.probeBusy('stored-9'), true)
  assert.equal(live.isBusy('stored-9'), true, 'runtime-9 is now known to be stored-9')
  assert.equal(await live.probeBusy('stored-7'), false)
  assert.equal(await live.probeBusy('stored-8'), false, 'not live in the gateway: no turn can be running')
  sdk.request = async () => {
    throw new Error('no gateway')
  }
  const cold = createLive() // a new window: no snapshot yet
  assert.equal(await cold.probeBusy('stored-5'), null, 'no information: unknown')
  cold.dispose()
  live.dispose()
  delete sdk.request
  st.busyBySession.set({})
  st.focusedSessionId.set(null)
})

test('XE-10: busy unknown → the send is queued behind the answer, and goes once the session is known idle', async () => {
  const f = fixture()
  let state = null
  f.env.isBusy = () => state
  f.env.probeBusy = async () => state
  f.add()
  const r = await f.flow.start('s1', { body: '' })
  assert.equal(r.queued, true)
  assert.equal(f.submits.length, 0, 'never an interjection')
  assert.equal(f.flow.queue.get('s1').unknown, true)
  await f.fireTimers()
  assert.equal(f.submits.length, 0, 'still unknown: still waiting')
  state = false
  await f.fireTimers()
  assert.equal(f.submits.length, 1)
  assert.equal(f.flow.queue.get('s1'), null)
})
