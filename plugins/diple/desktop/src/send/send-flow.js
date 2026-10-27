// The single send flow (design §3.2 "发送", ADR 0006). W2b owns this file.
// Since L3 (ADR 0009) this is the implementation inside the send module
// (send/sending.js): the UI gets createSending's request / preview / get /
// subscribe / resolve, never this object. The regression suites still drive
// it directly as the module's internal seam (its races are hard to reach
// from outside).
//
//   const flow = createSendFlow(deps, env)   deps.batches: the BatchCatalog
//
//   flow.start(key, { useDraft?, body? }) → Promise<{ ok, batchId?, queued?, reason?, done? }>
//       The one way a batch leaves: list button, ⌘↩, the send keybind and
//       hand-offs all call it. Idle: beginSend → PUT /batches → composer.submit
//       → `done` settles when the turn proves delivery. Busy: the session goes
//       into the plugin's own persistent queue instead ("send after reply").
//   flow.sendNow(key, opts) → Promise<{ ok, batchId?, queued?, reason? }>   start + await done
//   flow.middleware(draft) → draft | null
//       Main send button: appends the display text of the focused session's
//       list to the typed draft (byte-identical to start() with that body).
//   flow.handleEvent({ type, session_id, payload })
//       Gateway events: message.start, message.complete, error and
//       plugin.diple.batch.sent drive delivery, the queue and the answer check.
//   flow.preview(key, body?) → { display, full, stats, size } | null
//   flow.size(key)           → { tokens, max, pct, level: 'ok'|'soft'|'hard'|'unknown' }
//   flow.queue.{ has, get, cancel, subscribe }, flow.receipt.{ get, clear, subscribe },
//   flow.notices.{ get, dismiss, putBack, subscribe }, flow.status.{ get, subscribe }
//       subscribe(key, fn) → off: fn() after that key's record changed
//   flow.resume()            → re-attach sends that were in flight before a reload
//
// Success (W1 P2, design §3.2 revised): the batch was expanded in this turn
// (plugin.diple.batch.sent, or backend status `expanded`) AND that turn's
// message.complete carries persisted_turn.user_row_id — and that user row is
// the one holding `@diple:<batchId>` whenever the history can say so (R1
// XE-07). Expansion alone is not enough: over the 50% hard limit the provider
// runs but the turn is refused.
//
// Expansion clears the list early, but the send stays a persisted pending
// confirmation (`confirm.<batchId>`, R1 XE-01) until a turn settles it: a
// reload, a lost complete event or a turn that never ends still finds it,
// checks the persisted user row and either confirms it or puts the items back.
//
// env = { submit(key, text) → boolean, getDraft(key) → Promise<string|null>,
//         setDraft(key, text) → Promise<boolean>, isBusy(key) → boolean,
//         contextMax(key) → number|null, storedIdFor(runtimeId) → string|null,
//         findUserRow(key, batchId, rowId?) → Promise<boolean|null>
//             is there a persisted user row (that row, when given) carrying
//             `@diple:<batchId>`? null = cannot tell (history unavailable),
//         storage, now(), setTimeout, clearTimeout, sleep(ms),
//         deliveryTimeoutMs?, confirmTimeoutMs?, idleWaitMs? }

import { Envelope, Markers, PendingList, SendSize } from '@diple/core'

export const DELIVERY_TIMEOUT_MS = 60_000
// After expansion: how long a turn may run before the plugin checks the
// persisted rows itself (re-armed while the session is still busy).
export const CONFIRM_TIMEOUT_MS = 5 * 60_000
export const { SOFT_LIMIT, HARD_LIMIT } = SendSize
export const REFUSED_PREFIX = '@ context injection refused'
const IDLE_WAIT_MS = 15_000
// First retry of a send whose confirmation could not be checked (backend or
// history unreachable); doubles up to CONFIRM_TIMEOUT_MS.
const RETRY_MS = 5_000
// A send queued while the session's busy state was unknown re-checks this often.
const QUEUE_POLL_MS = 4_000

/** What the backend and the markers need of an item (no UI state). */
export function batchItem(it) {
  return { id: it.id, origin: it.origin, text: it.text, comment: it.comment, revision: it.revision }
}

const isComment = (it) => typeof it?.comment === 'string' && it.comment.trim() !== ''

/** Size class of a batch against the model context: core SendSize.level (XR10-02). */
const sizeLevel = SendSize.level

// A tiny keyed observable store over ctx.storage (persisted values). No React:
// the send module's read model (send/sending.js) is the one React adapter.
function keyedStore(storage, prefix, empty) {
  const listeners = new Set()
  const cache = new Map()
  const read = (key) => {
    if (!cache.has(key)) cache.set(key, storage.get(prefix + key, null) ?? empty)
    return cache.get(key)
  }
  const sub = new Map()
  const subscribeFor = (key) => {
    if (!sub.has(key)) {
      sub.set(key, (cb) => {
        const fn = (k) => k === key && cb()
        listeners.add(fn)
        return () => listeners.delete(fn)
      })
    }
    return sub.get(key)
  }
  return {
    get: (key) => (key ? read(key) : empty),
    set(key, value) {
      if (!key) return
      const v = value ?? empty
      cache.set(key, v)
      if (value == null) storage.remove(prefix + key)
      else storage.set(prefix + key, value)
      for (const fn of [...listeners]) fn(key)
    },
    /** fn() after every set of `key` (the send module's read model subscribes, L3). */
    subscribe: (key, fn) => subscribeFor(key ?? '')(fn)
  }
}

