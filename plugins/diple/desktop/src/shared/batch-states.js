// V2-X (R8 XV-04): one derivation of what became of a sent annotation, read
// by both the transcript marks (capture/mark-states.js) and the session
// drawer (send/drawer/records.js), so the two can never disagree.
//
//   wentOut(batch) → boolean
//       Did this batch reach the AI? Only when it was expanded into a turn
//       (status expanded / answered) AND its final outcome is not a failure.
//       A final outcome is checked first: 'failed' (not persisted, put back,
//       cancelled — the backend may still say status 'expanded' while the
//       /failed update has not arrived) never counts, nor does any outcome
//       other than 'delivered' / none yet. registered (in flight, still in the
//       list) and failed (put back) never count either. When in doubt: no.
//   itemState(batch, item, n) → 'sent' | 'answered' | 'missing' | null
//       null when the batch did not go out. n = the item's number in the batch.
//       answered / missing only for a 批注 (an item with a comment) of a batch
//       whose answer was checked (status answered); a reply without any
//       markers leaves every 批注 missing.

const isComment = (it) => typeof it?.comment === 'string' && it.comment.trim() !== ''

export function wentOut(batch) {
  if (!batch) return false
  const outcome = batch.outcome ?? null
  if (outcome !== null && outcome !== 'delivered') return false
  return batch.status === 'expanded' || batch.status === 'answered'
}

export function itemState(batch, item, n) {
  if (!wentOut(batch)) return null
  if (batch.status !== 'answered' || !isComment(item)) return 'sent'
  const a = batch.answer ?? {}
  if ((a.answered ?? []).includes(n)) return 'answered'
  if (a.noMarkers || (a.missing ?? []).includes(n)) return 'missing'
  return 'sent'
}
