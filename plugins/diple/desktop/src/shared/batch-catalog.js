// The local batch records (D1 L2): what each sent batch carried, kept in the
// plugin storage for the response markers, the transcript marks and locate.
// The only module that knows the storage layout — `batch.<batchId>` per
// record and `batches.index` (oldest first) — the cap, and the way back to the
// backend when a record is not here.
//
//   const batches = createBatchCatalog({ storage, api })
//   batches.remember(rec)          rec = { batchId, sessionKey, items, at?, handoffIds? }
//                                  stored as given; moves to the newest end of the
//                                  index; beyond MAX_LOCAL_BATCHES the oldest go
//   batches.peek(batchId)          → rec | null      local only, never a request
//   batches.read(batchId)          → Promise<rec | null>
//                                  local first; else GET /batches/<id> → { batchId,
//                                  sessionKey, items }, remembered. A 404, an
//                                  unreachable backend or a batch without items → null
//   batches.localForSession(key)   → rec[]           this session's records with
//                                  items, in index order (oldest first)
//   batches.findItem(itemId, key?) → Promise<item | null>
//                                  an item with an origin: every session's local
//                                  records, newest first; then, with a key, the
//                                  backend's records of that session (limit 100);
//                                  unreachable → null
//
// A record says what a batch CARRIED, never whether it was delivered: the
// marks still draw only what the backend confirms (shared/batch-states.js).
// storage: { get(key, fallback), set, remove } (ctx.storage);
// api: { getBatch(id), listBatches({ sessionId, limit }) } (shared/api.js).

export const MAX_LOCAL_BATCHES = 200
const FIND_LIMIT = 100
const INDEX = 'batches.index'
const keyOf = (batchId) => `batch.${batchId}`

export function createBatchCatalog({ storage, api }) {
  const index = () => storage.get(INDEX, []) ?? []
  const peek = (batchId) => storage.get(keyOf(batchId), null)

  function remember(rec) {
    storage.set(keyOf(rec.batchId), rec)
    const order = index().filter((b) => b !== rec.batchId)
    order.push(rec.batchId)
    while (order.length > MAX_LOCAL_BATCHES) storage.remove(keyOf(order.shift()))
    storage.set(INDEX, order)
  }

  async function read(batchId) {
    const local = peek(batchId)
    if (local?.items) return local
    try {
      const r = await api.getBatch(batchId)
      if (!r?.items) return null
      const rec = { batchId, sessionKey: r.sessionId, items: r.items }
      remember(rec)
      return rec
    } catch {
      return null
    }
  }

  function localForSession(key) {
    const out = []
    for (const batchId of index()) {
      const rec = peek(batchId)
      if (rec?.sessionKey === key && Array.isArray(rec.items)) out.push(rec)
    }
    return out
  }

  async function findItem(itemId, key) {
    if (!itemId) return null
    for (const batchId of [...index()].reverse()) {
      const it = peek(batchId)?.items?.find?.((x) => x?.id === itemId)
      if (it?.origin) return it
    }
    if (!key) return null
    try {
      const r = await api.listBatches({ sessionId: key, limit: FIND_LIMIT })
      for (const b of r?.batches ?? []) {
        const it = (b?.items ?? []).find((x) => x?.id === itemId)
        if (it?.origin) return it
      }
    } catch {
      /* backend unreachable: not found */
    }
    return null
  }

  return { remember, peek, read, localForSession, findItem }
}
