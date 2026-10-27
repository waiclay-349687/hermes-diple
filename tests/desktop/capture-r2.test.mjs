// fix-a2 — R2 XE-02 through register(ctx): a temporary-id capture is verified
// only against the turn that produced it (the reviewer's two probe scenarios).
import test from 'node:test'
import assert from 'node:assert/strict'

import { setupDom, loadPlugin, makeCtx, fakeDipleBackend, tick } from './harness.mjs'

const html = `<!doctype html><html><head></head><body>
<div data-chat-surface="" data-composer-target="main" data-session-anchor="workspace"><div data-slot="aui_thread-viewport"><div data-slot="aui_thread-content">
  <div data-slot="aui_assistant-message-root" data-role="assistant" data-message-id="assistant-stream-old"><div data-slot="aui_assistant-message-content"><p id="old">重复片段</p></div></div>
</div></div></div>
<div data-chat-surface="" data-composer-target="tile:s2" data-session-anchor="session-tile:s2"><div data-slot="aui_thread-viewport"><div data-slot="aui_thread-content">
  <div data-slot="aui_assistant-message-root" data-role="assistant" data-message-id="assistant-stream-current"><div data-slot="aui_assistant-message-content"><p id="stream">相同的新输出</p></div></div>
</div></div></div>
</body></html>`

const w = setupDom(html)
w.location.hash = '#/s1'
const plugin = await loadPlugin('diple')
const sdk = globalThis.__sdk

let histories
let activeList
function fresh({ busyBy = {}, focusedBusy = false } = {}) {
  sdk.state.focusedStoredSessionId.set('s1')
  sdk.state.focusedSessionId.set('runtime1')
  sdk.state.busy.set(focusedBusy)
  sdk.state.busyBySession.set({ runtime1: focusedBusy, ...busyBy })
  histories = {
    s1: [
      { row_id: 11, role: 'assistant', timestamp: 10, text: '重复片段' },
      { row_id: 22, role: 'assistant', timestamp: 20, text: '重复片段' }
    ],
    s2: [{ row_id: 44, role: 'assistant', timestamp: 40, text: '相同的新输出' }]
  }
  activeList = null
  sdk.request = async (m, p) => {
    if (m === 'session.active_list') {
      if (!activeList) throw new Error('unknown method')
      return { sessions: activeList }
    }
    return { messages: histories[p.session_id] ?? [] }
  }
  const h = makeCtx({ rest: fakeDipleBackend().rest })
  h.registerI18n('diple')
  plugin.register(h.ctx)
  return h
}
const capture = async (h, id) => {
  const range = document.createRange()
  range.selectNodeContents(document.getElementById(id))
  document.getSelection().removeAllRanges()
  document.getSelection().addRange(range)
  h.contributions.find((c) => c.area === 'keybinds' && c.data?.id === 'diple.add').data.run()
  await tick(40)
}
const itemsOf = (h) => h.ctx.storage.get('list.s1', { items: [] }).items

test('XE-02: an old ambiguous capture is not bound by the next turn that repeats its text', async () => {
  const h = fresh()
  await capture(h, 'old')
  assert.equal(itemsOf(h)[0].origin.pending, true, 'two rows hold it: unverified')
  histories.s1.push({ row_id: 33, role: 'assistant', timestamp: 30, text: '重复片段' })
  h.emit('message.complete', { session_id: 'runtime1', status: 'complete', persisted_turn: { user_row_id: 32, final_assistant_row_id: 33, row_ids: [32, 33] } })
  await tick(40)
  const o = itemsOf(h)[0].origin
  assert.equal(o.rowId, undefined)
  assert.equal(o.verified, false)
  assert.equal(o.pending, true)
  h.dispose()
})

test('XE-02: text streaming in a background tile is not bound to an older identical row', async () => {
  const h = fresh({ busyBy: { runtime2: true } })
  activeList = [
    { id: 'runtime1', session_key: 's1', status: 'idle' },
    { id: 'runtime2', session_key: 's2', status: 'working' }
  ]
  await capture(h, 'stream')
  let o = itemsOf(h).find((x) => x.origin.sessionId === 's2').origin
  assert.equal(o.rowId, undefined, 'not row 44')
  assert.equal(o.pending, true)
  // another session's turn ends: still waiting
  h.emit('message.complete', { session_id: 'runtime1', status: 'complete', persisted_turn: { user_row_id: 50, final_assistant_row_id: 51, row_ids: [50, 51] } })
  await tick(40)
  assert.equal(itemsOf(h).find((x) => x.origin.sessionId === 's2').origin.pending, true)
  // its own turn ends: bound to that turn's row
  histories.s2.push({ row_id: 55, role: 'user', timestamp: 50, text: '问' }, { row_id: 56, role: 'assistant', timestamp: 51, text: '相同的新输出' })
  h.emit('message.complete', { session_id: 'runtime2', status: 'complete', persisted_turn: { user_row_id: 55, final_assistant_row_id: 56, row_ids: [55, 56] } })
  await tick(40)
  o = itemsOf(h).find((x) => x.origin.sessionId === 's2').origin
  assert.equal(o.rowId, 56)
  assert.equal(o.verified, true)
  assert.equal(o.pending, undefined)
  h.dispose()
})

test('XE-02: a background tile whose busy state cannot be learned stays unverified', async () => {
  const h = fresh({ busyBy: { runtime2: true } }) // runtime2 never paired with s2, no active_list
  await capture(h, 'stream')
  const o = itemsOf(h).find((x) => x.origin.sessionId === 's2').origin
  assert.equal(o.rowId, undefined)
  assert.equal(o.pending, true)
  assert.equal(o.verified, false)
  h.dispose()
})
