// P2 (D1 design review): one scenario driver for the send / hand-off / state
// contracts — test layer only, no production interface of its own.
//
//   const out = await runScenario(M, setup, actions)
//
//   M       the Diple modules (tests/desktop/fixtures/diple-modules.js, built
//           against the SDK stub)
//   setup   { initialStorage?: object, backend?: { batches?: object },
//             clock?: number, busy?: boolean, history?: true|false|null,
//             draft?: string, finals?: { fail: n } (the first window's final POSTs fail n times) }
//   actions what the user, the host, the network and the clock do, in order:
//     { add: { id?, text?, comment? } }        an annotation in s1's list
//     { send: { body?, useDraft? } }           a user send (strip / ⌘⏎ / keybind)
//     { middleware: text }                     the main send button with that text
//     { cancelQueue: true }                    the strip's 取消排队
//     { putBack: n } / { keep: n }             "cannot confirm" choices for the nth batch
//     { handoff: payload }                     a plugin.diple-docs.handoff broadcast
//     { sent: n }                              plugin.diple.batch.sent for the nth batch
//     { start: true }                          message.start in s1
//     { complete: { rowId?, status?, text? } } message.complete in s1
//     { error: message }                       a turn error in s1
//     { busy: bool } / { history: v } / { draft: text }
//     { hold: 'putBatch'|'getDraft'|'findUserRow'|'finalBatch'|'claim'|'claimReply' }  the next such call waits …
//         (claim: before the ledger sees it; claimReply: the ledger granted it, the answer is late)
//     { release: same }                        … until here
//     { window: 'B' }                          a second window opens beside the first (own owner,
//                                              own host binding; same storage, backend, composer)
//     { handoff: payload, in: 'B' }            the broadcast reaches only that window (default: the first)
//     { otherWindowWrites: { key: value } }    another window persisted these plugin storage records
//     { resume: true }                         the host resumes this window (outbox flush, no reload)
//     { fail: 'putBatch'|'finalBatch' }        the next such call fails (500)
//     { advance: ms }                          fire the timers armed for <= ms
//     { reload: true }                         a new window over the same storage + backend
//     { reconnect: true }                      the gateway came back
//   Batches are named by their order of registration: 1 = the first PUT /batches.
//
//   → { visible, submits, persisted, broadcasts, backend, ledger, finalPosts, protocolCalls, pendingTimers, results, trace }
//     visible     what the user sees: s1's list, lock, receipt, queue, notices, notes
//     submits     composer submits [{ key, text }]
//     persisted   the plugin storage after the last action (plain object)
//     broadcasts  { receipts, settled } the backend broadcast to the sender
//     ledger      the backend's hand-off claims (owner, generation, stage …)
//     finalPosts  every POST /final the windows made, in order (a snapshot of each body)
//     protocolCalls  every hand-off progress / receipt write: { op, owner, generation, stage, status }
//     results     what each send/middleware/putBack/keep returned, then `done`
//     trace       visible after every action (index-aligned with actions)
//
// Since L3 the driver crosses the send module's role interfaces only: the UI's
// (createSending: request / preview / get / subscribe / resolve) and the host's
// (bindSending: gateway events, the hand-off broadcast, the middleware, resume,
// reconnect). The scenarios and their expected results did not change — the
// same observations before and after.
import { fixture, flush } from './flow-fixture.mjs'

const clean = (v) => JSON.parse(JSON.stringify(v ?? null))

