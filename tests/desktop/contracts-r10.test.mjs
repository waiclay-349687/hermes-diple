// R10 (GPT code review of V2-R, §4 rows 1–2, §7): the two high-risk tracks D1
// §7.2 asked for, fixed as contracts through the send module's role
// interfaces (runScenario: createSending / bindSending), not the hidden flow.
//   (a) late claim taken over: window A's claim is granted but its answer is
//       late; past the 30s lease window B takes the hand-off over and sends it.
//   (b) outbox: while an old final POST is out, another window appends to the
//       outbox; the old success returning late must not erase the newer records.
import test from 'node:test'
import assert from 'node:assert/strict'

import { setupDom, loadEntry } from './harness.mjs'
import { runScenario } from './scenario.mjs'

setupDom('<!doctype html><html><body></body></html>')
const M = await loadEntry('diple', 'tests/desktop/fixtures/diple-modules.js')
const run = (setup, actions) => runScenario(M, setup, actions)

const handoff = (id = 'h-late') => ({
  v: 1,
  handoffId: id,
  targetSessionId: 's1',
  sendNow: true,
  caps: ['partial'],
  items: [{ origin: { plugin: 'diple-docs', itemId: 'r1', revision: 1, path: '/a.md', line: 1 }, text: '原文', comment: '意见' }]
})

test('contract (R10 a): a late claim answer after another window took over → B sends once; the stale fence of A is refused, A adds nothing', async () => {
  const o = await run({ history: true }, [
    { window: 'B' },
    { hold: 'claimReply' },
    { handoff: handoff() }, // A: the ledger grants generation 1, the answer is held
    { advance: 31_001 }, // past the 30s lease
    { handoff: handoff(), in: 'B' }, // B takes it over: generation 2
    { sent: 1 },
    { release: 'claimReply' }, // A's answer finally arrives
    { complete: { rowId: 7 } }
  ])
  assert.equal(o.submits.length, 1, 'one submit')
  assert.equal(Object.keys(o.backend).length, 1, 'one batch registered')
  const id = o.batch(1)
  assert.deepEqual(o.backend[id].items.length, 1)
  assert.equal(o.ledger['h-late'].generation, 2, 'B owns it')
  assert.equal(o.ledger['h-late'].owner, 'B')
  assert.deepEqual(o.visible.list, [], 'A did not put the items (back) into the list')
  assert.ok(o.broadcasts.receipts.length >= 1)
  assert.ok(o.broadcasts.receipts.every((r) => r.handoffId === 'h-late' && r.batchId === id), 'every receipt the sender heard names the one batch')
  assert.deepEqual(o.broadcasts.settled.filter((s) => s.delivered), [{ handoffId: 'h-late', batchId: id, delivered: true }])
  assert.deepEqual(o.backend[id].outcome, 'delivered')
  // A's late answer: its fence (CAS on generation 1) is refused, so it never added, sent or told a receipt
  const a = o.protocolCalls.filter((c) => c.owner !== 'B')
  assert.deepEqual(a.map((c) => [c.op, c.generation, c.stage, c.status]), [['progress', 1, 'claimed', 409]])
  assert.deepEqual(o.protocolCalls.filter((c) => c.owner === 'B').map((c) => [c.op, c.stage, c.status]), [['progress', 'added', 200], ['progress', 'sending', 200], ['receipt', null, 200]])
})

test('contract (R10 a): the same window, answer later than freshness (15s) but within the lease → it re-checks the claim before adding', async () => {
  const o = await run({}, [{ hold: 'claimReply' }, { handoff: handoff('h-fresh') }, { advance: 20_000 }, { release: 'claimReply' }, { sent: 1 }, { complete: { rowId: 7 } }])
  assert.equal(o.submits.length, 1)
  assert.equal(o.ledger['h-fresh'].generation, 1)
  assert.deepEqual(o.protocolCalls.filter((c) => c.op === 'progress').map((c) => c.stage), ['claimed', 'added', 'sending'], 'the claimed fence comes first')
  assert.deepEqual(o.broadcasts.settled.filter((s) => s.delivered).map((s) => s.handoffId), ['h-fresh'])
})

test('contract (R10 b): an outbox append while the old final POST is out survives the old success; the next resume posts every member, terminal stays failed', async () => {
  const old = { batchId: 'out1', delivered: false, reason: 'turn-error', handoffIds: ['h1'] }
  const o = await run({ initialStorage: { 'final.out1': old, 'final.index': ['out1'] } }, [
    { hold: 'finalBatch' },
    { resume: true }, // POST /final out1 {h1} … held
    {
      otherWindowWrites: {
        'final.out1': { ...old, handoffIds: ['h1', 'h2'] }, // a member joined
        'final.out2': { batchId: 'out2', delivered: false, reason: 'cancelled', handoffIds: ['h3'] },
        'final.index': ['out1', 'out2']
      }
    },
    { release: 'finalBatch' } // the old success returns late
  ])
  assert.deepEqual(o.finalPosts.map((x) => [x.id, x.handoffIds]), [['out1', ['h1']]], 'one POST so far, with the old snapshot')
  assert.deepEqual(o.persisted['final.out1']?.handoffIds, ['h1', 'h2'], 'the old success did not remove the newer record')
  assert.ok(o.persisted['final.out2'], 'the concurrent new batch survives the first flush')
  assert.deepEqual(o.backend.out1.outcome, 'failed')

  const again = await run({ initialStorage: o.persisted, backend: { batches: { out1: { batchId: 'out1', status: 'failed', outcome: 'failed', items: [] } } } }, [{ resume: true }])
  const posts = again.finalPosts.map((x) => [x.id, x.handoffIds, x.delivered])
  assert.ok(posts.some(([id, h, d]) => id === 'out1' && h.includes('h2') && d === false), JSON.stringify(posts))
  assert.ok(posts.some(([id, h]) => id === 'out2' && h.includes('h3')), JSON.stringify(posts))
  assert.deepEqual(again.persisted['final.index'], [])
  assert.equal(again.persisted['final.out1'], undefined)
  assert.equal(again.persisted['final.out2'], undefined)
  assert.equal(again.backend.out1.outcome, 'failed', 'the first terminal stays')
})
