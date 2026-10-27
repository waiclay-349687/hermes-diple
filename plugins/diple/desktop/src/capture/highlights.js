// Marks on annotated passages in the transcript, drawn with the CSS Custom
// Highlight API (no host DOM changes; requirements 01-#14). V2 styles,
// design §2.1–2.2 (P7: ::highlight() paints text-decoration):
//
//   diple-mark       pending, fill                    (划线 and 批注)
//   diple-mark-line  pending 批注, 2px solid underline
//   diple-sent       sent (and missing), half fill
//   diple-sent-line  sent 批注, dashed underline
//   diple-answered(-line)  answered: the same in the answer hue, solid line
// Looks: @diple/core MarkLook, shared with Diple Docs.
//   diple-active     the annotation being edited or hovered: deeper fill; also
//                    what marks the place after locating (V2.1: no flash)
// Quiet mode (settings.marksQuiet) draws only diple-active.
//
//   const hl = createHighlighter({ lists, ui, doc, enabled, focusedKey, quiet, sent })
//   hl.start()             observe the transcript; redraw on list or DOM changes
//   hl.refresh()           redraw now (also marks cards whose original changed)
//   hl.schedule()          redraw soon (debounced)
//   hl.entries()           → [{ range, key, id, n, kind, state, sent, locked, text, comment, origin }]
//                            n = the number shown on the pin (send order; for a sent one, its
//                            number in that batch); state = 'highlight' | 'comment' | 'sent' |
//                            'answered' | 'missing'
//   hl.entry(id)           → that entry or null
//   hl.hitTest(x, y, preferKey) → the entry under a point, or null
//   hl.setActive(ids)      deepen these
//   hl.onChange(fn) → off  after every redraw (pins follow)
//   hl.dispose()
//
// Without CSS.highlights (old engines, jsdom) drawing is a silent no-op;
// entries and hitTest still work from the computed ranges.

import { PendingList } from '@diple/core'

import { allPersisted, contentOf, findMessage, hasEarlier, messageRoots, resolveSurfaceKey, surfaceFor } from './surfaces.js'
import { findAnchor } from './text-range.js'

export const HIGHLIGHT = 'diple-mark'
const NAMES = ['diple-mark', 'diple-mark-line', 'diple-sent', 'diple-sent-line', 'diple-answered', 'diple-answered-line', 'diple-active']
const DEBOUNCE_MS = 180

