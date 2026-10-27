// P2 (D1 design review §2 P2, §5.4, §7.2): the send / hand-off / state
// contracts as scenarios, written BEFORE the refactors (L2 BatchCatalog, L3
// the send interface) and passing on the code they protect. Each scenario
// names the regression it pins (R1 XE-…, R2 XE-…, R4/R5 XE…, R8 XV-…).
//
// Driven only through runScenario (tests/desktop/scenario.mjs): what the
// user, host, network and clock do in → what the user sees, what was
// submitted, persisted and broadcast out. After L3 only the driver changes.
import test from 'node:test'
import assert from 'node:assert/strict'

import { setupDom, loadEntry } from './harness.mjs'
import { runScenario } from './scenario.mjs'

setupDom('<!doctype html><html><body></body></html>')
const M = await loadEntry('diple', 'tests/desktop/fixtures/diple-modules.js')
const run = (setup, actions) => runScenario(M, setup, actions)

const handoff = (id = 'h-1', extra = {}) => ({
  v: 1,
  handoffId: id,
  targetSessionId: 's1',
  sendNow: true,
  caps: ['partial'],
  items: [{ origin: { plugin: 'diple-docs', itemId: 'r1', revision: 1, path: '/a.md', line: 1 }, text: '原文', comment: '意见' }],
  ...extra
})
const delivered = (o, n = 1) => ({ batchId: o.batch(n), count: 1, delivered: true })

// -- the happy path, byte for byte ------------------------------------------------
test('contract: one send → one PUT, one submit, list cleared on expansion, delivered on the persisted row (design §3.2)', async () => {
  const o = await run({ draft: '正文请比较两种方案' }, [{ add: {} }, { send: { useDraft: true } }, { sent: 1 }, { complete: { rowId: 7 } }])
  assert.equal(o.submits.length, 1)
  assert.equal(
    o.submits[0].text,
    `正文请比较两种方案\n\n—— 附 1 条标注 ——\n① 第 1 条回复：「缓存策略」\n   意见：请解释\n@diple:${o.batch(1)}`
  )
  assert.deepEqual(o.visible.list, [])
  assert.deepEqual(o.visible.receipt, delivered(o))
  assert.deepEqual(o.results[0].done, { ok: true, batchId: o.batch(1) })
  assert.deepEqual(o.backend[o.batch(1)], { status: 'answered', outcome: 'delivered', items: ['i1'] })
  assert.equal(o.pendingTimers, 0)
  assert.deepEqual(o.persisted['sending.index'], [])
  assert.deepEqual(o.persisted['confirm.index'], [])
  assert.deepEqual(o.persisted['batches.index'], [o.batch(1)])
})

test('contract: the main send button and a strip send build the same bytes for the same body (XE-09)', async () => {
  const a = await run({}, [{ add: {} }, { middleware: '正文' }])
  const b = await run({}, [{ add: {} }, { send: { body: '正文' } }])
  assert.equal(a.results[0].result.text, b.submits[0].text)
  assert.equal(a.submits.length, 0, 'the middleware returns the text; the host submits it')
})

test('contract: the composer draft is cleared only when it is still what was sent (compare before clear)', async () => {
  const same = await run({ draft: '原稿' }, [{ add: {} }, { send: { useDraft: true } }])
  assert.match(same.submits[0].text, /^原稿/)
  assert.equal(same.visible.draft, '')
  // the user typed on meanwhile: what they typed stays
  const typed = await run({ draft: '原稿' }, [{ add: {} }, { hold: 'putBatch' }, { send: { useDraft: true } }, { draft: '又写了一句' }, { release: 'putBatch' }])
  assert.match(typed.submits[0].text, /^原稿/)
  assert.equal(typed.visible.draft, '又写了一句')
  // a strip send without the draft never touches it
  const body = await run({ draft: '原稿' }, [{ add: {} }, { send: { body: '另写' } }])
  assert.equal(body.visible.draft, '原稿')
})

