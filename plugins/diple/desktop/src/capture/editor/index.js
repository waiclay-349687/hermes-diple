// The editor beside the original text (design §2.4). Plain DOM on <body>:
// a summary of the passage (host Markdown via the mirror) over a comment box
// styled like the host's input.
//
//   const ed = createEditor({ doc, md, t, anchor, onSave, onCancel, onReplace, canReplace })
//   ed.open({ key, id, n, mode, text, comment, kind }, { focus, at })   mode 'new' | 'edit'
//                     at: { x, rtl } — the leading edge to open on (the toolbar's), kept
//                     relative to the passage while it scrolls; without x: the passage's start
//   ed.current()      → that state + { draft } | null
//   ed.close()        just close (no callbacks)
//   ed.outside()      the rules for a click outside: new + empty → onCancel;
//                     new + text → shake, keep the draft; existing → onSave
//   ed.setText(text)  after the passage was replaced
//   ed.reposition()   follow the passage (scroll / resize)
//   ed.contains(node) / ed.element
//
// Foot (V2.1 #4, after Orca's DiffCommentPopover): an icon-only 「用当前选区
// 替换原文」 on the left (its words in aria-label and a tooltip; greyed when
// nothing is selected), then 「保存并发送」 and the primary 「保存」 — text
// only, no key hints. The row wraps instead of overflowing in long languages.
//
// Keys in the box: ⏎ onSave(state, draft) · ⇧⏎ new line · ⌘⏎ onSave(state, draft, { send: true })
// · Esc onCancel(state) (new: the caller discards it; existing: this edit is dropped).
// An IME composition's ⏎ (isComposing / keyCode 229) never saves.
// `anchor(state)` → the passage's client rect, or null (keep the last place).

const WIDTH = 320
const GAP = 4 // under the passage: where the toolbar's top edge was (scheme B)
const EDGE = 8

const isImeEnter = (e) => e.isComposing || e.keyCode === 229

/** V3-T (design §V3): below the passage, its leading edge on `lead` (the toolbar's
 *  leading edge, else the passage's start); RTL mirrored. Not enough room below:
 *  above the passage; neither: the roomier side, kept on screen. Pure. */
export function placeEditor(rect, size, viewport, { lead = null, rtl = false } = {}) {
  const x = lead ?? (rtl ? rect.right : rect.left)
  const left = Math.round(Math.max(EDGE, Math.min(rtl ? x - size.width : x, viewport.width - size.width - EDGE)))
  const below = rect.bottom + GAP
  const above = rect.top - GAP - size.height
  const clampY = (y) => Math.round(Math.max(EDGE, Math.min(y, viewport.height - size.height - EDGE)))
  if (below + size.height <= viewport.height - EDGE) return { left, top: Math.round(below), side: 'bottom' }
  if (above >= EDGE) return { left, top: Math.round(above), side: 'top' }
  const roomBelow = viewport.height - rect.bottom
  return roomBelow >= rect.top ? { left, top: clampY(below), side: 'bottom' } : { left, top: clampY(above), side: 'top' }
}

