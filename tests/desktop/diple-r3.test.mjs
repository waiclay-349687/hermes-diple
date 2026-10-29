// R3 findings on the Diple side of the hand-off (ADR 0007), each reproduced
// through the module interfaces (createHandoffReceiver, createSendFlow) over
// the flow fixture, whose claim ledger is the shared protocol core.
//   XE2-03  a claim answer delayed past the lease never sends a second time
//   XE3-01  a final word whose first POST fails still arrives (outbox, replay)
//   XE3-02  two hand-offs queued into one send are both settled
import test from 'node:test'
import assert from 'node:assert/strict'

import { setupDom, loadEntry } from './harness.mjs'
import { fixture, flush } from './flow-fixture.mjs'

setupDom()
const M = await loadEntry('diple', 'tests/desktop/fixtures/diple-modules.js')
const { createHandoffReceiver } = M
// (imported without `as`: the public-export analysis allows no renamed import of a test helper)
const newFixture = (opts) => fixture(M, opts)

const handoff = (handoffId, itemId = 'r1', text = '同一条标注') => ({
  v: 1,
  handoffId,
  targetSessionId: 's1',
  sendNow: true,
  items: [{ origin: { plugin: 'diple-docs', itemId, revision: 1, path: '/a.md', line: 1 }, text, comment: '请解释' }]
})
const defer = () => {
  let resolve
  const promise = new Promise((r) => (resolve = r))
  return { promise, resolve }
}
const receiver = (f, owner) => createHandoffReceiver({ deps: f.deps, flow: f.flow, sleep: async () => {}, now: f.now, ...(owner ? { owner } : {}) })

// -- XE2-03 ------------------------------------------------------------------------------------
test('XE2-03 (R3): A’s claim answer arrives after B took over and sent — A stops, one submit, one batch', async () => {
  const f = newFixture({ findUserRow: async () => true })
  const gate = defer()
  const reached = defer()
  let n = 0
  const claim = f.deps.api.claimHandoff
  f.deps.api.claimHandoff = async (...args) => {
    const res = await claim(...args)
    if (++n === 1) {
      reached.resolve()
      await gate.promise // A's answer is held back
    }
    return res
  }
  const a = receiver(f, 'A')
  const b = receiver(f, 'B')
  const first = a(handoff('h-lease'))
  await reached.promise
  f.setNow(100000 + 31_001)
  const second = await b(handoff('h-lease'))
  assert.equal(second.handled, true)
  f.expand(second.batchId)
  await f.flow.onSessionFocus('s1')
  assert.equal(f.lists.get('s1').items.length, 0)
  gate.resolve()
  const late = await first
  assert.equal(f.submits.length, 1, 'one hand-off, one submit')
  assert.equal(late.handled, false)
  assert.equal(late.reason, 'lost-claim')
  assert.equal(f.lists.get('s1').items.length, 0, 'A did not add the sent items back')
  assert.equal(f.claimSet.get('h-lease').receipt.batchId, second.batchId)
  assert.deepEqual(f.puts, [second.batchId], 'never a second batch')
})

test('XE2-03 (R3): a claim answer that took long is checked before anything is added', async () => {
  const f = newFixture()
  const claim = f.deps.api.claimHandoff
  f.deps.api.claimHandoff = async (...args) => {
    const res = await claim(...args)
    f.setNow(f.now() + 20_000) // the answer took 20 s — past FRESH_MS, inside the lease
    return res
  }
  const r = await receiver(f, 'A')(handoff('h-slow'))
  assert.equal(r.handled, true, 'still the holder: carries on')
  assert.deepEqual(f.progressCalls.map((c) => c.stage), ['claimed', 'added', 'sending'], 'a fence before adding')
  assert.equal(f.submits.length, 1)
})

