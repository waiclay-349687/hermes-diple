import test from 'node:test'
import assert from 'node:assert/strict'

import { createState, reduce, summary, isLocked, kindOf, serialize, UNDO_MS } from '../src/pending-list.js'

const o = (ordinal, offset = 0, extra = {}) => ({ sessionId: 's1', role: 'assistant', ordinal, offset, rowId: 100 + ordinal, verified: true, ...extra })

function run(state, ...cmds) {
  let effects = []
  for (const cmd of cmds) {
    const r = reduce(state, cmd)
    state = r.state
    effects = r.effects
  }
  return { state, effects }
}

const add = (id, ordinal, offset, text, comment = '') => ({ type: 'add', id, now: 1, item: { origin: o(ordinal, offset), text, comment } })

test('add focuses the new card; kind follows the comment', () => {
  const { state, effects } = run(createState(), add('a', 2, 0, '原文'))
  assert.deepEqual(effects, [{ type: 'focus', id: 'a', duplicate: false }])
  assert.equal(kindOf(state.items[0]), 'highlight')
  const r = reduce(state, { type: 'editComment', id: 'a', comment: '  意见 ' })
  assert.equal(kindOf(r.state.items[0]), 'comment')
  assert.equal(r.state.items[0].revision, 2)
})

test('items sort by message position, then offset inside the message', () => {
  const { state } = run(createState(), add('c', 4, 0, 'c'), add('b', 2, 30, 'b'), add('a', 2, 5, 'a'))
  assert.deepEqual(state.items.map((it) => it.id), ['a', 'b', 'c'])
})

test('adding the same text from the same message focuses the existing card', () => {
  const { state, effects } = run(createState(), add('a', 2, 0, '同一段'), { type: 'add', id: 'z', item: { origin: o(2, 0), text: ' 同一段 ' } })
  assert.equal(state.items.length, 1)
  assert.deepEqual(effects, [{ type: 'focus', id: 'a', duplicate: true }])
})

test('partially overlapping selections are two items', () => {
  const { state } = run(createState(), add('a', 2, 0, '甲乙丙'), add('b', 2, 1, '乙丙丁'))
  assert.equal(state.items.length, 2)
})

test('same text in another message is not a duplicate', () => {
  const { state } = run(createState(), add('a', 2, 0, '好的'), add('b', 4, 0, '好的'))
  assert.equal(state.items.length, 2)
})

test('replaceText keeps the comment and re-sorts', () => {
  const { state } = run(
    createState(),
    add('a', 2, 0, 'old', '保留我'),
    add('b', 4, 0, 'other'),
    { type: 'replaceText', id: 'a', text: 'new', origin: o(6, 0) }
  )
  assert.deepEqual(state.items.map((it) => [it.id, it.text, it.comment]), [
    ['b', 'other', ''],
    ['a', 'new', '保留我']
  ])
})

test('remove and undo within 5 s; expired undo is rejected', () => {
  const s0 = run(createState(), add('a', 2, 0, 'x'), add('b', 4, 0, 'y')).state
  const removed = reduce(s0, { type: 'remove', id: 'a', now: 1000 })
  assert.deepEqual(removed.effects, [{ type: 'undoable', kind: 'remove', until: 1000 + UNDO_MS }])
  assert.deepEqual(removed.state.items.map((it) => it.id), ['b'])
  const undone = reduce(removed.state, { type: 'undoRemove', now: 1000 + UNDO_MS })
  assert.deepEqual(undone.state.items.map((it) => it.id), ['a', 'b'])
  const late = reduce(removed.state, { type: 'undoRemove', now: 1001 + UNDO_MS })
  assert.deepEqual(late.effects, [{ type: 'rejected', reason: 'expired' }])
  assert.equal(late.state.items.length, 1)
})

test('clear and undo', () => {
  const s0 = run(createState(), add('a', 2, 0, 'x'), add('b', 4, 0, 'y')).state
  const cleared = reduce(s0, { type: 'clear', now: 0 })
  assert.equal(cleared.state.items.length, 0)
  assert.equal(reduce(cleared.state, { type: 'undoClear', now: 10 }).state.items.length, 2)
})

test('send transaction: snapshot locks, later adds stay, commit removes only the snapshot', () => {
  let { state } = run(createState(), add('a', 2, 0, 'x', '意见'), add('b', 4, 0, 'y'))
  const begun = reduce(state, { type: 'beginSend', batchId: 'B1' })
  assert.equal(begun.effects[0].type, 'sendStarted')
  assert.deepEqual(begun.effects[0].items.map((it) => it.id), ['a', 'b'])
  state = begun.state
  assert.ok(isLocked(state, 'a'))
  assert.equal(summary(state).sending, 'B1')
  assert.deepEqual(reduce(state, { type: 'editComment', id: 'a', comment: 'changed' }).effects, [{ type: 'rejected', reason: 'locked' }])
  assert.deepEqual(reduce(state, { type: 'remove', id: 'b', now: 0 }).effects, [{ type: 'rejected', reason: 'locked' }])
  assert.deepEqual(reduce(state, { type: 'beginSend', batchId: 'B2' }).effects, [{ type: 'rejected', reason: 'busy' }])
  state = reduce(state, add('c', 6, 0, 'added while sending')).state
  assert.ok(!isLocked(state, 'c'))
  const committed = reduce(state, { type: 'commitSend', batchId: 'B1' })
  assert.deepEqual(committed.effects, [{ type: 'sent', batchId: 'B1', ids: ['a', 'b'] }])
  assert.deepEqual(committed.state.items.map((it) => it.id), ['c'])
  assert.equal(committed.state.sending, null)
})

