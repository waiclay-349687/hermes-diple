// Host DOM, read-only: which chat surface shows which session, where its
// messages are, and which parts of a message are quotable. Every selector of
// host markup used by capture/ lives here, so a host markup change is fixed in
// one file. Nothing here writes to host DOM.
//
//   surfaceOf(el)                 → the chat surface element containing el, or null
//   surfaceSessionKey(surface)    → stored session id shown by that surface, or null
//   resolveSurfaceKey(surface, focusedKey) → surfaceSessionKey with a draft fallback
//   surfaceFor(sessionKey)        → the visible surface showing that session, or null
//   messageRootOf(el)             → { root, role } of the message containing el, or null
//   contentOf(root)               → the element holding the message's own text
//   blockedReason(el)             → 'composer' | 'tool' | 'thinking' | null
//   parseMessageId(id)            → { ts, index, role } | null  (persisted ids only)
//   findMessage(surface, origin)  → message root element for an origin, or null
//   messageRoots(scope)           → all message roots in document order
//   hasEarlier(surface)           → the surface still hides older messages
//   showEarlierButton(surface)    → the host's "Show earlier" button, or null
//   viewportOf(surface)           → the thread scroller
//   ownedElsewhere(node)          → node sits in another plugin's UI that owns its own capture
//                                   ([data-diple-owner], e.g. the Diple Docs document)

export const USER_ROOT = '[data-slot="aui_user-message-root"]'
export const ASSISTANT_ROOT = '[data-slot="aui_assistant-message-root"]'
export const MESSAGE_ROOT = `${USER_ROOT}, ${ASSISTANT_ROOT}`
const USER_CONTENT = '[data-slot="aui_user-message-text"]'
const ASSISTANT_CONTENT = '[data-slot="aui_assistant-message-content"]'
const SURFACE = '[data-chat-surface]'
const VIEWPORT = '[data-slot="aui_thread-viewport"]'
const THREAD_CONTENT = '[data-slot="aui_thread-content"]'

const COMPOSER = '[data-slot="composer-rich-input"], [data-slot="aui_edit-composer-root"], textarea, input, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]'
const TOOL = '[data-slot="tool-block"], [data-slot="tool-progress"], [data-slot="tool-approval-card"], [data-slot="aui_turn-activity"]'
const THINKING = '[data-slot="aui_thinking-disclosure"], [data-slot="aui_reasoning-text"], [data-slot="aui_thinking-body"]'

// Host app routes that are not sessions (apps/desktop/src/app/routes.ts).
const NON_SESSION_ROUTES = new Set([
  'settings', 'command-center', 'session-import', 'capabilities', 'messaging', 'webhooks',
  'artifacts', 'cron', 'profiles', 'agents', 'starmap', 'skills', 'new'
])

// Plugin UIs that handle ⌘⇧E / selections themselves mark their root with this
// (diple-docs's document view). Capture stays silent inside them.
const FOREIGN_OWNER = '[data-diple-owner]'

export const elementOf = (node) => (node?.nodeType === 1 ? node : node?.parentElement ?? null)

export function surfaceOf(el) {
  return elementOf(el)?.closest?.(SURFACE) ?? null
}