// -- await points (§5.4: putBatch / getDraft / findUserRow) -----------------------
test('contract: a second send, a middleware and a queue cancel during PUT /batches change nothing: one batch, one submit', async () => {
  const o = await run({}, [{ add: {} }, { hold: 'putBatch' }, { send: {} }, { send: {} }, { middleware: '另一句' }, { cancelQueue: true }, { release: 'putBatch' }])
  assert.equal(o.submits.length, 1)
  assert.equal(Object.keys(o.backend).length, 1)
  assert.deepEqual(o.results[1].result, { ok: false, reason: 'already-sending' })
  assert.deepEqual(o.results[2].result, { text: '另一句' }, 'middleware: the typed draft goes on alone')
  assert.deepEqual(o.visible.notes, [['warning', 'send.reason.middleware-busy', null]])
  assert.equal(o.results[3].result, false, 'nothing queued to cancel')
  assert.equal(o.visible.locked, true, 'still locked until the turn settles')
})

test('contract: a PUT /batches that fails unlocks the list, submits nothing, says register-failed', async () => {
  const o = await run({}, [{ add: {} }, { fail: 'putBatch' }, { send: {} }])
  assert.equal(o.submits.length, 0)
  assert.deepEqual(o.results[0].result, { ok: false, reason: 'register-failed' })
  assert.equal(o.visible.locked, false)
  assert.deepEqual(o.persisted['sending.index'], [])
})

test('contract: a turn error that arrives while PUT /batches is still out does not cancel the send it did not start', async () => {
  const o = await run({}, [{ add: {} }, { hold: 'putBatch' }, { send: {} }, { error: 'unrelated' }, { release: 'putBatch' }])
  assert.equal(o.submits.length, 1)
})

test('contract: two sends while the composer draft is slow to read → one batch (R9 XV9-02 class)', async () => {
  const o = await run({ draft: 'd' }, [{ add: {} }, { hold: 'getDraft' }, { send: { useDraft: true } }, { send: { useDraft: true } }, { release: 'getDraft' }])
  assert.equal(o.submits.length, 1)
  assert.equal(Object.keys(o.backend).length, 1)
  // whichever registers first goes; the other is told the list is already sending
  assert.deepEqual(o.results.map((r) => r.result.ok).sort(), [false, true])
  assert.equal(o.results.find((r) => !r.result.ok).result.reason, 'already-sending')
})

test('contract: a queued send cancelled while it drains is not submitted; a new one after it is (gen / stillWanted)', async () => {
  const o = await run({ busy: true }, [
    { add: {} },
    { send: {} },
    { busy: false },
    { hold: 'putBatch' },
    { complete: { rowId: 1 } }, // the other turn ends → the queue drains
    { cancelQueue: true },
    { release: 'putBatch' }
  ])
  assert.deepEqual(o.results[0].result, { ok: true, queued: true })
  assert.equal(o.submits.length, 0, 'cancelled while registering → never submitted')
  assert.equal(o.visible.locked, false)
  assert.deepEqual(o.visible.list.map((x) => x.id), ['i1'], 'the items stay')
  const again = await run({ busy: true }, [{ add: {} }, { send: {} }, { cancelQueue: true }, { busy: false }, { send: {} }])
  assert.equal(again.submits.length, 1)
})

test('contract: the answer of another turn (wrong row) or a complete without a row never settles a batch (R2 XE-07)', async () => {
  const noRow = await run({}, [{ add: {} }, { send: {} }, { sent: 1 }, { complete: {} }])
  assert.deepEqual(noRow.results[0].done, { ok: false, reason: 'not-persisted', batchId: noRow.batch(1) })
  assert.deepEqual(noRow.visible.list.map((x) => x.id), ['i1'], 'put back')
  assert.deepEqual(noRow.visible.notes, [['error', 'send.failed', 'send.reason.not-persisted']])
  const wrong = await run({ history: false }, [{ add: {} }, { send: {} }, { sent: 1 }, { complete: { rowId: 7 } }])
  assert.equal(wrong.results[0].done, 'pending', 'false row: not delivered, still waiting')
  assert.equal(wrong.visible.receipt.delivered, false)
  assert.ok(wrong.persisted[`confirm.${wrong.batch(1)}`], 'kept as a pending confirmation')
})

