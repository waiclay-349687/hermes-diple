// fix-a — GPT code review R1 (an internal review report, not published), the
// Diple half. Each test reproduces one finding through the module's own
// interface (createSendFlow, createHandoffReceiver, createOriginResolver,
// rangeToMarkdown, createLive), with an in-memory backend and host.
import test from 'node:test'
import assert from 'node:assert/strict'

import { setupDom, loadEntry, tick } from './harness.mjs'
import { flush, fixture as makeFixture, errors } from './flow-fixture.mjs'

const w = setupDom('<!doctype html><html><body></body></html>')
const M = await loadEntry('diple', 'tests/desktop/fixtures/diple-modules.js')
const { createSendFlow, createListStore, createHandoffReceiver, createOriginResolver, rangeToMarkdown, createLive, newBatchId } = M
const sdk = globalThis.__sdk
const fixture = (opts) => makeFixture(M, opts)


// -- XE-01 ---------------------------------------------------------------------
test('XE-01: a reload after expansion still recovers the items when the turn then fails', async () => {
  const f = fixture()
  f.add()
  const r = await f.flow.start('s1')
  f.expand(r.batchId)
  assert.equal(f.lists.get('s1').items.length, 0, 'expansion clears the list early (fast feedback)')
  const g = fixture({ storage: f.map, batches: f.bs, now: 101000 })
  await g.flow.resume()
  await g.flow.handleEvent({ type: 'message.complete', session_id: 's1', payload: { status: 'error', text: 'provider failed' } })
  await flush()
  assert.equal(g.lists.get('s1').items.length, 1, 'the annotation is back in the pending list')
  assert.equal(g.lists.get('s1').items[0].comment, '请解释')
  assert.equal(errors(g).length, 1, 'the user is told the send failed')
  assert.equal(g.flow.receipt.get('s1'), null)
})

test('XE-01: after a reload an idle session settles the expanded batch by its persisted user row', async () => {
  for (const [found, restored] of [
    [true, 0],
    [false, 1]
  ]) {
    const f = fixture()
    f.add()
    const r = await f.flow.start('s1')
    f.expand(r.batchId)
    const asked = []
    const g = fixture({ storage: f.map, batches: f.bs, now: 101000, findUserRow: async (key, batchId) => (asked.push([key, batchId]), found) })
    await g.flow.resume()
    await flush()
    assert.deepEqual(asked, [['s1', r.batchId]])
    assert.equal(g.lists.get('s1').items.length, restored)
    if (found) assert.equal(g.flow.receipt.get('s1')?.delivered, true)
    else {
      assert.equal(errors(g).length, 1)
      assert.ok(g.failed.some((x) => x.id === r.batchId && x.rejected), 'the backend leaves expanded')
    }
    // settled once: a second reload does nothing
    const h = fixture({ storage: f.map, batches: f.bs, now: 102000, findUserRow: async () => !found })
    await h.flow.resume()
    await flush()
    assert.equal(h.lists.get('s1').items.length, restored)
  }
})

test('XE-01: an expanded batch whose turn never completes is settled by the confirm timer', async () => {
  const f = fixture({ findUserRow: async () => false })
  f.add()
  const r = await f.flow.start('s1')
  f.expand(r.batchId)
  assert.ok(f.timers.size >= 1, 'a confirm timer stays armed after expansion')
  await f.fireTimers()
  assert.equal(f.flow.isInflight(r.batchId), false)
  assert.equal(f.lists.get('s1').items.length, 1, 'not persisted: the items come back')
  assert.notEqual(f.flow.receipt.get('s1')?.delivered, false, 'no receipt stuck at "sending"')
})

