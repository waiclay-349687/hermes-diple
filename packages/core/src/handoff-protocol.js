// The hand-off protocol between the two plugins (ADR 0007, design §4).
// Pure logic, no I/O: three state machines, each `step(state, event) →
// { state, effects, result? }`. Callers run the effects and feed what came
// back in as the next event; they never decide protocol questions themselves.
//
//   ledgerStep(rec, req, now)  the Diple backend's claim record for one hand-off
//                              (plugins/diple/python/store.py is its SQLite twin;
//                              both run test/handoff-ledger.cases.json)
//   receiverStep(s, event)     one Diple window running one hand-off
//   senderStep(s, event)       the Review window that made the hand-off, from
//                              broadcast to the final word
//
// Invariants (checked by the permutation tests):
//   1. one hand-off is submitted at most once, under one batch id;
//   2. a failed send is never shown as sent when the receiver declared
//      `settles: true`, and the last word on a failed send is 'returned'.

export const LEASE_MS = 30_000
/** An unfenced side effect (adding to the list) needs a lease younger than this. */
export const FRESH_MS = LEASE_MS / 2
export const STAGES = ['claimed', 'added', 'sending']
export const LOST = 'lost-claim'
/** Legacy receivers (no `settles`): batch.sent + this much silence counts as sent. */
export const INFER_AFTER_MS = 60_000
/** How long the sender waits before saying "unknown" (still correctable later). */
export const UNKNOWN_AFTER_MS = 10 * 60_000

const stageAt = (s) => STAGES.indexOf(s)
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null))

// =============================================================================================
// Ledger: the claim record. rec = { owner, generation, batchId, stage, accepted, at,
// receipt, settled } | null. req.op: claim | advance | receipt | settle.
// → { rec, status: 200 | 409, res }
// =============================================================================================
export function ledgerStep(rec, req, now) {
  const lost = { rec, status: 409, res: { detail: LOST } }
  const holds = (r) => r && r.owner != null && r.owner === req.owner && r.generation === req.generation
  switch (req.op) {
    case 'claim': {
      if (!rec) {
        const r = { owner: req.owner, generation: 1, batchId: req.batchId ?? null, stage: 'claimed', accepted: [], at: now, receipt: null, settled: null }
        return { rec: r, status: 200, res: clean({ claimed: true, owner: r.owner, generation: 1, batchId: r.batchId }) }
      }
      if (rec.receipt || rec.settled) {
        return { rec, status: 200, res: clean({ claimed: false, receipt: rec.receipt, settled: rec.settled }) }
      }
      if (now - rec.at > LEASE_MS) {
        const r = { ...rec, owner: req.owner, generation: rec.generation + 1, at: now, batchId: rec.batchId ?? req.batchId ?? null }
        const progress = r.stage !== 'claimed' ? clean({ stage: r.stage, accepted: r.accepted, batchId: r.batchId }) : null
        return { rec: r, status: 200, res: clean({ claimed: true, owner: r.owner, generation: r.generation, batchId: r.batchId, progress }) }
      }
      return { rec, status: 200, res: { claimed: false } }
    }
    case 'advance': {
      if (!holds(rec) || rec.receipt || rec.settled || stageAt(req.stage) < 0 || stageAt(req.stage) < stageAt(rec.stage)) return lost
      const r = { ...rec, stage: req.stage, accepted: req.accepted ?? rec.accepted, at: now }
      return { rec: r, status: 200, res: { ok: true, generation: r.generation } }
    }
    case 'receipt': {
      if (!holds(rec)) return lost
      if (rec.receipt) return { rec, status: 200, res: { ok: true, receipt: rec.receipt } }
      const r = { ...rec, receipt: req.receipt, at: now }
      return { rec: r, status: 200, res: { ok: true, receipt: r.receipt } }
    }
    case 'settle': {
      const base = rec ?? { owner: null, generation: 0, batchId: req.settled?.batchId ?? null, stage: 'claimed', accepted: [], at: now, receipt: null, settled: null }
      if (base.settled) return { rec: base, status: 200, res: { settled: base.settled, first: false } }
      const r = { ...base, settled: req.settled }
      return { rec: r, status: 200, res: { settled: r.settled, first: true } }
    }
    default:
      return { rec, status: 400, res: { detail: 'unknown op' } }
  }
}

