// V2-T: shared/ui-bus.js, the frozen T ↔ C contract (design §3).
import test from 'node:test'
import assert from 'node:assert/strict'

import { createUiBus } from '../../plugins/diple/desktop/src/shared/ui-bus.js'

test('locate: no implementation yet → missing; the registered one answers; off restores missing', async () => {
  const bus = createUiBus()
  assert.equal(await bus.locate('a'), 'missing')
  const calls = []
  const off = bus.onLocate(async (id, opts) => {
    calls.push([id, opts])
    return 'shown'
  })
  assert.equal(await bus.locate('a'), 'shown')
  assert.equal(await bus.locate('b', { edit: false }), 'shown')
  assert.deepEqual(calls, [
    ['a', { edit: true }],
    ['b', { edit: false }]
  ])
  off()
  assert.equal(await bus.locate('a'), 'missing')
})

test('locate: a throwing or off-contract implementation reads as missing', async () => {
  const bus = createUiBus()
  bus.onLocate(() => {
    throw new Error('boom')
  })
  assert.equal(await bus.locate('a'), 'missing')
  bus.onLocate(async () => 'loaded-and-shown')
  assert.equal(await bus.locate('a'), 'missing')
  for (const r of ['shown', 'loaded', 'other-session', 'missing']) {
    bus.onLocate(() => r)
    assert.equal(await bus.locate('a'), r)
  }
})

test('locate: an older off() does not remove a newer implementation; the newer one\'s off hands back', async () => {
  const bus = createUiBus()
  const off1 = bus.onLocate(() => 'shown')
  const off2 = bus.onLocate(() => 'loaded')
  bus.onLocate(() => 'other-session')
  off2()
  assert.equal(await bus.locate('a'), 'other-session')
  off1()
  assert.equal(await bus.locate('a'), 'other-session')
  const bus2 = createUiBus()
  bus2.onLocate(() => 'shown') // e.g. a temporary fallback
  const offT = bus2.onLocate(() => 'loaded')
  assert.equal(await bus2.locate('a'), 'loaded')
  offT()
  assert.equal(await bus2.locate('a'), 'shown')
})

test('hover: every subscriber hears it, repeats are dropped, null clears', () => {
  const bus = createUiBus()
  const a = []
  const b = []
  bus.onHover((id) => a.push(id))
  const offB = bus.onHover((id) => b.push(id))
  bus.hover('x')
  bus.hover('x')
  bus.hover(null)
  offB()
  bus.hover('y')
  bus.hover(undefined)
  assert.deepEqual(a, ['x', null, 'y', null])
  assert.deepEqual(b, ['x', null])
})

test('editor: opened / closed reach onEditor as { type, itemId }', () => {
  const bus = createUiBus()
  const seen = []
  const off = bus.onEditor((e) => seen.push(e))
  bus.editorOpened('i1')
  bus.editorClosed('i1')
  off()
  bus.editorOpened('i2')
  assert.deepEqual(seen, [
    { type: 'opened', itemId: 'i1', open: true },
    { type: 'closed', itemId: 'i1', open: false }
  ])
})

test('sendNow: subscribers run; a failing subscriber does not stop the others', () => {
  const bus = createUiBus()
  let n = 0
  bus.onSendNow(() => {
    throw new Error('x')
  })
  bus.onSendNow(() => n++)
  bus.sendNow()
  assert.equal(n, 1)
})