test('abortSend unlocks and keeps every item as it was', () => {
  const { state } = run(createState(), add('a', 2, 0, 'x', '意见'), { type: 'beginSend', batchId: 'B1' })
  const aborted = reduce(state, { type: 'abortSend', batchId: 'B1', reason: 'submit-refused' })
  assert.deepEqual(aborted.effects, [{ type: 'sendAborted', batchId: 'B1', reason: 'submit-refused' }])
  assert.deepEqual(aborted.state.items, state.items)
  assert.equal(aborted.state.sending, null)
  assert.deepEqual(reduce(aborted.state, { type: 'commitSend', batchId: 'B1' }).effects, [{ type: 'rejected', reason: 'not-sending' }])
})

test('clear while sending keeps the locked items', () => {
  const { state } = run(createState(), add('a', 2, 0, 'x'), { type: 'beginSend', batchId: 'B1' }, add('b', 4, 0, 'y'), { type: 'clear', now: 0 })
  assert.deepEqual(state.items.map((it) => it.id), ['a'])
})

test('beginSend on an empty list is rejected', () => {
  assert.deepEqual(reduce(createState(), { type: 'beginSend', batchId: 'B1' }).effects, [{ type: 'rejected', reason: 'empty' }])
})

test('serialize → hydrate round-trips items and an in-flight send, drops undo', () => {
  const { state } = run(createState(), add('a', 2, 0, 'x', 'c'), { type: 'remove', id: 'a', now: 0 }, { type: 'undoRemove', now: 1 }, { type: 'beginSend', batchId: 'B1' })
  const restored = reduce(undefined, { type: 'hydrate', state: JSON.parse(JSON.stringify(serialize(state))) }).state
  assert.deepEqual(restored.items, state.items)
  assert.equal(restored.sending.batchId, 'B1')
  assert.equal(restored.trash, null)
})

test('hydrate tolerates garbage', () => {
  const { state } = reduce(undefined, { type: 'hydrate', state: { items: [null, { id: 1 }, { id: 'ok', text: 't' }], sending: 'x' } })
  assert.deepEqual(state.items.map((it) => it.id), ['ok'])
  assert.equal(state.sending, null)
})

test('sessions keep first-seen order; file origins sort by line', () => {
  const s2 = { type: 'add', id: 'z', item: { origin: o(1, 0, { sessionId: 's2' }), text: 'z' } }
  const f1 = { type: 'add', id: 'f9', item: { origin: { path: 'a.md', line: 9 }, text: 'f9' } }
  const f2 = { type: 'add', id: 'f2', item: { origin: { path: 'a.md', line: 2 }, text: 'f2' } }
  const { state } = run(createState(), add('a', 5, 0, 'a'), s2, add('b', 1, 0, 'b'), f1, f2)
  assert.deepEqual(state.items.map((it) => it.id), ['b', 'a', 'z', 'f2', 'f9'])
})

// core fix (W3, XE-05/XR-02): items from another plugin are identified by { plugin, itemId }
test('core: review items with the same text but different itemIds are two items', () => {
  const f = (itemId, line) => ({ plugin: 'diple-docs', itemId, revision: 1, path: '/d/plan.md', line })
  const { state } = run(createState(), { type: 'add', id: 'a', item: { origin: f('r1', 3), text: '同一句' } }, { type: 'add', id: 'b', item: { origin: f('r2', 9), text: '同一句' } })
  assert.deepEqual(state.items.map((it) => it.origin.itemId), ['r1', 'r2'])
})

test('core: the same review itemId re-added focuses its card, whatever the text', () => {
  const f = { plugin: 'diple-docs', itemId: 'r1', revision: 1, path: '/d/plan.md', line: 3 }
  const s1 = run(createState(), { type: 'add', id: 'a', item: { origin: f, text: '旧原文' } }).state
  const r = reduce(s1, { type: 'add', id: 'b', item: { origin: { ...f, revision: 2 }, text: '新原文' } })
  assert.deepEqual(r.effects, [{ type: 'focus', id: 'a', duplicate: true }])
  // chat annotations keep the text rule
  const c = run(createState(), { type: 'add', id: 'x', item: { origin: o(1), text: 'T' } }, { type: 'add', id: 'y', item: { origin: o(1), text: 'T' } })
  assert.equal(c.state.items.length, 1)
})
