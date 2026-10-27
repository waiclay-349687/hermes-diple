// Scope + target → one send request (V2.1 #8, after Orca's "Send notes").
// Pure; the two plugins' send menus share it. It only DESCRIBES the request:
// the chat plugin carries it out with sending.request (ADR 0009), Diple Docs
// with handoff.send — neither engine changes.
//
//   SendRequest.plan({ scope, target, items, focusedSessionId, explicit })
//     scope:  { kind: 'item', id } | { kind: 'unsent' }
//     target: { kind: 'session', sessionId }   send now into that session
//           | { kind: 'queue' }                加入待发: the focused session's list, not sent
//           | { kind: 'copy' }                 复制给 AI: nothing is sent
//           | { kind: 'new' }                  a new session: the SDK cannot target one → refused
//     items:  [{ id, unsent }] in list order (the caller decides what "unsent" means)
//     explicit: the user picked the target in a menu (no second question)
//   → { ok: true, kind: 'send', sessionId, sendNow, itemIds, confirm }
//   | { ok: true, kind: 'copy', itemIds }
//   | { ok: false, reason: 'no-items' | 'no-session' | 'unsupported-target' }
//   confirm: ask "send to «title»?" first — only when nobody picked the target
//   (a shortcut) and it is not the focused session (design §2.10b).
//
//   SendRequest.targets({ current, recent }) → the menu's target list:
//     the current session, up to 5 recent ones (no repeats), then 加入待发.

export const RECENT_MAX = 5

export function plan({ scope, target, items = [], focusedSessionId = null, explicit = false } = {}) {
  if (target?.kind === 'new') return { ok: false, reason: 'unsupported-target' }
  const unsent = items.filter((it) => it && it.unsent)
  const picked = scope?.kind === 'item' ? unsent.filter((it) => it.id === scope.id) : unsent
  if (!picked.length) return { ok: false, reason: 'no-items' }
  const itemIds = picked.map((it) => it.id)
  if (target?.kind === 'copy') return { ok: true, kind: 'copy', itemIds }
  const sessionId = target?.kind === 'queue' ? focusedSessionId : target?.kind === 'session' ? target.sessionId : null
  if (!sessionId) return { ok: false, reason: 'no-session' }
  return { ok: true, kind: 'send', sessionId, sendNow: target.kind === 'session', itemIds, confirm: !explicit && sessionId !== focusedSessionId }
}

export function targets({ current = null, recent = [] } = {}) {
  const out = []
  const seen = new Set()
  if (current) {
    out.push({ kind: 'session', sessionId: current, current: true })
    seen.add(current)
  }
  for (const id of recent) {
    if (!id || seen.has(id)) continue
    if (out.length - (current ? 1 : 0) >= RECENT_MAX) break
    seen.add(id)
    out.push({ kind: 'session', sessionId: id })
  }
  if (current) out.push({ kind: 'queue' })
  return out
}
