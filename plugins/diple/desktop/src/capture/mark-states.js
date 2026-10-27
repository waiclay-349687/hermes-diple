// What happened to the annotations already sent from a session, for the
// transcript marks (design §2.2): sent → answered / missing. Read-only: the
// send flow (send/) writes the local batch records (shared/batch-catalog.js)
// and the backend keeps each batch's status and answer check; nothing here
// writes either.
//
//   const sent = createSentMarks({ batches, api, enabled })   batches: the BatchCatalog
//   sent.forKey(key)  → [{ id, batchId, n, origin, text, comment, state }]
//                       state: 'sent' | 'answered' | 'missing'; n = its number in that batch
//   sent.refresh(key) → Promise   ask the backend again (debounced per key)
//   sent.subscribe(fn) → off      fn(key) after the backend answered
//   sent.find(itemId, key) → Promise<item | null>   for locate, regardless of the setting
//
// Shown only when the backend confirms the batch went out — the same
// derivation as the drawer (shared/batch-states.js): a final 'failed' outcome
// (not persisted, put back, cancelled) or an unknown batch draws nothing.

import { itemState } from '../shared/batch-states.js'

const DEBOUNCE_MS = 300
const LIMIT = 100

export function createSentMarks({ batches, api, enabled = () => true }) {
  const status = new Map() // key → Map(batchId → { status, answer })
  const timers = new Map()
  const listeners = new Set()

  const records = (key) => batches.localForSession(key)

  async function load(key) {
    try {
      const r = await api.listBatches({ sessionId: key, limit: LIMIT })
      const m = new Map()
      for (const b of r?.batches ?? []) if (b?.batchId) m.set(b.batchId, { status: b.status, answer: b.answer ?? null, outcome: b.outcome ?? null, items: b.items ?? null })
      status.set(key, m)
    } catch {
      status.set(key, new Map()) // unreachable: nothing is shown as sent
    }
    for (const fn of [...listeners]) fn(key)
  }

  return {
    forKey(key) {
      if (!key || !enabled()) return []
      const known = status.get(key)
      if (!known) {
        this.refresh(key)
        return []
      }
      const out = []
      for (const rec of records(key)) {
        const b = known.get(rec.batchId)
        if (!b) continue
        rec.items.forEach((it, i) => {
          const n = i + 1
          // the one derivation shared with the drawer (shared/batch-states.js)
          const state = itemState(b, it, n)
          if (!state) return
          out.push({ id: it.id, batchId: rec.batchId, n, origin: it.origin, text: it.text, comment: it.comment ?? '', state })
        })
      }
      return out
    },
    refresh(key) {
      if (!key) return Promise.resolve()
      clearTimeout(timers.get(key))
      return new Promise((resolve) => {
        timers.set(
          key,
          setTimeout(() => {
            timers.delete(key)
            load(key).then(resolve)
          }, DEBOUNCE_MS)
        )
      })
    },
    /** A sent annotation by its item id, for uiBus.locate — whatever the
     *  marks show (marksKeepSent off, the mark not drawn): the local batch
     *  records first, then the backend's records of `key`.
     *  → Promise<{ id, origin, text, comment } | null> */
    find: (itemId, key) => batches.findItem(itemId, key),
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    dispose() {
      for (const t of timers.values()) clearTimeout(t)
      timers.clear()
      listeners.clear()
    }
  }
}
