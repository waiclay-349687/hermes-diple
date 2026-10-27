// fix-r5 audit — the queue's hand-offs belong to the send that locks the list.
// A drain that waited (getDraft) while another send took the queue must not
// settle the queue's hand-offs, nor fail the batch id that send now carries.
import test from 'node:test'
import assert from 'node:assert/strict'

import { setupDom, loadEntry } from './harness.mjs'
import { fixture, flush } from './flow-fixture.mjs'

setupDom()
const M = await loadEntry('diple', 'tests/desktop/fixtures/diple-modules.js')

test('audit: a drain that lost the queue to another send while reading the draft settles nothing', async () => {
  const f = fixture(M, { busy: true })
  f.add('i1', '缓存策略', '请解释', { sessionId: 's1', role: 'assistant', ordinal: 1, rowId: 1, plugin: 'diple-docs', itemId: 'r0001', revision: 1 })
  // the user pressed send while busy (useDraft), with a queued hand-off h1 in the same entry
  const q = await f.flow.start('s1', { useDraft: true, handoffId: 'h1', batchId: 'batchH1', accepted: [{ itemId: 'r0001', revision: 1 }] })
  assert.equal(q.queued, true)
  // the turn ends; the drain reads the draft (held)
  let release
  const held = new Promise((r) => (release = r))
  const plain = f.env.getDraft
  f.env.getDraft = async (k) => (await held, plain(k))
  f.setBusy(false)
  const draining = f.flow.handleEvent({ type: 'message.complete', session_id: 's1', payload: { status: 'complete' } })
  await flush()
  // meanwhile another send of this idle session takes the queue (and its hand-offs)
  f.env.getDraft = plain
  const other = f.flow.start('s1', {})
  await flush()
  release()
  await draining
  await other
  await flush()
  const bid = [...f.bs.keys()].at(-1)
  assert.equal(bid, 'batchH1', 'the other send carries the queued batch id')
  assert.ok(f.links.has('batchH1|h1'), 'and links h1')
  assert.deepEqual(f.finalCalls, [], `the losing drain settled nothing: ${JSON.stringify(f.finalCalls)}`)
  assert.equal(f.bs.get('batchH1').outcome, undefined, 'the batch the other send carries is not failed')
})

test('audit: an error turn does not fail a batch that expanded only after that turn ended', async () => {
  const f = fixture(M)
  f.add()
  const r = await f.flow.start('s1', {})
  assert.equal(r.ok, true)
  const bid = [...f.bs.keys()].at(-1)
  // an earlier turn (the host ran it before this prompt) ends with an error; while the
  // window asks the backend about the batch, the batch's own turn starts and expands it
  let release
  const held = new Promise((ok) => (release = ok))
  const plain = f.deps.api.getBatch
  f.deps.api.getBatch = async (id) => (await held, plain(id))
  const done = f.flow.handleEvent({ type: 'message.complete', session_id: 's1', payload: { status: 'error', text: 'earlier turn failed' } })
  await flush()
  f.setNow(f.now() + 5000)
  Object.assign(f.bs.get(bid), { status: 'expanded', expandedAt: f.now() / 1000 })
  release()
  await done
  await flush()
  f.deps.api.getBatch = plain
  assert.deepEqual(f.failed, [], 'not failed by the earlier turn')
  assert.ok(!f.finalCalls.some((c) => c.id === bid), `no final word yet: ${JSON.stringify(f.finalCalls)}`)
})