export function createSendFlow(deps, env) {
  const { lists, api, ids, i18n, settings, notify } = deps
  const storage = env.storage
  const catalog = deps.batches // the local batch records (shared/batch-catalog.js)
  const timeoutMs = env.deliveryTimeoutMs ?? DELIVERY_TIMEOUT_MS
  const confirmTimeoutMs = env.confirmTimeoutMs ?? CONFIRM_TIMEOUT_MS
  const contextMax = (key) => env.contextMax(key)
  const findUserRow = async (key, batchId, rowId) => {
    try {
      const r = await env.findUserRow?.(key, batchId, rowId)
      return typeof r === 'boolean' ? r : null
    } catch {
      return null
    }
  }
  const idleWaitMs = env.idleWaitMs ?? IDLE_WAIT_MS
  const retryMs = env.retryMs ?? RETRY_MS
  const queuePollMs = env.queuePollMs ?? QUEUE_POLL_MS

  const queue = keyedStore(storage, 'queue.', null) // key → { at, gen, useDraft?, body?, stalled?, waiting?, draining? }
  const receipt = keyedStore(storage, 'last.', null) // key → { batchId, count, delivered }
  const noticeStore = keyedStore(storage, 'notice.', null) // key → [{ batchId, kind, numbers }]
  const statusStore = keyedStore({ get: () => null, set() {}, remove() {} }, '', null) // key → { batchId, phase }

  // Index of sessions with something to resume after a reload.
  const indexGet = (name) => storage.get(name, []) ?? []
  const indexAdd = (name, key) => {
    const cur = indexGet(name)
    if (!cur.includes(key)) storage.set(name, [...cur, key])
  }
  const indexDel = (name, key) => storage.set(name, indexGet(name).filter((k) => k !== key))

  // Expanded sends not yet confirmed by a turn (XE-01): batchId → { key, batchId, at }.
  const confirmAdd = (key, batchId) => {
    storage.set(`confirm.${batchId}`, { key, batchId, at: env.now() })
    indexAdd('confirm.index', batchId)
  }
  const confirmDel = (batchId) => {
    storage.remove(`confirm.${batchId}`)
    indexDel('confirm.index', batchId)
  }

  // -- local batch records (marker lookups, answer check): shared/batch-catalog.js
  const saveBatch = (rec) => catalog.remember(rec)
  const localBatch = (batchId) => catalog.peek(batchId)
  const batchRecord = (batchId) => catalog.read(batchId)

  const reasonText = (reason) => i18n.t('send.reason.' + reason)
  const fail = (reason, detail) =>
    notify({ kind: 'error', title: i18n.t('send.failed'), message: reasonText(reason), ...(detail ? { detail } : {}) })

  // -- composing --------------------------------------------------------------
  // key: the session the batch is sent into (cross-session origins say so, XE-08)
  const compose = (items, body, batchId, key) =>
    Envelope.compose({ body: body ?? '', items: items.map(batchItem), batchId, lang: i18n.lang(), sessionId: key })

  function size(key) {
    const state = lists.get(key)
    if (!state.items.length) return sizeLevel(0, contextMax(key))
    const { stats } = compose(state.items, '', 'preview', key)
    return sizeLevel(stats.tokens, contextMax(key))
  }

  function preview(key, body = '') {
    const state = lists.get(key)
    if (!state.items.length) return null
    const r = compose(state.items, body, 'preview', key)
    return { ...r, size: sizeLevel(r.stats.tokens, contextMax(key)) }
  }

  /**
   * Lock the list, compose, register. Shared by start() and middleware(), so
   * every path produces the same texts for the same body.
   * → { ok: true, batchId, display, items } | { ok: false, reason }
   */
  async function prepare(key, body, { batchId: wanted = null, handoffIds = [], handoffItems = {} } = {}) {
    const state = lists.get(key)
    if (state.sending) return { ok: false, reason: 'already-sending' }
    if (!state.items.length) return { ok: false, reason: 'empty' }
    const batchId = wanted ?? ids.newBatchId()
    const check = compose(state.items, body, batchId, key)
    const sz = sizeLevel(check.stats.tokens, contextMax(key))
    if (sz.level === 'hard') return { ok: false, reason: 'too-large' }
    const started = lists.dispatch(key, { type: 'beginSend', batchId }).find((e) => e.type === 'sendStarted')
    if (!started) return { ok: false, reason: 'already-sending' }
    // the hand-offs belong to the send that locked the list, from this moment (fix-r5 audit)
    for (const h of handoffIds) takenBy.set(h, batchId)
    indexAdd('sending.index', key)
    const items = started.items.map(batchItem)
    const { display, full } = compose(items, body, batchId, key)
    if (sz.level === 'soft') notify({ kind: 'warning', title: i18n.t('send.sizeWarnTitle'), message: i18n.t('send.sizeWarn', sz.pct) })
    try {
      // handoffItems: what each hand-off handed over, by version (R4 XE4-02). The backend
      // settles each hand-off from the items that REALLY ride in this batch: one whose
      // items were removed or replaced meanwhile is not reported as sent.
      const hitems = Object.fromEntries(handoffIds.filter((h) => handoffItems?.[h]?.length).map((h) => [h, handoffItems[h]]))
      await api.putBatch(batchId, { sessionId: key, full, display, items, ...(handoffIds.length ? { handoffIds } : {}), ...(Object.keys(hitems).length ? { handoffItems: hitems } : {}) })
    } catch {
      abortLocal(key, batchId, 'register-failed')
      return { ok: false, reason: 'register-failed' }
    }
    saveBatch({ batchId, sessionKey: key, items, at: env.now(), ...(handoffIds.length ? { handoffIds } : {}) })
    statusStore.set(key, { batchId, phase: 'sending' })
    return { ok: true, batchId, display, items }
  }

  function abortLocal(key, batchId, reason) {
    for (const [h, b] of takenBy) if (b === batchId) takenBy.delete(h)
    lists.dispatch(key, { type: 'abortSend', batchId, reason })
    if (!lists.get(key).sending) indexDel('sending.index', key)
    if (statusStore.get(key)?.batchId === batchId) statusStore.set(key, null)
  }

  // -- delivery tracking --------------------------------------------------------
  // One rule decides both delivery and the answer check (R2 XE-07): a turn
  // proves a batch only when its persisted user row carries `@diple:<id>`.
  // turnCarries() is that rule; nothing else may confirm or answer-check.
  // An unknown answer (history unreadable) is never turned into a success
  // (R2 XE-01): the send stays a pending confirmation, retried, with a
  // visible way out after a while ("cannot confirm · put back").
  const inflight = new Map() // batchId → { key, sentSeen, committed, parked, timer, settle, promise }
  const turnBatches = new Map() // key → Set<batchId> expanded during the current turn
  const HOST_REJECTIONS = new Set(['refused', 'turn-error', 'not-persisted'])
  const failedBatches = new Set() // sends that failed in this window: never answer-checked
  const loadedAt = env.now()

  /**
   * Did the turn whose persisted user row is `userRowId` carry `batchId`?
   * true / false from the session's history. History unreadable: true only
   * when this window saw the batch expand inside this very turn (inTurn:
   * batch.sent between this session's message.start and message.complete);
   * otherwise null — no trusted correspondence.
   */
  async function turnCarries(key, batchId, userRowId, inTurn) {
    if (userRowId == null) return null
    const found = await findUserRow(key, batchId, userRowId)
    if (found !== null) return found
    return inTurn ? true : null
  }

  function track(key, batchId, { sentSeen = false, committed = false, parked = false } = {}) {
    const existing = inflight.get(batchId)
    if (existing) return existing
    let settle
    const promise = new Promise((r) => (settle = r))
    const entry = { key, batchId, sentSeen, committed, parked, settle, promise, timer: null, retries: 0 }
    // Parked (backend unreachable at reload): only the reattach retry runs.
    // Not expanded yet: give up after timeoutMs. Expanded: check the persisted
    // rows after confirmTimeoutMs (a lost or never-sent complete event).
    const arm = (ms) => {
      env.clearTimeout(entry.timer)
      entry.timer = null
      if (entry.parked) return
      entry.timer = entry.sentSeen
        ? env.setTimeout(() => void confirmFromRows(entry), ms ?? confirmTimeoutMs)
        : env.setTimeout(() => finish(entry, { ok: false, reason: 'not-delivered' }), timeoutMs)
    }
    entry.arm = arm
    inflight.set(batchId, entry)
    arm()
    return entry
  }

  const confirmRec = (batchId) => storage.get(`confirm.${batchId}`, null)
  const countOf = (batchId) => localBatch(batchId)?.items?.length ?? 0

  /** Settle an expanded send from the session's persisted rows (no turn event
   *  to go by). Busy → look again later. History unreadable → still pending:
   *  shown as such, retried; after confirmTimeoutMs the user may decide. */
  async function confirmFromRows(entry) {
    if (!inflight.has(entry.batchId)) return
    if (await busyNow(entry.key)) return entry.arm()
    const found = await findUserRow(entry.key, entry.batchId)
    if (!inflight.has(entry.batchId)) return
    if (found === true) finish(entry, { ok: true })
    else if (found === false) finish(entry, { ok: false, reason: 'not-persisted' })
    else unconfirmed(entry)
  }

  function unconfirmed(entry) {
    commitEarly(entry)
    const since = confirmRec(entry.batchId)?.at ?? env.now()
    const stale = env.now() - since >= confirmTimeoutMs
    receipt.set(entry.key, { batchId: entry.batchId, count: countOf(entry.batchId), delivered: false, ...(stale ? { unconfirmed: true } : { confirming: true }) })
    // retry: soon at first (a gateway coming back), then every confirm period
    entry.retries++
    entry.arm(Math.min(confirmTimeoutMs, retryMs * 2 ** Math.min(entry.retries - 1, 6)))
  }

  // Expanded = the AI has the annotations: clear the list now (fast feedback),
  // but keep the batch in flight until the turn proves it was persisted. A
  // refusal after that puts the very same items back.
  function commitEarly(entry) {
    if (entry.committed) {
      if (!confirmRec(entry.batchId)) confirmAdd(entry.key, entry.batchId)
      return
    }
    entry.committed = true
    confirmAdd(entry.key, entry.batchId) // before the list lets go of the items
    lists.dispatch(entry.key, { type: 'commitSend', batchId: entry.batchId })
    if (!lists.get(entry.key).sending) indexDel('sending.index', entry.key)
  }

  function restore(key, batchId) {
    const rec = localBatch(batchId)
    for (const it of rec?.items ?? []) {
      lists.dispatch(key, { type: 'add', id: it.id, item: { origin: it.origin, text: it.text, comment: it.comment } })
    }
  }

  // -- the final-word outbox (ADR 0007 §4) ------------------------------------------
  // How the send of a batch carrying hand-offs ended is written here BEFORE the
  // send's bookkeeping is cleared, then POSTed to /batches/{id}/final until the
  // backend has it (retried on a backoff, on resume() and on reconnected()).
  // The backend settles every hand-off of the batch once and broadcasts it.
  const handoffsOf = (batchId) => {
    const rec = localBatch(batchId)
    return [...new Set([...(rec?.handoffIds ?? []), ...(rec?.handoffId ? [rec.handoffId] : [])])]
  }
  let outboxTimer = null
  let outboxTries = 0
  let flushing = null
  function settle({ batchId, handoffIds, delivered, reason }) {
    const hids = [...new Set((handoffIds ?? []).filter(Boolean))]
    if (!batchId || !hids.length) return
    const prev = storage.get(`final.${batchId}`, null)
    // the first word stays; a later call only adds hand-offs
    const rec = prev ? { ...prev, handoffIds: [...new Set([...prev.handoffIds, ...hids])] } : { batchId, delivered: Boolean(delivered), ...(delivered ? {} : { reason: reason || 'failed' }), handoffIds: hids }
    storage.set(`final.${batchId}`, rec)
    indexAdd('final.index', batchId)
    void flushOutbox()
  }
  function flushOutbox() {
    if (flushing) return flushing.then(() => (indexGet('final.index').length ? flushOutbox() : undefined))
    flushing = (async () => {
      let failed = false
      for (const batchId of indexGet('final.index')) {
        const rec = storage.get(`final.${batchId}`, null)
        if (!rec) {
          indexDel('final.index', batchId)
          continue
        }
        try {
          await api.finalBatch(batchId, rec)
          if (JSON.stringify(storage.get(`final.${batchId}`, null)) === JSON.stringify(rec)) {
            storage.remove(`final.${batchId}`)
            indexDel('final.index', batchId)
          }
        } catch {
          failed = true
        }
      }
      if (failed && outboxTimer == null) {
        const ms = Math.min(confirmTimeoutMs, retryMs * 2 ** Math.min(outboxTries++, 6))
        outboxTimer = env.setTimeout(() => {
          outboxTimer = null
          void flushOutbox()
        }, ms)
      } else if (!failed) outboxTries = 0
    })().finally(() => (flushing = null))
    return flushing
  }

  // result: { ok } | { ok: false, reason, detail?, quiet? } — quiet: the user
  // chose this (no error toast, the backend status is left alone).
  function finish(entry, result) {
    if (!inflight.has(entry.batchId)) return
    const { key, batchId } = entry
    // the final word first: nothing below may lose it (ADR 0007 §4)
    settle({ batchId, handoffIds: handoffsOf(batchId), delivered: Boolean(result.ok), reason: result.reason })
    for (const [h, b] of takenBy) if (b === batchId) takenBy.delete(h)
    inflight.delete(entry.batchId)
    env.clearTimeout(entry.timer)
    if (result.ok) {
      commitEarly(entry)
      confirmDel(batchId)
      receipt.set(key, { batchId, count: countOf(batchId), delivered: true })
    } else {
      failedBatches.add(batchId)
      // The host refused the turn (hard limit, turn error, never persisted)
      // after it may already have expanded the batch: let the backend take it
      // out of 'expanded' too. A timeout or a user interrupt keeps the old call
      // (an interrupted turn did reach the model).
      if (!result.quiet) {
        const rejected = HOST_REJECTIONS.has(result.reason)
        api.markFailed(batchId, result.reason, rejected ? { rejected: true } : undefined).catch(() => {})
      }
      if (entry.committed) restore(key, batchId)
      else abortLocal(key, batchId, result.reason)
      confirmDel(batchId)
      if (receipt.get(key)?.batchId === batchId) receipt.set(key, null)
      turnBatches.get(key)?.delete(batchId)
      if (!result.quiet) fail(result.reason, result.detail)
    }
    if (statusStore.get(key)?.batchId === batchId) statusStore.set(key, null)
    entry.settle({ ...result, batchId })
  }

  const keysFor = (sessionId) => {
    const out = new Set()
    if (sessionId) {
      out.add(sessionId)
      const stored = env.storedIdFor?.(sessionId)
      if (stored) out.add(stored)
    }
    return out
  }

  async function onComplete(sessionId, payload) {
    const arrivedAt = env.now() // what this turn may settle is decided as of now (fix-r5 audit)
    const keys = keysFor(sessionId)
    const status = payload?.status ?? 'complete'
    const userRowId = payload?.persisted_turn?.user_row_id
    const persisted = userRowId != null
    const text = typeof payload?.text === 'string' ? payload.text : ''
    const refused = text.trim().startsWith(REFUSED_PREFIX)
    // the batches in flight when the turn ended: one tracked later is never this turn's
    const atArrival = [...inflight.values()]
    for (const key of keys) {
      const inTurn = turnBatches.get(key) ?? new Set()
      turnBatches.delete(key)
      const carried = new Map() // batchId → turnCarries(), asked once per turn
      const carries = async (batchId) => {
        if (!carried.has(batchId)) carried.set(batchId, await turnCarries(key, batchId, userRowId, inTurn.has(batchId)))
        return carried.get(batchId)
      }
      for (const entry of atArrival) {
        if (entry.key !== key || inflight.get(entry.batchId) !== entry) continue
        if (!entry.sentSeen) {
          // The event may have been missed; the backend knows whether it expanded.
          try {
            const b = await api.getBatch(entry.batchId)
            // expanded only after this turn ended (while we asked): the next turn's, not this one's
            const before = typeof b?.expandedAt !== 'number' || b.expandedAt * 1000 <= arrivedAt
            if ((b?.status === 'expanded' || b?.status === 'answered') && before) {
              entry.sentSeen = true
              entry.parked = false
            }
          } catch {
            /* unknown: keep waiting */
          }
          if (!entry.sentSeen) continue // not our turn (e.g. a queued prompt finished first)
        }
        if (refused) finish(entry, { ok: false, reason: 'refused', detail: text.trim() })
        else if (status === 'interrupted') finish(entry, { ok: false, reason: 'interrupted' })
        else if (status === 'error') finish(entry, { ok: false, reason: 'turn-error', detail: text.trim() || undefined })
        else if (!persisted || status !== 'complete') finish(entry, { ok: false, reason: 'not-persisted' })
        else {
          const c = await carries(entry.batchId)
          if (c === true) finish(entry, { ok: true })
          else if (c === null) unconfirmed(entry) // cannot tell: keep it pending
          // false: another turn's row (a queued prompt) — keep waiting
        }
      }
      if (status === 'complete' && !refused) await checkAnswers(key, text, userRowId, inTurn, carries)
      onTurnEnded(key, status)
    }
  }

  // -- answer check (design §3.2 "漏答核对", XR1-06) ------------------------------
  // Only batches this turn provably carried (turnCarries === true), so the
  // check never runs on another turn's answer and `answered` never stands in
  // for an unfinished delivery confirmation (R2 XE-07).
  async function checkAnswers(key, text, userRowId, inTurn, carries) {
    const candidates = new Set([...inTurn].filter((b) => !failedBatches.has(b)))
    if (!candidates.size && userRowId != null) {
      // Reloaded mid-turn: the in-memory "expanded this turn" set is gone. The
      // session's latest expanded, unchecked batch is a candidate — it still
      // has to pass the same row check.
      try {
        const r = await api.listBatches({ sessionId: key, status: 'expanded', limit: 1 })
        const b = r?.batches?.[0]
        if (b && b.expandedAt && b.expandedAt * 1000 < loadedAt) candidates.add(b.batchId)
      } catch {
        /* backend unavailable: no check */
      }
    }
    for (const batchId of candidates) {
      if ((await carries(batchId)) !== true) continue
      const rec = await batchRecord(batchId)
      if (!rec) continue
      const r = Markers.reconcile(text, { batchId, items: rec.items })
      let first = false
      try {
        const res = await api.markAnswered(batchId, { answered: [...r.answered], missing: r.missing, noMarkers: r.noMarkers })
        first = Boolean(res?.first)
      } catch {
        continue
      }
      if (!first) continue // idempotent per batch: another window or an earlier check did it
      if (r.answered.size) {
        const numbers = [...r.answered].sort((a, b) => a - b)
        const answered = numbers.map((n) => ({ origin: rec.items[n - 1]?.origin ?? null }))
        api.emitBatchAnswered(batchId, answered, numbers).catch(() => {})
      }
      const comments = rec.items.map((it, i) => (isComment(it) ? i + 1 : 0)).filter(Boolean)
      if (!comments.length) continue
      if (r.noMarkers) addNotice(key, { batchId, kind: 'none', numbers: comments })
      else if (r.missing.length) addNotice(key, { batchId, kind: 'missing', numbers: r.missing })
    }
  }

  function addNotice(key, notice) {
    const cur = (noticeStore.get(key) ?? []).filter((n) => n.batchId !== notice.batchId)
    noticeStore.set(key, [...cur, notice].slice(-3))
  }

  const notices = {
    get: (key) => noticeStore.get(key) ?? EMPTY_LIST,
    subscribe: (key, fn) => noticeStore.subscribe(key, fn),
    dismiss(key, batchId) {
      const next = (noticeStore.get(key) ?? []).filter((n) => n.batchId !== batchId)
      noticeStore.set(key, next.length ? next : null)
    },
    /** Put the listed comment numbers of a batch back in the pending list. */
    async putBack(key, batchId, numbers) {
      const rec = await batchRecord(batchId)
      if (!rec) return 0
      let added = 0
      for (const n of numbers) {
        const it = rec.items[n - 1]
        if (!it) continue
        const effects = lists.dispatch(key, { type: 'add', id: ids.newItemId(), item: { origin: it.origin, text: it.text, comment: it.comment } })
        if (effects.some((e) => e.type === 'focus')) added++
      }
      const cur = noticeStore.get(key) ?? []
      const next = cur
        .map((x) => (x.batchId === batchId ? { ...x, numbers: x.numbers.filter((n) => !numbers.includes(n)) } : x))
        .filter((x) => x.numbers.length)
      noticeStore.set(key, next.length ? next : null)
      return added
    }
  }

  // -- the queue ("send after reply") -------------------------------------------
  // gen: a cancelled (or replaced) queue entry never sends (XE-06).
  // useDraft / body: what this send was asked to carry (XE-03); a useDraft
  // send reads the composer when it actually leaves.
  // batchId: a hand-off's send keeps the id fixed at its claim (XE2-03); the
  // first one queued is the one the merged send goes out under.
  // handoffIds: EVERY hand-off whose items wait in this queue — each one is
  // settled when the send ends (XE3-02 / XR3-03, ADR 0007 §5).
  // unknown: queued because the session's busy state could not be learned
  // (R2 XE-10) — no message.complete may ever come, so it polls.
  let genSeq = 0
  const pollTimers = new Map() // key → timer
  // handoffId → the batch that took it when it locked the list (prepare). A drain that
  // waited meanwhile (idle, the draft) decides on its own snapshot of the queue; a
  // hand-off another send took is that send's to settle, never the drain's.
  const takenBy = new Map()
  const queuedHandoffs = (q) => [...new Set([...(q?.handoffIds ?? []), ...(q?.handoffId ? [q.handoffId] : [])])]
  /** handoffId → [{itemId, revision}] of the queue entry, plus this call's hand-off (R4 XE4-02). */
  const queuedItems = (q, handoffId = null, accepted = null) => ({ ...(q?.handoffItems ?? {}), ...(handoffId && Array.isArray(accepted) ? { [handoffId]: accepted } : {}) })
  function enqueue(key, { useDraft = false, body = '', batchId = null, handoffId = null, accepted = null } = {}, { unknown = false } = {}) {
    const old = queue.get(key)
    const gen = `${env.now()}-${++genSeq}`
    const hids = [...new Set([...queuedHandoffs(old), ...(handoffId ? [handoffId] : [])])]
    const hitems = queuedItems(old, handoffId, accepted)
    const bid = old?.batchId ?? batchId ?? null
    queue.set(key, {
      at: env.now(),
      gen,
      ...(useDraft ? { useDraft: true } : {}),
      ...(body ? { body } : {}),
      ...(bid ? { batchId: bid } : {}),
      ...(hids.length ? { handoffIds: hids } : {}),
      ...(Object.keys(hitems).length ? { handoffItems: hitems } : {}),
      ...(unknown ? { unknown: true } : {})
    })
    indexAdd('queue.index', key)
    if (unknown) armPoll(key)
    return { ok: true, queued: true, ...(bid ? { batchId: bid } : {}) }
  }
  function dequeue(key) {
    queue.set(key, null)
    indexDel('queue.index', key)
    env.clearTimeout(pollTimers.get(key))
    pollTimers.delete(key)
  }
  function armPoll(key) {
    env.clearTimeout(pollTimers.get(key))
    pollTimers.set(
      key,
      env.setTimeout(async () => {
        pollTimers.delete(key)
        const q = queue.get(key)
        if (!q || q.stalled || q.waiting) return
        if (!q.draining && !(await busyNow(key))) await drain(key)
        if (queue.get(key) && !queue.get(key).draining) armPoll(key)
      }, queuePollMs)
    )
  }

  /** Busy, idle or unknown → boolean. Unknown counts as busy (R2 XE-10): a
   *  send into a session that may be mid-turn waits for the answer instead
   *  of becoming an interjection. */
  async function busyNow(key) {
    let b = env.isBusy(key)
    if (b !== true && b !== false && env.probeBusy) {
      try {
        b = await env.probeBusy(key)
      } catch {
        b = null
      }
    }
    return b !== false
  }

  async function waitIdle(key) {
    const end = env.now() + idleWaitMs
    while ((await busyNow(key)) && env.now() < end) await env.sleep(200)
    return !(await busyNow(key))
  }

  async function drain(key) {
    const q = queue.get(key)
    if (!q || q.draining) return
    const gen = q.gen
    const current = () => queue.get(key) != null && queue.get(key).gen === gen
    queue.set(key, { ...q, draining: true })
    if (!(await waitIdle(key))) {
      if (current()) queue.set(key, { ...q, draining: false })
      return
    }
    if (!current()) return // cancelled while waiting
    const r = settings.get().enabled
      ? await startIdle(key, { body: q.body ?? '', useDraft: Boolean(q.useDraft), stillWanted: current, batchId: q.batchId ?? null, handoffIds: queuedHandoffs(q), handoffItems: queuedItems(q) })
      : { ok: false, reason: 'disabled' }
    if (!r.ok && r.reason === 'cancelled') return
    if (!r.ok && r.reason === 'submit-refused') {
      // The session is not on screen: wait for the user to come back to it.
      if (current()) queue.set(key, { ...q, waiting: true, draining: false })
      notify({ kind: 'info', title: i18n.t('send.queued'), message: i18n.t('send.queueWaiting') })
      return
    }
    if (!r.ok) {
      // a failed send of the drain holds no lock (abortLocal let go of it): whatever is
      // still taken was taken by another send, with the batch id it now carries
      const others = new Set(queuedHandoffs(q).map((h) => takenBy.get(h)).filter(Boolean))
      const mine = queuedHandoffs(q).filter((h) => !takenBy.has(h))
      const want = r.batchId ?? q.batchId
      settle({ batchId: want && !others.has(want) ? want : ids.newBatchId(), handoffIds: mine, delivered: false, reason: r.reason })
    }
    if (current()) dequeue(key)
    if (!r.ok && r.reason !== 'empty') fail(r.reason)
  }

  function onTurnEnded(key, status) {
    const q = queue.get(key)
    if (!q) return
    if (status === 'complete') void drain(key)
    else queue.set(key, { ...q, stalled: true })
  }

  // -- public send ------------------------------------------------------------------
  async function startIdle(key, { body = '', useDraft = false, stillWanted = null, batchId = null, handoffIds = [], handoffItems = {} } = {}) {
    let draft = null
    if (useDraft) {
      try {
        draft = (await env.getDraft(key)) ?? ''
      } catch {
        draft = ''
      }
      body = draft
    }
    const p = await prepare(key, body, { batchId, handoffIds, handoffItems })
    if (!p.ok) return { ...p, ...(batchId ? { batchId } : {}) }
    if (stillWanted && !stillWanted()) {
      // the queue was cancelled while the batch was being registered
      api.markFailed(p.batchId, 'cancelled').catch(() => {})
      abortLocal(key, p.batchId, 'cancelled')
      return { ok: false, batchId: p.batchId, reason: 'cancelled' }
    }
    if (!env.submit(key, p.display)) {
      api.markFailed(p.batchId, 'submit-refused').catch(() => {})
      abortLocal(key, p.batchId, 'submit-refused')
      return { ok: false, batchId: p.batchId, reason: 'submit-refused' }
    }
    if (useDraft && draft && draft.trim()) {
      // The draft became the body: clear it unless the user typed on meanwhile.
      Promise.resolve(env.getDraft(key))
        .then((now) => now === draft && env.setDraft(key, ''))
        .catch(() => {})
    }
    receipt.set(key, null)
    const done = track(key, p.batchId).promise
    return { ok: true, batchId: p.batchId, done }
  }

  // opts: { useDraft?, body?, batchId?, handoffId?, accepted?: [{itemId, revision}] }
  async function start(key, opts = {}) {
    if (!settings.get().enabled) return { ok: false, reason: 'disabled' }
    if (!key) return { ok: false, reason: 'no-session' }
    if (!lists.get(key).items.length) return { ok: false, reason: 'empty' }
    const known = env.isBusy(key)
    if (known === true || (await busyNow(key))) {
      if (lists.get(key).sending) return { ok: false, reason: 'already-sending' }
      return enqueue(key, opts, { unknown: known !== true })
    }
    const q = queue.get(key)
    if (q) dequeue(key)
    // queued hand-offs' items go out with this send: each one is settled by it
    const handoffIds = [...new Set([...queuedHandoffs(q), ...(opts.handoffId ? [opts.handoffId] : [])])]
    return startIdle(key, { useDraft: opts.useDraft, body: opts.body, batchId: opts.batchId ?? q?.batchId ?? null, handoffIds, handoffItems: queuedItems(q, opts.handoffId, opts.accepted) })
  }

  async function sendNow(key, opts) {
    const r = await start(key, opts)
    if (!r.ok || !r.done) return r.ok ? { ok: true, queued: Boolean(r.queued) } : r
    return r.done
  }

  async function middleware(draft) {
    if (!draft || typeof draft.text !== 'string') return draft
    if (!settings.get().enabled) return draft
    if (Envelope.batchReferenceIn(draft.text)) return draft // our own submit, or a hand-typed reference
    const key = deps.session.currentKey()
    if (!key) return draft
    const state = lists.get(key)
    if (!state.items.length) return draft
    if (state.sending) {
      notify({ kind: 'warning', title: reasonText('middleware-busy') })
      return draft
    }
    const q = queue.get(key)
    const p = await prepare(key, draft.text, { batchId: q?.batchId ?? null, handoffIds: queuedHandoffs(q), handoffItems: queuedItems(q) })
    if (!p.ok) {
      notify({ kind: 'error', title: reasonText('middleware-blocked'), message: reasonText(p.reason) })
      return null // keep the typed text in the composer
    }
    receipt.set(key, null)
    if (queue.get(key)) dequeue(key)
    void track(key, p.batchId)
    return { ...draft, text: p.display }
  }

  // -- events ---------------------------------------------------------------------
  function handleEvent(e) {
    const type = e?.type
    const payload = e?.payload ?? {}
    if (type === `plugin.${Envelope.REFERENCE_PREFIX}.batch.sent`) {
      const batchId = payload.batchId
      if (typeof batchId !== 'string' || failedBatches.has(batchId)) return
      const entry = inflight.get(batchId)
      const key = entry?.key ?? localBatch(batchId)?.sessionKey ?? payload.sessionId
      if (!key) return
      if (!turnBatches.has(key)) turnBatches.set(key, new Set())
      turnBatches.get(key).add(batchId)
      if (entry) {
        entry.sentSeen = true
        entry.parked = false
        entry.arm()
        commitEarly(entry)
        statusStore.set(key, { batchId, phase: 'delivered' })
        receipt.set(key, { batchId, count: countOf(batchId), delivered: false })
      }
      return
    }
    const sessionId = e?.session_id || payload.session_id || ''
    if (type === 'message.start') {
      for (const key of keysFor(sessionId)) {
        turnBatches.delete(key)
        const mine = [...inflight.values()].some((x) => x.key === key)
        if (!mine && receipt.get(key)) receipt.set(key, null)
      }
      return
    }
    if (type === 'message.complete') return onComplete(sessionId, payload)
    if (type === 'error') {
      for (const entry of [...inflight.values()]) {
        if (keysFor(sessionId).has(entry.key)) finish(entry, { ok: false, reason: 'turn-error', detail: payload?.message })
      }
    }
  }

  /** Session came into view: a queue that waited for it (or for its busy
   *  state to become known) can go now. */
  async function onSessionFocus(key) {
    const q = key && queue.get(key)
    if ((q?.waiting || q?.unknown) && !q.draining && !(await busyNow(key))) await drain(key)
  }

  // -- reattach after a reload (R1 XE-01, R2 XE-01) -------------------------------
  // Re-entrant: runs at install, again on a backoff while anything is parked
  // (the plugin API was not up yet), and whenever the gateway reconnects.
  let reattaching = null
  let reattachTimer = null
  let reattachTries = 0
  function scheduleReattach() {
    if (reattachTimer != null) return
    const ms = Math.min(confirmTimeoutMs, retryMs * 2 ** Math.min(reattachTries++, 6))
    reattachTimer = env.setTimeout(() => {
      reattachTimer = null
      void resume()
    }, ms)
  }

  /** backend status of a batch: its status, 'missing' (404) or 'unknown' (unreachable). */
  async function backendStatus(batchId) {
    try {
      const b = await api.getBatch(batchId)
      return b?.status ?? 'missing'
    } catch (err) {
      return err?.status === 404 ? 'missing' : 'unknown'
    }
  }

  async function reattachOnce() {
    let parked = false
    // Locked lists: sends that had not been confirmed expanded at the reload.
    for (const key of indexGet('sending.index')) {
      const state = lists.get(key)
      const batchId = state.sending?.batchId
      if (!batchId) {
        indexDel('sending.index', key)
        continue
      }
      const cur = inflight.get(batchId)
      if (cur && !cur.parked) continue
      const st = await backendStatus(batchId)
      if (st === 'unknown') {
        // Backend not up yet: hold the send (a turn error still unlocks it) and retry.
        track(key, batchId, { parked: true })
        parked = true
      } else if (st === 'expanded' || st === 'answered') {
        // Expanded before the reload: the turn's event is gone with the old
        // renderer. The persisted rows decide — `answered` is no shortcut.
        const entry = track(key, batchId, { sentSeen: true })
        entry.parked = false
        entry.arm()
        await confirmFromRows(entry)
      } else {
        const entry = inflight.get(batchId)
        if (entry) {
          inflight.delete(batchId)
          env.clearTimeout(entry.timer)
        }
        lists.dispatch(key, { type: 'abortSend', batchId, reason: 'lost' })
        indexDel('sending.index', key)
        if (st !== 'missing') api.markFailed(batchId, 'lost').catch(() => {})
        settle({ batchId, handoffIds: handoffsOf(batchId), delivered: false, reason: 'lost' })
      }
    }
    // Expanded sends whose list was already cleared. The record exists only
    // after expansion, so the rows decide even while the backend is down; the
    // backend only tells whether another window already put the items back.
    for (const batchId of indexGet('confirm.index')) {
      const rec = confirmRec(batchId)
      if (!rec?.key) {
        confirmDel(batchId)
        continue
      }
      if (inflight.has(batchId)) continue
      if ((await backendStatus(batchId)) === 'failed') {
        confirmDel(batchId) // settled elsewhere
        continue
      }
      const entry = track(rec.key, batchId, { sentSeen: true, committed: true })
      await confirmFromRows(entry)
    }
    for (const key of indexGet('queue.index')) {
      const q = queue.get(key)
      if (!q) indexDel('queue.index', key)
      else if (q.stalled || q.draining || q.waiting) continue
      else if (!(await busyNow(key))) queue.set(key, { ...q, stalled: true, draining: false })
      else armPoll(key)
    }
    return parked
  }

  /** After a reload, and again whenever it may help: settle sends that were in
   *  flight, keep queues. Never drops a pending confirmation it cannot check. */
  function resume() {
    void flushOutbox()
    if (reattaching) return reattaching
    reattaching = reattachOnce()
      .then((parked) => {
        if (parked) scheduleReattach()
        else reattachTries = 0
      })
      .finally(() => (reattaching = null))
    return reattaching
  }

  /** The gateway or the plugin API is back: retry parked and unconfirmed sends now. */
  function reconnected() {
    env.clearTimeout(reattachTimer)
    reattachTimer = null
    reattachTries = 0
    for (const entry of inflight.values()) if (!entry.parked && entry.sentSeen && receipt.get(entry.key)?.batchId === entry.batchId && !receipt.get(entry.key)?.delivered) void confirmFromRows(entry)
    return resume()
  }

  /** "Cannot confirm whether this batch arrived": the user decides (R2 XE-01). */
  const pendingConfirm = {
    putBack(key, batchId) {
      const entry = inflight.get(batchId) ?? (confirmRec(batchId) ? track(key, batchId, { sentSeen: true, committed: true }) : null)
      if (!entry) return false
      finish(entry, { ok: false, reason: 'put-back', quiet: true })
      return true
    },
    keep(key, batchId) {
      const entry = inflight.get(batchId) ?? (confirmRec(batchId) ? track(key, batchId, { sentSeen: true, committed: true }) : null)
      if (!entry) return false
      finish(entry, { ok: true })
      return true
    }
  }

  return {
    start,
    sendNow,
    middleware,
    handleEvent,
    onSessionFocus,
    resume,
    reconnected,
    settle,
    flushOutbox,
    pendingConfirm,
    preview,
    size,
    queue: {
      has: (key) => Boolean(queue.get(key)),
      get: (key) => queue.get(key),
      subscribe: (key, fn) => queue.subscribe(key, fn),
      cancel(key) {
        const q = queue.get(key)
        if (!q) return false
        settle({ batchId: q.batchId ?? ids.newBatchId(), handoffIds: queuedHandoffs(q), delivered: false, reason: 'cancelled' })
        dequeue(key)
        return true
      }
    },
    receipt: { get: (key) => receipt.get(key), subscribe: (key, fn) => receipt.subscribe(key, fn), clear: (key) => receipt.set(key, null) },
    status: { get: (key) => statusStore.get(key), subscribe: (key, fn) => statusStore.subscribe(key, fn) },
    notices,
    isInflight: (batchId) => inflight.has(batchId)
  }
}

const EMPTY_LIST = Object.freeze([])
