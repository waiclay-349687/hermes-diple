// The session's annotations in four states, for the drawer (design §2.7).
//
//   buildRecords({ items, batches }) → Record[]
//       items   — the session's pending list (PendingList items, list order)
//       batches — GET /batches?sessionId= rows (any order)
//     Record = { key, itemId, status, n, batchId, text, comment, origin, kind }
//       status: 'pending'  — in the pending list (also while it is being sent)
//               'sent'     — expanded into a turn; a highlight, or a comment
//                            whose answer was not checked (yet)
//               'answered' — a comment the reply answered with its marker
//               'missing'  — a comment the reply left out (or a reply with no
//                            markers at all)
//       Pending first in list order, then batches oldest first, by number.
//       Sent / answered / missing: shared/batch-states.js, the same derivation
//       as the transcript marks (a registered, failed, put back or cancelled
//       batch is not a record).
//   countByStatus(records) → { all, pending, sent, answered, missing }
//   toMarkdown(records, { t, originLabel }) → string   ("copy as Markdown")

import { itemState, wentOut } from '../../shared/batch-states.js'
import { CopyText } from '@diple/core'

export const STATUSES = ['pending', 'sent', 'answered', 'missing']

const isComment = (it) => typeof it?.comment === 'string' && it.comment.trim() !== ''

export function buildRecords({ items = [], batches = [] } = {}) {
  const out = items.map((it, i) => ({
    key: `p:${it.id}`,
    itemId: it.id,
    status: 'pending',
    n: i + 1,
    batchId: null,
    text: it.text ?? '',
    comment: it.comment ?? '',
    origin: it.origin ?? null,
    kind: isComment(it) ? 'comment' : 'highlight'
  }))
  const sent = batches.filter(wentOut).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
  for (const b of sent) {
    ;(b.items ?? []).forEach((it, i) => {
      const n = i + 1
      out.push({
        key: `${b.batchId}:${n}`,
        itemId: it?.id ?? null,
        status: itemState(b, it, n),
        n,
        batchId: b.batchId,
        text: it?.text ?? '',
        comment: it?.comment ?? '',
        origin: it?.origin ?? null,
        kind: isComment(it) ? 'comment' : 'highlight'
      })
    })
  }
  return out
}

export function countByStatus(records) {
  const c = { all: records.length, pending: 0, sent: 0, answered: 0, missing: 0 }
  for (const r of records) c[r.status]++
  return c
}

// the same block as the pin card's 「复制」 (core CopyText, V2.1 #7), indented under its list item
const indent = (block) =>
  block
    .split('\n')
    .map((l) => (l ? `   ${l}` : ''))
    .join('\n')

export function toMarkdown(records, { t, originLabel }) {
  const lines = [`# ${t('send.drawer.mdTitle', records.length)}`, '']
  for (const status of STATUSES) {
    const rs = records.filter((r) => r.status === status)
    if (!rs.length) continue
    lines.push(`## ${t(`send.drawer.status.${status}`)}`, '')
    for (const r of rs) {
      lines.push(`${r.n}. ${originLabel(r.origin) || '—'}`, '', indent(CopyText.block(r)), '')
    }
  }
  return lines.join('\n')
}
