// Selection → annotation candidates. W2a.
//
//   readSelection(selection, { fallbackSessionKey }) →
//     { ok: true, pieces: [{ origin, text }] }      one piece per message touched
//     { ok: false, reason }
//   reason: 'empty' | 'outside' | 'composer' | 'tool' | 'thinking' | 'foreign'
//   ('foreign': inside another plugin's own capture UI, [data-diple-owner];
//    callers stay silent — that UI has its own ⌘⇧E and button)
//   canCapture(selection) → boolean   same rules, cheap (no Markdown); drives the floating button
//
// Rules (design 3.2, requirements 01-#3/#16): chat messages only — user and
// assistant text, including code blocks and tables. Tool output, thinking,
// any editor and everything outside the transcript are refused with a reason.
// A selection across several messages is split per message, each with its
// own origin. Text is Markdown (markdown.js).
//
// Origin (stored with the item; PendingList orders by ordinal then offset):
//   { sessionId, role, roleOrdinal, ordinal, offset, anchor,
//     messageId?, messageTs?, pending?, verified:false, approx? }
// `ordinal` is the message timestamp when known (monotonic per session, so
// order survives history windowing), else the DOM position. `verified` and
// `rowId` are filled in later by origin.js.

import { Anchor } from '@diple/core'

import { rangeToMarkdown } from './markdown.js'
import {
  ASSISTANT_ROOT,
  blockedReason,
  contentOf,
  elementOf,
  hasEarlier,
  ownedElsewhere,
  messageRootOf,
  messageRoots,
  parseMessageId,
  resolveSurfaceKey,
  surfaceOf,
  USER_ROOT
} from './surfaces.js'
import { textOffset } from './text-range.js'

const isOwnUi = (node) => Boolean(elementOf(node)?.closest?.('[data-diple-ui]'))

/** Message roots the range touches, in document order. */
function touchedMessages(range) {
  const doc = range.startContainer.ownerDocument
  const start = messageRootOf(range.startContainer)?.root
  const end = messageRootOf(range.endContainer)?.root
  if (start && start === end) return [start]
  const scope = elementOf(range.commonAncestorContainer) ?? doc.body
  const inside = messageRoots(scope).filter((r) => range.intersectsNode(r))
  const all = [...new Set([...(start ? [start] : []), ...inside, ...(end ? [end] : [])])]
  return all.sort((a, b) => (a === b ? 0 : a.compareDocumentPosition(b) & 4 ? -1 : 1))
}

/** The part of `range` that lies inside `el`, or null. */
function clampTo(range, el) {
  const r = el.ownerDocument.createRange()
  r.selectNodeContents(el)
  if (range.compareBoundaryPoints(0 /* START_TO_START */, r) > 0) r.setStart(range.startContainer, range.startOffset)
  if (range.compareBoundaryPoints(2 /* END_TO_END */, r) < 0) r.setEnd(range.endContainer, range.endOffset)
  return r.collapsed ? null : r
}

function reasonAt(node) {
  if (isOwnUi(node)) return 'outside'
  return blockedReason(node) ?? (messageRootOf(node) ? null : 'outside')
}

/** Text of the piece without tool output / thinking inside it. */
function quotableText(piece) {
  const frag = piece.cloneContents()
  frag.querySelectorAll?.('[data-slot="tool-block"],[data-slot="aui_thinking-disclosure"],[data-slot="aui_reasoning-text"],[data-slot="aui_turn-activity"]').forEach((n) => n.remove())
  return frag.textContent ?? ''
}

function originFor(root, role, piece, content, fallbackSessionKey) {
  const surface = surfaceOf(root)
  const sessionId = (surface ? resolveSurfaceKey(surface, fallbackSessionKey) : null) ?? fallbackSessionKey
  const all = messageRoots(surface ?? root.ownerDocument)
  const sameRole = all.filter((el) => el.matches(role === 'user' ? USER_ROOT : ASSISTANT_ROOT))
  const messageId = root.getAttribute('data-message-id') || null
  const parsed = parseMessageId(messageId)
  const start = textOffset(content, piece.startContainer, piece.startOffset)
  const end = start + piece.toString().length
  let anchor = null
  try {
    anchor = Anchor.makeAnchor(content.textContent ?? '', start, end)
  } catch {
    anchor = null
  }
  // Streaming messages carry temporary ids (user-<uuid>, assistant-stream-…);
  // origin.js binds them to a row once the turn completes.
  const streaming = Boolean(messageId) && !parsed && /^(user-|assistant-stream-)/.test(messageId)
  return {
    sessionId,
    role,
    roleOrdinal: sameRole.indexOf(root) + 1,
    ordinal: parsed ? Number(parsed.ts) : streaming ? Date.now() / 1000 : all.indexOf(root) + 1,
    offset: start,
    ...(anchor ? { anchor } : {}),
    ...(messageId ? { messageId } : {}),
    ...(parsed ? { messageTs: parsed.ts } : {}),
    ...(streaming ? { pending: true } : {}),
    ...(surface && hasEarlier(surface) ? { approx: true } : {}),
    verified: false
  }
}

function analyze(selection) {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return { reason: 'empty' }
  const range = selection.getRangeAt(0)
  if (ownedElsewhere(range.startContainer) || ownedElsewhere(range.endContainer)) return { reason: 'foreign' }
  if (!range.toString().trim()) return { reason: 'empty' }
  const roots = touchedMessages(range)
  if (!roots.length) return { reason: reasonAt(range.startContainer) ?? reasonAt(range.endContainer) ?? 'outside' }
  const pieces = []
  let blocked = null
  for (const root of roots) {
    const role = root.matches(USER_ROOT) ? 'user' : 'assistant'
    const content = contentOf(root)
    const piece = clampTo(range, content)
    const inside = piece && blockedReason(piece.commonAncestorContainer)
    if (!piece || inside || !quotableText(piece).trim()) {
      if (inside) {
        blocked ??= inside
        continue
      }
      blocked ??= (piece && (blockedReason(piece.startContainer) ?? blockedReason(piece.endContainer))) ?? reasonAt(range.startContainer) ?? reasonAt(range.endContainer)
      continue
    }
    pieces.push({ root, role, content, piece })
  }
  if (!pieces.length) return { reason: blocked ?? 'outside' }
  return { pieces }
}

export function canCapture(selection) {
  return !analyze(selection).reason
}

export function readSelection(selection, { fallbackSessionKey = null } = {}) {
  const a = analyze(selection)
  if (a.reason) return { ok: false, reason: a.reason }
  const pieces = []
  for (const { root, role, content, piece } of a.pieces) {
    const text = rangeToMarkdown(piece)
    if (!text) continue
    pieces.push({ text, origin: originFor(root, role, piece, content, fallbackSessionKey) })
  }
  if (!pieces.length) return { ok: false, reason: 'empty' }
  return { ok: true, pieces }
}

export { ASSISTANT_ROOT, USER_ROOT }
