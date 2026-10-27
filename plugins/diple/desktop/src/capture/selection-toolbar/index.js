// The selection toolbar beside a chat selection (V2, design §2.3; V3-T: scheme B, design §V3).
//
//   const tb = installSelectionToolbar({ doc, enabled, canCapture, onActivate, label, avoid })
//   V2.1 #3: icon + 「标注」 only, no keycap (the shortcut still works; onboarding teaches it)
//   onActivate({ range, at })   range: the selection it was shown for, kept from that
//                               moment (#144421); at: { x, top, side, rtl } — the button's
//                               leading edge, where the editor opens
//   avoid() → client rects the button must not cover (the pins)
//   tb.current() → { range, at } while shown, else null (⌘⇧E uses it)
//   tb.hide() / tb.relabel() / tb.dispose() / tb.element
//   place({ lines, pointer, backward, rtl }, size, viewport, avoid) → { left, top, side }   (pure)
//   lineBoxes(rects) → one rect per visual line                                          (pure)
//
// Where (scheme B, design §V3): beside the pointer where
// the mouse was released, 6 px past it and 4 px below the line under it, so the
// pointer's hot spot is never on the button. A backward drag ends on the first
// line: the button goes above that line instead of over the rest of the passage.
// A keyboard selection uses its focus end (the caret) instead of the pointer.
// RTL (the focus's `direction`, or its paragraph's first strong character): mirrored, left of the pointer. Kept 8 px
// inside the window (to the other side of the line when it does not fit) and off
// the pins (moved past a pin it would cover, else to the other side of the line).
//
// Timing (Codex-like, no settle delay):
//   - a mouse selection shows it on the next animation frame after the
//     release — only when the press (primary button, no ctrl) produced a new
//     selection, so clicking a context-menu item never brings it back;
//   - pressing ANY mouse button hides it at once (right button included), so
//     it never sits under the host's context menu, and the menu closing does
//     not restore it; `contextmenu` (ctrl+click on macOS) does the same;
//   - pressing ANY key hides it (Esc, typing, arrows) — except modifiers alone
//     and ⌘ / ⌃ / ⌥ shortcuts, so ⌘C keeps it; so does text going in (`input`);
//   - a keyboard selection shows once it has rested 300 ms;
//   - scroll or resize hide it and re-place it after 100 ms of quiet;
//   - window blur hides it.
// #144421: the host clears transcript selections about a second after the
// release. The Range is kept when the button is shown; a selection collapsed
// while it is up (with no key or mouse button pressed: those hid it already)
// leaves it up, and 「标注」 annotates the kept Range.
// It never takes focus or the selection (mousedown is prevented), so ⌘C works.
// Where it may appear is decided by `canCapture` (the ⌘⇧E rules).
//
// One DOM node, appended to <body>; host nodes are never touched.

const KEY_REST_MS = 300
const SCROLL_REST_MS = 100
const DX = 6 // from the pointer, sideways
const DY = 4 // from the line, down (or up)
const EDGE = 8
const PIN_GAP = 2
const MODIFIERS = new Set(['Shift', 'Meta', 'Control', 'Alt', 'AltGraph', 'CapsLock', 'Fn'])

const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

/** One rect per visual line: client rects top-down, merged when their middles share a line. */
export function lineBoxes(rects) {
  const rs = [...rects].filter((r) => r.width > 0 && r.height > 0).sort((a, b) => a.top - b.top || a.left - b.left)
  const lines = []
  for (const r of rs) {
    const mid = (r.top + r.bottom) / 2
    const l = lines.find((x) => mid >= x.top && mid <= x.bottom)
    if (l) Object.assign(l, { left: Math.min(l.left, r.left), right: Math.max(l.right, r.right), top: Math.min(l.top, r.top), bottom: Math.max(l.bottom, r.bottom) })
    else lines.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })
  }
  return lines
}

