// Persisted rows of a stored session, through the gateway's session.history.
// Shared by capture/ (origins) and send/ (did the turn persist this batch?).
//
//   sessionHistory(host, storedId) → Promise<[{ role, row_id, timestamp, text|content }]>
//   rowText(row) → string
//   rowHasBatch(row, batchId) → boolean   the row carries `@diple:<batchId>`

import { Envelope } from '@diple/core'

export async function sessionHistory(host, storedId) {
  const h = host ?? {}
  if (typeof h.request !== 'function') throw new Error('no gateway')
  const candidates = [storedId]
  if (h.state?.focusedStoredSessionId?.get?.() === storedId) candidates.push(h.state?.focusedSessionId?.get?.())
  let lastErr = null
  for (const sid of [...new Set(candidates.filter(Boolean))]) {
    try {
      const r = await h.request('session.history', { session_id: sid })
      if (Array.isArray(r?.messages)) return r.messages
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr ?? new Error('no history')
}

export function rowText(row) {
  const c = row?.text ?? row?.content ?? ''
  if (typeof c === 'string') return c
  if (Array.isArray(c)) return c.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join('\n')
  return ''
}

export function rowHasBatch(row, batchId) {
  const text = rowText(row)
  const token = `@${Envelope.REFERENCE_PREFIX}:${batchId}`
  let at = text.indexOf(token)
  while (at >= 0) {
    const next = text[at + token.length]
    if (next === undefined || !/[A-Za-z0-9_-]/.test(next)) return true
    at = text.indexOf(token, at + 1)
  }
  return false
}
