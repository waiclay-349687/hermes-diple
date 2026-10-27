// The transcript side of Diple V2 (design §2.1–2.6, §3): the editor beside
// the text, numbered pins with their hover preview, the hover link to the
// composer strip, and uiBus.locate — back to the original, then the editor,
// with a way back to the composer.
//
//   const an = createAnnotator({ doc, lists, bus, highlighter, md, t, notify,
//                                locateOrigin, findSent, focusComposer, currentKey,
//                                readReplacement, canReplace, onRemoved, onDraft })
//   onDraft(id, bool)            V2.1 #2: true while a new annotation's editor is open
//                                and has not saved it once (the strip leaves it out)
//   an.openNew(key, id)          a just-added annotation: editor in 'new' mode
//   an.openEdit(key, id, opts)   an existing one (opts.focus, default true)
//   an.commitOpen() → { ok, key } save what is open (a new empty one stays as a 划线)
//                                and close it: before the next annotation, a locate,
//                                the way back, any send, a session switch, unload.
//                                ok false: the list refused (locked) — the editor
//                                stays open with the draft
//
// Invariant (R8 XV-01/02): words typed in the editor are never dropped
// silently. Every path that closes, replaces or sends goes through
// commitOpen() first; only Esc / × (an explicit discard, design §2.4) and
// a new empty annotation clicked away drop anything.
//   an.isOpen()
//   an.locate(itemId, { edit }) → 'shown' | 'loaded' | 'other-session' | 'missing'
//   an.dispose()
//
// Rules (design §2.4): ⏎ saves (empty = 划线), ⇧⏎ new line, ⌘⏎ saves then
// bus.sendNow(); Esc drops a new annotation / this edit; outside: new + empty
// → dropped, new + text → shake, existing → saved. A selection gesture is not
// a click outside. Only one editor at a time.

import { createEditor } from './editor/index.js'
import { isRtlAt } from './selection-toolbar/index.js'
import { createPins } from './pins/index.js'
import { createPreview } from './pins/preview.js'
import { CopyText } from '@diple/core'
import { surfaceFor, viewportOf } from './surfaces.js'

const HOVER_DELAY_MS = 140
const RETURN_MS = 5000
const COMPOSER = '[data-slot="composer-fade"]'

const RESULT = { shown: 'shown', 'loaded-and-shown': 'loaded', 'other-session-opened': 'other-session' }

