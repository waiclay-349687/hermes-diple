// fix-r6 — R6 XE6-01: an Diple that never settles, a batch that carried only some of
// a hand-off's items. The sender machine itself says which items went out — in the
// final word it shows AND in the conclusion it records — from the same set: the items
// its batch events carried. An item they did not carry never takes the batch's word.
import test from 'node:test'
import assert from 'node:assert/strict'

import { senderInit, senderStep } from '../src/handoff-protocol.js'

const A = 'rA'
const B = 'rB'
const run = (events) => {
  let s = senderInit({ sendNow: true, itemIds: [A, B] })
  const effects = []
  for (const e of events) {
    const r = senderStep(s, e)
    s = r.state
    effects.push(...r.effects)
  }
  return { s, effects, of: (t) => effects.filter((x) => x.type === t) }
}
// an older Diple: no `settles`, the session was busy (queued)
const receipt = { type: 'receipt', receipt: { v: 1, handoffId: 'h1', accepted: [A, B], queued: true } }
const sentB = { type: 'sent', batchId: 'b1', carried: [B] }
const answeredB = { type: 'answered', batchId: 'b1', carried: [B] }
const PARTIAL = [
  { itemId: A, delivered: false, reason: 'removed' },
  { itemId: B, delivered: true }
]

test('XE6-01: batch.answered carrying B only — the record says A did not go out', () => {
  const { of } = run([receipt, sentB, answeredB])
  assert.deepEqual(of('record'), [{ type: 'record', delivered: true, inferred: 'batch.answered', items: PARTIAL }])
  assert.deepEqual(of('final'), [{ type: 'final', outcome: 'sent', items: PARTIAL }])
})

test('XE6-01: batch.sent carrying B only, then the quiet period — the record says A did not go out', () => {
  const { of } = run([receipt, sentB, { type: 'fallback' }])
  assert.deepEqual(of('record'), [{ type: 'record', delivered: true, inferred: 'batch.sent', items: PARTIAL }])
  assert.deepEqual(of('final'), [{ type: 'final', outcome: 'sent', items: PARTIAL }])
})

test('XE6-01: answered without its batch.sent — what answered carried is all that is known', () => {
  const { of } = run([receipt, answeredB])
  assert.deepEqual(of('record')[0].items, PARTIAL)
})

test('XE6-01: carried in pieces (two batch events) — both count', () => {
  const { of } = run([receipt, { type: 'sent', batchId: 'b1', carried: [A] }, { type: 'sent', batchId: 'b1', carried: [B] }, { type: 'fallback' }])
  assert.deepEqual(of('record'), [{ type: 'record', delivered: true, inferred: 'batch.sent' }], 'all carried: the whole hand-off')
})

test('XE6-01: every item carried, or nothing known about the members — the whole hand-off, no items', () => {
  const all = run([receipt, { type: 'sent', batchId: 'b1', carried: [A, B] }, { type: 'answered', batchId: 'b1', carried: [A, B] }])
  assert.deepEqual(all.of('record'), [{ type: 'record', delivered: true, inferred: 'batch.answered' }])
  assert.deepEqual(all.of('final'), [{ type: 'final', outcome: 'sent' }])
  const blind = run([receipt, { type: 'sent', batchId: 'b1' }, { type: 'answered', batchId: 'b1' }])
  assert.deepEqual(blind.of('record'), [{ type: 'record', delivered: true, inferred: 'batch.answered' }])
})

test('XE6-01: none of the hand-off carried — not delivered (removed), shown and recorded alike', () => {
  const { of } = run([receipt, { type: 'sent', batchId: 'b1', carried: ['rOther'] }, { type: 'fallback' }])
  const items = [
    { itemId: A, delivered: false, reason: 'removed' },
    { itemId: B, delivered: false, reason: 'removed' }
  ]
  assert.deepEqual(of('record'), [{ type: 'record', delivered: false, reason: 'removed', inferred: 'batch.sent', items }])
  assert.deepEqual(of('final'), [{ type: 'final', outcome: 'returned', reason: 'removed', items }])
})
