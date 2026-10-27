// Locate: from an annotation's origin back to its original text (requirements
// 01-#13, stories 22–25). Provides the `locate` service. W2a.
//
//   const locate = createLocator({ highlighter, ui, openSession, notify, t, doc })
//   locate(origin, { itemId, silent, onShown }) → Promise<'shown' | 'loaded-and-shown' | 'not-loaded' | 'changed' | 'other-session-opened'>
//     silent: no notices (the caller reports the result itself — uiBus.locate)
//     onShown(range, { surface }): called once the passage is in view
//
// Steps: find the surface showing the origin's session (open it beside the
// current one when none does) → find the message (ask the host's own reveal
// path for an older row, else page "Show earlier") → find the passage via its
// anchor → bring it into view (V2, design §2.6; V2.1: nothing flashes — the
// editor that opens next deepens the mark instead). A passage
// already in view does not move; otherwise a smooth scroll to the middle of
// its thread, a jump under reduced motion or after loading). Loading older messages and
// the reveal event are host internals, so every step degrades to a notice.

import { allPersisted, contentOf, findMessage, hasEarlier, isShown, messageRoots, showEarlierButton, surfaceFor, viewportOf } from './surfaces.js'
import { findAnchor } from './text-range.js'

const REVEAL_EVENT = 'hermes:timeline-reveal' // host thread/timeline-data.ts (internal)
const OPEN_TIMEOUT_MS = 10_000
const REVEAL_TIMEOUT_MS = 4_000
const PAGE_TRIES = 12

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(fn, timeout, every = 100) {
  const end = Date.now() + timeout
  for (;;) {
    const v = fn()
    if (v) return v
    if (Date.now() > end) return null
    await sleep(every)
  }
}

function reveal(surface, rowId) {
  const viewport = viewportOf(surface)
  if (!viewport || rowId == null) return Promise.resolve(false)
  return new Promise((resolve) => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort()
      resolve(false)
    }, REVEAL_TIMEOUT_MS)
    const detail = {
      id: `history:${rowId}`,
      rowId,
      signal: controller.signal,
      complete: (id) => {
        clearTimeout(timer)
        resolve(Boolean(id))
      }
    }
    const Ctor = viewport.ownerDocument?.defaultView?.CustomEvent ?? CustomEvent
    viewport.dispatchEvent(new Ctor(REVEAL_EVENT, { detail }))
  })
}

async function pageEarlier(surface, origin) {
  for (let i = 0; i < PAGE_TRIES; i++) {
    const btn = showEarlierButton(surface)
    if (!btn) return null
    const before = messageRoots(surface).length
    btn.click()
    const moved = await waitFor(() => messageRoots(surface).length !== before || !showEarlierButton(surface), 2500)
    const el = findMessage(surface, origin)
    if (el) return el
    if (!moved) return null // the button did nothing: stop instead of spinning
  }
  return null
}

const reducedMotion = (doc) => Boolean(doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)

const hasLayout = (viewport) => Boolean(viewport?.getBoundingClientRect?.().height)

function rangeInView(range, viewport) {
  const r = range.getBoundingClientRect?.()
  const v = viewport.getBoundingClientRect()
  if (!r || (!r.height && !r.width)) return false
  return r.top >= v.top + 8 && r.bottom <= v.bottom - 8
}

/** Resolves when a scroll of `viewport` has come to rest (scrollend, or 140 ms without scroll events; at most 900 ms). */
function scrollRest(viewport) {
  return new Promise((resolve) => {
    let idle = null
    const done = () => {
      clearTimeout(cap)
      clearTimeout(idle)
      viewport.removeEventListener('scroll', on)
      viewport.removeEventListener('scrollend', done)
      resolve()
    }
    const on = () => {
      clearTimeout(idle)
      idle = setTimeout(done, 140)
    }
    const cap = setTimeout(done, 900)
    viewport.addEventListener('scroll', on, { passive: true })
    viewport.addEventListener('scrollend', done, { once: true })
    on()
  })
}