export function createEditor({ doc = globalThis.document, md, t, anchor, onSave, onCancel, onReplace, canReplace = () => false }) {
  const win = doc.defaultView ?? globalThis
  let el = null
  let state = null
  let offMd = null
  let lastRect = null
  let lead = null // { dx, rtl }: the leading edge, relative to the passage's start edge

  const h = (tag, cls, attrs = {}) => {
    const n = doc.createElement(tag)
    if (cls) n.className = cls
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v)
    return n
  }

  function build() {
    const root = h('div', 'diple-pop diple-editor', { 'data-diple-ui': '', 'data-diple-editor': '', role: 'dialog' })
    const head = h('div', 'diple-editor-head')
    const badge = h('span', 'diple-nb')
    const title = h('span', 'diple-editor-title')
    const spacer = h('span', 'diple-spacer')
    const close = h('button', 'diple-ibtn', { type: 'button', 'data-diple-editor-close': '' })
    close.append(h('i', 'codicon codicon-close', { 'aria-hidden': 'true' }))
    head.append(badge, title, spacer, close)
    const quote = h('div', 'diple-editor-quote')
    const box = h('textarea', 'diple-field', { rows: '2', 'data-diple-editor-input': '' })
    const foot = h('div', 'diple-editor-foot')
    const replace = h('button', 'diple-ibtn diple-tipped', { type: 'button', 'data-diple-editor-replace': '' })
    replace.append(h('i', 'codicon codicon-replace', { 'aria-hidden': 'true' }))
    const actions = h('span', 'diple-editor-actions')
    const send = h('button', 'diple-sbtn', { type: 'button', 'data-diple-editor-send': '' })
    const save = h('button', 'diple-pbtn', { type: 'button', 'data-diple-editor-save': '' })
    actions.append(send, save)
    foot.append(replace, actions)
    root.append(head, quote, box, foot)

    root.addEventListener('mousedown', (e) => {
      // Buttons keep the transcript selection (the replace button needs it).
      if (e.target.closest('button')) e.preventDefault()
    })
    close.addEventListener('click', () => state && onCancel(snapshot()))
    save.addEventListener('click', () => state && onSave(snapshot(), box.value, { send: false }))
    send.addEventListener('click', () => state && onSave(snapshot(), box.value, { send: true }))
    replace.addEventListener('click', async () => {
      if (!state || replace.disabled) return
      await onReplace(snapshot())
      refreshReplace()
      box.focus({ preventScroll: true })
    })
    box.addEventListener('input', () => {
      fit()
      root.removeAttribute('data-shake')
    })
    box.addEventListener('keydown', (e) => {
      if (!state) return
      if (e.key === 'Enter' && !e.shiftKey && !isImeEnter(e)) {
        e.preventDefault()
        e.stopPropagation()
        onSave(snapshot(), box.value, { send: e.metaKey || e.ctrlKey })
      } else if (e.key === 'Escape' && !isImeEnter(e)) {
        e.preventDefault()
        e.stopPropagation()
        onCancel(snapshot())
      }
    })
    return { root, badge, title, close, quote, box, replace, save, send }
  }

  let parts = null
  const fit = () => {
    const box = parts.box
    box.style.height = 'auto'
    const sh = box.scrollHeight || 0
    if (sh) box.style.height = `${Math.min(180, Math.max(56, sh + 2))}px`
  }
  const snapshot = () => (state ? { ...state, draft: parts.box.value } : null)

  function refreshReplace() {
    if (!parts) return
    const ok = Boolean(state) && canReplace()
    parts.replace.disabled = !ok
    parts.replace.removeAttribute('title')
    const label = ok ? t('capture.editor.replace') : `${t('capture.editor.replace')} — ${t('capture.editor.replaceTip')}`
    parts.replace.setAttribute('aria-label', label)
    parts.replace.setAttribute('data-diple-tip', label)
  }

  function relabel() {
    if (!parts || !state) return
    parts.badge.textContent = state.mode === 'new' ? '+' : String(state.n)
    parts.badge.setAttribute('data-kind', state.kind ?? 'highlight')
    parts.title.textContent = state.mode === 'new' ? t('capture.editor.new') : t(state.kind === 'comment' ? 'capture.editor.editComment' : 'capture.editor.editHighlight')
    parts.close.setAttribute('aria-label', t('capture.editor.close'))
    parts.box.placeholder = t('capture.editor.placeholder')
    parts.box.setAttribute('aria-label', t('capture.editor.placeholder'))
    parts.save.textContent = t('capture.editor.save')
    parts.send.textContent = t('capture.editor.send')
    refreshReplace()
  }

  function reposition() {
    if (!el || !state) return
    const r = anchor(state) ?? lastRect
    if (!r) return
    lastRect = r
    const vp = { width: win.innerWidth || doc.documentElement.clientWidth || 0, height: win.innerHeight || doc.documentElement.clientHeight || 0 }
    const rtl = Boolean(lead?.rtl)
    const start = rtl ? r.right : r.left
    const p = placeEditor(r, { width: el.offsetWidth || WIDTH, height: el.offsetHeight || 0 }, vp.width ? vp : { width: 10_000, height: 10_000 }, { lead: lead?.dx != null ? start + lead.dx : null, rtl })
    el.style.left = `${p.left}px`
    el.style.top = `${p.top}px`
    el.setAttribute('data-side', p.side)
    el.setAttribute('data-dir', rtl ? 'rtl' : 'ltr')
  }

  const onSel = () => refreshReplace()
  doc.addEventListener('selectionchange', onSel)

  return {
    open(next, { focus = true, at = null } = {}) {
      if (!parts) parts = build()
      el = parts.root
      state = { ...next }
      lastRect = null
      // The leading edge, relative to the passage (it follows a scroll); measured now, before any await.
      const r0 = anchor(state)
      lead = { rtl: Boolean(at?.rtl), dx: at?.x != null && r0 ? at.x - (at.rtl ? r0.right : r0.left) : null }
      relabel()
      parts.box.value = next.comment ?? ''
      el.removeAttribute('data-shake')
      el.setAttribute('data-mode', state.mode)
      el.setAttribute('data-item-id', state.id)
      offMd?.()
      offMd = md ? md.render(parts.quote, next.text ?? '') : (parts.quote.textContent = next.text ?? '', null)
      if (!el.isConnected) doc.body.append(el)
      el.removeAttribute('data-enter')
      void el.offsetWidth
      el.setAttribute('data-enter', '')
      fit()
      reposition()
      if (focus) {
        parts.box.focus({ preventScroll: true })
        const end = parts.box.value.length
        parts.box.setSelectionRange?.(end, end)
      }
    },
    current: snapshot,
    isOpen: () => Boolean(state),
    close() {
      offMd?.()
      offMd = null
      state = null
      el?.remove()
    },
    outside() {
      if (!state) return
      const snap = snapshot()
      if (snap.mode === 'new' && !snap.draft.trim()) return onCancel(snap)
      if (snap.mode === 'new') {
        el.removeAttribute('data-shake')
        void el.offsetWidth
        el.setAttribute('data-shake', '')
        parts.box.focus({ preventScroll: true })
        return
      }
      onSave(snap, snap.draft, { send: false, outside: true })
    },
    setText(text) {
      if (!state) return
      state.text = text
      offMd?.()
      offMd = md ? md.render(parts.quote, text) : ((parts.quote.textContent = text), null)
      reposition()
    },
    setMode(mode, extra = {}) {
      if (!state) return
      Object.assign(state, { mode }, extra)
      el.setAttribute('data-mode', mode)
      relabel()
    },
    relabel,
    reposition,
    focus: () => parts?.box.focus({ preventScroll: true }),
    contains: (node) => Boolean(el && node && el.contains(node)),
    get element() {
      return el
    },
    dispose() {
      doc.removeEventListener('selectionchange', onSel)
      offMd?.()
      el?.remove()
      state = null
    }
  }
}