// -- XE-02 ---------------------------------------------------------------------
test('XE-02: a temporary-id capture never binds to a row it cannot tell apart', async () => {
  const rows = [
    { row_id: 11, role: 'assistant', timestamp: 10, text: '同一句' },
    { row_id: 22, role: 'assistant', timestamp: 20, text: '同一句' },
    { row_id: 33, role: 'assistant', timestamp: 30, text: '只出现一次' }
  ]
  const resolver = createOriginResolver({ history: async () => rows })
  const o = { pending: true, sessionId: 's1', role: 'assistant', roleOrdinal: 1, messageId: 'assistant-stream-old', ordinal: 1 }
  const two = await resolver.capture(o, '同一句', { busy: false })
  assert.equal(two.rowId, undefined, 'two rows hold it: stay pending')
  assert.equal(two.pending, true)
  const one = await resolver.capture(o, '只出现一次', { busy: false })
  assert.equal(one.rowId, 33)
  assert.equal(one.verified, true)
})

// -- XE-03 ---------------------------------------------------------------------
test('XE-03: "send after reply" keeps the body the user asked to send', async () => {
  const f = fixture({ busy: true })
  f.add()
  const r = await f.flow.start('s1', { useDraft: true })
  assert.equal(r.queued, true)
  f.setBusy(false)
  await f.flow.handleEvent({ type: 'message.complete', session_id: 's1', payload: { status: 'complete', persisted_turn: { user_row_id: 3 }, text: 'done' } })
  await flush()
  assert.equal(f.submits.length, 1)
  assert.ok(f.submits[0].text.startsWith('正文请比较两种方案'), f.submits[0].text)
  assert.equal(f.env.drafts.get('s1'), '', 'the draft became the body and is cleared')
})

test('XE-03: a hand-off queued for later still sends without the composer text', async () => {
  const f = fixture({ busy: true })
  f.add()
  await f.flow.start('s1', { body: '' })
  f.setBusy(false)
  await f.flow.handleEvent({ type: 'message.complete', session_id: 's1', payload: { status: 'complete', persisted_turn: { user_row_id: 3 }, text: 'done' } })
  await flush()
  assert.equal(f.submits.length, 1)
  assert.ok(!f.submits[0].text.includes('正文请比较'))
  assert.equal(f.env.drafts.get('s1'), '正文请比较两种方案')
})

// -- XE-04 ---------------------------------------------------------------------
const handoff = { v: 1, handoffId: 'handoff-123', targetSessionId: 's1', items: [{ origin: { plugin: 'diple-docs', itemId: 'r1', revision: 1, path: '/a.md', line: 1 }, text: '原文', comment: '意见' }] }

test('XE-04: a finished hand-off replays its stored receipt in a new window', async () => {
  const f = fixture()
  const first = await createHandoffReceiver({ deps: f.deps, flow: f.flow, sleep: async () => {}, now: f.now })(handoff)
  assert.equal(first.handled, true)
  // the review side missed that broadcast and rebroadcasts to a reloaded window
  const retry = await createHandoffReceiver({ deps: f.deps, flow: f.flow, sleep: async () => {}, now: f.now })(handoff)
  assert.equal(retry.reason, 'replayed')
  assert.equal(f.emitted.length, 2)
  assert.deepEqual(f.emitted[1], { handoffId: 'handoff-123', accepted: ['r1'] })
  assert.equal(f.lists.get('s1').items.length, 1, 'not added twice')
})

test('XE-04: a claim whose window died before the receipt is finished by a later window', async () => {
  const receipts = { fail: true }
  const f = fixture({ receipts })
  await createHandoffReceiver({ deps: f.deps, flow: f.flow, sleep: async () => {}, now: f.now })(handoff)
  assert.equal(f.emitted.length, 0, 'claimed, items added, receipt never reached the backend')
  receipts.fail = false
  const soon = await createHandoffReceiver({ deps: f.deps, flow: f.flow, sleep: async () => {}, now: f.now })(handoff)
  assert.equal(soon.reason, 'claimed-elsewhere', 'the claim may still be in progress')
  f.setNow(100000 + 31_000)
  const later = await createHandoffReceiver({ deps: f.deps, flow: f.flow, sleep: async () => {}, now: f.now })(handoff)
  assert.equal(later.handled, true)
  assert.deepEqual(f.emitted.at(-1), { handoffId: 'handoff-123', accepted: ['r1'] })
  assert.equal(f.lists.get('s1').items.length, 1, 'the items already there are not doubled')
})