test('XE2-03 (R3): an old holder’s late receipt cannot rewrite the receipt (409)', async () => {
  const f = newFixture()
  const r = await receiver(f, 'B')(handoff('h-rcpt'))
  await assert.rejects(f.deps.api.emitHandoffReceipt({ handoffId: 'h-rcpt', owner: 'A', generation: 1, accepted: ['r1'], batchId: 'bOther' }), (e) => e.status === 409)
  assert.equal(f.claimSet.get('h-rcpt').receipt.batchId, r.batchId)
})

// -- XE3-01 ------------------------------------------------------------------------------------
test('XE3-01: the final word whose first POST fails is kept in the outbox and retried until it lands', async () => {
  const f = newFixture({ findUserRow: async () => null, finals: { fail: 1 } })
  const r = await receiver(f)(handoff('h-lost'))
  f.expand(r.batchId)
  f.flow.handleEvent({ type: 'error', session_id: 's1', payload: { message: 'context too large' } })
  await flush()
  assert.equal(f.lists.get('s1').items.length, 1, 'the annotation is back in the list')
  assert.equal(f.finalCalls.length, 1)
  assert.deepEqual(f.settled, [], 'the first POST failed')
  assert.ok(f.map.get(`final.${r.batchId}`), 'kept in the outbox (storage) meanwhile')
  await f.fireTimers()
  assert.deepEqual(f.settled, [{ handoffId: 'h-lost', batchId: r.batchId, delivered: false, reason: 'turn-error' }])
  assert.equal(f.map.has(`final.${r.batchId}`), false, 'gone once the backend has it')
})

test('XE3-01: the outbox survives a reload; resume() sends it', async () => {
  const storage = new Map()
  const batches = new Map()
  const claims = new Map()
  const f = newFixture({ storage, batches, claims, findUserRow: async () => null, finals: { fail: 99 } })
  const r = await receiver(f)(handoff('h-reload'))
  f.expand(r.batchId)
  f.flow.handleEvent({ type: 'error', session_id: 's1', payload: { message: 'x' } })
  await flush()
  assert.deepEqual(f.settled, [])
  const g = newFixture({ storage, batches, claims, findUserRow: async () => null })
  await g.flow.resume()
  await flush()
  assert.deepEqual(g.settled, [{ handoffId: 'h-reload', batchId: r.batchId, delivered: false, reason: 'turn-error' }])
})

test('XE3-01 / XR3-02: a rebroadcast to the SAME window that finished asks the backend to replay receipt and settled', async () => {
  const f = newFixture({ findUserRow: async () => null, finals: { fail: 1 } })
  const rx = receiver(f)
  const r = await rx(handoff('h-same'))
  f.expand(r.batchId)
  f.flow.handleEvent({ type: 'error', session_id: 's1', payload: { message: 'x' } })
  await flush()
  assert.deepEqual(f.settled, [])
  // the outbox has not retried yet; the batch's outcome is not recorded either —
  // the replay finds nothing final. After the retry the replay carries it.
  await f.fireTimers()
  f.settled.length = 0
  const again = await rx(handoff('h-same'))
  assert.equal(again.reason, 'replayed')
  assert.deepEqual(f.replays, ['h-same'])
  assert.deepEqual(f.settled, [{ handoffId: 'h-same', batchId: r.batchId, delivered: false, reason: 'turn-error' }])
  assert.equal(f.submits.length, 1)
})

test('XE3-01: a new window derives the settled from the batch outcome when no one recorded it for the hand-off', async () => {
  const f = newFixture({ findUserRow: async () => true })
  const r = await receiver(f)(handoff('h-derive'))
  f.expand(r.batchId)
  // the outcome was recorded for the batch (another hand-off's final), not this one
  f.bs.get(r.batchId).outcome = 'failed'
  f.bs.get(r.batchId).outcomeReason = 'turn-error'
  f.claimSet.get('h-derive').settled = null
  const again = await receiver(f)(handoff('h-derive'))
  assert.equal(again.reason, 'replayed')
  assert.deepEqual(f.settled.at(-1), { handoffId: 'h-derive', batchId: r.batchId, delivered: false, reason: 'turn-error' })
})

