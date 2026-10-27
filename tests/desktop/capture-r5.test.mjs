// fix-r5 — R5 XE5-01 through register(ctx): which completed turn may pin a
// streaming capture. Every order of {T1 complete, T2 capture, T2 complete, an
// unrelated session's complete, the runtime lookup answering, history reads
// failing} is played against the real plugin, with the capture's runtime known
// or not and the lookup mapping the runtime or not. Invariant checked after
// every run: an origin is verified only against its OWN turn's row (C1 → 12,
// C2 → 22), else it stays unverified; and when everything needed is known it
// is verified.
import test from 'node:test'
import assert from 'node:assert/strict'

import { setupDom, loadPlugin, makeCtx, fakeDipleBackend, tick } from './harness.mjs'

const w = setupDom(`<!doctype html><html><head></head><body><div data-chat-surface="" data-composer-target="main" data-session-anchor="workspace"><div data-slot="aui_thread-viewport"><div data-slot="aui_thread-content">
<div data-slot="aui_assistant-message-root" data-role="assistant" data-message-id="assistant-stream-T1"><div data-slot="aui_assistant-message-content"><p id="capture">重复输出</p></div></div>
</div></div></div></body></html>`)
w.location.hash = '#/s1'
const plugin = await loadPlugin('diple')
const sdk = globalThis.__sdk

const ROWS = [
  { row_id: 11, role: 'user', timestamp: 9, text: 'T1' },
  { row_id: 12, role: 'assistant', timestamp: 10, text: '重复输出' },
  { row_id: 21, role: 'user', timestamp: 19, text: 'T2' },
  { row_id: 22, role: 'assistant', timestamp: 20, text: '重复输出' },
  { row_id: 31, role: 'user', timestamp: 29, text: 'T3' },
  { row_id: 32, role: 'assistant', timestamp: 30, text: '别的回答' }
]
const deferred = () => {
  let resolve, reject
  const promise = new Promise((a, b) => ((resolve = a), (reject = b)))
  return { promise, resolve, reject }
}
const settle = () => tick(1)

async function rig({ runtimeKnown, answer }) {
  document.querySelector('[data-message-id]').setAttribute('data-message-id', 'assistant-stream-T1')
  sdk.state.focusedStoredSessionId.set('s1')
  sdk.state.focusedSessionId.set(runtimeKnown ? 'runtime1' : null)
  sdk.state.busy.set(true)
  sdk.state.busyBySession.set(runtimeKnown ? { runtime1: true } : {})
  const lookups = []
  const histories = []
  sdk.request = async (method) => {
    const d = deferred()
    ;(method === 'session.active_list' ? lookups : histories).push(d)
    return d.promise
  }
  const h = makeCtx({ rest: fakeDipleBackend().rest })
  h.registerI18n('diple')
  plugin.register(h.ctx)
  const capture = async (short) => {
    const p = document.getElementById('capture')
    const range = document.createRange()
    range.selectNodeContents(p)
    if (short) range.setEnd(p.firstChild, 2)
    document.getSelection().removeAllRanges()
    document.getSelection().addRange(range)
    h.contributions.find((c) => c.area === 'keybinds' && c.data?.id === 'diple.add').data.run()
    await settle()
  }
  const complete = (rid, u, a) =>
    h.emit('message.complete', { ...(rid ? { session_id: rid } : {}), status: 'complete', persisted_turn: { user_row_id: u, final_assistant_row_id: a, row_ids: [u, a] } })
  // 'pair': the gateway lists both live sessions; 'empty': it knows neither runtime
  const pairs = answer === 'pair' ? [{ id: 'runtime1', session_key: 's1', status: 'working' }, { id: 'unrelated-runtime', session_key: 's9', status: 'idle' }] : []
  const answerLookups = () => lookups.splice(0).forEach((d) => d.resolve({ sessions: pairs }))
  const items = () => h.ctx.storage.get('list.s1', { items: [] }).items
  const actions = {
    T1: () => complete('runtime1', 11, 12),
    C2: async () => {
      document.querySelector('[data-message-id]').setAttribute('data-message-id', 'assistant-stream-T2')
      await capture(true)
    },
    T2: () => complete('runtime1', 21, 22),
    U: () => complete('unrelated-runtime', 91, 92),
    M: answerLookups,
    Hf: () => histories.splice(0).forEach((d) => d.reject(new Error('history down')))
  }
  const drain = async () => {
    for (let i = 0; i < 6; i++) {
      answerLookups()
      histories.splice(0).forEach((d) => d.resolve({ messages: ROWS }))
      await settle()
    }
  }
  return { h, capture, complete, actions, drain, items }
}

/** All orders of `free` steps inserted around the fixed sequence T1 → C2 → T2. */
function orders(fixed, free) {
  const out = []
  const place = (seq, rest) => {
    if (!rest.length) return out.push(seq)
    const [x, ...more] = rest
    for (let i = 0; i <= seq.length; i++) place([...seq.slice(0, i), x, ...seq.slice(i)], more)
  }
  place(fixed, free)
  return out
}