// ---------------------------------------------------------------------------------------------
// Settling a hand-off from its batch (ADR 0007 §5). Each function below has a Python twin
// (settledFromBatch / settledForHandoff / settledForPeer: plugins/diple/python/store.py;
// itemOutcomes: plugins/diple-docs/python/store.py). Both run the shared cases
// (test/handoff-settle.cases.json) and a differential test over generated inputs
// (test/protocol-diff.mjs, run from tests/python/test_protocol_diff.py), so they agree on
// every input — including malformed ones: ids are strings, revisions integers, reasons
// are cut to REASON_MAX code points.
// ---------------------------------------------------------------------------------------------
export const REASON_MAX = 100
/** Peer capability (R5 XE5-02): the sender reads a per-item settled (`items`) and shows
 *  only the items that went out as sent. Declared in the hand-off payload's `caps`. */
export const CAP_PARTIAL = 'partial'

const cut = (s) => Array.from(String(s)).slice(0, REASON_MAX).join('')
const isInt = (x) => typeof x === 'number' && Number.isInteger(x)
const reasonOr = (r, fallback) => (typeof r === 'string' && r ? cut(r) : fallback)

/** A batch's final word for its hand-offs: { batchId, delivered, reason? } | null. */
export function settledFromBatch(batch) {
  if (!batch || typeof batch.batchId !== 'string' || !batch.batchId) return null
  if (batch.outcome === 'delivered' || (batch.outcome == null && batch.status === 'answered')) return { batchId: batch.batchId, delivered: true }
  if (batch.outcome === 'failed') return { batchId: batch.batchId, delivered: false, reason: reasonOr(batch.outcomeReason, 'failed') }
  return null
}

/** Accepted items of a hand-off as [{ itemId, revision? }]; bare ids (a receipt's
 *  `accepted`) carry no revision. Only string ids, integer revisions. */
function acceptedVersions(accepted) {
  if (!Array.isArray(accepted)) return []
  const out = []
  for (const a of accepted) {
    if (typeof a === 'string') out.push({ itemId: a })
    else if (a && typeof a === 'object' && typeof a.itemId === 'string') out.push(isInt(a.revision) ? { itemId: a.itemId, revision: a.revision } : { itemId: a.itemId })
  }
  return out
}

/**
 * One hand-off's final word from the batch it was linked to (ADR 0007 §5,
 * R4 XE4-02, R5). Only the accepted items that really ride in the batch (same
 * itemId and, when known, revision) share its outcome; an accepted item that
 * is not in it was removed from the pending list ('removed') or replaced by
 * another version ('replaced') and never went out.
 *   batch.items: Array = the batch was REGISTERED with these entries — its
 *                membership is known, even when no entry is a hand-off item (a
 *                batch of manual annotations only, or none at all);
 *                null / missing = never registered (a spent id): unknown.
 *   accepted:    [{ itemId, revision? }] | [itemId] | null (unknown: legacy)
 *   Unknown membership (either side) → the batch's word for the whole hand-off.
 * → { handoffId, batchId, delivered, reason?, items? } | null (no final word yet)
 *   items: [{ itemId, delivered, reason? }] only when membership is not whole;
 *   none carried → delivered:false with reason 'removed' / 'replaced'.
 */
export function settledForHandoff(batch, handoffId, accepted) {
  const st = settledFromBatch(batch)
  if (!st) return null
  const base = { handoffId, ...st }
  const want = acceptedVersions(accepted)
  if (!want.length || !Array.isArray(batch.items)) return base
  const carried = new Map() // itemId → Set<revision | null>
  for (const it of batch.items) {
    const o = it && typeof it === 'object' ? it.origin : null
    if (!o || typeof o !== 'object' || typeof o.itemId !== 'string') continue
    if (!carried.has(o.itemId)) carried.set(o.itemId, new Set())
    carried.get(o.itemId).add(isInt(o.revision) ? o.revision : null)
  }
  const rows = want.map((a) => {
    const revs = carried.get(a.itemId)
    const inBatch = Boolean(revs) && (a.revision === undefined || revs.has(a.revision))
    return { itemId: a.itemId, inBatch, missing: inBatch ? null : revs ? 'replaced' : 'removed' }
  })
  if (rows.every((r) => r.inBatch)) return base
  const items = rows.map((r) =>
    r.inBatch ? (st.delivered ? { itemId: r.itemId, delivered: true } : { itemId: r.itemId, delivered: false, reason: st.reason }) : { itemId: r.itemId, delivered: false, reason: r.missing }
  )
  if (!rows.some((r) => r.inBatch)) {
    const reason = rows.some((r) => r.missing === 'replaced') ? 'replaced' : 'removed'
    return { handoffId, batchId: st.batchId, delivered: false, reason, items }
  }
  return { ...base, items }
}