/** Scheme B: beside the pointer, below its line (above for a backward drag), in the window, off the pins. */
export function place({ lines, pointer, backward = false, rtl = false }, size, viewport, avoid = []) {
  const { width: w, height: h } = size
  const near = (l) => Math.abs((l.top + l.bottom) / 2 - pointer.y)
  const line = lines.find((l) => pointer.y >= l.top - 2 && pointer.y <= l.bottom + 2) ?? [...lines].sort((a, b) => near(a) - near(b))[0] ?? { top: pointer.y, bottom: pointer.y }
  const below = line.bottom + DY
  const above = line.top - DY - h
  const fitsBelow = below + h <= viewport.height - EDGE
  const fitsAbove = above >= EDGE
  const side = backward ? (fitsAbove || !fitsBelow ? 'top' : 'bottom') : fitsBelow || !fitsAbove ? 'bottom' : 'top'
  const clampX = (x) => Math.max(EDGE, Math.min(x, viewport.width - w - EDGE))
  const clampY = (y) => Math.max(EDGE, Math.min(y, viewport.height - h - EDGE))
  const at = (s, x) => ({ left: clampX(x), top: clampY(s === 'bottom' ? below : above), side: s })
  const hits = (p) => avoid.filter((a) => overlaps({ left: p.left, top: p.top, right: p.left + w, bottom: p.top + h }, a))
  const x0 = rtl ? pointer.x - DX - w : pointer.x + DX
  let p = at(side, x0)
  const pins = hits(p)
  if (pins.length) {
    const past = rtl ? at(side, Math.min(...pins.map((a) => a.left)) - PIN_GAP - w) : at(side, Math.max(...pins.map((a) => a.right)) + PIN_GAP)
    const flip = at(side === 'bottom' ? 'top' : 'bottom', x0)
    if (!hits(past).length) p = past
    else if (!hits(flip).length) p = flip
  }
  return { left: Math.round(p.left), top: Math.round(p.top), side: p.side }
}

const snapshot = (sel) => (sel && sel.rangeCount ? [sel.anchorNode, sel.anchorOffset, sel.focusNode, sel.focusOffset] : [null, 0, null, 0])
const sameSnap = (a, b) => a.every((v, i) => v === b[i])
const elementOf = (n) => (n?.nodeType === 1 ? n : n?.parentElement) ?? null
// A kept Range, read through the Selection interface canCapture() expects.
export const asSelection = (r) => ({ rangeCount: 1, isCollapsed: r.collapsed, getRangeAt: () => r, anchorNode: r.startContainer, anchorOffset: r.startOffset, focusNode: r.endContainer, focusOffset: r.endOffset, toString: () => r.toString() })
const usable = (r) => Boolean(r && !r.collapsed && r.startContainer?.isConnected && r.endContainer?.isConnected && r.toString().trim())

// The first strong character decides a paragraph's direction (the host lays
// messages out with `unicode-bidi: plaintext`, so `direction` stays ltr).
const STRONG = /[A-Za-z\u00C0-\u02AF\u0370-\u058F\u0900-\u1FFF\u2C00-\uFAFF]|([\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF])/
/** Right-to-left at this node: its computed `direction`, else its block's first strong character. */
export function isRtlAt(node, win = globalThis) {
  const el = elementOf(node)
  if (!el) return false
  if (win.getComputedStyle?.(el)?.direction === 'rtl') return true
  const block = el.closest?.('p,li,td,th,blockquote,h1,h2,h3,h4,h5,h6,pre,div') ?? el
  const m = STRONG.exec(block.textContent ?? '')
  return Boolean(m?.[1])
}

function isBackward(sel) {
  if (!sel.anchorNode || !sel.focusNode) return false
  if (sel.anchorNode === sel.focusNode) return sel.focusOffset < sel.anchorOffset
  return Boolean(sel.anchorNode.compareDocumentPosition(sel.focusNode) & 2) // DOCUMENT_POSITION_PRECEDING
}

