// Origins ↔ persisted rows. W2a; R2 XE-02.
//
//   const resolver = createOriginResolver({ history, run? })
//     history(sessionId) → Promise<[{ role, row_id, timestamp, text }]>   (session.history)
//
//   resolver.capture(origin, text, { busy }) → Promise<origin>
//       at capture time. A persisted message (messageTs) is verified against
//       its row. A temporary-id message (origin.pending) gets a binding plan
//       in origin.bind = { mode, run }:
//         busy true / null (unknown) → 'turn': only the next completed turn
//             OF THAT SESSION may bind it (it may be streaming right now, and
//             an older row with the same text is not it);
//         busy false → bound now when exactly one persisted row of that role
//             holds it; none yet → 'turn'; several → 'never' (ambiguous).
//   resolver.pinTurn(origin, turn, turnSession) → origin | null   (SYNC)
//       a turn of stored session `turnSession` completed. Only an origin
//       waiting for a turn of that same session, captured in this run, is
//       touched: its rows are pinned to THIS turn's row ids
//       (bind = { mode: 'rows', run, rows }). The caller must publish
//       (persist) the pinned origin before starting any history I/O, so a
//       later turn already sees it pinned and can never pin it again (R4
//       XE4-01). null = untouched. WHICH turn is an origin's own is the
//       caller's ledger (capture/turns.js, R5 XE5-01): the first completion
//       of its session after the capture (bind.after, bind.rt).
//   resolver.verifyPinned(origin, text) → Promise<origin | null>
//       an origin with pinned rows: bound to the pinned row that holds it;
//       if none does, it was not this message → 'never'. History unreadable
//       → null (it stays pinned and unverified; every later turn or reload
//       retries ONLY the pinned rows, never a later turn's — R3 XE-02).
//       The result is a verdict on THIS snapshot: write it back only if the
//       stored origin is still that snapshot (sameOriginState).
//   resolver.onReload(origin, text, { busy }) → Promise<origin | null>
//       an origin with pinned rows: retried against them (any run). One
//       waiting for a turn of an EARLIER run (its turn ended while this
//       window did not listen): with the session known idle, bound to the
//       single row holding it, else 'never'. null = untouched.
//
// Invariant (R2 "出处只能验证本条消息"): an origin is marked verified only
// against a row that can only be its own message — its timestamp row, the
// sole matching row while the session was idle, or a row of the very turn
// that was producing it. Everything else stays unverified.
//
// The text check compares rendered selection text against the stored
// Markdown with Markdown syntax and whitespace stripped, so formatting does
// not cause false "unverified".

import { rowText } from '../shared/history.js'

