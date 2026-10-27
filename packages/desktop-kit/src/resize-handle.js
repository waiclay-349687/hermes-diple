// A drag handle that resizes a side panel (V3-D, research B §6.1 B1, after
// Plannotator's useResizablePanel). Pure DOM pointer events; no host SDK.
//
//   <ResizeHandle width min max def collapseBelow? step? label onLive onCommit onCollapse attrs? />
//     The panel sits on the content's inline-end side; the handle is its
//     inline-start edge (the caller's panel box is position:relative).
//     width      the committed width (px); the caller owns it
//     onLive(w)  while dragging, at most once per frame: show w without a
//                React render (the caller writes a CSS variable)
//     onCommit(w) on release, a double click (→ def), or a keyboard step
//     onCollapse() a click (moved ≤ 4px), a drag released below collapseBelow,
//                or Enter
//   Keyboard: role=separator, ← widens and → narrows by `step` (16px), mirrored
//   in RTL (read from the handle's computed direction). Home → min, End → max.
//
//   resizeWidth({ start, dx, rtl?, min, max, raw? }) → the width a drag of dx
//   pixels gives (clamped unless raw).
//   RESIZE_HANDLE_CSS — the styles (host tokens only).

import { createElement as h, useEffect, useRef } from 'react'

const CLICK_PX = 4
const DOUBLE_MS = 280

export function resizeWidth({ start, dx, rtl = false, min, max, raw = false }) {
  const w = start + (rtl ? dx : -dx)
  return raw ? w : Math.max(min, Math.min(max, w))
}

const isRtl = (el) => {
  try {
    if (el.ownerDocument.defaultView.getComputedStyle(el).direction === 'rtl') return true
  } catch {}
  return el?.closest?.('[dir]')?.getAttribute('dir') === 'rtl'
}

export function ResizeHandle({ width, min, max, def, collapseBelow = 0, step = 16, label, onLive, onCommit, onCollapse, attrs }) {
  const ref = useRef(null)
  const drag = useRef(null)
  const frame = useRef(0)
  const clickTimer = useRef(null)
  const lastClick = useRef(0)
  const props = useRef(null)
  props.current = { width, min, max, def, collapseBelow, onLive, onCommit, onCollapse }
  useEffect(
    () => () => {
      clearTimeout(clickTimer.current)
      if (frame.current) globalThis.cancelAnimationFrame?.(frame.current)
    },
    []
  )

  const live = (w) => {
    drag.current.pending = w
    if (frame.current) return
    const run = () => {
      frame.current = 0
      if (drag.current && drag.current.pending != null) props.current.onLive?.(drag.current.pending)
    }
    if (typeof globalThis.requestAnimationFrame === 'function') frame.current = globalThis.requestAnimationFrame(run)
    else run()
  }

  const onPointerDown = (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    try {
      ref.current?.setPointerCapture?.(e.pointerId)
    } catch {}
    drag.current = { x0: e.clientX, start: props.current.width, moved: false, rtl: isRtl(ref.current), raw: props.current.width, pending: null }
    ref.current?.classList.add('is-dragging')
  }
  const onPointerMove = (e) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x0
    if (!d.moved && Math.abs(dx) <= CLICK_PX) return
    d.moved = true
    const { min: lo, max: hi } = props.current
    d.raw = resizeWidth({ start: d.start, dx, rtl: d.rtl, min: lo, max: hi, raw: true })
    live(Math.max(lo, Math.min(hi, d.raw)))
  }
  const finish = (e) => {
    const d = drag.current
    if (!d) return
    drag.current = null
    ref.current?.classList.remove('is-dragging')
    try {
      ref.current?.releasePointerCapture?.(e.pointerId)
    } catch {}
    const p = props.current
    if (!d.moved) {
      const now = Date.now()
      if (now - lastClick.current < DOUBLE_MS) {
        lastClick.current = 0
        clearTimeout(clickTimer.current)
        p.onCommit?.(p.def)
        return
      }
      lastClick.current = now
      clearTimeout(clickTimer.current)
      clickTimer.current = setTimeout(() => props.current.onCollapse?.(), DOUBLE_MS)
      return
    }
    if (d.raw < p.collapseBelow) {
      p.onLive?.(d.start)
      p.onCollapse?.()
      return
    }
    p.onCommit?.(Math.max(p.min, Math.min(p.max, d.raw)))
  }
  const onPointerCancel = () => {
    const d = drag.current
    drag.current = null
    ref.current?.classList.remove('is-dragging')
    if (d) props.current.onLive?.(d.start)
  }
  const onKeyDown = (e) => {
    const p = props.current
    const sign = isRtl(ref.current) ? -1 : 1
    let next = null
    if (e.key === 'ArrowLeft') next = p.width + step * sign
    else if (e.key === 'ArrowRight') next = p.width - step * sign
    else if (e.key === 'Home') next = p.min
    else if (e.key === 'End') next = p.max
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      p.onCollapse?.()
      return
    }
    if (next == null) return
    e.preventDefault()
    p.onCommit?.(Math.max(p.min, Math.min(p.max, next)))
  }

  return h('div', {
    ref,
    role: 'separator',
    'aria-orientation': 'vertical',
    'aria-valuenow': Math.round(width),
    'aria-valuemin': min,
    'aria-valuemax': max,
    'aria-label': label,
    tabIndex: 0,
    className: 'dk-resize',
    onPointerDown,
    onPointerMove,
    onPointerUp: finish,
    onPointerCancel,
    onKeyDown,
    ...attrs
  })
}

export const RESIZE_HANDLE_CSS = `
.dk-resize { position: absolute; top: 0; bottom: 0; inset-inline-start: -3px; width: 6px; z-index: 4; cursor: col-resize; touch-action: none; outline: none; }
.dk-resize::after { content: ''; position: absolute; top: 0; bottom: 0; inset-inline-start: 2px; width: 2px; background: transparent; transition: background-color 100ms ease-out; }
.dk-resize:hover::after, .dk-resize.is-dragging::after { background: color-mix(in srgb, var(--ui-accent) 55%, transparent); transition: none; }
.dk-resize:focus-visible::after { background: var(--ui-accent); }
@media (prefers-reduced-motion: reduce) { .dk-resize::after { transition: none; } }
`
