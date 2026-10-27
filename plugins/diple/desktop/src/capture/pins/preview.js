// Hover preview of an annotation (design §2.5): its comment (host Markdown
// via the mirror) and three buttons (V2.1 #6) — a comment: 编辑 / 复制 / 删除;
// a highlight: 写意见 / 复制 / 删除 (both open the editor; clearing the words
// there and saving makes a comment a highlight again). Sent annotations are
// read-only: 复制 only. Buttons are real, focusable buttons.
//
//   const pv = createPreview({ doc, md, t, onAction })
//   pv.show(entry, rect)      after a short hover delay (the caller's)
//   pv.hide({ now })          leaves after 250 ms unless the pointer comes into it
//   pv.shownId()              → id | null
//   pv.contains(node) / pv.dispose()
//   onAction(action, entry)   action: 'edit' | 'copy' | 'remove'

const LINGER_MS = 250
const GAP = 6
const EDGE = 8
const WIDTH = 300

const ICONS = { edit: 'edit', addComment: 'comment', remove: 'trash', copy: 'copy' }

export function createPreview({ doc = globalThis.document, md, t, onAction, onEnter, onLeave }) {
  const win = doc.defaultView ?? globalThis
  const root = doc.createElement('div')
  root.className = 'diple-pop diple-preview'
  root.setAttribute('data-diple-ui', '')
  root.setAttribute('data-diple-hovercard', '')
  root.hidden = true
  doc.body.append(root)
  let entry = null
  let offMd = null
  let hideTimer = null

  root.addEventListener('mouseenter', () => {
    clearTimeout(hideTimer)
    onEnter?.(entry)
  })
  root.addEventListener('mouseleave', () => {
    hide()
    onLeave?.(entry)
  })
  root.addEventListener('mousedown', (e) => e.preventDefault())
  root.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-diple-action]')
    if (!b || !entry) return
    e.preventDefault()
    e.stopPropagation()
    const cur = entry
    hide({ now: true })
    onAction(b.getAttribute('data-diple-action'), cur)
  })

  function hide({ now = false } = {}) {
    clearTimeout(hideTimer)
    const go = () => {
      offMd?.()
      offMd = null
      entry = null
      root.hidden = true
    }
    if (now) go()
    else hideTimer = setTimeout(go, LINGER_MS)
  }

  function button(action, label, extra = '', icon = action) {
    const b = doc.createElement('button')
    b.type = 'button'
    b.className = `diple-tbtn ${extra}`.trim()
    b.setAttribute('data-diple-action', action)
    const i = doc.createElement('i')
    i.className = `codicon codicon-${ICONS[icon]}`
    i.setAttribute('aria-hidden', 'true')
    const s = doc.createElement('span')
    s.textContent = label
    b.append(i, s)
    return b
  }

  function show(next, rect) {
    clearTimeout(hideTimer)
    entry = next
    offMd?.()
    offMd = null
    const head = doc.createElement('div')
    head.className = 'diple-preview-head'
    const nb = doc.createElement('span')
    nb.className = 'diple-nb'
    nb.setAttribute('data-kind', next.kind)
    nb.textContent = String(next.n)
    const state = doc.createElement('span')
    state.textContent = t(`capture.pin.state.${next.state}`)
    head.append(nb, state)
    const body = doc.createElement('div')
    body.className = 'diple-preview-body'
    if (next.comment.trim()) offMd = md ? md.render(body, next.comment) : ((body.textContent = next.comment), null)
    else {
      body.classList.add('diple-preview-empty')
      body.textContent = t('capture.preview.noComment')
    }
    const tools = doc.createElement('div')
    tools.className = 'diple-preview-tools'
    if (next.sent) {
      tools.append(button('copy', t('capture.preview.copy')))
      const note = doc.createElement('span')
      note.className = 'diple-preview-note'
      note.textContent = t('capture.preview.sentReadonly')
      tools.append(note)
    } else {
      const isComment = next.kind === 'comment'
      tools.append(
        isComment ? button('edit', t('capture.preview.edit')) : button('edit', t('capture.preview.addComment'), '', 'addComment'),
        button('copy', t('capture.preview.copy')),
        button('remove', t('capture.preview.remove'), 'diple-danger')
      )
    }
    root.replaceChildren(head, body, tools)
    root.hidden = false
    root.setAttribute('data-item-id', next.id)
    root.removeAttribute('data-enter')
    void root.offsetWidth
    root.setAttribute('data-enter', '')
    const vw = win.innerWidth || 10_000
    const vh = win.innerHeight || 10_000
    const w = root.offsetWidth || WIDTH
    const hgt = root.offsetHeight || 0
    let top = rect.top - GAP - hgt
    if (top < EDGE) top = rect.bottom + GAP
    top = Math.max(EDGE, Math.min(top, vh - hgt - EDGE))
    const left = Math.max(EDGE, Math.min(rect.left, vw - w - EDGE))
    root.style.left = `${Math.round(left)}px`
    root.style.top = `${Math.round(top)}px`
  }

  return {
    show,
    hide,
    shownId: () => entry?.id ?? null,
    contains: (node) => Boolean(node && root.contains(node)),
    element: root,
    dispose() {
      clearTimeout(hideTimer)
      offMd?.()
      root.remove()
    }
  }
}
