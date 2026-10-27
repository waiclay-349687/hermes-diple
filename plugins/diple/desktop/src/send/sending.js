// The send module (D1 L3, design §5.4 option C, ADR 0009): one interface per
// role. The UI gets createSending's five entries and nothing else; the host
// wiring (gateway events, the composer middleware, the review → annotation
// hand-off, focus, reconnect, resume after a reload) goes through bindSending;
// the batch records are deps.batches (shared/batch-catalog.js). Inside, the
// proven protocol implementation runs unchanged: createSendFlow (send-flow.js)
// and the hand-off receiver (handoff.js), which also share start / settle /
// the outbox between themselves.
//
//   const sending = createSending(deps, env, { reveal?, receiver? })
//
//   sending.request(key, { bodySource: 'draft' | 'explicit', body? })
//       → Promise<{ ok, batchId?, queued?, reason?, done? }>   (send-flow start())
//       draft: the session's composer text goes with it (and is cleared after,
//       unless the user typed on); explicit: `body` (default '') and the
//       composer is not touched. `done` settles when the turn proves delivery.
//       reason ∈ disabled | no-session | empty | already-sending | too-large |
//       register-failed | submit-refused | cancelled (the strings the UI shows).
//   sending.preview(key, body?) → { display, full, stats, size } | null
//   sending.get(key) → SendView { queued, status, receipt, notices }
//       a frozen snapshot: the same object until one of its parts changes
//       (safe for useSyncExternalStore); key null → the empty view
//       queued   the "send after reply" record or null
//       status   { batchId, phase: 'sending' | 'delivered' } | null
//       receipt  { batchId, count, delivered } | null — delivered:false = not confirmed yet
//       notices  [{ batchId, kind: 'none' | 'missing', numbers }] (frozen [] when none)
//   sending.subscribe(key, fn) → off     fn() after any part of that view changed
//   sending.resolve(key, action) → Promise<{ ok, count? }>
//       { type: 'cancel-queue' }                      ok: there was a queue to cancel
//       { type: 'put-back-confirmation', batchId }    ok: that send was still unconfirmed
//       { type: 'keep-confirmation', batchId }        ok: same
//       { type: 'dismiss-notice', batchId }           ok: that notice was there
//       { type: 'put-back-notice', batchId, numbers } count: items put back (0 when the
//                                                     batch record is gone); ok: count > 0
//       { type: 'clear-receipt' }                     ok: there was one
//       an unknown type → { ok: false } (never a silent success)
//   useSending(sending, key) → SendView, reactive (the React adapter)
//
//   const bound = bindSending(ctx, sending, { live, session, gateway?, beforeEvent? })
//       subscribes the gateway turn events and plugin.diple.batch.sent,
//       plugin.diple-docs.handoff, session focus (live.watchFocus) and gateway
//       reconnects (gateway: an atom { get, listen }); every subscription ends
//       with ctx.onDispose. beforeEvent(e) runs before each turn event.
//   bound.middleware(draft) → Promise<draft | draft' | null>   the main send button
//       (the host's composer middleware contract: unchanged draft, the draft with
//       the batch appended, or null = keep the text in the composer)
//   bound.resume() → Promise   re-attach what was in flight before a reload (call once,
//       after the contributions are registered — the order the plugin always had)
//
// Not here on purpose: settle, flushOutbox and the receiver's start — the UI
// must never be able to forge a final word. Timeouts, persisted formats,
// await points and failure words are send-flow.js's, untouched by this module.

import { useSyncExternalStore } from 'react'

import { createHandoffReceiver } from './handoff.js'
import { createSendFlow } from './send-flow.js'
import { PLUGIN_ID } from '../shared/i18n.js'

const EMPTY_LIST = Object.freeze([])
const EMPTY_VIEW = Object.freeze({ queued: null, status: null, receipt: null, notices: EMPTY_LIST })
const INSIDE = new WeakMap() // sending → { flow, receive }: the host seam only (bindSending)

export function createSending(deps, env, { reveal, receiver = {} } = {}) {
  const flow = createSendFlow(deps, env)
  const receive = createHandoffReceiver({ deps, flow, ...(reveal ? { reveal } : {}), ...receiver })
  const views = new Map() // key → the last SendView handed out
  const parts = [flow.queue, flow.status, flow.receipt, flow.notices]

  function get(key) {
    if (!key) return EMPTY_VIEW
    const queued = flow.queue.get(key) ?? null
    const status = flow.status.get(key) ?? null
    const receipt = flow.receipt.get(key) ?? null
    const notices = flow.notices.get(key) ?? EMPTY_LIST
    const last = views.get(key)
    if (last && last.queued === queued && last.status === status && last.receipt === receipt && last.notices === notices) return last
    const view = Object.freeze({ queued, status, receipt, notices })
    views.set(key, view)
    return view
  }

  function subscribe(key, fn) {
    if (!key) return () => {}
    const offs = parts.map((p) => p.subscribe(key, fn))
    return () => offs.forEach((off) => off())
  }

  const request = (key, { bodySource = 'draft', body } = {}) => flow.start(key, { useDraft: bodySource === 'draft', ...(body != null ? { body } : {}) })

  async function resolve(key, action) {
    switch (action?.type) {
      case 'cancel-queue':
        return { ok: flow.queue.cancel(key) }
      case 'put-back-confirmation':
        return { ok: flow.pendingConfirm.putBack(key, action.batchId) }
      case 'keep-confirmation':
        return { ok: flow.pendingConfirm.keep(key, action.batchId) }
      case 'dismiss-notice': {
        const was = flow.notices.get(key).some((n) => n.batchId === action.batchId)
        flow.notices.dismiss(key, action.batchId)
        return { ok: was }
      }
      case 'put-back-notice': {
        const count = await flow.notices.putBack(key, action.batchId, action.numbers ?? [])
        return { ok: count > 0, count }
      }
      case 'clear-receipt': {
        const was = flow.receipt.get(key) != null
        flow.receipt.clear(key)
        return { ok: was }
      }
      default:
        return { ok: false }
    }
  }

  const sending = Object.freeze({ request, preview: (key, body) => flow.preview(key, body), get, subscribe, resolve })
  INSIDE.set(sending, { flow, receive })
  return sending
}

/** The React adapter: the key's SendView, re-rendering when it changes. */
export function useSending(sending, key) {
  return useSyncExternalStore(
    (fn) => sending.subscribe(key, fn),
    () => sending.get(key)
  )
}

const TURN_EVENTS = ['message.start', 'message.complete', 'error', `plugin.${PLUGIN_ID}.batch.sent`]

export function bindSending(ctx, sending, { live, session, gateway = null, beforeEvent = null }) {
  const inside = INSIDE.get(sending)
  if (!inside) throw new Error('bindSending: not a sending module')
  const { flow, receive } = inside
  const onEvent = (e) => {
    beforeEvent?.(e)
    return flow.handleEvent(e)
  }
  for (const type of TURN_EVENTS) ctx.onDispose(ctx.onEvent(type, onEvent))
  ctx.onDispose(ctx.onEvent('plugin.diple-docs.handoff', (e) => void receive(e?.payload)))
  ctx.onDispose(live.watchFocus(() => void flow.onSessionFocus(session.currentKey())))
  // The gateway (re)connected: retry sends whose confirmation was parked (R2 XE-01).
  if (gateway?.listen) {
    let last = gateway.get?.()
    ctx.onDispose(
      gateway.listen((v) => {
        if (v === 'open' && last !== 'open') void flow.reconnected()
        last = v
      })
    )
  }
  return { middleware: (draft) => flow.middleware(draft), resume: () => flow.resume() }
}