export function installSelectionToolbar({ doc = globalThis.document, enabled, canCapture, onActivate, label, avoid = () => [] }) {
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
  let kept = null // the shown selection: { range, backward, rtl, pointer, line0, box } (#144421)
  let pointer = null // the last primary-button release, client coordinates

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
    kept = null
    if (shown()) root.removeAttribute('data-shown')
  }

  /** The caret end of a selection in client coordinates: a keyboard selection's "pointer". */
  function focusPoint(range, backward, lines, rtl) {
    const r = doc.createRange()
    try {
      if (backward) r.setStart(range.startContainer, range.startOffset)
      else r.setStart(range.endContainer, range.endOffset)
    } catch {
      return null
    }
    r.collapse(true)
    const l = backward ? lines[0] : lines.at(-1)
    let c = [...(r.getClientRects?.() ?? [])].find((x) => x.height) ?? null
    if (!c && l) c = { left: backward === rtl ? l.right : l.left, top: l.top, height: l.bottom - l.top }
    if (!c) return null
    // at a wrap the caret may report the next line's start: keep it on the passage's line
    const x = l && !backward && !rtl ? Math.min(c.left, l.right) : c.left
    return { x, y: l ? (l.top + l.bottom) / 2 : c.top + c.height / 2 }
  }

  /** Show it for the selection — or, once the host cleared that (#144421) or after a scroll, the kept one. */
  function evaluate({ fromMouse = false } = {}) {
    timer = null
    frame = null
    if (!enabled()) return hide()
    const sel = doc.getSelection()
    const live = sel && !sel.isCollapsed && sel.rangeCount ? sel : null
    const prev = kept
    let info
    if (live) {
      if (!canCapture(live)) return hide()
      const backward = isBackward(live)
      const rtl = isRtlAt(live.focusNode, win)
      const same = prev && prev.snap && sameSnap(prev.snap, snapshot(live))
      info = { range: live.getRangeAt(0).cloneRange(), backward, rtl, pointer: fromMouse ? pointer : same ? prev.pointer : null, line0: same && !fromMouse ? prev.line0 : null, snap: snapshot(live) }
    } else if (prev && usable(prev.range) && canCapture(asSelection(prev.range))) {
      info = prev
    } else return hide()
    const range = info.range
    const rect = range.getBoundingClientRect?.() ?? { left: 0, right: 0, top: 0, bottom: 0 }
    const vp = { width: win.innerWidth || doc.documentElement.clientWidth || 0, height: win.innerHeight || doc.documentElement.clientHeight || 0 }
    if (vp.height && (rect.bottom < 0 || rect.top > vp.height)) return hide() // scrolled out of sight
    relabel()
    let lines = lineBoxes(range.getClientRects?.() ?? [])
    if (!lines.length) lines = [{ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }]
    // The release point rides with the text across a scroll / resize.
    const moved = info.pointer && info.line0 ? { x: info.pointer.x + lines[0].left - info.line0.left, y: info.pointer.y + lines[0].top - info.line0.top } : null
    const at = moved ?? info.pointer ?? focusPoint(range, info.backward, lines, info.rtl) ?? { x: rect.right, y: rect.bottom }
    const size = { width: root.offsetWidth || 72, height: root.offsetHeight || 28 }
    const p = place({ lines, pointer: at, backward: info.backward, rtl: info.rtl }, size, vp.width ? vp : { width: 10_000, height: 10_000 }, avoid() ?? [])
    root.style.left = `${p.left}px`
    root.style.top = `${p.top}px`
    root.setAttribute('data-side', p.side)
    root.setAttribute('data-dir', info.rtl ? 'rtl' : 'ltr')
    kept = { ...info, pointer: at, line0: { left: lines[0].left, top: lines[0].top }, box: { left: p.left, top: p.top, width: size.width, height: size.height } }
    shownSnap = info.snap ?? null
    root.setAttribute('data-shown', '')
  }

  /** While shown: the Range it was shown for, and where the editor opens (the button's leading edge). */
  const current = () => {
    if (!shown() || !kept || !usable(kept.range)) return null
    const b = kept.box
    return { range: kept.range, at: { x: kept.rtl ? b.left + b.width : b.left, top: b.top, side: root.getAttribute('data-side'), rtl: kept.rtl } }
  }

  const nextFrame = () => {
    cancel()
    frame = raf(() => evaluate({ fromMouse: true }))
  }
  const after = (ms) => {
    cancel()
    timer = setTimeout(() => evaluate(), ms)
  }

  const own = (e) => root.contains(e.target)
  const onScrollish = (e) => {
    if (e && own(e)) return
    if (shown() || rescue) {
      rescue = true
      root.removeAttribute('data-shown')
      shownSnap = null // `kept` stays: the rescue re-places it, also once the host cleared the selection
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
      pointer = { x: e.clientX, y: e.clientY }
      nextFrame()
    }, true],
    [doc, 'contextmenu', () => {
      down = down ? { ...down, ctrl: true } : null
      hide()
    }, true],
    [doc, 'selectionchange', () => {
      const sel = doc.getSelection()
      if (down) down.changed = true
      if (!sel || sel.isCollapsed) {
        // #144421: the host clearing it while the button is up keeps the button and the Range.
        if (!down && (shown() || rescue) && kept && usable(kept.range)) return
        return hide()
      }
      if (down) return // the mouse decides on release
      if (frame != null) return // a release is about to show it: a late echo of that drag
      if (shownSnap && sameSnap(shownSnap, snapshot(sel))) return // a late echo of the shown selection
      hide()
      after(KEY_REST_MS)
    }],
    [doc, 'keydown', (e) => {
      if (e.key === 'Escape') return hide()
      if (e.metaKey || e.ctrlKey || e.altKey || MODIFIERS.has(e.key)) return // ⌘C and the other shortcuts keep it
      hide() // typing, arrows (⇧-arrows bring it back once the selection rests)
    }, true],
    // text going in anywhere (IME, paste, a scripted insert into the composer) is typing too
    [doc, 'input', () => hide(), true],
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
      const cur = current()
      hide()
      onActivate(cur ?? {})
    }]
  ]
  for (const [target, type, fn, capture] of listeners) target.addEventListener(type, fn, Boolean(capture))

  return {
    hide,
    relabel,
    current,
    element: root,
    dispose() {
      hide()
      for (const [target, type, fn, capture] of listeners) target.removeEventListener(type, fn, Boolean(capture))
      root.remove()
    }
  }
}