/** Session id of the primary (workspace) surface, from the hash route. */
export function primaryRouteKey(hash = (globalThis.window ?? globalThis).location?.hash ?? '') {
  const path = hash.replace(/^#/, '').replace(/[?#].*$/, '')
  if (!path.startsWith('/')) return null
  const id = path.slice(1)
  if (!id || id.includes('/') || NON_SESSION_ROUTES.has(id)) return null
  try {
    return decodeURIComponent(id)
  } catch {
    return null
  }
}

export function surfaceSessionKey(surface) {
  if (!surface) return null
  const anchor = surface.getAttribute('data-session-anchor') ?? ''
  if (anchor.startsWith('session-tile:')) return anchor.slice('session-tile:'.length) || null
  const target = surface.getAttribute('data-composer-target') ?? ''
  if (target.startsWith('tile:')) return target.slice(5) || null
  return primaryRouteKey()
}

/** Like surfaceSessionKey, but a primary surface whose route names no session
 *  (a draft that just became a session) takes the focused session, unless a
 *  tile is the one showing it. */
export function resolveSurfaceKey(surface, focusedKey, doc = globalThis.document) {
  const own = surfaceSessionKey(surface)
  if (own || !surface || !focusedKey) return own
  const isPrimary = !(surface.getAttribute('data-session-anchor') ?? '').startsWith('session-tile:')
  if (!isPrimary) return own
  const tile = surfaceFor(focusedKey, doc)
  return tile && tile !== surface ? null : focusedKey
}

export function surfaceFor(sessionKey, doc = globalThis.document) {
  if (!sessionKey || !doc) return null
  let hidden = null
  for (const s of doc.querySelectorAll(SURFACE)) {
    if (surfaceSessionKey(s) !== sessionKey) continue
    if (isShown(s)) return s
    hidden ??= s
  }
  return hidden
}

/** Rendered and not hidden behind another tab (kept-alive panes are display:none). */
export function isShown(el) {
  if (!el?.getClientRects) return false
  // jsdom has no layout: treat everything as shown there.
  if (!globalThis.navigator?.userAgent || /jsdom/i.test(globalThis.navigator.userAgent)) return true
  return el.getClientRects().length > 0
}

export function messageRootOf(el) {
  const root = elementOf(el)?.closest?.(MESSAGE_ROOT)
  if (!root) return null
  return { root, role: root.matches(USER_ROOT) ? 'user' : 'assistant' }
}

export function contentOf(root) {
  return root.querySelector(root.matches(USER_ROOT) ? USER_CONTENT : ASSISTANT_CONTENT) ?? root
}

export function blockedReason(el) {
  const e = elementOf(el)
  if (!e?.closest) return null
  if (e.closest(COMPOSER)) return 'composer'
  if (e.closest(TOOL)) return 'tool'
  if (e.closest(THINKING)) return 'thinking'
  return null
}

/** Persisted message ids look like `<timestamp>-<index>-<role>` (W1 P4). */
export function parseMessageId(id) {
  const m = /^(\d+(?:\.\d+)?)-(\d+)-(user|assistant)$/.exec(id ?? '')
  return m ? { ts: m[1], index: Number(m[2]), role: m[3] } : null
}

export function messageRoots(scope) {
  return scope ? [...scope.querySelectorAll(MESSAGE_ROOT)] : []
}

export function findMessage(scope, origin) {
  if (!scope || !origin) return null
  if (origin.messageTs) {
    const hit = scope.querySelector(`[data-message-id^="${cssEscape(origin.messageTs)}-"]`)
    if (hit && hit.matches(MESSAGE_ROOT)) return hit
    // The live session keeps temporary ids on finished turns until a reload:
    // a same-role message at the same position with a temporary id may be it.
    const cand = byRoleOrdinal(scope, origin)
    return cand && !parseMessageId(cand.getAttribute('data-message-id')) ? cand : null
  }
  if (origin.messageId) {
    const hit = scope.querySelector(`[data-message-id="${cssEscape(origin.messageId)}"]`)
    if (hit) return hit
  }
  // No durable id (streaming capture not yet bound, or markup without ids):
  // fall back to the role ordinal; the anchor check decides whether it is right.
  return byRoleOrdinal(scope, origin)
}

function byRoleOrdinal(scope, origin) {
  const same = messageRoots(scope).filter((r) => r.matches(origin.role === 'user' ? USER_ROOT : ASSISTANT_ROOT))
  return same[(origin.roleOrdinal ?? 0) - 1] ?? null
}

/** Every rendered message carries a persisted id (so a missing one is really gone). */
export function allPersisted(scope) {
  return messageRoots(scope).every((r) => parseMessageId(r.getAttribute('data-message-id')))
}

export function viewportOf(surface) {
  return surface?.querySelector(VIEWPORT) ?? null
}

export function showEarlierButton(surface) {
  const content = surface?.querySelector(THREAD_CONTENT)
  const first = content?.firstElementChild
  return first && first.tagName === 'BUTTON' && !first.closest(MESSAGE_ROOT) ? first : null
}

export function hasEarlier(surface) {
  return Boolean(showEarlierButton(surface))
}

function cssEscape(s) {
  return globalThis.CSS?.escape ? globalThis.CSS.escape(String(s)) : String(s).replace(/["\\]/g, '\\$&')
}

export function ownedElsewhere(node) {
  return Boolean(elementOf(node)?.closest?.(FOREIGN_OWNER))
}