test('contract: history unknown (null) on the turn that expanded it → delivered; true → delivered; false → waits (R1 XE-07)', async () => {
  for (const [history, want] of [
    [true, true],
    [null, true],
    [false, false]
  ]) {
    const o = await run({ history }, [{ add: {} }, { send: {} }, { sent: 1 }, { complete: { rowId: 7 } }])
    assert.equal(o.visible.receipt.delivered, want, String(history))
  }
})

test('contract: complete before batch.sent does not settle it; the expansion still waits for its own turn', async () => {
  const o = await run({}, [{ add: {} }, { send: {} }, { complete: { rowId: 7 } }, { sent: 1 }])
  assert.equal(o.results[0].done, 'pending')
  assert.equal(o.visible.receipt.delivered, false)
  assert.equal(o.pendingTimers, 1, 'the confirm timer is armed')
})

test('contract: a turn that holds the history read while a new turn starts: the old answer does not settle a batch expanded later', async () => {
  const o = await run({}, [{ add: {} }, { send: {} }, { sent: 1 }, { hold: 'findUserRow' }, { complete: { rowId: 7 } }, { start: true }, { release: 'findUserRow' }])
  assert.deepEqual(o.results[0].done, { ok: true, batchId: o.batch(1) }, 'its own turn settles it, even when the read returns late')
})

test('contract: backend unreachable at reload → parked, then reconnect settles it (R2 XE-01)', async () => {
  const o = await run({}, [{ add: {} }, { send: {} }, { sent: 1 }, { reload: true }, { reconnect: true }])
  assert.deepEqual(o.visible.receipt, delivered(o))
  assert.deepEqual(o.visible.list, [])
})

test('contract: a turn error before expansion puts the items back and says turn-error', async () => {
  const o = await run({}, [{ add: {} }, { send: {} }, { error: 'provider failed' }])
  assert.deepEqual(o.results[0].done, { ok: false, reason: 'turn-error', detail: 'provider failed', batchId: o.batch(1) })
  assert.deepEqual(o.visible.list.map((x) => x.id), ['i1'])
  assert.equal(o.visible.locked, false)
})

// -- the final word and its outbox (R4/R5, ADR 0007 §4) ---------------------------
test('contract: a final POST that fails is kept in the outbox and retried; the first terminal stays', async () => {
  const o = await run({ finals: { fail: 1 } }, [{ handoff: handoff() }, { sent: 1 }, { complete: { rowId: 7 } }])
  assert.ok(Object.keys(o.persisted).some((k) => k.startsWith('final.')), 'persisted before the retry')
  assert.deepEqual(o.broadcasts.settled, [])
  const later = await run({ finals: { fail: 1 } }, [{ handoff: handoff() }, { sent: 1 }, { complete: { rowId: 7 } }, { advance: 60_000 }])
  assert.deepEqual(later.broadcasts.settled, [{ handoffId: 'h-1', batchId: later.batch(1), delivered: true }])
  assert.deepEqual(later.persisted['final.index'], [])
})

test('contract: the outbox survives a reload and is flushed by the next window', async () => {
  const o = await run({ finals: { fail: 1 } }, [{ handoff: handoff() }, { sent: 1 }, { complete: { rowId: 7 } }, { reload: true }])
  assert.deepEqual(o.broadcasts.settled, [{ handoffId: 'h-1', batchId: o.batch(1), delivered: true }])
})

test('contract: a hand-off that failed is settled failed once, never delivered (no false success)', async () => {
  const o = await run({}, [{ handoff: handoff() }, { error: 'host rejected' }])
  assert.deepEqual(o.broadcasts.settled.map((s) => [s.handoffId, s.delivered]), [['h-1', false]])
  assert.equal(o.broadcasts.settled[0].reason, 'turn-error')
})

// -- hand-offs (ADR 0007) ---------------------------------------------------------
test('contract: one hand-off id → at most one submit, also when it is broadcast twice and the claim is slow (late claim)', async () => {
  const o = await run({}, [{ hold: 'claim' }, { handoff: handoff() }, { handoff: handoff() }, { release: 'claim' }, { sent: 1 }, { complete: { rowId: 7 } }])
  assert.equal(o.submits.length, 1)
  assert.equal(o.broadcasts.receipts.length >= 1, true)
  assert.ok(o.broadcasts.receipts.every((r) => r.handoffId === 'h-1' && r.batchId === o.batch(1)), 'one batch id for the hand-off')
  assert.deepEqual(o.broadcasts.settled.filter((s) => s.delivered), [{ handoffId: 'h-1', batchId: o.batch(1), delivered: true }])
})