/**
 * The settled a peer may be TOLD (R5 XE5-02): a sender that did not declare
 * CAP_PARTIAL in its hand-off reads only `delivered` and would show every item
 * as sent. A partly carried hand-off is then reported as not delivered
 * (reason 'partial'): the older sender puts its items back as pending — the
 * user may send one twice, but never sees an unsent item as sent. The stored
 * settled is unchanged; this is only what goes on the wire.
 *   caps: the hand-off payload's `caps` (array of strings) | anything else = none
 */
export function settledForPeer(settled, caps) {
  if (!settled || typeof settled !== 'object') return settled
  if (Array.isArray(caps) && caps.includes(CAP_PARTIAL)) return settled
  if (!('items' in settled)) return settled
  const { items, ...rest } = settled
  const partial = rest.delivered === true && Array.isArray(items) && items.some((x) => !(x && x.delivered === true))
  if (!partial) return rest
  const { reason, ...out } = rest
  return { ...out, delivered: false, reason: 'partial' }
}

/**
 * Each handed-over item's final word from a settled: [{ itemId, delivered, reason? }],
 * in `itemIds` order. An item may count as delivered only when the hand-off was:
 * with a per-item list, its own entry decides (an item missing from a list that
 * exists did not go out, 'unlisted'); without one, the hand-off's word.
 */
export function itemOutcomes(settled, itemIds) {
  const top = settled?.delivered === true
  const topReason = typeof settled?.reason === 'string' && settled.reason ? settled.reason : null
  const listed = Array.isArray(settled?.items) ? new Map() : null
  if (listed) {
    for (const x of settled.items) {
      if (x && typeof x === 'object' && typeof x.itemId === 'string' && typeof x.delivered === 'boolean' && !listed.has(x.itemId)) listed.set(x.itemId, x)
    }
  }
  const ids = Array.isArray(itemIds) ? itemIds.filter((x) => typeof x === 'string') : []
  return ids.map((itemId) => {
    if (listed) {
      const w = listed.get(itemId)
      if (!w) return { itemId, delivered: false, reason: 'unlisted' }
      if (top && w.delivered) return { itemId, delivered: true }
      const why = typeof w.reason === 'string' && w.reason ? w.reason : topReason
      return why ? { itemId, delivered: false, reason: why } : { itemId, delivered: false }
    }
    if (top) return { itemId, delivered: true }
    return topReason ? { itemId, delivered: false, reason: topReason } : { itemId, delivered: false }
  })
}

// =============================================================================================
// Receiver: one Diple window, one hand-off.
//
// events  payload {handoffId, key, sendNow, owner, batchId, now}  (every broadcast of it)
//         claimed {res | null, now}       advanced {status: ok|lost|error, now}
//         added {accepted}                started {r}         inspected {batch | null}
//         receipted {status: ok|lost|error}                   replayed {}
// effects claim {owner, batchId} · advance {stage, accepted, owner, generation} · add
//         start {batchId, reveal?} · receipt {receipt, owner, generation} · inspect {batchId}
//         replay · final {batchId, delivered, reason?} · notify {kind, reason}
// At most one effect per step expects an answer (the last one); the others are fire-and-forget.
// result  {handled, reason?, accepted?, batchId?, resumed?} whenever a run comes to rest.
// =============================================================================================
export const receiverInit = () => ({ phase: 'new' })

