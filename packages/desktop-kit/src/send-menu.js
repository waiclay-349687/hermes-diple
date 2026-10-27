// The send menu both plugins open (V2.1 #8, after Orca's "Send notes"): a
// small popover menu of sections — a scope to pick, targets to send to, a
// copy action. Only the behaviour is shared (D1 §L7): keyboard, focus,
// dismissal, roles. What the sections hold is each plugin's.
//
//   <SendMenu label sections onClose attrs? />
//     sections: [{ key, title?, items: [{ key, label, detail?, checked?, disabled?,
//                  keep?, onSelect, attrs? }] }]
//       checked: a radio item (a scope); keep: selecting it leaves the menu open
//     onClose(): Esc, Tab, a click outside, or after an item without `keep`
//     attrs: data-* / aria-* put on the menu element (the caller's test hooks)
//   Focus goes to the item marked `checked` in the first section with actions
//   (the default target), else to the first enabled item; ↑ ↓ Home End move,
//   Enter / Space select. role=menu, items role=menuitem / menuitemradio.
//   Labels wrap (a long session title is shortened by the caller, never clipped).
//   Position: absolutely under its offset parent's end edge (the caller wraps
//   the trigger in a position:relative box); it flips up when there is no room.
//   When a clipping ancestor (a scrolling list) would cut it both ways, it is
//   placed position:fixed at the trigger inside the window (data-fixed), and
//   closes when that ancestor scrolls.
//
//   SEND_MENU_CSS — the styles (host tokens only), included by each plugin.

import { createElement as h, useEffect, useLayoutEffect, useRef } from 'react'

const M = 4

/** The visible box the menu must stay inside: the window cut by every clipping ancestor. */
function clipBox(el) {
  const win = el.ownerDocument.defaultView
  const box = { top: 0, left: 0, bottom: win?.innerHeight ?? 0, right: win?.innerWidth ?? 0 }
  for (let p = el.parentElement; p && win; p = p.parentElement) {
    const cs = win.getComputedStyle(p)
    if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue
    const r = p.getBoundingClientRect()
    box.top = Math.max(box.top, r.top)
    box.left = Math.max(box.left, r.left)
    box.bottom = Math.min(box.bottom, r.bottom)
    box.right = Math.min(box.right, r.right)
  }
  return box
}
const inside = (r, b) => r.top >= b.top - 0.5 && r.bottom <= b.bottom + 0.5 && r.left >= b.left - 0.5 && r.right <= b.right + 0.5

/**
 * Under the trigger; above it when there is no room below. When a scrolling
 * ancestor would cut it either way (a card low in Diple Docs' list), it leaves
 * its box: position:fixed at the trigger, inside the window (data-fixed).
 */
const PLACED = ['position', 'top', 'left', 'bottom', 'right', 'insetInlineEnd', 'maxHeight', 'overflowY', 'width', 'translate']
function place(root) {
  // from scratch each time (the sections can grow: recent sessions arrive later)
  root.removeAttribute('data-up')
  root.removeAttribute('data-fixed')
  for (const k of PLACED) root.style[k] = ''
  position(root)
  // last, sideways: never past the window's left or right edge (an RTL menu opens
  // towards the end of a trigger that sits at the window's right edge)
  const win = root.ownerDocument.defaultView
  const r = root.getBoundingClientRect?.()
  if (!r || !win || !r.width) return
  const over = r.right > win.innerWidth - M ? r.right - (win.innerWidth - M) : r.left < M ? r.left - M : 0
  if (Math.abs(over) > 0.5) root.style.translate = `${-over}px 0`
}

function position(root) {
  const r0 = root.getBoundingClientRect?.()
  const win = root.ownerDocument.defaultView
  if (!r0 || !win || (!r0.width && !r0.height)) return
  const clip = clipBox(root)
  if (inside(r0, clip)) return
  root.setAttribute('data-up', '')
  if (inside(root.getBoundingClientRect(), clip)) return
  root.removeAttribute('data-up')
  const a = (root.offsetParent ?? root.parentElement).getBoundingClientRect()
  const vw = win.innerWidth
  const vh = win.innerHeight
  const h = Math.min(r0.height, vh - 2 * M)
  const w = r0.width
  const rtl = win.getComputedStyle(root).direction === 'rtl'
  let top = a.bottom + M
  if (top + h > vh - M) top = a.top - M - h >= M ? a.top - M - h : Math.max(M, vh - M - h)
  const left = Math.min(Math.max(M, rtl ? a.left : a.right - w), vw - M - w)
  root.setAttribute('data-fixed', '')
  Object.assign(root.style, { position: 'fixed', top: `${top}px`, left: `${left}px`, bottom: 'auto', right: 'auto', insetInlineEnd: 'auto', width: `${w}px`, maxHeight: `${vh - 2 * M}px`, overflowY: 'auto' })
  // an ancestor with a transform (the host's composer) is the containing block of a
  // fixed box: shift by what it added, so the menu lands where it was meant to
  const got = root.getBoundingClientRect()
  const dx = got.left - left
  const dy = got.top - top
  if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) Object.assign(root.style, { top: `${top - dy}px`, left: `${left - dx}px` })
}