const HISTORY_TTL_MS = 1500
export const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export function normalizeForMatch(text) {
  return String(text ?? '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[\s*_`#>|~\-[\]()!:]/g, '')
    .toLowerCase()
}

/** Does the stored Markdown contain the rendered annotation? Each rendered line
 *  must appear, in order (list numbers, fence languages and other syntax the
 *  renderer drops may sit between them). */
export function containsAnnotation(markdown, rendered) {
  const hay = normalizeForMatch(markdown)
  const parts = String(rendered ?? '')
    .split(/\n+/)
    .map(normalizeForMatch)
    .filter(Boolean)
  if (!parts.length) return false
  let at = 0
  for (const p of parts) {
    const i = hay.indexOf(p, at)
    if (i < 0) return false
    at = i + p.length
  }
  return true
}

/** Is `current` still the very origin state `snapshot` was taken from? An
 *  async verdict computed on `snapshot` may only be written back if so: once
 *  the origin was pinned elsewhere, verified, or replaced, it is stale. */
export function sameOriginState(current, snapshot) {
  if (!current || !snapshot) return false
  const key = (o) => JSON.stringify([o.pending ?? null, o.messageId ?? null, o.messageTs ?? null, o.rowId ?? null, o.verified ?? null, o.bind ?? null])
  return key(current) === key(snapshot)
}

const sameTs = (a, b) => Math.abs(Number(a) - Number(b)) < 1e-4

export function createOriginResolver({ history, run = RUN_ID }) {
  const cache = new Map()
  const load = async (sessionId, fresh = false) => {
    const hit = cache.get(sessionId)
    if (!fresh && hit && Date.now() - hit.at < HISTORY_TTL_MS) return hit.rows
    const rows = await history(sessionId)
    const list = Array.isArray(rows) ? rows : []
    cache.set(sessionId, { at: Date.now(), rows: list })
    return list
  }
  const tryLoad = (sessionId, fresh) => load(sessionId, fresh).then((r) => r, () => null)
  // The annotation's own Markdown is the best probe; the anchor (rendered text of
  // the passage, which may include tool output) is the fallback.
  const contains = (row, origin, text) => containsAnnotation(rowText(row), text || origin.anchor?.text || '')
  const bound = (origin, row) => {
    const { pending, messageId, approx, bind, ...rest } = origin
    return { ...rest, rowId: row.row_id, messageTs: String(row.timestamp), ordinal: Number(row.timestamp), verified: true }
  }
  const plan = (origin, mode) => ({ ...origin, verified: false, bind: { mode, run } })
  const pin = (origin, rows) => ({ ...origin, verified: false, bind: { mode: 'rows', run, rows } })
  /** Bind against the pinned rows only. → origin, or null when history is unreadable. */
  async function fromPinned(origin, text) {
    const rows = await tryLoad(origin.sessionId, true)
    if (!rows) return null
    const ids = new Set(origin.bind.rows)
    const row = rows.find((r) => ids.has(r.row_id) && r.role === origin.role && contains(r, origin, text))
    return row ? bound(origin, row) : plan(origin, 'never')
  }
  /** idle session: the single row of that role holding it; 'never' when several; null when unknown/none */
  async function sole(origin, text) {
    const rows = await tryLoad(origin.sessionId, true)
    if (!rows) return { rows: null }
    const hits = rows.filter((r) => r.role === origin.role && r.row_id != null && contains(r, origin, text))
    return { rows, hits }
  }

  return {
    async capture(origin, text, { busy = null } = {}) {
      if (!origin?.sessionId) return origin
      if (!origin.pending) {
        if (!origin.messageTs || origin.verified) return origin
        const rows = await tryLoad(origin.sessionId)
        const row = rows?.find((r) => r.row_id != null && r.timestamp != null && sameTs(r.timestamp, origin.messageTs))
        if (!row || !contains(row, origin, text)) return origin
        const { approx, ...rest } = origin
        return { ...rest, rowId: row.row_id, verified: true }
      }
      if (busy !== false) return plan(origin, 'turn')
      const { rows, hits } = await sole(origin, text)
      if (!rows) return plan(origin, 'turn')
      if (hits.length === 1) return bound(origin, hits[0])
      return plan(origin, hits.length ? 'never' : 'turn')
    },

    pinTurn(origin, turn, turnSession) {
      const b = origin?.bind
      if (!origin?.pending || !turn || b?.mode !== 'turn' || b.run !== run) return null
      if (!turnSession || turnSession !== origin.sessionId) return null
      const ids = [...new Set([...(turn.row_ids ?? []), turn.user_row_id, turn.final_assistant_row_id].filter((x) => x != null))]
      return ids.length ? pin(origin, ids) : null
    },

    async verifyPinned(origin, text) {
      if (!origin?.pending || origin.bind?.mode !== 'rows' || !Array.isArray(origin.bind.rows)) return null
      return fromPinned(origin, text)
    },

    async onReload(origin, text, { busy = null } = {}) {
      const b = origin?.bind
      if (origin?.pending && b?.mode === 'rows' && Array.isArray(b.rows)) return fromPinned(origin, text)
      if (!origin?.pending || busy !== false) return null
      // legacy pending origins (before R2) carry no plan: treat as an earlier run's
      if (b && (b.mode !== 'turn' || b.run === run)) return null
      const { rows, hits } = await sole(origin, text)
      if (!rows) return null
      if (hits.length === 1) return bound(origin, hits[0])
      return hits.length ? plan(origin, 'never') : null
    }
  }
}
