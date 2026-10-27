// Shared by diple-r1/r2 tests: a send flow over an in-memory backend and host.
import { tick } from './harness.mjs'
// the reference models (backend ledger, settled derivations), not the runtime entry
import * as Handoff from '../../packages/core/src/handoff-protocol.js'

export const flush = async (n = 20) => {
  for (let i = 0; i < n; i++) await Promise.resolve()
  await tick(1)
}

/** A send flow over an in-memory backend; `storage` / `batches` survive a "reload". */
export function fixture({ createSendFlow, createListStore, createBatchCatalog }, { storage, batches, busy = false, now = 100000, findUserRow, claims, receipts, progress, finals: finalOpts, hold: holdOpts } = {}) {
  const map = storage ?? new Map()
  const bs = batches ?? new Map()
  let clock = now
  let seq = 0
  let busyNow = busy
  const store = {
    get: (k, d) => (map.has(k) ? structuredClone(map.get(k)) : d),
    set: (k, v) => map.set(k, structuredClone(v)),
    remove: (k) => map.delete(k)
  }
  const lists = createListStore({ storage: store, now: () => clock })
  const submits = []
  const notes = []
  const answerCalls = []
  const failed = []
  const emitted = []
  const settled = []
  const puts = []
  const claimSet = claims ?? new Map() // handoffId → ledger record (Handoff.ledgerStep)
  const links = new Set() // `${batchId}|${handoffId}`
  const capsOf = new Map() // handoffId → the sender's caps, kept with the claim (R5 XE5-02)
  /** what the backend broadcasts: the stored settled as its sender may be told (store.settled_for_peer) */
  const told = (st) => Handoff.settledForPeer(st, capsOf.get(st?.handoffId) ?? [])
  const linkItems = new Map() // `${batchId}|${handoffId}` → [{itemId, revision}] (put_batch handoffItems)
  /** what a hand-off handed over: put_batch's versions, else its receipt / progress ids (store._accepted_locked) */
  const acceptedOf = (batchId, id) => {
    const v = linkItems.get(batchId + '|' + id)
    if (v?.length) return v
    const c = claimSet.get(id)
    if (c?.receipt?.accepted?.length) return c.receipt.accepted
    return c?.accepted?.length ? c.accepted : null
  }
  /** store.settled_for_handoff over a batch: only items really in it share its word (R4 XE4-02).
   *  A batch put_batch registered: its entries are its whole membership (members_known, R5);
   *  a final_batch placeholder has none. */
  const forHandoff = (b, id) => Handoff.settledForHandoff(b.placeholder ? { ...b, items: null } : b, id, acceptedOf(b.batchId, id))
  const linked = (batchId) => [...links].filter((x) => x.startsWith(batchId + '|')).map((x) => x.slice(batchId.length + 1))
  const progressCalls = []
  const replays = []
  const finalCalls = []
  const finals = { fail: finalOpts?.fail ?? 0 }
  const hold = holdOpts ?? {}
  /** One ledger step; a 409 throws like the REST client does. */
  const ledger = (id, req) => {
    const r = Handoff.ledgerStep(claimSet.get(id) ?? null, req, clock)
    if (r.rec) claimSet.set(id, r.rec)
    if (r.status === 409) throw Object.assign(new Error('lost-claim'), { status: 409 })
    return r
  }
  /** store.replay_receipt: the stored receipt, else the one a settled claim's progress implies. */
  const replayReceipt = (id) => {
    const c = claimSet.get(id)
    if (!c) return null
    if (c.receipt) return c.receipt
    if (!c.settled || c.stage === 'claimed') return null
    return { handoffId: id, accepted: c.accepted ?? [], ...(c.stage === 'sending' && c.settled.batchId ? { batchId: c.settled.batchId } : {}) }
  }
  /** settled as the backend gives it: stored, else derived from a linked batch's outcome. */
  const derived = (id) => {
    const c = claimSet.get(id)
    if (c?.settled) return c.settled
    if (!c) return null
    for (const b of bs.values()) {
      if (!(links.has(b.batchId + '|' + id) || b.batchId === c.batchId)) continue
      const st = forHandoff(b, id)
      if (st) return ledger(id, { op: 'settle', settled: st }).res.settled
    }
    return null
  }
  const timers = new Map()
  let t = 0
  const deps = {
    lists,
    session: { currentKey: () => 's1' },
    settings: { get: () => ({ enabled: true }) },
    i18n: { t: (x) => x, lang: () => 'zh' },
    ids: { newBatchId: () => 'batch' + ++seq + (now % 1000), newItemId: () => 'item' + ++seq },
    notify: (n) => notes.push(n),
    api: {
      putBatch: async (id, b) => {
        const cur = bs.get(id)
        if (cur && (cur.outcome || cur.status === 'expanded' || cur.status === 'answered')) throw Object.assign(new Error('conflict'), { status: 409 })
        puts.push(id)
        for (const h of b.handoffIds ?? []) links.add(id + '|' + h)
        for (const [h, v] of Object.entries(b.handoffItems ?? {})) linkItems.set(id + '|' + h, v)
        bs.set(id, { ...structuredClone(b), batchId: id, status: 'registered', createdAt: clock / 1000 })
      },
      getBatch: async (id) => {
        const b = bs.get(id)
        if (!b) throw Object.assign(new Error('unknown'), { status: 404 })
        return structuredClone(b)
      },
      markFailed: async (id, reason, opts) => {
        failed.push({ id, reason, rejected: Boolean(opts?.rejected) })
        const b = bs.get(id)
        if (b && (b.status === 'registered' || (b.status === 'expanded' && opts?.rejected))) b.status = 'failed'
        return b
      },
      listBatches: async ({ sessionId, status }) => ({ batches: [...bs.values()].filter((b) => b.sessionId === sessionId && b.status === status).slice(-1) }),
      markAnswered: async (id, ans) => {
        answerCalls.push({ id, ans })
        const b = bs.get(id)
        const first = b?.status === 'expanded'
        if (first) b.status = 'answered'
        if (first && !b.outcome) b.outcome = 'delivered' // one first terminal per batch (R4)
        return { first }
      },
      emitBatchAnswered: async () => {},
      // The claim ledger is the shared protocol core (the Python store runs the same
      // cases): owner + generation, CAS, the batch id fixed at the claim (ADR 0007).
      claimHandoff: async (id, _key, { owner, batchId, caps } = {}) => {
        if (hold.claim) await hold.claim(id)
        if (caps?.length && !capsOf.has(id)) capsOf.set(id, caps)
        const r = ledger(id, { op: 'claim', owner: owner ?? 'anon', batchId })
        if (r.res.claimed) return r.res
        const st = derived(id)
        const rc = replayReceipt(id)
        return { claimed: false, ...(rc ? { receipt: rc } : {}), ...(st ? { settled: st } : {}) }
      },
      saveHandoffProgress: async (id, { owner, generation, stage, accepted }) => {
        if (progress?.fail) throw new Error('network')
        progressCalls.push({ id, owner, generation, stage })
        ledger(id, { op: 'advance', owner, generation, stage, accepted })
      },
      emitHandoffReceipt: async (r) => {
        if (receipts?.fail) throw new Error('network')
        const { owner, generation, ...receipt } = r
        const res = ledger(r.handoffId, { op: 'receipt', owner, generation, receipt })
        emitted.push(res.res.receipt)
      },
      replayHandoff: async (id) => {
        replays.push(id)
        const st = derived(id)
        const rc = replayReceipt(id)
        if (rc) emitted.push(rc)
        if (st) settled.push(told(st))
        return { receipt: rc, settled: st }
      },
      // /batches/{id}/final: outcome once, every linked hand-off settled once, broadcast
      finalBatch: async (id, { delivered, reason, handoffIds }) => {
        finalCalls.push({ id, delivered, reason, handoffIds })
        if (finals.fail > 0) {
          finals.fail--
          throw new Error('network')
        }
        if (!bs.has(id) && !delivered) bs.set(id, { batchId: id, status: 'failed', failReason: reason, items: [], placeholder: true, createdAt: clock / 1000 })
        const b = bs.get(id)
        if (b && !b.outcome) Object.assign(b, { outcome: delivered ? 'delivered' : 'failed', outcomeReason: delivered ? undefined : reason || 'failed' })
        for (const h of handoffIds ?? []) links.add(id + '|' + h)
        for (const h of linked(id)) {
          const fromBatch = b ? forHandoff(b, h) : { handoffId: h, batchId: id, delivered, ...(delivered ? {} : { reason: reason || 'failed' }) }
          if (!fromBatch) continue
          const r = ledger(h, { op: 'settle', settled: fromBatch })
          settled.push(told(r.res.settled))
        }
      }
    }
  }
  // the local batch records over the same storage (plugin: deps.batches)
  deps.batches = createBatchCatalog({ storage: store, api: deps.api })
  const env = {
    storage: store,
    now: () => clock,
    setTimeout: (f, ms) => {
      timers.set(++t, { f, ms })
      return t
    },
    clearTimeout: (n) => timers.delete(n),
    isBusy: () => busyNow,
    submit: (key, text) => {
      submits.push({ key, text })
      return true
    },
    drafts: new Map([['s1', '正文请比较两种方案']]),
    getDraft: async (key) => env.drafts.get(key) ?? '',
    setDraft: async (key, text) => (env.drafts.set(key, text), true),
    contextMax: () => null,
    sleep: async () => {
      busyNow = false
    },
    storedIdFor: () => null,
    findUserRow: findUserRow ?? (async () => null)
  }
  const flow = createSendFlow(deps, env)
  const add = (id = 'i1', text = '缓存策略', comment = '请解释', origin = { sessionId: 's1', role: 'assistant', ordinal: 1, rowId: 1 }) =>
    lists.dispatch('s1', { type: 'add', id, item: { origin, text, comment } })
  const expand = (id) => {
    Object.assign(bs.get(id), { status: 'expanded', expandedAt: clock / 1000 })
    flow.handleEvent({ type: 'plugin.diple.batch.sent', payload: { batchId: id, sessionId: 's1' } })
  }
  const fireTimers = async () => {
    const all = [...timers.entries()]
    timers.clear()
    for (const [, x] of all) await x.f()
    await flush()
  }
  return {
    flow, add, expand, deps, env, lists, map, bs, submits, notes, answerCalls, failed, emitted, settled, timers, fireTimers, claimSet,
    progressCalls, replays, finalCalls, finals, puts, links,
    setBusy: (v) => (busyNow = v), setNow: (v) => (clock = v), now: () => clock
  }
}

export const errors = (f) => f.notes.filter((n) => n.kind === 'error')