/** The middle of the passage to the middle of its thread viewport. */
function centre(range, viewport, behavior) {
  const r = range.getBoundingClientRect()
  const v = viewport.getBoundingClientRect()
  const top = Math.round((viewport.scrollTop || 0) + (r.top + r.height / 2) - (v.top + v.height / 2))
  if (viewport.scrollTo) viewport.scrollTo({ top, behavior })
  else viewport.scrollTop = top
}

/** Bring the passage into view: leave it when it is already there; else
 *  centre it. After a page was loaded the host restores its own scroll anchor
 *  once more, so re-check and retry. Without layout (tests) the old path. */
async function bringIntoView(range, target, viewport, jump, doc) {
  if (!hasLayout(viewport)) {
    target.scrollIntoView?.({ block: 'center', behavior: jump ? 'auto' : 'smooth' })
    return
  }
  if (rangeInView(range, viewport)) return
  const behavior = jump || reducedMotion(doc) ? 'auto' : 'smooth'
  centre(range, viewport, behavior)
  if (behavior === 'smooth') await scrollRest(viewport)
  for (const ms of jump ? [120, 300, 600] : [60]) {
    await sleep(ms)
    if (rangeInView(range, viewport)) return
    centre(range, viewport, 'auto')
  }
}

export function createLocator({ highlighter, ui, openSession, notify, t, doc = globalThis.document }) {
  return async function locate(origin, { itemId, silent = false, onShown = null } = {}) {
    const tell = (code, kind = 'info') => silent || notify({ kind, title: t(`capture.locate.${code}`) })
    if (!origin) {
      tell('not-loaded', 'warning')
      return 'not-loaded'
    }
    if (origin.path) {
      // From the review checklist (diple-docs): the file lives there, not in a chat.
      if (!silent) notify({ kind: 'info', title: t('capture.locate.file', origin.path) })
      return 'not-loaded'
    }
    let surface = surfaceFor(origin.sessionId, doc)
    let opened = false
    if (!surface || !isShown(surface)) {
      if (!origin.sessionId || !openSession) {
        tell('not-loaded', 'warning')
        return 'not-loaded'
      }
      try {
        await openSession(origin.sessionId)
      } catch {
        /* reported below */
      }
      surface = await waitFor(() => {
        const s = surfaceFor(origin.sessionId, doc)
        return s && isShown(s) ? s : null
      }, OPEN_TIMEOUT_MS)
      if (!surface) {
        tell('open-failed', 'warning')
        return 'not-loaded'
      }
      opened = true
      // Let the opened session paint its transcript before looking.
      await waitFor(() => messageRoots(surface).length > 0, OPEN_TIMEOUT_MS)
    }

    let el = findMessage(surface, origin)
    let loaded = false
    if (!el) {
      if (origin.rowId != null && (await reveal(surface, origin.rowId))) el = await waitFor(() => findMessage(surface, origin), 1500)
      if (!el) el = await pageEarlier(surface, origin)
      loaded = Boolean(el)
    }
    if (!el) {
      if (origin.messageTs && !origin.pending && !hasEarlier(surface) && allPersisted(surface)) {
        if (itemId) ui.markChanged(itemId, true)
        tell('changed', 'warning')
        return 'changed'
      }
      tell('not-loaded', 'warning')
      return 'not-loaded'
    }

    const hit = findAnchor(contentOf(el), origin.anchor)
    if (hit.changed) {
      el.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
      if (itemId) ui.markChanged(itemId, true)
      tell('changed', 'warning')
      return 'changed'
    }
    if (itemId) ui.markChanged(itemId, false)
    const target = hit.startContainer?.parentElement ?? el
    const viewport = viewportOf(surface)
    await bringIntoView(hit, target, viewport, loaded || opened, doc)
    onShown?.(hit, { surface })
    return opened ? 'other-session-opened' : loaded ? 'loaded-and-shown' : 'shown'
  }
}
