// Receiving side of the review → annotation hand-off (design §4, ADR 0007).
//
//   createHandoffReceiver({ deps, flow, reveal?, sleep?, now?, owner? }) → handle(payload) → Promise<result>
//
// plugin.diple-docs.handoff { v:1, handoffId, targetSessionId, sendNow, caps?, items:[{ origin, text, comment }] }
//   caps: what the sender understands — ['partial'] = it reads a per-item settled. Kept with
//   the claim: the backend only tells a sender that declared it which items went out; an
//   older one hears delivered:false, reason:'partial' for a partly carried hand-off (R5 XE5-02).
//
// The protocol itself — claim with owner + generation, CAS before each side
// effect, the batch id fixed at the claim, what a take-over may do, when a
// rebroadcast replays — is the shared state machine `Handoff.receiverStep`
// (packages/core/src/handoff-protocol.js). This module is its adapter: it runs
// the effects against the backend, the list and the send flow, and feeds the
// answers back in. Invariant: one hand-off is submitted at most once, under
// one batch id; a window that lost its claim (409) stops at once.
//
// The final word of a sendNow hand-off (plugin.diple.handoff.settled) is
// not sent from here: the send flow's outbox records how the batch ended and
// the backend settles every hand-off in it (ADR 0007 §4). A rebroadcast of a
// finished hand-off asks the backend to replay its receipt and settled.
//
// A window that is not showing targetSessionId waits CLAIM_DEFER_MS before it
// claims, so the window the user is looking at normally wins (lists are
// cached per window; see W2b Comments).
// Plugin off → ignored entirely: no receipt, so the review page greys its
// send buttons out after its own 3 s timeout.

import { Handoff } from '@diple/core'

export const CLAIM_DEFER_MS = 1500

const rev = (o) => (typeof o?.revision === 'number' ? o.revision : -Infinity)
const sameVersion = (saved, inc) =>
  String(saved.origin?.itemId) === String(inc.origin?.itemId) &&
  rev(saved.origin) === rev(inc.origin) &&
  saved.text === inc.text &&
  (saved.comment ?? '') === inc.comment

const randomOwner = () => {
  const c = globalThis.crypto
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, '')
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

