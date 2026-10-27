// PendingList: the pending annotations of one session, as a pure reducer.
//
// Interface:
//   createState()                 → empty state
//   reduce(state, cmd)            → { state, effects }
//   kindOf(item)                  → 'comment' | 'highlight'   (comment.trim() non-empty?)
//   summary(state)                → { total, comments, highlights, sending }
//   isLocked(state, id)           → true while the item is part of an in-flight send
//   serialize(state) / hydrate    → persistence (via the `hydrate` command)
//
// Item: { id, origin, text /*markdown*/, comment, revision, addedAt }.
// Commands (all pure; callers pass ids and clock values in):
//   add          { item: { origin, text, comment? }, id, now }
//   replaceText  { id, text, origin? }       keeps the comment
//   editComment  { id, comment }
//   remove       { id, now }    undoRemove { now }      5 s window
//   clear        { now }        undoClear  { now }      5 s window
//   beginSend    { batchId }    snapshot + lock every current item
//   commitSend   { batchId }    remove exactly the snapshot's items
//   abortSend    { batchId, reason }   unlock, items untouched
//   hydrate      { state }      load a persisted state
// Effects: { type: 'focus', id, duplicate }, { type: 'undoable', kind, until },
//   { type: 'sendStarted', batchId, items }, { type: 'sent', batchId, ids },
//   { type: 'sendAborted', batchId, reason }, { type: 'rejected', reason }.
//
// Order: chat annotations by origin.ordinal (position in the transcript), then
// origin.offset inside one message; sessions keep the order they first
// appeared in; file annotations by path, then line. Two annotations that only
// partly overlap are two items. The same origin message + same text is a
// duplicate and focuses the existing card instead.

export const UNDO_MS = 5000

export function createState() {
  return { items: [], sending: null, trash: null }
}

export function kindOf(item) {
  return typeof item?.comment === 'string' && item.comment.trim() ? 'comment' : 'highlight'
}

export function isLocked(state, id) {
  return Boolean(state.sending && state.sending.ids.includes(id))
}

export function summary(state) {
  const comments = state.items.filter((it) => kindOf(it) === 'comment').length
  return {
    total: state.items.length,
    comments,
    highlights: state.items.length - comments,
    sending: state.sending ? state.sending.batchId : null
  }
}

function messageKey(origin) {
  if (!origin) return ''
  if (origin.path) return `file:${origin.path}`
  return `msg:${origin.sessionId ?? ''}:${origin.rowId ?? `#${origin.role ?? ''}:${origin.ordinal ?? ''}`}`
}

// Items handed in by another plugin carry their own identity ({ plugin, itemId }):
// that identity alone decides "the same annotation" — two review items with the
// same text are two items, and one review item re-sent is still one (XE-05).
const ownerKey = (origin) => (origin && origin.plugin && origin.itemId != null ? `${origin.plugin}:${origin.itemId}` : null)

function sameAnnotation(a, b) {
  const ka = ownerKey(a.origin)
  const kb = ownerKey(b.origin)
  if (ka || kb) return ka === kb
  return messageKey(a.origin) === messageKey(b.origin) && (a.text ?? '').trim() === (b.text ?? '').trim()
}

function sortItems(items) {
  const groups = new Map()
  for (const it of items) {
    const g = it.origin?.path ? `file:${it.origin.path}` : `session:${it.origin?.sessionId ?? ''}`
    if (!groups.has(g)) groups.set(g, groups.size)
  }
  const key = (it) => {
    const o = it.origin ?? {}
    return o.path
      ? [groups.get(`file:${o.path}`), o.line ?? 0, o.offset ?? 0]
      : [groups.get(`session:${o.sessionId ?? ''}`), o.ordinal ?? 0, o.offset ?? 0]
  }
  // Stable: ties keep insertion order.
  return items
    .map((it, i) => ({ it, i, k: key(it) }))
    .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2] || a.i - b.i)
    .map((x) => x.it)
}

const done = (state, effects = []) => ({ state, effects })
const reject = (state, reason) => done(state, [{ type: 'rejected', reason }])

export function serialize(state) {
  return JSON.parse(JSON.stringify({ items: state.items, sending: state.sending }))
}