// -- XE3-02 ------------------------------------------------------------------------------------
test('XE3-02: two sendNow hand-offs queued for one busy session — the merged batch fails, both are settled', async () => {
  const f = newFixture({ busy: true, findUserRow: async () => null })
  const rx = receiver(f)
  const a = await rx(handoff('h-queue-a', 'ra', '第一条'))
  const b = await rx(handoff('h-queue-b', 'rb', '第二条'))
  assert.deepEqual(f.emitted.map((x) => x.queued), [true, true])
  assert.deepEqual(f.map.get('queue.s1').handoffIds, ['h-queue-a', 'h-queue-b'])
  f.setBusy(false)
  await f.flow.handleEvent({ type: 'message.complete', session_id: 's1', payload: { status: 'complete' } })
  await flush()
  assert.equal(f.submits.length, 1)
  const batch = f.submits[0].text.match(/@diple:(\S+)/)[1]
  assert.deepEqual(f.bs.get(batch).items.map((x) => x.origin.itemId), ['ra', 'rb'])
  f.expand(batch)
  f.flow.handleEvent({ type: 'error', session_id: 's1', payload: { message: 'context too large' } })
  await flush()
  assert.deepEqual(
    f.settled.map((x) => [x.handoffId, x.delivered, x.reason]),
    [
      ['h-queue-a', false, 'turn-error'],
      ['h-queue-b', false, 'turn-error']
    ]
  )
  void a
  void b
})

test('XE3-02: two queued hand-offs that go out and are answered are both settled delivered', async () => {
  const f = newFixture({ busy: true, findUserRow: async () => true })
  const rx = receiver(f)
  await rx(handoff('h-ok-a', 'ra', '第一条'))
  await rx(handoff('h-ok-b', 'rb', '第二条'))
  f.setBusy(false)
  await f.flow.handleEvent({ type: 'message.complete', session_id: 's1', payload: { status: 'complete', persisted_turn: { user_row_id: 4 } } })
  await flush()
  const batch = f.submits[0].text.match(/@diple:(\S+)/)[1]
  f.expand(batch)
  await f.flow.handleEvent({ type: 'message.complete', session_id: 's1', payload: { status: 'complete', text: 'ok', persisted_turn: { user_row_id: 5 } } })
  await flush()
  assert.deepEqual(f.settled.map((x) => [x.handoffId, x.delivered]), [['h-ok-a', true], ['h-ok-b', true]])
})

test('XE3-02: cancelling a queue holding two hand-offs settles both as cancelled', async () => {
  const f = newFixture({ busy: true })
  const rx = receiver(f)
  await rx(handoff('h-c-a', 'ra', '第一条'))
  await rx(handoff('h-c-b', 'rb', '第二条'))
  assert.equal(f.flow.queue.cancel('s1'), true)
  await flush()
  assert.deepEqual(f.settled.map((x) => [x.handoffId, x.delivered, x.reason]), [['h-c-a', false, 'cancelled'], ['h-c-b', false, 'cancelled']])
})

test('XE3-02: a reload that finds the merged send lost settles both hand-offs', async () => {
  const storage = new Map()
  const batches = new Map()
  const claims = new Map()
  const f = newFixture({ storage, batches, claims, busy: true })
  const rx = receiver(f)
  await rx(handoff('h-l-a', 'ra', '第一条'))
  await rx(handoff('h-l-b', 'rb', '第二条'))
  f.setBusy(false)
  await f.flow.handleEvent({ type: 'message.complete', session_id: 's1', payload: { status: 'complete' } })
  await flush()
  const batch = f.submits[0].text.match(/@diple:(\S+)/)[1]
  // the window reloads before the batch expands; the backend lost it
  batches.delete(batch)
  const g = newFixture({ storage, batches, claims })
  await g.flow.resume()
  await flush()
  assert.deepEqual(g.settled.map((x) => [x.handoffId, x.delivered, x.reason]), [['h-l-a', false, 'lost'], ['h-l-b', false, 'lost']])
})