export function receiverStep(s, e) {
  const out = (state, effects = [], result) => ({ state, effects, ...(result ? { result } : {}) })
  const receiptOf = (st, extra = {}) => clean({ handoffId: st.handoffId, accepted: st.accepted ?? [], ...extra })
  const emitReceipt = (st, receipt) => {
    const next = { ...st, phase: 'receipting', receipt }
    return out(next, [{ type: 'receipt', receipt, owner: st.owner, generation: st.generation }])
  }
  // askedAt: when the request left — a later side effect needs the answer to a FRESH request
  const advance = (st, phase, stage, now) =>
    out({ ...st, phase, askedAt: now, asked: stage }, [{ type: 'advance', stage, accepted: st.accepted ?? [], owner: st.owner, generation: st.generation }])
  const fresh = (st, now) => typeof now === 'number' && typeof st.askedAt === 'number' && now - st.askedAt <= FRESH_MS

  switch (e.type) {
    case 'payload': {
      if (s.phase === 'new' || s.phase === 'elsewhere') {
        const st = { phase: 'claiming', handoffId: e.handoffId, key: e.key, sendNow: Boolean(e.sendNow), owner: e.owner, proposed: e.batchId, claimAt: e.now }
        return out(st, [{ type: 'claim', owner: e.owner, batchId: e.batchId }])
      }
      if (s.phase === 'done' && !s.receiptStored && s.receipt) return emitReceipt(s, s.receipt)
      if (s.phase === 'done' || s.phase === 'lost') return out({ ...s, back: s.phase, phase: 'replaying' }, [{ type: 'replay' }])
      return out(s, [], { handled: false, reason: 'seen' }) // still running here
    }
    case 'claimed': {
      const res = e.res
      if (!res) return out({ phase: 'new' }, [], { handled: false, reason: 'claim-failed' })
      if (!res.claimed) {
        if (res.receipt || res.settled) return out({ ...s, phase: 'replaying', back: 'done', receiptStored: true }, [{ type: 'replay' }])
        return out({ ...s, phase: 'elsewhere' }, [], { handled: false, reason: 'claimed-elsewhere' })
      }
      const st = { ...s, owner: res.owner ?? s.owner, generation: res.generation, batchId: res.batchId ?? s.proposed }
      const p = res.progress
      if (p?.stage === 'sending') {
        const acc = Array.isArray(p.accepted) ? p.accepted.map(String) : []
        return out({ ...st, phase: 'resuming', accepted: acc }, [{ type: 'inspect', batchId: p.batchId ?? st.batchId }])
      }
      if (e.now - s.claimAt > FRESH_MS) {
        // the answer took long: another window may have taken over meanwhile — check first
        return advance({ ...st, accepted: p?.accepted ?? [] }, 'fencing', p?.stage ?? 'claimed', e.now)
      }
      return out({ ...st, phase: 'adding' }, [{ type: 'add' }])
    }
    case 'added':
      return advance({ ...s, accepted: e.accepted ?? [] }, 'recording', 'added', e.now)
    case 'advanced': {
      if (e.status === 'lost') return out({ ...s, phase: 'lost' }, [], { handled: false, reason: LOST })
      if (s.phase === 'fencing') {
        if (e.status !== 'ok') return out({ phase: 'new' }, [], { handled: false, reason: 'claim-failed' })
        // the check itself must be fresh: an answer that took long proves nothing about now
        if (!fresh(s, e.now)) return advance(s, 'fencing', s.asked, e.now)
        return out({ ...s, phase: 'adding' }, [{ type: 'add' }])
      }
      if (s.phase === 'recording') {
        if (s.sendNow && s.accepted.length) return advance(s, 'sending', 'sending', e.now)
        const notes = s.accepted.length ? [{ type: 'notify', kind: 'info', reason: 'added', count: s.accepted.length }] : []
        const r = emitReceipt(s, receiptOf(s))
        return { ...r, effects: [...notes, ...r.effects] }
      }
      if (s.phase === 'sending') {
        if (e.status === 'ok') {
          // submit only on a fresh lease: a late "ok" may predate another window's take-over
          if (!fresh(s, e.now)) return advance(s, 'sending', 'sending', e.now)
          return out({ ...s, phase: 'starting' }, [{ type: 'start', batchId: s.batchId }])
        }
        // cannot make the send idempotent: do not send; the items wait in the list
        const r = emitReceipt(s, receiptOf(s))
        return { ...r, effects: [{ type: 'notify', kind: 'warning', reason: 'not-recorded' }, { type: 'final', batchId: s.batchId, delivered: false, reason: 'not-recorded' }, ...r.effects] }
      }
      return out(s)
    }
    case 'started': {
      const r = e.r ?? { ok: false, reason: 'error' }
      if (r.ok && r.queued) return emitReceipt(s, receiptOf(s, { queued: true }))
      if (r.ok && r.batchId) return emitReceipt({ ...s, sent: r.batchId }, receiptOf(s, { batchId: r.batchId }))
      if (!r.ok && r.reason === 'submit-refused' && !s.revealed) {
        // the session is not on screen (直接发送 pressed on the review page)
        return out({ ...s, revealed: true }, [{ type: 'start', batchId: s.batchId, reveal: true }])
      }
      const rr = emitReceipt(s, receiptOf(s))
      return { ...rr, effects: [{ type: 'notify', kind: 'error', reason: r.reason }, { type: 'final', batchId: s.batchId, delivered: false, reason: r.reason }, ...rr.effects] }
    }
    case 'inspected': {
      // a take-over of a claim whose window recorded "sending": report, never send again
      const b = e.batch
      // registered = submitted by the window that died (or about to be): its own outcome settles it
      const went = b?.status === 'registered' || b?.status === 'expanded' || b?.status === 'answered'
      // never registered: settle it as lost — the backend then refuses that batch id for
      // good, so a slow (not dead) holder cannot register and send it later (ADR 0007 §2)
      const finals = b?.status === 'answered'
        ? [{ type: 'final', batchId: b.batchId, delivered: true }]
        : b?.status === 'failed'
          ? [{ type: 'final', batchId: b.batchId, delivered: false, reason: b.failReason || 'failed' }]
          : !b && s.batchId
            ? [{ type: 'final', batchId: s.batchId, delivered: false, reason: 'lost' }]
            : []
      const r = emitReceipt({ ...s, resumed: true }, receiptOf(s, went ? { batchId: b.batchId } : {}))
      return { ...r, effects: [...finals, ...r.effects] }
    }
    case 'receipted': {
      if (e.status === 'lost') return out({ ...s, phase: 'lost' }, [], { handled: false, reason: LOST })
      const st = { ...s, phase: 'done', receiptStored: e.status === 'ok' }
      return out(st, [], clean({ handled: true, accepted: s.accepted, batchId: s.receipt?.batchId, resumed: s.resumed || undefined }))
    }
    case 'replayed':
      return out({ ...s, phase: s.back ?? 'done' }, [], { handled: false, reason: 'replayed' })
    default:
      return out(s)
  }
}