export function reduce(state, cmd) {
  state = state ?? createState()
  switch (cmd?.type) {
    case 'add': {
      const incoming = { origin: cmd.item?.origin ?? null, text: cmd.item?.text ?? '', comment: cmd.item?.comment ?? '' }
      if (!incoming.text.trim()) return reject(state, 'empty')
      const existing = state.items.find((it) => sameAnnotation(it, incoming))
      if (existing) return done(state, [{ type: 'focus', id: existing.id, duplicate: true }])
      if (!cmd.id) return reject(state, 'missing-id')
      const item = { id: cmd.id, ...incoming, revision: 1, addedAt: cmd.now ?? 0 }
      return done({ ...state, items: sortItems([...state.items, item]) }, [{ type: 'focus', id: item.id, duplicate: false }])
    }
    case 'replaceText': {
      const target = state.items.find((it) => it.id === cmd.id)
      if (!target) return reject(state, 'not-found')
      if (isLocked(state, cmd.id)) return reject(state, 'locked')
      if (!(cmd.text ?? '').trim()) return reject(state, 'empty')
      const next = { ...target, text: cmd.text, origin: cmd.origin ?? target.origin, revision: target.revision + 1 }
      const others = state.items.filter((it) => it.id !== cmd.id)
      const dup = others.find((it) => sameAnnotation(it, next))
      if (dup) return done(state, [{ type: 'focus', id: dup.id, duplicate: true }])
      return done({ ...state, items: sortItems([...others, next]) }, [{ type: 'focus', id: next.id, duplicate: false }])
    }
    case 'editComment': {
      const target = state.items.find((it) => it.id === cmd.id)
      if (!target) return reject(state, 'not-found')
      if (isLocked(state, cmd.id)) return reject(state, 'locked')
      const comment = cmd.comment ?? ''
      if (comment === target.comment) return done(state)
      return done({ ...state, items: state.items.map((it) => (it.id === cmd.id ? { ...it, comment, revision: it.revision + 1 } : it)) })
    }
    case 'remove': {
      const target = state.items.find((it) => it.id === cmd.id)
      if (!target) return reject(state, 'not-found')
      if (isLocked(state, cmd.id)) return reject(state, 'locked')
      const at = cmd.now ?? 0
      return done(
        { ...state, items: state.items.filter((it) => it.id !== cmd.id), trash: { kind: 'remove', items: [target], at } },
        [{ type: 'undoable', kind: 'remove', until: at + UNDO_MS }]
      )
    }
    case 'clear': {
      const removable = state.items.filter((it) => !isLocked(state, it.id))
      if (!removable.length) return reject(state, 'empty')
      const at = cmd.now ?? 0
      return done(
        { ...state, items: state.items.filter((it) => isLocked(state, it.id)), trash: { kind: 'clear', items: removable, at } },
        [{ type: 'undoable', kind: 'clear', until: at + UNDO_MS }]
      )
    }
    case 'undoRemove':
    case 'undoClear': {
      const kind = cmd.type === 'undoRemove' ? 'remove' : 'clear'
      const trash = state.trash
      if (!trash || trash.kind !== kind) return reject(state, 'nothing-to-undo')
      if ((cmd.now ?? 0) > trash.at + UNDO_MS) return reject({ ...state, trash: null }, 'expired')
      const restored = trash.items.filter((t) => !state.items.some((it) => sameAnnotation(it, t) || it.id === t.id))
      return done({ ...state, items: sortItems([...state.items, ...restored]), trash: null })
    }
    case 'beginSend': {
      if (!cmd.batchId) return reject(state, 'missing-batch')
      if (state.sending) return reject(state, 'busy')
      if (!state.items.length) return reject(state, 'empty')
      const snapshot = state.items.map((it) => ({ ...it }))
      return done(
        { ...state, sending: { batchId: cmd.batchId, ids: snapshot.map((it) => it.id), items: snapshot } },
        [{ type: 'sendStarted', batchId: cmd.batchId, items: snapshot }]
      )
    }
    case 'commitSend': {
      if (!state.sending || state.sending.batchId !== cmd.batchId) return reject(state, 'not-sending')
      const ids = state.sending.ids
      return done({ ...state, items: state.items.filter((it) => !ids.includes(it.id)), sending: null }, [
        { type: 'sent', batchId: cmd.batchId, ids }
      ])
    }
    case 'abortSend': {
      if (!state.sending || state.sending.batchId !== cmd.batchId) return reject(state, 'not-sending')
      return done({ ...state, sending: null }, [{ type: 'sendAborted', batchId: cmd.batchId, reason: cmd.reason ?? 'unknown' }])
    }
    case 'hydrate': {
      const src = cmd.state ?? {}
      const items = Array.isArray(src.items)
        ? src.items
            .filter((it) => it && typeof it.id === 'string' && typeof it.text === 'string')
            .map((it) => ({ revision: 1, addedAt: 0, comment: '', origin: null, ...it }))
        : []
      const sending =
        src.sending && typeof src.sending.batchId === 'string' && Array.isArray(src.sending.ids) ? src.sending : null
      return done({ items: sortItems(items), sending, trash: null })
    }
    default:
      return reject(state, 'unknown-command')
  }
}
