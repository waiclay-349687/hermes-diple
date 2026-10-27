// The selection toolbar beside a chat selection (V2, design §2.3).
//
//   const tb = installSelectionToolbar({ doc, enabled, canCapture, onActivate, label })
//   V2.1 #3: icon + 「标注」 only, no keycap (the shortcut still works; onboarding teaches it)
//   tb.hide() / tb.relabel() / tb.dispose() / tb.element
//   place(rect, size, viewport) → { left, top, side }     (pure, for tests)
//
// Timing (Codex-like, no settle delay):
//   - a mouse selection shows it on the next animation frame after the
//     release — only when the press (primary button, no ctrl) produced a new
//     selection, so clicking a context-menu item never brings it back;
//   - pressing ANY mouse button hides it at once (right button included), so
//     it never sits under the host's context menu, and the menu closing does
//     not restore it; `contextmenu` (ctrl+click on macOS) does the same;
//   - a keyboard selection shows once it has rested 300 ms;
//   - scroll or resize hide it and re-place it after 100 ms of quiet;
//   - Esc, typing, window blur and a collapsed selection hide it.
// It never takes focus or the selection (mousedown is prevented), so ⌘C works.
// Where it may appear is decided by `canCapture` (the ⌘⇧E rules).
//
// One DOM node, appended to <body>; host nodes are never touched.

const KEY_REST_MS = 300
const SCROLL_REST_MS = 100
const GAP = 8
const EDGE = 8

/** Centred above `rect`, 8 px gap, 8 px from the viewport edges; below when it does not fit above. */
export function place(rect, size, viewport) {
  const mid = (rect.left + rect.right) / 2
  const left = Math.round(Math.max(EDGE, Math.min(mid - size.width / 2, viewport.width - size.width - EDGE)))
  const above = rect.top - GAP - size.height
  if (above >= EDGE) return { left, top: Math.round(above), side: 'top' }
  return { left, top: Math.round(Math.min(rect.bottom + GAP, viewport.height - size.height - EDGE)), side: 'bottom' }
}

const snapshot = (sel) => (sel && sel.rangeCount ? [sel.anchorNode, sel.anchorOffset, sel.focusNode, sel.focusOffset] : [null, 0, null, 0])
const sameSnap = (a, b) => a.every((v, i) => v === b[i])

export function installSelectionToolbar({ doc = globalThis.document, enabled, canCapture, onActivate, label }) {
  const win = doc.defaultView ?? globalThis
  const raf = win.requestAnimationFrame?.bind(win) ?? ((fn) => setTimeout(fn, 16))
  const caf = win.cancelAnimationFrame?.bind(win) ?? clearTimeout

  const root = doc.createElement('div')
  root.setAttribute('data-diple-ui', '')
  root.setAttribute('data-diple-toolbar', '')
  root.className = 'diple-toolbar'
  root.setAttribute('role', 'toolbar')
  const btn = doc.createElement('button')
  btn.type = 'button'
  btn.tabIndex = -1
  btn.className = 'diple-toolbar-btn'
  const glyph = doc.createElement('span')
  glyph.className = 'diple-toolbar-glyph'
  glyph.setAttribute('aria-hidden', 'true')
  const text = doc.createElement('span')
  btn.append(glyph, text)
  root.append(btn)
  doc.body.append(root)

  let timer = null
  let frame = null
  let down = null // { button, ctrl, snap, changed } while a mouse button is pressed
  let shownSnap = null
  let rescue = false // shown before a scroll / resize: bring it back when it settles

  const relabel = () => {
    text.textContent = label()
    btn.setAttribute('aria-label', label())
  }
  relabel()

  const shown = () => root.hasAttribute('data-shown')
  const cancel = () => {
    clearTimeout(timer)
    timer = null
    if (frame != null) caf(frame)
    frame = null
  }
  const hide = () => {
    cancel()
    shownSnap = null
    if (shown()) root.removeAttribute('data-shown')
  }

  function evaluate() {
    timer = null
    frame = null
    if (!enabled()) return hide()
    const sel = doc.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount || !canCapture(sel)) return hide()
    const range = sel.getRangeAt(0)
    const rect = range.getBoundingClientRect?.() ?? { left: 0, right: 0, top: 0, bottom: 0 }
    const vp = { width: win.innerWidth || doc.documentElement.clientWidth || 0, height: win.innerHeight || doc.documentElement.clientHeight || 0 }
    if (vp.height && (rect.bottom < 0 || rect.top > vp.height)) return hide() // scrolled out of sight
    relabel()
    const size = { width: root.offsetWidth || 72, height: root.offsetHeight || 28 }
    const p = place(rect, size, vp)
    root.style.left = `${p.left}px`
    root.style.top = `${p.top}px`
    root.setAttribute('data-side', p.side)
    shownSnap = snapshot(sel)
    root.setAttribute('data-shown', '')
  }

  const nextFrame = () => {
    cancel()
    frame = raf(evaluate)
  }
  const after = (ms) => {
    cancel()
    timer = setTimeout(evaluate, ms)
  }

  const own = (e) => root.contains(e.target)
  const onScrollish = (e) => {
    if (e && own(e)) return
    if (shown() || rescue) {
      rescue = true
      root.removeAttribute('data-shown')
      shownSnap = null
      cancel()
      timer = setTimeout(() => {
        rescue = false
        evaluate()
      }, SCROLL_REST_MS)
    }
  }
  const listeners = [
    [doc, 'mousedown', (e) => {
      if (own(e)) return
      rescue = false
      hide()
      down = { button: e.button, ctrl: e.ctrlKey, snap: snapshot(doc.getSelection()), changed: false }
    }, true],
    [doc, 'mouseup', (e) => {
      if (own(e)) return
      const d = down
      down = null
      if (!d || d.button !== 0 || d.ctrl || e.button !== 0) return
      // Only a press that made a new selection: a click in a menu leaves it as it was.
      if (!d.changed && sameSnap(d.snap, snapshot(doc.getSelection()))) return
      nextFrame()
    }, true],
    [doc, 'contextmenu', () => {
      down = down ? { ...down, ctrl: true } : null
      hide()
    }, true],
    [doc, 'selectionchange', () => {
      const sel = doc.getSelection()
      if (down) down.changed = true
      if (!sel || sel.isCollapsed) return hide()
      if (down) {
        down.changed = true
        return // the mouse decides on release
      }
      if (frame != null) return // a release is about to show it: a late echo of that drag
      if (shownSnap && sameSnap(shownSnap, snapshot(sel))) return // a late echo of the shown selection
      hide()
      after(KEY_REST_MS)
    }],
    [doc, 'keydown', (e) => {
      if (e.key === 'Escape') return hide()
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key.length === 1 || e.key === 'Enter' || e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Tab') hide()
    }, true],
    [doc, 'scroll', onScrollish, true],
    [win, 'resize', () => onScrollish(null)],
    [win, 'blur', () => {
      down = null
      rescue = false
      hide()
    }],
    [btn, 'mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
    }],
    [btn, 'click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (!shown()) return
      hide()
      onActivate()
    }]
  ]
  for (const [target, type, fn, capture] of listeners) target.addEventListener(type, fn, Boolean(capture))

  return {
    hide,
    relabel,
    element: root,
    dispose() {
      hide()
      for (const [target, type, fn, capture] of listeners) target.removeEventListener(type, fn, Boolean(capture))
      root.remove()
    }
  }
}