function check(items, { live }, label) {
  const c1 = items.find((i) => i.text === '重复输出')
  const c2 = items.find((i) => i.text === '重复')
  assert.ok(c1 && c2, `${label}: both captured`)
  for (const [c, own] of [[c1, 12], [c2, 22]]) {
    const o = c.origin
    assert.ok(!o.verified || o.rowId === own, `${label}: ${c.text} verified against row ${o.rowId}, not its own ${own}`)
    if (live) assert.equal(o.rowId, own, `${label}: ${c.text} should end verified to ${own}: ${JSON.stringify(o)}`)
  }
}

const SEQS = orders(['T1', 'C2', 'T2'], ['U', 'M', 'Hf'])
const VARIANTS = [
  { runtimeKnown: true, answer: 'pair' },
  { runtimeKnown: true, answer: 'empty' },
  { runtimeKnown: false, answer: 'pair' },
  { runtimeKnown: false, answer: 'empty' }
]

test(`XE5-01: ${SEQS.length} orders × ${VARIANTS.length} variants — an origin is only ever verified to its own turn`, async () => {
  let runs = 0
  for (const v of VARIANTS) {
    for (const seq of SEQS) {
      const r = await rig(v)
      await r.capture(false)
      for (const step of seq) {
        await r.actions[step]()
        await settle()
      }
      await r.drain()
      // a later turn of the same session (no session id: the focused chat's) must
      // not take a capture still waiting, and retries the failed reads
      r.complete(null, 31, 32)
      await r.drain()
      const label = `${v.runtimeKnown ? 'rt-known' : 'rt-unknown'}/${v.answer}: ${seq.join(' → ')}`
      check(r.items(), { live: v.runtimeKnown || v.answer === 'pair' }, label)
      if (!v.runtimeKnown && v.answer === 'empty') {
        for (const it of r.items()) assert.equal(it.origin.verified, false, `${label}: unmapped turns leave it unverified`)
      }
      r.h.dispose()
      runs++
    }
  }
  assert.equal(runs, SEQS.length * VARIANTS.length)
})

test('XE5-01: the reviewer’s origin-backlog sequence — an unrelated lookup does not hold T1, T2 is bound to row 22', async () => {
  const r = await rig({ runtimeKnown: true, answer: 'empty' })
  await r.capture(false)
  r.actions.U()
  await settle()
  r.actions.T1()
  await settle()
  const c1 = r.items()[0].origin
  assert.equal(c1.bind.mode, 'rows', 'T1 pins its capture at once, the unrelated lookup still pending')
  assert.deepEqual(c1.bind.rows, [11, 12])
  await r.actions.C2()
  r.actions.T2()
  await r.drain()
  check(r.items(), { live: true }, 'origin-backlog')
  r.h.dispose()
})

test('XE5-01: a completion that arrives while a capture is still being resolved is that capture’s turn', async () => {
  const r = await rig({ runtimeKnown: true, answer: 'pair' })
  // idle when captured: the resolver first reads the history (held here) to bind it now
  sdk.state.busy.set(false)
  sdk.state.busyBySession.set({ runtime1: false })
  let release
  const held = new Promise((ok) => (release = ok))
  let first = true
  sdk.request = async (m) => {
    if (m !== 'session.history') return { sessions: [] }
    if (first) return (first = false), held
    return { messages: ROWS }
  }
  await r.capture(false)
  assert.equal(r.items().length, 0, 'still being resolved')
  r.actions.T1() // its turn completes meanwhile
  await settle()
  release({ messages: [] }) // the read predates the persisted turn: no row yet → waits for a turn
  await settle()
  sdk.state.busy.set(true)
  sdk.state.busyBySession.set({ runtime1: true })
  await r.actions.C2()
  r.actions.T2()
  await r.drain()
  check(r.items(), { live: true }, 'in-flight')
  r.h.dispose()
})

test('XE5-01: a runtime lookup that never answers leaves its candidates unverified (bounded)', async () => {
  const r = await rig({ runtimeKnown: false, answer: 'pair' })
  sdk.request = async (m) => (m === 'session.active_list' ? new Promise(() => {}) : { messages: ROWS })
  await r.capture(false)
  r.actions.T1()
  await tick(1700) // past RESOLVE_TIMEOUT_MS
  await r.actions.C2()
  r.actions.T2()
  await tick(20)
  r.complete(null, 31, 32)
  await tick(20)
  for (const it of r.items()) assert.equal(it.origin.verified, false, `${it.text}: ${JSON.stringify(it.origin)}`)
  // the pair becomes known later (the user focuses that chat): the turns decide then
  sdk.state.focusedSessionId.set('runtime1')
  r.complete(null, 41, 42)
  await tick(20)
  check(r.items(), { live: false }, 'late pair')
  r.h.dispose()
})