export async function runScenario(M, setup = {}, actions = []) {
  const storage = new Map(Object.entries(clean(setup.initialStorage ?? {})))
  const batches = new Map(Object.entries(clean(setup.backend?.batches ?? {})))
  let history = 'history' in setup ? setup.history : true
  const failing = new Set() // the next call of these fails (network)
  const holds = new Map() // name → { armed, wait: Promise, release }
  const gate = (name) => {
    const h = holds.get(name)
    if (!h?.armed) return null
    h.armed = false
    return h.wait
  }
  const findUserRow = async () => {
    const w = gate('findUserRow')
    if (w) await w
    return history
  }
  let f
  let sending
  let host
  let gatewayOpen
  const events = {}
  const others = new Map() // name → { events } of a second window over the same fixture
  const claims = new Map() // the backend's hand-off ledger survives a reload too
  const carry = { submits: [], notes: [], emitted: [], settled: [] } // what earlier windows (before a reload) did
  const results = []
  const pending = []
  const finalPosts = []
  const protocolCalls = []
  const make = (now) => {
    const first = !f
    if (f) for (const k of Object.keys(carry)) carry[k].push(...f[k])
    const claim = async () => {
      const w = gate('claim')
      if (w) await w
    }
    f = fixture(M, { storage, batches, busy: Boolean(setup.busy), now, findUserRow, finals: first ? setup.finals : undefined, hold: { claim }, claims })
    if (setup.draft != null) f.env.drafts.set('s1', setup.draft)
    const claimHandoff = f.deps.api.claimHandoff
    f.deps.api.claimHandoff = async (...a) => {
      const res = await claimHandoff(...a)
      const w = gate('claimReply')
      if (w) await w
      return res
    }
    // what each window told the ledger and what the ledger answered (409 = a lost claim)
    for (const name of ['saveHandoffProgress', 'emitHandoffReceipt']) {
      const real = f.deps.api[name]
      f.deps.api[name] = async (...a) => {
        const body = name === 'saveHandoffProgress' ? { id: a[0], ...a[1] } : { id: a[0].handoffId, ...a[0] }
        const call = { op: name === 'saveHandoffProgress' ? 'progress' : 'receipt', owner: body.owner, generation: body.generation, stage: body.stage ?? null, status: 200 }
        protocolCalls.push(call)
        try {
          return await real(...a)
        } catch (e) {
          call.status = e?.status ?? 'error'
          throw e
        }
      }
    }
    for (const name of ['putBatch', 'finalBatch']) {
      const real = f.deps.api[name]
      f.deps.api[name] = async (...a) => {
        if (name === 'finalBatch') finalPosts.push(clean({ id: a[0], ...a[1] }))
        const w = gate(name)
        if (w) await w
        if (failing.delete(name)) throw Object.assign(new Error('down'), { status: 500 })
        return real(...a)
      }
    }
    const getDraft = f.env.getDraft
    f.env.getDraft = async (k) => {
      const w = gate('getDraft')
      if (w) await w
      return getDraft(k)
    }
    sending = M.createSending(f.deps, f.env, { receiver: { sleep: async () => {}, now: f.now } })
    const ctx = {
      onDispose: () => {},
      onEvent: (type, fn) => ((events[type] ??= new Set()).add(fn), () => events[type].delete(fn))
    }
    for (const k of Object.keys(events)) delete events[k]
    const listeners = new Set()
    let state = 'open'
    const gateway = { get: () => state, listen: (fn) => (listeners.add(fn), () => listeners.delete(fn)) }
    gatewayOpen = async () => {
      for (const v of ['closed', 'open']) {
        state = v
        for (const fn of [...listeners]) fn(v)
      }
      await flush()
    }
    host = M.bindSending(ctx, sending, { live: { watchFocus: () => () => {} }, session: { currentKey: () => 's1' }, gateway })
  }
  // gateway events reach every open window; a hand-off broadcast is routed (see `handoff … in`)
  const emitTo = (evs, type, e) => Promise.all([...(evs[type] ?? [])].map((fn) => fn(e)))
  const emit = (type, e) => Promise.all([emitTo(events, type, e), ...[...others.values()].map((o) => emitTo(o.events, type, e))])
  make(setup.clock ?? 100000)
  const nth = (n) => f.puts[n - 1] ?? [...f.bs.keys()][n - 1]
  const s1Events = (type, payload) => emit(type, { type, session_id: 's1', payload })
  const expand = (id) => {
    Object.assign(f.bs.get(id), { status: 'expanded', expandedAt: f.now() / 1000 })
    return emit('plugin.diple.batch.sent', { type: 'plugin.diple.batch.sent', payload: { batchId: id, sessionId: 's1' } })
  }
  const track = (label, p) => {
    const slot = { label, result: 'pending', done: 'none' }
    results.push(slot)
    pending.push(
      Promise.resolve(p).then((r) => {
        slot.result = r && typeof r === 'object' ? { ...r, done: undefined } : r
        if (r?.done) {
          slot.done = 'pending'
          r.done.then((d) => (slot.done = clean(d)))
        }
      })
    )
  }
  const visible = () => {
    const st = f.lists.get('s1')
    return clean({
      list: st.items.map((it) => ({ id: it.id, comment: it.comment ?? '' })),
      locked: st.sending ? true : false,
      receipt: sending.get('s1').receipt,
      queued: Boolean(sending.get('s1').queued),
      draft: f.env.drafts.get('s1') ?? '',
      notices: sending.get('s1').notices,
      notes: [...carry.notes, ...f.notes].map((n) => [n.kind, n.title, n.message ?? null])
    })
  }
  const trace = []
  for (const a of actions) {
    const [kind, arg] = Object.entries(a)[0]
    switch (kind) {
      case 'add':
        f.add(arg?.id ?? 'i' + (f.lists.get('s1').items.length + 1), arg?.text ?? '缓存策略', arg?.comment ?? '请解释')
        break
      case 'send':
        track('send', sending.request('s1', { bodySource: arg?.useDraft ? 'draft' : 'explicit', ...(arg?.body != null ? { body: arg.body } : {}) }))
        break
      case 'middleware':
        track('middleware', host.middleware({ text: arg }))
        break
      case 'cancelQueue':
        results.push({ label: 'cancelQueue', result: (await sending.resolve('s1', { type: 'cancel-queue' })).ok })
        break
      case 'putBack':
        results.push({ label: 'putBack', result: (await sending.resolve('s1', { type: 'put-back-confirmation', batchId: nth(arg) })).ok })
        break
      case 'keep':
        results.push({ label: 'keep', result: (await sending.resolve('s1', { type: 'keep-confirmation', batchId: nth(arg) })).ok })
        break
      case 'handoff': {
        const evs = a.in ? others.get(a.in)?.events : events
        if (!evs) throw new Error(`runScenario: no window ${a.in}`)
        pending.push(emitTo(evs, 'plugin.diple-docs.handoff', { type: 'plugin.diple-docs.handoff', payload: arg }))
        break
      }
      case 'window': {
        const evs = {}
        const second = M.createSending(f.deps, f.env, { receiver: { owner: arg, sleep: async () => {}, now: f.now } })
        const ctx = { onDispose: () => {}, onEvent: (type, fn) => ((evs[type] ??= new Set()).add(fn), () => evs[type].delete(fn)) }
        M.bindSending(ctx, second, { live: { watchFocus: () => () => {} }, session: { currentKey: () => 's1' } })
        others.set(arg, { events: evs })
        break
      }
      case 'otherWindowWrites':
        for (const [k, v] of Object.entries(arg)) storage.set(k, clean(v))
        break
      case 'resume':
        pending.push(host.resume())
        break
      case 'sent':
        pending.push(expand(nth(arg)))
        break
      case 'start':
        pending.push(s1Events('message.start', {}))
        break
      case 'complete':
        // not awaited: a held history read must not stop the scenario
        pending.push(s1Events('message.complete', { status: arg?.status ?? 'complete', text: arg?.text ?? '回答', ...(arg?.rowId != null ? { persisted_turn: { user_row_id: arg.rowId } } : {}) }))
        break
      case 'error':
        pending.push(s1Events('error', { message: arg }))
        break
      case 'busy':
        f.setBusy(arg)
        break
      case 'history':
        history = arg
        break
      case 'draft':
        f.env.drafts.set('s1', arg)
        break
      case 'hold': {
        let release
        const wait = new Promise((r) => (release = r))
        holds.set(arg, { armed: true, wait, release })
        break
      }
      case 'fail':
        failing.add(arg)
        break
      case 'release':
        holds.get(arg)?.release()
        break
      case 'advance': {
        const due = [...f.timers.entries()].filter(([, x]) => x.ms <= arg)
        for (const [id] of due) f.timers.delete(id)
        f.setNow(f.now() + arg)
        for (const [, x] of due) await x.f()
        break
      }
      case 'reload':
        make(f.now() + 1000)
        pending.push(host.resume())
        break
      case 'reconnect':
        // the gateway atom went closed → open
        pending.push(gatewayOpen())
        break
      default:
        throw new Error(`runScenario: unknown action ${kind}`)
    }
    await flush()
    trace.push(visible())
  }
  for (const h of holds.values()) h.release()
  await Promise.race([Promise.all(pending), flush(40)])
  await flush()
  return {
    visible: visible(),
    submits: clean([...carry.submits, ...f.submits]),
    persisted: Object.fromEntries([...storage.entries()].sort(([a], [b]) => (a < b ? -1 : 1))),
    broadcasts: clean({ receipts: [...carry.emitted, ...f.emitted], settled: [...carry.settled, ...f.settled] }),
    ledger: clean(Object.fromEntries(claims)),
    finalPosts: clean([...finalPosts]),
    protocolCalls: clean([...protocolCalls]),
    backend: Object.fromEntries([...f.bs.entries()].map(([id, b]) => [id, { status: b.status, outcome: b.outcome ?? null, items: (b.items ?? []).map((x) => x.id) }])),
    pendingTimers: f.timers.size,
    results: clean(results),
    batch: (n) => nth(n),
    trace
  }
}