// =============================================================================================
// Sender: the Review window that made a hand-off.
//
// events  receipt {receipt} · settled {delivered, reason?, batchId?} (real)
//         sent {batchId} · answered {batchId} · fallback (the timer armed by `wait`)
// effects result {result}          the answer of send(): what the receipt says
//         wait {queued, settles}   start pulling / arm the fallback timer
//         final {outcome, reason?, corrected?, items?}       the last word (onSettled)
//         record {delivered, reason?, inferred, items?}      persist an inferred conclusion
//   An inferred final and its record come from ONE word (R6 XE6-01): `carried` on sent /
//   answered (the hand-off items the batch events listed) decides each item; an item
//   they did not carry is {delivered:false, reason:'removed'}, never the batch's word.
// =============================================================================================

/** What a receipt says happened, for a hand-off of `itemIds`. */
export function readReceipt(r, { sendNow, itemIds }) {
  const wanted = new Set(itemIds)
  const accepted = (Array.isArray(r?.accepted) ? r.accepted : []).filter((x) => typeof x === 'string' && wanted.has(x))
  if (!accepted.length) return { ok: false, reason: 'rejected' }
  const batchId = typeof r.batchId === 'string' && r.batchId ? r.batchId : null
  const outcome = !sendNow ? 'added' : batchId ? 'submitted' : r.queued === true ? 'queued' : 'not-sent'
  return { ok: true, outcome, accepted, missed: wanted.size - accepted.length, ...(batchId ? { batchId } : {}) }
}

export const senderInit = ({ sendNow, itemIds }) => ({ phase: 'receipt', sendNow: Boolean(sendNow), itemIds, early: null })

const outcomeOf = (delivered) => (delivered === true ? 'sent' : delivered === false ? 'returned' : 'unknown')

/** Remember the items a legacy batch event carried (sent / answered `carried`). */
const carry = (s, e) =>
  Array.isArray(e.carried) ? { ...s, carried: [...new Set([...(s.carried ?? []), ...e.carried.filter((x) => typeof x === 'string')])] } : s

/**
 * The conclusion drawn from an Diple that never settles (R6 XE6-01): the batch went
 * out, but only the accepted items its events carried did. → { final, record } effects
 * built from the same per-item word. Nothing known about the members → the whole hand-off.
 */
