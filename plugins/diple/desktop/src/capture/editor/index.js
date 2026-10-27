// The editor beside the original text (design §2.4). Plain DOM on <body>:
// a summary of the passage (host Markdown via the mirror) over a comment box
// styled like the host's input.
//
//   const ed = createEditor({ doc, md, t, anchor, onSave, onCancel, onReplace, canReplace })
//   ed.open({ key, id, n, mode, text, comment, kind })   mode 'new' | 'edit'
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
const GAP = 8
const EDGE = 8

const isImeEnter = (e) => e.isComposing || e.keyCode === 229

/** Above the passage when it fits, else below; left-aligned with it, kept on screen. */
export function placeEditor(rect, size, viewport) {
  const left = Math.round(Math.max(EDGE, Math.min(rect.left, viewport.width - size.width - EDGE)))
  const above = rect.top - GAP - size.height
  if (above >= EDGE) return { left, top: Math.round(above), side: 'top' }
  const below = rect.bottom + GAP
  return { left, top: Math.round(Math.max(EDGE, Math.min(below, viewport.height - size.height - EDGE))), side: 'bottom' }
}

export function createEditor({ doc = globalThis.document, md, t, anchor, onSave, onCancel, onReplace, canReplace = () => false }) {
  const win = doc.defaultView ?? globalThis
  let el = null
  let state = null
  let offMd = null
  let lastRect = null

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
    const p = placeEditor(r, { width: el.offsetWidth || WIDTH, height: el.offsetHeight || 0 }, vp.width ? vp : { width: 10_000, height: 10_000 })
    el.style.left = `${p.left}px`
    el.style.top = `${p.top}px`
    el.setAttribute('data-side', p.side)
  }

  const onSel = () => refreshReplace()
  doc.addEventListener('selectionchange', onSel)

  return {
    open(next, { focus = true } = {}) {
      if (!parts) parts = build()
      el = parts.root
      state = { ...next }
      lastRect = null
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