export function createHighlighter({ lists, ui, doc = globalThis.document, enabled = () => true, focusedKey = () => null, quiet = () => false, sent = null }) {
  const win = doc.defaultView ?? globalThis
  const registry = () => win.CSS?.highlights ?? null
  const HighlightCtor = win.Highlight
  let entries = []
  let active = new Set()
  let timer = null
  let observer = null
  const listeners = new Set()

  const visibleKeys = () => {
    // lists.keys() only knows lists already loaded; visible sessions load theirs here.
    const keys = new Set(lists.keys())
    for (const s of doc.querySelectorAll('[data-chat-surface]')) {
      const k = resolveSurfaceKey(s, focusedKey(), doc)
      if (k) keys.add(k)
    }
    return keys
  }

  const draw = (name, ranges, priority = 0) => {
    const reg = registry()
    if (!reg || !HighlightCtor) return
    if (!ranges.length) return void reg.delete(name)
    const h = new HighlightCtor(...ranges)
    h.priority = priority
    reg.set(name, h)
  }

  function paint() {
    const loud = !quiet()
    const pending = entries.filter((e) => !e.sent)
    const done = entries.filter((e) => e.sent)
    draw('diple-mark', loud ? pending.map((e) => e.range) : [])
    draw('diple-mark-line', loud ? pending.filter((e) => e.kind === 'comment').map((e) => e.range) : [], 1)
    const answered = done.filter((e) => e.state === 'answered')
    const sentOnly = done.filter((e) => e.state !== 'answered')
    draw('diple-sent', loud ? sentOnly.map((e) => e.range) : [])
    draw('diple-sent-line', loud ? sentOnly.filter((e) => e.kind === 'comment').map((e) => e.range) : [], 1)
    draw('diple-answered', loud ? answered.map((e) => e.range) : [])
    draw('diple-answered-line', loud ? answered.filter((e) => e.kind === 'comment').map((e) => e.range) : [], 1)
    draw('diple-active', entries.filter((e) => active.has(e.id)).map((e) => e.range), 2)
  }

  function locateIn(origin) {
    const surface = surfaceFor(origin.sessionId, doc)
    if (!surface) return { surface: null }
    const el = findMessage(surface, origin)
    if (!el) return { surface, el: null }
    return { surface, el, r: findAnchor(contentOf(el), origin.anchor) }
  }

  function refresh() {
    timer = null
    const next = []
    if (enabled()) {
      for (const key of visibleKeys()) {
        const state = lists.get(key)
        const pendingIds = new Set(state.items.map((it) => it.id))
        state.items.forEach((item, i) => {
          const origin = item.origin
          if (!origin || origin.path) return
          const { surface, el, r } = locateIn(origin)
          if (!surface) return
          if (!el) {
            // A persisted message that is gone from a fully loaded transcript
            // was deleted or regenerated.
            if (origin.messageTs && !origin.pending && !hasEarlier(surface) && messageRoots(surface).length && allPersisted(surface)) ui.markChanged(item.id, true)
            return
          }
          if (r.changed) {
            if (!origin.pending) ui.markChanged(item.id, true)
            return
          }
          ui.markChanged(item.id, false)
          const kind = PendingList.kindOf(item)
          next.push({ range: r, key, id: item.id, n: i + 1, kind, state: kind, sent: false, locked: PendingList.isLocked(state, item.id), text: item.text, comment: item.comment ?? '', origin })
        })
        // One mark per passage: a pending annotation wins over a sent one, the
        // latest send over earlier sends of the same passage.
        const sameSpot = (a, b) => a.startContainer === b.startContainer && a.startOffset === b.startOffset && a.endContainer === b.endContainer && a.endOffset === b.endOffset
        const taken = next.filter((e) => e.key === key).map((e) => e.range)
        for (const s of [...(sent?.forKey(key) ?? [])].reverse()) {
          if (pendingIds.has(s.id) || !s.origin || s.origin.path) continue
          const { el, r } = locateIn(s.origin)
          if (!el || r.changed) continue
          if (taken.some((t) => sameSpot(t, r))) continue
          taken.push(r)
          const kind = s.comment.trim() ? 'comment' : 'highlight'
          next.push({ range: r, key, id: s.id, n: s.n, kind, state: s.state, sent: true, locked: true, text: s.text, comment: s.comment, origin: s.origin, batchId: s.batchId })
        }
      }
    }
    entries = next
    paint()
    for (const fn of [...listeners]) fn(entries)
  }

  const schedule = () => {
    if (timer) return
    timer = setTimeout(refresh, DEBOUNCE_MS)
  }

  function pointRange(x, y) {
    if (doc.caretRangeFromPoint) return doc.caretRangeFromPoint(x, y)
    const p = doc.caretPositionFromPoint?.(x, y)
    if (!p) return null
    const r = doc.createRange()
    r.setStart(p.offsetNode, p.offset)
    return r
  }

  let unsubs = []
  return {
    start() {
      unsubs.push(lists.subscribe(schedule))
      if (sent) unsubs.push(sent.subscribe(schedule))
      const MO = win.MutationObserver
      if (MO) {
        observer = new MO((records) => {
          if (records.every((r) => r.target?.closest?.('[data-diple-ui]') || r.target?.parentElement?.closest?.('[data-diple-ui]'))) return
          schedule()
        })
        observer.observe(doc.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-message-id'] })
      }
      win.addEventListener?.('hashchange', schedule)
      unsubs.push(() => win.removeEventListener?.('hashchange', schedule))
      schedule()
    },
    refresh,
    schedule,
    entries: () => entries,
    entry: (id) => entries.find((e) => e.id === id) ?? null,
    onChange(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    setActive(ids) {
      const next = new Set([...(ids ?? [])].filter(Boolean))
      if (next.size === active.size && [...next].every((id) => active.has(id))) return
      active = next
      paint()
    },
    hitTest(x, y, preferKey = null) {
      if (!entries.length) return null
      const p = pointRange(x, y)
      if (!p) return null
      // The same passage can sit in several lists (split view): prefer the list
      // of the surface under the pointer; pending before sent.
      const rank = (e) => (preferKey && e.key !== preferKey ? 2 : 0) + (e.sent ? 1 : 0)
      const ordered = [...entries].sort((a, b) => rank(a) - rank(b))
      for (const e of ordered) {
        try {
          if (e.range.isPointInRange(p.startContainer, p.startOffset)) {
            // Exclude the boundary right after the last character.
            if (!(p.startContainer === e.range.endContainer && p.startOffset === e.range.endOffset)) return e
          }
        } catch {
          /* detached range */
        }
      }
      return null
    },
    dispose() {
      clearTimeout(timer)
      observer?.disconnect()
      unsubs.forEach((u) => u())
      unsubs = []
      listeners.clear()
      for (const n of NAMES) registry()?.delete(n)
      entries = []
    }
  }
}