export function SendMenu({ label, sections = [], onClose, attrs = {} }) {
  const ref = useRef(null)
  const enabled = () => [...(ref.current?.querySelectorAll('[data-send-item]:not(:disabled)') ?? [])]

  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    place(root)
    const preferred = root.querySelector('[data-send-item][data-default]:not(:disabled)') ?? enabled()[0]
    preferred?.focus({ preventScroll: true })
  }, [])
  // the menu's content changed (titles of recent sessions came in): place it again
  const shape = sections.map((sec) => `${sec.key}:${(sec.items ?? []).map((it) => `${it.key}=${it.label}`).join('|')}`).join('/')
  const first = useRef(true)
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (ref.current) place(ref.current)
  }, [shape])

  useEffect(() => {
    const doc = ref.current?.ownerDocument ?? globalThis.document
    const away = (e) => {
      if (ref.current && !ref.current.contains(e.target) && !e.target?.closest?.('[data-send-menu-trigger]')) onClose?.()
    }
    // a menu that left its box (data-fixed) would float off its trigger when the box scrolls
    // (focusing an item never scrolls a box: every focus() here passes preventScroll)
    const scrolled = (e) => {
      const root = ref.current
      if (root?.hasAttribute('data-fixed') && e.target !== root && e.target?.contains?.(root)) onClose?.()
    }
    doc.addEventListener('mousedown', away, true)
    doc.addEventListener('scroll', scrolled, true)
    return () => {
      doc.removeEventListener('mousedown', away, true)
      doc.removeEventListener('scroll', scrolled, true)
    }
  }, [onClose])

  const onKeyDown = (e) => {
    const items = enabled()
    const i = items.indexOf(e.target)
    const go = (j) => {
      e.preventDefault()
      items[(j + items.length) % items.length]?.focus({ preventScroll: true })
    }
    if (e.key === 'ArrowDown') go(i + 1)
    else if (e.key === 'ArrowUp') go(i - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(items.length - 1)
    else if (e.key === 'Escape' || e.key === 'Tab') {
      if (e.key === 'Escape') e.preventDefault()
      e.stopPropagation()
      onClose?.()
    }
  }

  const select = (it) => {
    if (it.disabled) return
    it.onSelect?.()
    if (!it.keep) onClose?.()
  }

  return h(
    'div',
    { ref, className: 'dk-menu', role: 'menu', 'aria-label': label, 'data-send-menu': '', onKeyDown, ...attrs },
    sections
      .filter((s) => s.items?.length)
      .map((s, si) =>
        h(
          'div',
          { key: s.key ?? si, className: 'dk-menu-section', role: 'group', 'aria-label': s.title || undefined },
          s.title ? h('div', { className: 'dk-menu-title', 'aria-hidden': 'true' }, s.title) : null,
          s.items.map((it) =>
            h(
              'button',
              {
                key: it.key,
                type: 'button',
                className: 'dk-menu-item',
                role: typeof it.checked === 'boolean' ? 'menuitemradio' : 'menuitem',
                'aria-checked': typeof it.checked === 'boolean' ? String(it.checked) : undefined,
                'data-send-item': it.key,
                'data-default': it.default ? '' : undefined,
                disabled: it.disabled || undefined,
                tabIndex: -1,
                onClick: () => select(it),
                ...(it.attrs ?? {})
              },
              typeof it.checked === 'boolean' ? h('span', { className: 'dk-menu-check', 'aria-hidden': 'true' }, it.checked ? '\u2022' : '') : null,
              h('span', { className: 'dk-menu-label' }, it.label),
              it.detail ? h('span', { className: 'dk-menu-detail' }, it.detail) : null
            )
          )
        )
      )
  )
}

export const SEND_MENU_CSS = `
.dk-menu{position:absolute;inset-inline-end:0;top:calc(100% + 4px);z-index:70;min-width:220px;max-width:min(340px,calc(100vw - 16px));box-sizing:border-box;display:flex;flex-direction:column;padding:4px;border-radius:var(--radius-md,4px);border:1px solid var(--ui-stroke-secondary);background:var(--ui-bg-elevated,var(--ui-bg-secondary));box-shadow:var(--shadow-md,0 4px 16px color-mix(in srgb,currentColor 14%,transparent));color:var(--ui-text-primary);font-size:12px;line-height:1.4;text-align:start}
.dk-menu[data-up]{top:auto;bottom:calc(100% + 4px)}
.dk-menu-section+.dk-menu-section{margin-top:4px;padding-top:4px;border-top:1px solid var(--ui-stroke-tertiary,var(--ui-stroke-secondary))}
.dk-menu-title{padding:2px 8px 3px;font-size:11px;color:var(--ui-text-tertiary)}
.dk-menu-item{display:flex;align-items:baseline;gap:6px;width:100%;min-width:0;padding:5px 8px;border:0;border-radius:var(--radius-sm,3px);background:transparent;color:inherit;font:inherit;text-align:start;cursor:pointer}
.dk-menu-item:hover:not(:disabled),.dk-menu-item:focus-visible{background:var(--ui-control-hover-background,var(--ui-bg-tertiary));outline:none}
.dk-menu-item:focus{outline:none}
.dk-menu-item:disabled{opacity:.5;cursor:default}
.dk-menu-check{flex:none;width:10px;color:var(--ui-accent);text-align:center}
.dk-menu-label{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}
.dk-menu-detail{flex:none;white-space:nowrap;color:var(--ui-text-tertiary);font-size:11px}
`