// -- XE-05 (fixed in W3; confirm) ---------------------------------------------------
test('XE-05: a new revision updates its card; another review item with the same text is kept', async () => {
  const f = fixture()
  const receiver = createHandoffReceiver({ deps: f.deps, flow: f.flow, sleep: async () => {}, now: f.now })
  const mk = (h, itemId, revision, line, comment) => ({ v: 1, handoffId: h, targetSessionId: 's1', items: [{ origin: { plugin: 'diple-docs', itemId, revision, path: '/a.md', line }, text: '重复原文', comment }] })
  await receiver(mk('handoff-a', 'r1', 1, 1, '旧意见'))
  const updated = await receiver(mk('handoff-b', 'r1', 2, 1, '新意见'))
  const another = await receiver(mk('handoff-c', 'r2', 1, 50, '另一个位置的意见'))
  assert.deepEqual(updated.accepted, ['r1'])
  assert.deepEqual(another.accepted, ['r2'])
  const items = f.lists.get('s1').items
  assert.deepEqual(items.map((it) => [it.origin.itemId, it.origin.revision, it.comment]), [
    ['r1', 2, '新意见'],
    ['r2', 1, '另一个位置的意见']
  ])
})

// -- XE-06 ---------------------------------------------------------------------
test('XE-06: cancelling the queue while the drain waits for idle sends nothing', async () => {
  const f = fixture({ busy: true })
  f.add()
  await f.flow.start('s1')
  let release
  f.env.sleep = () => new Promise((r) => (release = r))
  const done = f.flow.handleEvent({ type: 'message.complete', session_id: 's1', payload: { status: 'complete', text: 'done', persisted_turn: { user_row_id: 1 } } })
  await flush()
  assert.ok(release, 'the drain is waiting for the host to go idle')
  assert.equal(f.flow.queue.cancel('s1'), true)
  f.setBusy(false)
  release()
  await done
  await flush()
  assert.equal(f.submits.length, 0)
  assert.equal(f.flow.queue.get('s1'), null)
  assert.equal(f.lists.get('s1').sending, null, 'the list is not left locked')
  assert.equal(f.lists.get('s1').items.length, 1)
})

test('XE-06: cancelling while the batch is being registered sends nothing', async () => {
  const f = fixture({ busy: true })
  f.add()
  await f.flow.start('s1')
  f.setBusy(false)
  let releasePut
  const put = f.deps.api.putBatch
  f.deps.api.putBatch = (id, b) => new Promise((r) => (releasePut = () => r(put(id, b))))
  const done = f.flow.handleEvent({ type: 'message.complete', session_id: 's1', payload: { status: 'complete', text: 'done', persisted_turn: { user_row_id: 1 } } })
  await flush()
  assert.ok(releasePut, 'registration in flight')
  f.flow.queue.cancel('s1')
  releasePut()
  await done
  await flush()
  assert.equal(f.submits.length, 0)
  assert.equal(f.lists.get('s1').sending, null)
  assert.equal(f.lists.get('s1').items.length, 1)
})

// -- XE-07 ---------------------------------------------------------------------
test('XE-07: after a reload an unrelated answer is never checked against an old batch', async () => {
  const old = { batchId: 'oldbatch', status: 'expanded', sessionId: 's1', expandedAt: 50, items: [{ comment: '必须回应', text: 'x' }] }
  const asked = []
  const f = fixture({ batches: new Map([['oldbatch', old]]), findUserRow: async (key, batchId, rowId) => (asked.push([batchId, rowId]), false) })
  await f.flow.handleEvent({ type: 'message.start', session_id: 's1', payload: {} })
  await f.flow.handleEvent({ type: 'message.complete', session_id: 's1', payload: { status: 'complete', text: '全新的普通问题的回复', persisted_turn: { user_row_id: 999 } } })
  assert.deepEqual(asked, [['oldbatch', 999]])
  assert.deepEqual(f.answerCalls, [])
  assert.deepEqual(f.flow.notices.get('s1'), [])
})