test('contract: two different hand-offs into a busy session → queued, one submit carrying both when the turn ends', async () => {
  const two = handoff('h-2', { items: [{ origin: { plugin: 'diple-docs', itemId: 'r2', revision: 1, path: '/a.md', line: 2 }, text: '第二段', comment: '意见二' }] })
  const o = await run({ busy: true }, [{ handoff: handoff() }, { handoff: two }, { busy: false }, { complete: { rowId: 1 } }, { sent: 1 }, { complete: { rowId: 7 } }])
  assert.equal(o.submits.length, 1)
  assert.deepEqual(
    o.broadcasts.settled.map((s) => [s.handoffId, s.delivered]).sort(),
    [
      ['h-1', true],
      ['h-2', true]
    ]
  )
})

// -- what a reload finds (persisted interface: old storage layouts) --------------
test('contract: old storage — a locked list whose batch the backend never registered → unlocked, lost, items kept', async () => {
  const item = { id: 'i1', origin: { sessionId: 's1', role: 'assistant', ordinal: 1, rowId: 1 }, text: '缓存策略', comment: '请解释', addedAt: 1 }
  const o = await run(
    { initialStorage: { 'list.s1': { items: [item], sending: { batchId: 'old1', ids: ['i1'], items: [item] } }, 'sending.index': ['s1'] } },
    [{ reload: true }]
  )
  assert.equal(o.visible.locked, false)
  assert.deepEqual(o.visible.list.map((x) => x.id), ['i1'])
  assert.deepEqual(o.persisted['sending.index'], [])
})

test('contract: old storage — a pending confirmation of an expanded batch is settled by its row after a reload', async () => {
  const o = await run(
    {
      initialStorage: { 'confirm.old2': { key: 's1', batchId: 'old2', at: 1 }, 'confirm.index': ['old2'], 'batch.old2': { batchId: 'old2', sessionKey: 's1', items: [{ id: 'i9', text: 't', comment: 'c', origin: {} }], at: 1 }, 'batches.index': ['old2'] },
      backend: { batches: { old2: { batchId: 'old2', sessionId: 's1', status: 'expanded', items: [{ id: 'i9' }] } } }
    },
    [{ reload: true }]
  )
  assert.deepEqual(o.persisted['confirm.index'], [])
  assert.equal(o.persisted['confirm.old2'], undefined)
  assert.deepEqual(o.visible.receipt, { batchId: 'old2', count: 1, delivered: true })
})

test('contract: old storage — a queue left from before a reload stays, stalled, until the user acts', async () => {
  const o = await run({ initialStorage: { 'queue.s1': { at: 1, gen: 'g1', useDraft: true }, 'queue.index': ['s1'] } }, [{ add: {} }, { reload: true }])
  assert.equal(o.visible.queued, true)
  assert.equal(o.persisted['queue.s1'].stalled, true)
  assert.equal(o.submits.length, 0, 'never sent on its own after a reload')
})

test('contract: "cannot confirm" choices — put back returns the items, keep settles as sent; unknown batch → false', async () => {
  const back = await run({ history: false }, [{ add: {} }, { send: {} }, { sent: 1 }, { complete: { rowId: 7 } }, { putBack: 1 }])
  assert.equal(back.results.at(-1).result, true)
  assert.deepEqual(back.visible.list.map((x) => x.id), ['i1'])
  const keep = await run({ history: false }, [{ add: {} }, { send: {} }, { sent: 1 }, { complete: { rowId: 7 } }, { keep: 1 }])
  assert.equal(keep.results.at(-1).result, true)
  assert.equal(keep.visible.receipt.delivered, true)
  const none = await run({}, [{ putBack: 1 }])
  assert.equal(none.results[0].result, false)
})