// reveal(key): bring the target session's composer on screen (host.composer.submit
// only reaches a VISIBLE composer; 直接发送 is pressed on the review page).
export function createHandoffReceiver({
  deps,
  flow,
  reveal = async () => {},
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = () => Date.now(),
  owner = randomOwner()
}) {
  const { api, lists, ids, settings, notify, i18n } = deps
  const runs = new Map() // handoffId → { state, payload }

  /** The card already holds this review item: bring it up to the incoming
   *  version, unless that version is older or the card is being sent (locked). */
  function upgrade(key, id, inc) {
    const cur = lists.get(key).items.find((x) => x.id === id)
    if (!cur || rev(inc.origin) < rev(cur.origin)) return
    if (cur.text !== inc.text || JSON.stringify(cur.origin) !== JSON.stringify(inc.origin)) {
      lists.dispatch(key, { type: 'replaceText', id, text: inc.text, origin: inc.origin })
    }
    lists.dispatch(key, { type: 'editComment', id, comment: inc.comment })
  }

  // accepted: only items whose exact version (itemId + revision + comment)
  // is in the list afterwards (XE-05 / XR-02). Another plugin's items are
  // identified by { plugin, itemId }: a re-sent item updates its card, so
  // running this again after a take-over adds nothing twice.
  function addItems(key, items) {
    const accepted = []
    for (const it of items) {
      if (!it || typeof it.text !== 'string' || !it.text.trim()) continue
      const origin = it.origin && typeof it.origin === 'object' ? it.origin : null
      const comment = typeof it.comment === 'string' ? it.comment : ''
      const effects = lists.dispatch(key, { type: 'add', id: ids.newItemId(), item: { origin, text: it.text, comment } })
      const focus = effects.find((e) => e.type === 'focus')
      if (!focus) continue
      if (focus.duplicate) upgrade(key, focus.id, { origin, text: it.text, comment })
      const saved = lists.get(key).items.find((x) => x.id === focus.id)
      if (origin?.itemId != null && saved && sameVersion(saved, { origin, text: it.text, comment })) accepted.push(String(origin.itemId))
    }
    return accepted
  }

  /** The accepted items of a run as [{ itemId, revision }] (revision from its payload). */
  function versionsOf(run) {
    const rev = new Map()
    for (const it of run.payload?.items ?? []) if (it?.origin?.itemId != null) rev.set(String(it.origin.itemId), it.origin.revision)
    return (run.state.accepted ?? []).map((id) => ({ itemId: String(id), ...(typeof rev.get(String(id)) === 'number' ? { revision: rev.get(String(id)) } : {}) }))
  }

  const statusOf = (err) => (err?.status === 409 ? 'lost' : 'error')

  /** Run one effect that expects an answer; returns the event to feed back. */
  async function remote(eff, run) {
    const { handoffId, key } = run.state
    switch (eff.type) {
      case 'claim':
        try {
          const caps = Array.isArray(run.payload?.caps) ? run.payload.caps.filter((c) => typeof c === 'string') : []
          return { type: 'claimed', res: await api.claimHandoff(handoffId, key, { owner: eff.owner, batchId: eff.batchId, caps }), now: now() }
        } catch {
          return { type: 'claimed', res: null, now: now() }
        }
      case 'advance':
        try {
          await api.saveHandoffProgress(handoffId, { owner: eff.owner, generation: eff.generation, stage: eff.stage, accepted: eff.accepted })
          return { type: 'advanced', status: 'ok', now: now() }
        } catch (err) {
          return { type: 'advanced', status: statusOf(err), now: now() }
        }
      case 'receipt':
        try {
          await api.emitHandoffReceipt({ ...eff.receipt, owner: eff.owner, generation: eff.generation })
          return { type: 'receipted', status: 'ok' }
        } catch (err) {
          return { type: 'receipted', status: statusOf(err) }
        }
      case 'replay':
        // the review side is still waiting: first push out any final word this window
        // still holds (its outbox), then have the backend replay what it stores (XR3-02)
        await flow.flushOutbox?.()
        await api.replayHandoff?.(handoffId)?.catch?.(() => {})
        return { type: 'replayed' }
      case 'add':
        return { type: 'added', accepted: addItems(key, run.payload.items), now: now() }
      case 'inspect': {
        let batch = null
        try {
          batch = eff.batchId ? await api.getBatch(eff.batchId) : null
        } catch {
          batch = null // never registered (404) or unknown: it did not go out from here
        }
        return { type: 'inspected', batch }
      }
      case 'start': {
        if (eff.reveal) await reveal(key)
        // what this hand-off handed over, by version (R4 XE4-02): the batch's real
        // items decide which of them went out
        const r = await flow.start(key, { body: '', batchId: eff.batchId, handoffId, accepted: versionsOf(run) })
        return { type: 'started', r }
      }
      default:
        return null
    }
  }

  function local(eff, run) {
    const { handoffId } = run.state
    if (eff.type === 'final') {
      flow.settle?.({ batchId: eff.batchId, handoffIds: [handoffId], delivered: eff.delivered, reason: eff.reason })
    } else if (eff.type === 'notify') {
      if (eff.reason === 'added') notify({ kind: 'info', title: i18n.t('send.handoffAdded', eff.count) })
      else notify({ kind: eff.kind, title: i18n.t('send.failed'), message: i18n.t('send.reason.' + eff.reason) })
    }
  }

  async function drive(run, event) {
    let step = Handoff.receiverStep(run.state, event)
    let result = null
    for (;;) {
      run.state = step.state
      if (step.result) result = step.result
      let next = null
      for (const eff of step.effects) {
        const ev = eff.type === 'final' || eff.type === 'notify' ? (local(eff, run), null) : await remote(eff, run)
        if (ev) next = ev
      }
      if (!next) return result ?? { handled: false, reason: 'seen' }
      step = Handoff.receiverStep(run.state, next)
    }
  }

  return async function handle(payload) {
    if (!payload || payload.v !== 1) return { handled: false, reason: 'version' }
    if (!settings.get().enabled) return { handled: false, reason: 'disabled' }
    const { handoffId, targetSessionId: key } = payload
    const items = Array.isArray(payload.items) ? payload.items : []
    if (typeof handoffId !== 'string' || !key || !items.length) return { handled: false, reason: 'invalid' }
    let run = runs.get(handoffId)
    if (!run) runs.set(handoffId, (run = { state: Handoff.receiverInit(), payload }))
    if (run.busy) return { handled: false, reason: 'seen' } // still running here
    run.busy = true
    try {
      const fresh = run.state.phase === 'new' || run.state.phase === 'elsewhere'
      if (fresh && deps.session.currentKey() !== key) await sleep(CLAIM_DEFER_MS)
      if (fresh) run.payload = payload
      const r = await drive(run, { type: 'payload', handoffId, key, sendNow: Boolean(payload.sendNow), owner, batchId: ids.newBatchId(), now: now() })
      if (r.handled) return { handled: true, accepted: r.accepted ?? [], batchId: r.batchId, ...(r.resumed ? { resumed: true } : {}) }
      return r
    } finally {
      run.busy = false
    }
  }
}