export function createAnnotator({ doc = globalThis.document, lists, bus, highlighter, md, t, notify, locateOrigin, findSent = async () => null, focusComposer, currentKey, onFocusChange = null, readReplacement, canReplace, onRemoved, onDraft = () => {} }) {
  const win = doc.defaultView ?? globalThis
  const reduced = () => Boolean(win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)
  const raf = win.requestAnimationFrame?.bind(win) ?? ((fn) => setTimeout(fn, 16))
  let hovered = null
  let openId = null
  // The open editor's baseline (R9 XV9-01): the words it was opened with, moved
  // on by each save of its own that leaves it open (a session switch, a page
  // hide). Words still equal to it were not edited here — a comment changed
  // elsewhere meanwhile is kept; anything else typed is the user's last word.
  let baseline = null // { id, comment }
  let returnTo = null // { key, viewport, top } while the way back is offered
  let disposed = false

  const itemOf = (key, id) => lists.get(key).items.find((it) => it.id === id) ?? null
  const findPending = (id) => {
    for (const key of lists.keys()) {
      const it = itemOf(key, id)
      if (it) return { key, item: it }
    }
    return null
  }

  function syncActive() {
    const ids = [openId, hovered].filter(Boolean)
    highlighter.setActive(ids)
    pins.setActive(ids)
  }

  // ── editor ────────────────────────────────────────────────────────────────
  const rectOf = (id) => {
    const e = highlighter.entry(id)
    try {
      return e?.range.getBoundingClientRect() ?? null
    } catch {
      return null
    }
  }
  const editor = createEditor({
    doc,
    md,
    t,
    anchor: (s) => rectOf(s.id),
    canReplace: () => canReplace(),
    onSave(s, draft, { send = false, outside = false } = {}) {
      if (!save(s, draft)) return // refused: the draft stays in the editor
      // ⌘⏎ (R8 XV-03): the list is fixed now and handed on, before the editor
      // closes — never the focused session's list instead.
      if (send) bus.sendNow({ key: s.key })
      close(s)
      if (send) return
      // From the keyboard, the next thing is the message: back to the composer (story 8).
      else if (!outside) returnTo ? back() : focusComposer(s.key)
    },
    onCancel(s) {
      if (s.mode === 'new') lists.dispatch(s.key, { type: 'remove', id: s.id })
      close(s)
      if (returnTo) back()
      else focusComposer(s.key)
    },
    async onReplace(s) {
      const r = await readReplacement()
      if (!r?.ok) {
        if (r?.reason) notify({ kind: 'warning', title: t('capture.reason.' + r.reason) })
        return
      }
      if (r.pieces.length > 1) return notify({ kind: 'warning', title: t('capture.reason.replace-multi') })
      const [p] = r.pieces
      const effects = lists.dispatch(s.key, { type: 'replaceText', id: s.id, text: p.text, origin: p.origin })
      const rej = effects.find((e) => e.type === 'rejected')
      if (rej) return notify({ kind: 'warning', title: t(rej.reason === 'locked' ? 'capture.reason.locked' : 'capture.reason.empty') })
      const focus = effects.find((e) => e.type === 'focus')
      if (focus?.duplicate && focus.id !== s.id) return notify({ kind: 'info', title: t('capture.duplicate') })
      doc.getSelection()?.removeAllRanges()
      editor.setText(p.text)
      highlighter.refresh()
      editor.reposition()
    }
  })

  /** Write the draft into the list. → false when the list refused it (locked):
   *  the user is told and the editor stays open with the words. */
  function save(s, draft) {
    const cur = itemOf(s.key, s.id)
    const base = baseline?.id === s.id ? baseline.comment : s.comment
    // Only what was edited here: a comment changed elsewhere meanwhile is not overwritten.
    if (!cur || draft === base) return true
    if ((cur.comment ?? '') === draft) {
      baseline = { id: s.id, comment: draft }
      return true
    }
    const effects = lists.dispatch(s.key, { type: 'editComment', id: s.id, comment: draft })
    if (!effects.some((e) => e.type === 'rejected')) {
      baseline = { id: s.id, comment: draft }
      return true
    }
    notify({ kind: 'warning', title: t('capture.reason.locked') })
    editor.focus()
    return false
  }

  function close(s) {
    // closing without a discard means saved (Esc / a click away remove it first)
    if (s?.mode === 'new') onDraft(s.id, false)
    editor.close()
    if (openId) bus.editorClosed(openId)
    openId = null
    syncActive()
    void s
  }

  // The passage's direction: an RTL passage gets its editor mirrored.
  const rtlOf = (id) => {
    const n = highlighter.entry(id)?.range.startContainer
    return n ? isRtlAt(n, win) : false
  }

  function open(key, id, mode, { focus = true, at = null } = {}) {
    const item = itemOf(key, id)
    if (!item) return false
    // The same one again (its pin, its preview's edit): keep what is typed (R8 XV-01).
    if (openId === id && editor.isOpen()) {
      preview.hide({ now: true })
      if (focus) editor.focus()
      return true
    }
    if (openId && !commitOpen().ok) return false
    preview.hide({ now: true })
    highlighter.refresh()
    const n = lists.get(key).items.findIndex((it) => it.id === id) + 1
    const kind = (item.comment ?? '').trim() ? 'comment' : 'highlight'
    const opened = openId === id
    openId = id
    baseline = { id, comment: item.comment ?? '' }
    if (mode === 'new') onDraft(id, true)
    // V3-T: where the toolbar was (a new one from it), else under the passage's start.
    editor.open({ key, id, n, mode, kind, text: item.text, comment: item.comment ?? '' }, { focus, at: at ?? { rtl: rtlOf(id) } })
    if (!opened) bus.editorOpened(id)
    syncActive()
    return true
  }

  function commitOpen() {
    const s = editor.current()
    if (!s) return { ok: true, key: null }
    // A new one is kept even when empty (a 划线): annotating the next passage
    // never drops the previous one (story 10). Only Esc and a click away do.
    if (!save(s, s.draft)) return { ok: false, key: s.key }
    close(s)
    return { ok: true, key: s.key }
  }

  // ── pins + preview ─────────────────────────────────────────────────────────
  let hoverTimer = null
  const showPreviewSoon = (entry) => {
    clearTimeout(hoverTimer)
    if (openId === entry.id) return
    hoverTimer = setTimeout(() => {
      const r = pins.element(entry.id)?.getBoundingClientRect?.()
      const m = rectOf(entry.id)
      const fresh = highlighter.entry(entry.id)
      if (!fresh || openId === entry.id) return
      const anchor = m && r ? { left: Math.min(m.left, r.left), right: Math.max(m.right, r.right), top: Math.min(m.top, r.top), bottom: Math.max(m.bottom, r.bottom) } : (m ?? r)
      if (anchor) preview.show(fresh, anchor)
    }, preview.shownId() ? 0 : HOVER_DELAY_MS)
  }
  const leave = () => {
    clearTimeout(hoverTimer)
    preview.hide()
    setHover(null)
  }
  const setHover = (id) => {
    if (hovered === id) return
    hovered = id
    syncActive()
    bus.hover(id)
  }

  const preview = createPreview({
    doc,
    md,
    t,
    onEnter: (e) => e && setHover(e.id),
    onLeave: () => setHover(null),
    onAction(action, entry) {
      const found = findPending(entry.id)
      if (action === 'copy') {
        // V2.1 #7: a highlight copies the original; a comment the annotation as Markdown
        const c = CopyText.forCard({ text: entry.text, comment: entry.comment })
        win.navigator?.clipboard?.writeText?.(c.text)?.then?.(
          () => notify({ kind: 'success', title: t(c.withComment ? 'capture.preview.copiedBoth' : 'capture.preview.copied') }),
          () => {}
        )
        return
      }
      if (!found) return
      const { key, item } = found
      if (action === 'edit') return void open(key, item.id, 'edit')
      if (action === 'remove') {
        const effects = lists.dispatch(key, { type: 'remove', id: item.id })
        if (effects.some((e) => e.type === 'rejected')) return notify({ kind: 'warning', title: t('capture.reason.locked') })
        onRemoved?.(key, effects)
        setHover(null)
        return
      }
    }
  })

  const clipFor = (e) => viewportOf(surfaceFor(e.origin?.sessionId, doc))?.getBoundingClientRect() ?? null
  clipFor.viewport = (e) => viewportOf(surfaceFor(e.origin?.sessionId, doc))
  const avoidFor = (e) => {
    const c = surfaceFor(e.origin?.sessionId, doc)?.querySelector(COMPOSER)
    const r = c?.getBoundingClientRect?.()
    return r && r.height ? [r] : []
  }
  const pins = createPins({
    doc,
    highlighter,
    clipFor,
    avoidFor,
    label: (e) => `${e.n} · ${t(`capture.pin.state.${e.state}`)}`,
    onClick(entry) {
      clearTimeout(hoverTimer)
      if (entry.sent) {
        const r = rectOf(entry.id)
        if (r) preview.show(entry, r)
        return
      }
      open(entry.key, entry.id, 'edit')
    },
    onEnter(entry) {
      setHover(entry.id)
      showPreviewSoon(entry)
    },
    onLeave: leave
  })

  // ── hovering the marked text itself ────────────────────────────────────────
  let moveQueued = false
  let lastXY = null
  let buttons = 0
  const onMove = (e) => {
    lastXY = [e.clientX, e.clientY, e.target]
    buttons = e.buttons
    if (moveQueued) return
    moveQueued = true
    raf(() => {
      moveQueued = false
      if (disposed || !lastXY) return
      const [x, y, target] = lastXY
      if (target?.closest?.('[data-diple-ui]')) return
      if (buttons) return // selecting
      // A selection is up (the toolbar is about it): marks under the pointer stay quiet.
      const sel = doc.getSelection()
      if (sel && !sel.isCollapsed) {
        if (hovered && !preview.shownId()) setHover(null)
        return
      }
      const hit = highlighter.hitTest(x, y)
      if (hit) {
        if (hovered !== hit.id) {
          setHover(hit.id)
          showPreviewSoon(hit)
        }
      } else if (hovered) {
        // off the mark: the preview lingers a moment so the pointer can reach it
        clearTimeout(hoverTimer)
        preview.hide()
        setHover(null)
      }
    })
  }
  doc.addEventListener('mousemove', onMove, { passive: true })
  // Pressing anywhere but our own overlays starts something else: the preview goes.
  const onDown = (e) => {
    if (e.target?.closest?.('[data-diple-ui]')) return
    clearTimeout(hoverTimer)
    if (preview.shownId()) preview.hide({ now: true })
  }
  doc.addEventListener('mousedown', onDown, true)

  // ── clicks outside the editor ──────────────────────────────────────────────
  const OWN = '[data-diple-pin], [data-diple-hovercard], [data-diple-toolbar], [data-diple-return]'
  // The composer and the plugin's own strip / list: where an annotation goes.
  const COMPOSER_ZONE = `${COMPOSER}, [data-diple-list], [data-diple-footer], [data-diple-send]`
  const onClick = (e) => {
    const target = e.target
    if (!editor.isOpen()) return
    if (editor.contains(target) || target?.closest?.(OWN)) return // they handle themselves
    if (target?.closest?.(COMPOSER_ZONE)) return commitOpen() // kept (empty → 划线), never shaken
    const sel = doc.getSelection()
    if (sel && !sel.isCollapsed) return // a selection gesture, not a click away
    editor.outside()
  }
  doc.addEventListener('click', onClick, true)

  // The open annotation left the list (sent, cleared, removed elsewhere): close.
  const offLists = lists.subscribe(() => {
    const s = editor.current()
    if (s && !itemOf(s.key, s.id)) close(s)
  })

  // Follow the passage: scroll, resize, re-render.
  const offChange = highlighter.onChange(() => {
    editor.reposition()
    if (hovered && !highlighter.entry(hovered)) setHover(null)
  })
  let followQueued = false
  const follow = (e) => {
    if (e?.target?.closest?.('[data-diple-ui]')) return
    if (preview.shownId()) preview.hide({ now: true })
    if (followQueued || !editor.isOpen()) return
    followQueued = true
    raf(() => {
      followQueued = false
      editor.reposition()
    })
  }
  doc.addEventListener('scroll', follow, true)
  win.addEventListener('resize', follow)

  // C's strip hovers a capsule → deepen that mark.
  const offBusHover = bus.onHover((id) => {
    if (hovered === id) return
    hovered = id
    syncActive()
  })

  // ── the way back to the composer ───────────────────────────────────────────
  const pill = doc.createElement('button')
  pill.type = 'button'
  pill.tabIndex = -1
  pill.className = 'diple-return'
  pill.setAttribute('data-diple-ui', '')
  pill.setAttribute('data-diple-return', '')
  pill.hidden = true
  const arrow = doc.createElement('span')
  arrow.setAttribute('aria-hidden', 'true')
  arrow.textContent = '\u2190'
  const pillText = doc.createElement('span')
  pill.append(arrow, pillText)
  doc.body.append(pill)
  let pillTimer = null
  pill.addEventListener('mousedown', (e) => e.preventDefault())
  pill.addEventListener('click', (e) => {
    e.preventDefault()
    if (editor.isOpen() && !commitOpen().ok) return
    back()
  })

  function offerReturn(key, viewport, top, atBottom = false) {
    returnTo = { key, viewport, top, atBottom }
    pillText.textContent = t('capture.back')
    const composer = surfaceFor(key, doc)?.querySelector(COMPOSER) ?? doc.querySelector(COMPOSER)
    const r = composer?.getBoundingClientRect?.()
    if (r && r.width) {
      pill.style.left = `${Math.round(r.left + r.width / 2)}px`
      pill.style.top = `${Math.round(r.top - 8)}px`
    }
    pill.hidden = false
    pill.removeAttribute('data-enter')
    void pill.offsetWidth
    pill.setAttribute('data-enter', '')
    clearTimeout(pillTimer)
    pillTimer = setTimeout(hidePill, RETURN_MS)
  }
  function hidePill() {
    clearTimeout(pillTimer)
    pill.hidden = true
    returnTo = null
  }
  function back() {
    const r = returnTo
    hidePill()
    if (!r) return
    const vp = r.viewport
    if (vp?.isConnected && typeof r.top === 'number' && vp.scrollTo) {
      // Back at the bottom (the usual place: the latest reply) stays the bottom
      // even when the host paged messages in or out meanwhile.
      const target = () => (r.atBottom ? vp.scrollHeight - vp.clientHeight : r.top)
      vp.scrollTo({ top: target(), behavior: reduced() ? 'auto' : 'smooth' })
      setTimeout(() => {
        if (vp.isConnected && Math.abs(vp.scrollTop - target()) > 4) vp.scrollTo({ top: target(), behavior: 'auto' })
      }, reduced() ? 0 : 700)
    }
    focusComposer(r.key)
  }
  const onKey = (e) => {
    if (e.key !== 'Escape' || e.isComposing || e.keyCode === 229 || !returnTo) return
    if (editor.isOpen()) return // the editor's own Esc goes back too
    const t2 = e.target
    if (t2?.closest?.('input, textarea, [contenteditable="true"]') && !t2.closest('[data-diple-ui]')) return
    back()
  }
  doc.addEventListener('keydown', onKey)

  // Another session in front (the host focuses a tile on hover too), or the
  // window going away: what is typed is written into the list now, the
  // editor stays where it is (R8 XV-01).
  const keepDraft = () => {
    const s = editor.current()
    if (s) save(s, s.draft)
  }
  const offFocus = onFocusChange?.(keepDraft)
  const onHide = keepDraft
  win.addEventListener('pagehide', onHide)
  win.addEventListener('beforeunload', onHide)

  // ── uiBus.locate ───────────────────────────────────────────────────────────
  async function locate(itemId, { edit = true } = {}) {
    // Pending: the list. Sent / answered / missing (the drawer): the mark if
    // drawn, else the batch records — also with marksKeepSent off.
    // Where the user is now, read at the click — not after the awaits below.
    const fromKey = currentKey()
    const fromViewport = viewportOf(surfaceFor(fromKey, doc))
    const fromTop = fromViewport?.scrollTop ?? null
    const fromBottom = fromViewport ? fromViewport.scrollHeight - fromViewport.clientHeight - fromViewport.scrollTop < 4 : false
    const found = findPending(itemId)
    // A sent one (R8 XV-05): its origin from the persisted batch records, not
    // from whatever mark happens to be drawn (a message paged out has none).
    const origin = found?.item.origin ?? (await findSent(itemId, fromKey))?.origin ?? highlighter.entry(itemId)?.origin ?? null
    // One notice, from the locator (the caller adds none): it knows why.
    if (!origin || origin.path) {
      await locateOrigin(origin)
      return 'missing'
    }
    if (disposed) return 'missing'
    if (editor.isOpen() && !commitOpen().ok) return 'missing' // refused: the draft stays, told already
    preview.hide({ now: true })
    const r = await locateOrigin(origin, { itemId: found ? itemId : undefined })
    const result = RESULT[r] ?? 'missing'
    if (result === 'missing' || disposed) return result
    highlighter.refresh()
    if (edit && found && itemOf(found.key, itemId)) {
      open(found.key, itemId, 'edit')
    }
    if (result === 'shown' || result === 'loaded') offerReturn(fromKey ?? found?.key, fromViewport, fromTop, fromBottom)
    return result
  }

  return {
    openNew: (key, id, opts) => open(key, id, 'new', opts),
    openEdit: (key, id, opts) => open(key, id, 'edit', opts),
    commitOpen,
    isOpen: () => editor.isOpen(),
    locate,
    relabel() {
      editor.relabel()
      pins.layout()
    },
    dispose() {
      if (editor.isOpen()) commitOpen() // unload / plugin reload: keep the words
      disposed = true
      offFocus?.()
      win.removeEventListener('pagehide', onHide)
      win.removeEventListener('beforeunload', onHide)
      clearTimeout(hoverTimer)
      clearTimeout(pillTimer)
      offLists()
      offChange()
      offBusHover()
      doc.removeEventListener('mousemove', onMove)
      doc.removeEventListener('mousedown', onDown, true)
      doc.removeEventListener('click', onClick, true)
      doc.removeEventListener('scroll', follow, true)
      doc.removeEventListener('keydown', onKey)
      win.removeEventListener('resize', follow)
      editor.dispose()
      preview.dispose()
      pins.dispose()
      pill.remove()
    }
  }
}