test('XE-07: after a reload the answer of the turn that carried the batch is checked', async () => {
  const old = { batchId: 'oldbatch', status: 'expanded', sessionId: 's1', expandedAt: 50, items: [{ comment: '必须回应', text: 'x' }] }
  const f = fixture({ batches: new Map([['oldbatch', old]]), findUserRow: async (key, batchId, rowId) => rowId === 999 })
  await f.flow.handleEvent({ type: 'message.complete', session_id: 's1', payload: { status: 'complete', text: '回答', persisted_turn: { user_row_id: 999 } } })
  assert.equal(f.answerCalls.length, 1)
  assert.equal(f.flow.notices.get('s1')[0].kind, 'none')
})

test('XE-07: a persisted turn whose user row does not carry the batch does not confirm it', async () => {
  const f = fixture({ findUserRow: async (key, batchId, rowId) => rowId === 42 })
  f.add()
  const r = await f.flow.start('s1')
  f.expand(r.batchId)
  await f.flow.handleEvent({ type: 'message.complete', session_id: 's1', payload: { status: 'complete', text: 'x', persisted_turn: { user_row_id: 7 } } })
  assert.equal(f.flow.isInflight(r.batchId), true, 'row 7 is another turn: keep waiting')
  await f.flow.handleEvent({ type: 'message.complete', session_id: 's1', payload: { status: 'complete', text: 'x', persisted_turn: { user_row_id: 42 } } })
  assert.equal(f.flow.isInflight(r.batchId), false)
  assert.equal(f.flow.receipt.get('s1').delivered, true)
})

// -- XE-10 ---------------------------------------------------------------------
test('XE-10: a session that is busy in the background is busy after the focus moves away', () => {
  const st = sdk.state
  st.focusedStoredSessionId.set('stored-2')
  st.focusedSessionId.set('runtime-2')
  st.busyBySession.set({ 'runtime-2': true })
  st.busy.set(true)
  const live = createLive()
  assert.equal(live.isBusy('stored-2'), true)
  st.focusedStoredSessionId.set('stored-1')
  st.focusedSessionId.set('runtime-1')
  st.busy.set(false)
  assert.equal(live.isBusy('stored-2'), true, 'runtime-2 is still busy')
  assert.equal(live.isBusy('stored-1'), false)
  // context_max is the focused session's: unknown for another session
  st.focusedUsage.set({ context_max: 1000 })
  assert.equal(live.contextMax('stored-1'), 1000)
  assert.equal(live.contextMax('stored-2'), null)
  st.focusedStoredSessionId.set('stored-1')
  st.focusedSessionId.set(null)
  st.busyBySession.set({})
  st.focusedUsage.set(null)
})

// -- XE-11 ---------------------------------------------------------------------
test('XE-11: code keeps its trailing spaces, blank lines and NBSPs', () => {
  const doc = w.document
  doc.body.innerHTML = '<div><p id="p">前言</p><pre><code id="c"></code></pre></div>'
  const c = doc.querySelector('#c')
  c.textContent = 'def f():\n    a = 1  \n\n\n    s = "x\u00a0y"\n    return a\n'
  let r = doc.createRange()
  r.selectNodeContents(c)
  assert.equal(rangeToMarkdown(r), '```\ndef f():\n    a = 1  \n\n\n    s = "x\u00a0y"\n    return a\n```')
  // the same block inside a wider selection
  r = doc.createRange()
  r.setStartBefore(doc.querySelector('#p'))
  r.setEndAfter(doc.querySelector('pre'))
  assert.equal(rangeToMarkdown(r), '前言\n\n```\ndef f():\n    a = 1  \n\n\n    s = "x\u00a0y"\n    return a\n```')
  // a block holding a ``` fence gets a longer one
  c.textContent = 'a\n````\nb\n'
  r = doc.createRange()
  r.selectNodeContents(c)
  assert.equal(rangeToMarkdown(r), '`````\na\n````\nb\n`````')
})

// -- XE-14 ---------------------------------------------------------------------
test('XE-14: batch ids are unguessable (≥128 random bits) and survive the @-reference parser', () => {
  const seen = new Set()
  for (let i = 0; i < 200; i++) {
    const id = newBatchId()
    assert.match(id, /^b[a-z2-7]{26}$/)
    seen.add(id)
  }
  assert.equal(seen.size, 200)
})