function inferredSent(s, inferred) {
  const ids = s.base.accepted
  let word = { delivered: true }
  if (Array.isArray(s.carried) && !ids.every((id) => s.carried.includes(id))) {
    const items = ids.map((id) => (s.carried.includes(id) ? { itemId: id, delivered: true } : { itemId: id, delivered: false, reason: 'removed' }))
    word = items.some((x) => x.delivered) ? { delivered: true, items } : { delivered: false, reason: 'removed', items }
  }
  const { delivered, reason, items } = word
  const shown = outcomeOf(delivered)
  const state = { ...s, phase: 'final', shown, inferred: true, real: false, word }
  return {
    state,
    effects: [
      { type: 'final', outcome: shown, ...clean({ reason }), ...(items ? { items } : {}) },
      { type: 'record', delivered, ...clean({ reason }), inferred, ...(items ? { items } : {}) }
    ]
  }
}

export function senderStep(s, e) {
  const out = (state, effects = []) => ({ state, effects })
  switch (e.type) {
    case 'receipt': {
      if (s.phase !== 'receipt') return out(s)
      const base = readReceipt(e.receipt, s)
      const settles = e.receipt?.settles === true
      if (!base.ok) return out({ ...s, phase: 'final', base }, [{ type: 'result', result: base }])
      const awaits = base.outcome === 'submitted' || base.outcome === 'queued'
      // a settled that beat its receipt is the final word (a send that failed at once)
      if (base.outcome !== 'added' && s.early) {
        const shown = outcomeOf(s.early.delivered)
        const result = clean({ ...base, outcome: shown, reason: s.early.delivered ? undefined : s.early.reason })
        return out({ ...s, phase: 'final', base, settles, shown, real: true }, [{ type: 'result', result }])
      }
      if (!awaits) return out({ ...s, phase: 'final', base, settles, shown: base.outcome, real: false }, [{ type: 'result', result: base }])
      const st = { ...s, phase: 'settling', base, settles, batchId: base.batchId ?? null, sentSeen: false }
      return out(st, [{ type: 'result', result: base }, { type: 'wait', queued: base.outcome === 'queued', settles }])
    }
    case 'settled': {
      if (typeof e.delivered !== 'boolean') return out(s)
      const reason = e.delivered ? undefined : e.reason
      if (s.phase === 'receipt') return out({ ...s, early: clean({ delivered: e.delivered, reason }) })
      if (s.phase === 'settling') {
        const shown = outcomeOf(e.delivered)
        return out({ ...s, phase: 'final', shown, real: true }, [{ type: 'final', outcome: shown, ...clean({ reason }) }])
      }
      if (s.phase === 'final' && !s.real && (s.inferred || s.shown === 'unknown')) {
        // a real result after a conclusion this window drew itself (XR3-04)
        const shown = outcomeOf(e.delivered)
        const st = { ...s, shown, real: true, inferred: false }
        return out(st, shown === s.shown ? [] : [{ type: 'final', outcome: shown, corrected: true, ...clean({ reason }) }])
      }
      return out(s) // first real word wins; duplicates are no-ops
    }
    case 'sent': {
      if (s.phase !== 'settling' || (s.batchId && e.batchId && s.batchId !== e.batchId)) return out(s)
      if (s.sentSeen) return out(carry(s, e))
      const st = { ...carry(s, e), sentSeen: true, batchId: s.batchId ?? e.batchId ?? null }
      // legacy receivers: a queued hand-off's deadline starts at its batch.sent
      return out(st, !s.settles && !s.batchId ? [{ type: 'wait', queued: false, settles: false, rearm: true }] : [])
    }
    case 'answered': {
      if (s.phase !== 'settling' || s.settles) return out(s)
      return inferredSent(carry(s, e), 'batch.answered')
    }
    case 'fallback': {
      if (s.phase !== 'settling') return out(s)
      if (!s.settles && s.sentSeen) {
        return inferredSent(s, 'batch.sent')
      }
      return out({ ...s, phase: 'final', shown: 'unknown', real: false }, [{ type: 'final', outcome: 'unknown' }])
    }
    default:
      return out(s)
  }
}

/** How long the sender waits for the final word before `fallback`. */
export function fallbackAfter({ queued, settles }) {
  if (settles) return UNKNOWN_AFTER_MS
  return queued ? UNKNOWN_AFTER_MS : INFER_AFTER_MS
}
