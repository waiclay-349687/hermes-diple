// The numbered pins (design §2.5, V2.1 #5): one fixed layer on <body>, one
// pin per marked passage, riding the passage's top-right corner (Codex).
// Never touches the host's DOM.
//
//   const pins = createPins({ doc, highlighter, clipFor, avoidFor, onClick, onEnter, onLeave, label })
//   clipFor(entry) → its thread viewport's client rect; clipFor.viewport(entry) → that scroller
//   pins.layout()           measure and place now
//   pins.schedule()         measure on the next frame (coalesced)
//   pins.setActive(ids)     the open or hovered annotation's pin is raised
//   pins.element(id)        → its pin, or null
//   pins.dispose()
//
// Cost model (V2.1 #5, measured by tests/e2e/v21-pin-perf.mjs):
//   - MEASURE (getClientRects, the viewport's rect) only when something can
//     have moved the text without a scroll: a resize, the viewport or its
//     content changing size (ResizeObserver), fonts loading, the set of pins
//     or their states changing, a chat tab coming back. All coalesced into one
//     pass that runs right after the frame's layout (a ResizeObserver callback
//     on a probe), so reading never forces a layout. Only pins whose message is on screen or near it (IntersectionObserver,
//     one screen of margin) are measured; the rest wait hidden until they come near.
//   - SCROLLING runs no script of ours: each viewport's group of pins is moved
//     by a scroll-driven animation (ScrollTimeline on that viewport, one
//     translate3d, set up at measure time from the scroll range then); pins keep
//     their own transform, relative to the scroll position at the measure. A
//     clip box at the viewport (minus the composer) hides what scrolls out.
//     Any measure asked for while the user scrolls (a pin coming near, content
//     loaded above, a re-render) waits for the pause (~140 ms): no scroll frame
//     reads layout. A resize measures at once.
//   - Without ScrollTimeline (older hosts, jsdom): the scroll event (capture
//     phase) notes the position and one rAF writes one translate3d per group;
//     which pins are on screen is arithmetic (layout.visibleAt). No left/top.
//
// Pin: <button data-diple-pin data-item-id data-state> n </button>
//   data-state: highlight | comment | sent | answered | missing
//   answered carries a ✓, missing a warning dot.

import { cornerOf, layoutPins, visibleAt, PIN_SIZE } from './layout.js'

const NEAR = '100% 0px' // IntersectionObserver margin: one viewport above and below
const SCROLL_IDLE_MS = 140

export function createPins({ doc = globalThis.document, highlighter, clipFor = () => null, avoidFor = () => [], onClick, onEnter, onLeave, label = (e) => String(e.n) }) {
  const win = doc.defaultView ?? globalThis
  const raf = win.requestAnimationFrame?.bind(win) ?? ((fn) => setTimeout(fn, 16))
  const layer = doc.createElement('div')
  layer.setAttribute('data-diple-ui', '')
  layer.setAttribute('data-diple-pins', '')
  layer.className = 'diple-layer'
  doc.body.append(layer)

  const els = new Map() // id → button
  const pinState = new Map() // id → { group, box, visible }
  const groups = new Map() // viewport element → { el, vp, sx, sy, dx, dy, clip, avoid, ids }
  let active = new Set()
  let measureQueued = false
  let scrollQueued = false
  const dirty = new Set() // groups to move on the next frame
  let observed = new Set()
  const RO = win.ResizeObserver
  // Measuring right after layout, never forcing it: a ResizeObserver callback
  // runs once the frame's layout is done, so reading geometry there costs no
  // extra layout. A measure is asked for by nudging a 1 px probe in our own
  // (contained) layer; the viewports' and contents' size changes arrive the
  // same way. Without ResizeObserver (jsdom): the next animation frame.
  const ro = RO ? new RO(() => schedule()) : null
  const probe = doc.createElement('div')
  probe.className = 'diple-pin-probe'
  layer.append(probe)
  let probeOn = false
  const atLayout = RO
    ? new RO(() => {
        if (!measureQueued) return
        measureQueued = false
        apply(measure())
      })
    : null
  atLayout?.observe(probe)
  const ST = typeof win.ScrollTimeline === 'function' && typeof doc.body.animate === 'function' ? win.ScrollTimeline : null
  // a measure asked for while the user scrolls (a pin coming near) waits for a pause
  let lastScrollAt = 0
  let idleTimer = null
  const scheduleWhenIdle = () => {
    const wait = lastScrollAt + SCROLL_IDLE_MS - Date.now()
    if (wait <= 0) return scheduleNow()
    clearTimeout(idleTimer)
    idleTimer = setTimeout(scheduleWhenIdle, wait)
  }

  // ── near the screen: IntersectionObserver on the passages' elements ─────────
  const IO = win.IntersectionObserver
  const near = new Set() // elements reported near
  const watched = new Map() // element → count of entries using it
  const io = IO
    ? new IO(
        (records) => {
          let changed = false
          for (const r of records) {
            if (r.isIntersecting !== near.has(r.target)) changed = true
            if (r.isIntersecting) near.add(r.target)
            else near.delete(r.target)
          }
          if (changed) schedule()
        },
        { rootMargin: NEAR }
      )
    : null
  const elementOf = (e) => {
    const n = e.range.startContainer
    const el = n?.nodeType === 1 ? n : n?.parentElement
    return el?.closest?.('[data-message-id],[data-slot="aui_assistant-message-root"],[data-slot="aui_user-message-root"]') ?? el ?? null
  }
  const isNear = (el) => !io || !el || near.has(el)

  function pinFor(entry, group) {
    let b = els.get(entry.id)
    if (!b) {
      b = doc.createElement('button')
      b.type = 'button'
      b.tabIndex = -1
      b.className = 'diple-pin'
      b.setAttribute('data-diple-pin', '')
      b.setAttribute('data-item-id', entry.id)
      b.addEventListener('mousedown', (e) => {
        e.preventDefault() // keep the selection and the focus where they are
      })
      b.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        const cur = highlighter.entry(b.getAttribute('data-item-id'))
        if (cur) onClick?.(cur, b)
      })
      b.addEventListener('mouseover', () => {
        const cur = highlighter.entry(b.getAttribute('data-item-id'))
        if (cur) onEnter?.(cur, b)
      })
      b.addEventListener('mouseout', (e) => {
        if (b.contains(e.relatedTarget)) return
        const cur = highlighter.entry(b.getAttribute('data-item-id'))
        if (cur) onLeave?.(cur, b)
      })
      els.set(entry.id, b)
    }
    if (b.parentElement !== group.el) group.el.append(b)
    const n = String(entry.n)
    if (b.getAttribute('data-n') !== n || b.getAttribute('data-state') !== entry.state) {
      b.setAttribute('data-n', n)
      b.setAttribute('data-state', entry.state)
      b.textContent = n
      if (entry.state === 'answered') {
        const tick = doc.createElement('span')
        tick.className = 'diple-pin-tick'
        tick.setAttribute('aria-hidden', 'true')
        tick.textContent = '\u2713'
        b.append(tick)
      }
      if (entry.state === 'missing') {
        const dot = doc.createElement('span')
        dot.className = 'diple-pin-dot'
        dot.setAttribute('aria-hidden', 'true')
        b.append(dot)
      }
    }
    b.setAttribute('aria-label', label(entry))
    b.toggleAttribute('data-sent', Boolean(entry.sent))
    b.toggleAttribute('data-active', active.has(entry.id))
    return b
  }

  const shown = (e) => {
    const el = e.range.startContainer?.nodeType === 1 ? e.range.startContainer : e.range.startContainer?.parentElement
    return !el?.checkVisibility || el.checkVisibility({ visibilityProperty: true })
  }
  // Switching tabs changes no size and scrolls nothing: look again now and then
  // while pins are out (cheap: one visibility check per pin, no layout read).
  const watch = setInterval(() => {
    if (!els.size) return
    for (const e of highlighter.entries()) {
      const b = els.get(e.id)
      if (b && shown(e) === b.hasAttribute('data-away')) return schedule()
    }
  }, 400)
  watch?.unref?.() // never keeps a test runtime alive

  const KEY_NONE = {} // pins whose viewport is unknown share one group
  function groupFor(vp) {
    const k = vp ?? KEY_NONE
    let g = groups.get(k)
    if (!g) {
      const box = doc.createElement('div') // the viewport's clip box
      box.className = 'diple-pin-clip'
      const el = doc.createElement('div') // what scrolling moves
      el.className = 'diple-pin-group'
      box.append(el)
      layer.append(box)
      g = { box, el, vp, sx: 0, sy: 0, cx: 0, cy: 0, dx: 0, dy: 0, clip: null, avoid: [], ids: new Set(), anim: null, animKey: '' }
      groups.set(k, g)
    }
    return g
  }
  const setHidden = (id, b, v) => {
    const st = pinState.get(id)
    if (st && st.visible === !v && b.hidden === v) return
    b.hidden = v
    if (st) st.visible = !v
  }
  const setSize = (el, wd, ht) => {
    const a = wd == null ? '' : `${wd}px`
    const b = ht == null ? '' : `${ht}px`
    if (el.style.width !== a) el.style.width = a
    if (el.style.height !== b) el.style.height = b
    el.toggleAttribute('data-clipped', wd != null)
  }
  // The group follows its viewport's scrolling on the compositor: progress 0 → 1
  // over the scroll range maps to a translate of sy → sy − max (pins were placed at sy).
  function follow(g, m) {
    if (!ST || !g.vp || !(m.max > 0)) {
      g.anim?.cancel()
      g.anim = null
      g.animKey = ''
      translate(g.el, 0, 0)
      return
    }
    const key = `${m.sy}|${m.max}`
    if (g.anim && g.animKey === key) return
    g.anim?.cancel()
    g.el.style.transform = ''
    g.anim = g.el.animate([{ transform: `translate3d(0px, ${m.sy}px, 0px)` }, { transform: `translate3d(0px, ${m.sy - m.max}px, 0px)` }], { timeline: new ST({ source: g.vp, axis: 'block' }), fill: 'both', easing: 'linear' })
    g.animKey = key
  }
  const translate = (el, x, y) => {
    const t = `translate3d(${x}px, ${y}px, 0px)`
    if (el.style.transform !== t) el.style.transform = t
  }

  // One rAF callback does everything, READS FIRST, then writes: a layout read
  // after our own writes in the same frame would force a synchronous layout.
  let frameQueued = false
  const queueFrame = () => {
    if (frameQueued) return
    frameQueued = true
    raf(frame)
  }
  function frame() {
    frameQueued = false
    if (measureQueued) {
      measureQueued = false
      scrollQueued = false
      dirty.clear()
      return apply(measure())
    }
    if (scrollQueued) moveGroups()
  }

  // ── measure (rare): reads only, returns the plan ─────────────────────────────
  function measure() {
    const entries = highlighter.entries()
    const byVp = new Map() // viewport (or null) → { vp, clip, avoid, sx, sy, list, marks }
    for (const e of entries) {
      const vp = clipFor.viewport?.(e) ?? null
      let m = byVp.get(vp)
      if (!m) {
        const clip = clipFor(e)
        const avoid = avoidFor(e) ?? []
        m = { vp, clip: clip || null, avoid, sx: vp?.scrollLeft ?? 0, sy: vp?.scrollTop ?? 0, max: vp ? vp.scrollHeight - vp.clientHeight : 0, list: [], marks: [] }
        // the clip box: the viewport, cut above the composer when it overlaps
        if (m.clip) {
          let bottom = m.clip.bottom
          for (const a of avoid) if (a.top > m.clip.top && a.top < bottom && a.left < m.clip.right && a.right > m.clip.left) bottom = a.top
          m.cut = { left: m.clip.left, top: m.clip.top, width: Math.max(0, m.clip.right - m.clip.left), height: Math.max(0, bottom - m.clip.top) }
        }
        byVp.set(vp, m)
      }
      let corner = null
      let away = false
      try {
        // A chat that is not in front (another tab, a Diple Docs page) keeps its
        // layout under visibility:hidden: its pins must not float over the page in front.
        away = !shown(e)
        if (!away && isNear(elementOf(e))) corner = cornerOf(e.range.getClientRects?.() ?? [])
      } catch {
        corner = null
      }
      m.list.push({ e, away })
      m.marks.push({ id: e.id, corner, clip: m.clip, avoid: m.avoid, sent: e.sent })
    }
    for (const m of byVp.values()) m.placed = layoutPins(m.marks, { size: PIN_SIZE })
    return { entries, byVp }
  }

  // ── apply a measure: writes only ─────────────────────────────────────────────
  function apply({ entries, byVp }) {
    const live = new Set(entries.map((e) => e.id))
    for (const [id, b] of els) {
      if (!live.has(id)) {
        b.remove()
        els.delete(id)
        pinState.delete(id)
      }
    }
    // the passages' elements, for "near the screen"
    if (io) {
      const want = new Set()
      for (const e of entries) {
        const el = elementOf(e)
        if (el) want.add(el)
      }
      for (const el of watched.keys()) if (!want.has(el)) (io.unobserve(el), near.delete(el))
      for (const el of want) if (!watched.has(el)) io.observe(el)
      watched.clear()
      for (const el of want) watched.set(el, 1)
    }
    const used = new Set()
    const nextObserved = new Set()
    for (const m of byVp.values()) {
      const g = groupFor(m.vp)
      used.add(g)
      g.clip = m.clip
      g.avoid = m.avoid
      g.sx = g.cx = m.sx
      g.sy = g.cy = m.sy
      g.dx = 0
      g.dy = 0
      const ox = m.cut?.left ?? 0
      const oy = m.cut?.top ?? 0
      if (m.cut && m.cut.width && m.cut.height) {
        translate(g.box, ox, oy)
        setSize(g.box, m.cut.width, m.cut.height)
      } else {
        translate(g.box, 0, 0)
        setSize(g.box, null, null)
      }
      follow(g, m)
      g.ids = new Set(m.list.map((x) => x.e.id))
      for (let i = 0; i < m.list.length; i++) {
        const { e, away } = m.list[i]
        const p = m.placed[i]
        const b = pinFor(e, g)
        b.toggleAttribute('data-away', away)
        pinState.set(e.id, { group: g, box: p.placed ? { left: p.left, top: p.top } : null, visible: !b.hidden })
        if (p.placed) translate(b, p.left - ox, p.top - oy)
        // with a scroll timeline the clip box hides what scrolls out; `hidden` is for no place at all
        setHidden(e.id, b, g.anim ? !p.placed || away : !p.visible)
      }
      // The viewport's size, and its content's: text moving without a scroll
      // (a reply growing above, a page loaded or dropped) changes the content height.
      if (g.vp) {
        nextObserved.add(g.vp)
        const content = g.vp.querySelector?.('[data-slot="aui_thread-content"]')
        if (content) nextObserved.add(content)
      }
    }
    for (const [k, g] of groups) {
      if (!used.has(g)) {
        g.anim?.cancel()
        g.box.remove()
        groups.delete(k)
      }
    }
    if (ro) {
      for (const el of nextObserved) if (!observed.has(el)) ro.observe(el)
      for (const el of observed) if (!nextObserved.has(el)) ro.unobserve(el)
    }
    observed = nextObserved
  }

  function layout() {
    measureQueued = false
    apply(measure())
  }

  function scheduleNow() {
    clearTimeout(idleTimer)
    measureQueued = true
    if (atLayout) {
      probeOn = !probeOn
      probe.style.width = probeOn ? '1px' : '0px'
    } else queueFrame()
  }
  // While the user scrolls, the compositor keeps the pins on their text; a
  // measure for anything else (content loaded above, a pin coming near, a
  // re-render) waits for the pause, so no scroll frame reads layout. A resize
  // measures at once.
  function schedule() {
    if (Date.now() - lastScrollAt < SCROLL_IDLE_MS) scheduleWhenIdle()
    else scheduleNow()
  }

  // ── scroll (every frame while scrolling): arithmetic and writes only ────────
  // The scroll position is read in the scroll event (capture phase, before the
  // host's own handlers can dirty the layout), not here.
  function moveGroups() {
    scrollQueued = false
    for (const g of dirty) {
      const dx = g.cx - g.sx
      const dy = g.cy - g.sy
      if (dx === g.dx && dy === g.dy) continue
      g.dx = dx
      g.dy = dy
      translate(g.el, -dx, -dy)
      for (const id of g.ids) {
        const st = pinState.get(id)
        const b = els.get(id)
        if (!st?.box || !b || b.hasAttribute('data-away')) continue
        setHidden(id, b, !visibleAt(st.box, { size: PIN_SIZE, clip: g.clip, avoid: g.avoid, dx, dy }))
      }
    }
    dirty.clear()
  }

  const offChange = highlighter.onChange(() => schedule())
  const onScroll = (e) => {
    const t = e.target
    if (t?.closest?.('[data-diple-ui]')) return
    const g = t && groups.get(t)
    if (g) {
      lastScrollAt = Date.now()
      if (g.anim) return // the compositor moves it
      g.cx = t.scrollLeft
      g.cy = t.scrollTop
      dirty.add(g)
      scrollQueued = true
      queueFrame()
      return
    }
    // another scroller: only one that holds a marked passage (a wide code
    // block scrolled sideways) can move a pin — check without reading layout
    if (t && t !== doc && t.nodeType === 1 && highlighter.entries().some((en) => t.contains(en.range.startContainer))) schedule()
  }
  doc.addEventListener('scroll', onScroll, true)
  win.addEventListener('resize', scheduleNow)
  const fonts = doc.fonts
  fonts?.addEventListener?.('loadingdone', schedule)
  fonts?.ready?.then?.(() => schedule(), () => {})

  return {
    layout,
    schedule,
    setActive(ids) {
      active = new Set([...(ids ?? [])].filter(Boolean))
      for (const [id, b] of els) b.toggleAttribute('data-active', active.has(id))
    },
    element: (id) => els.get(id) ?? null,
    dispose() {
      clearInterval(watch)
      clearTimeout(idleTimer)
      for (const g of groups.values()) g.anim?.cancel()
      offChange()
      doc.removeEventListener('scroll', onScroll, true)
      win.removeEventListener('resize', scheduleNow)
      fonts?.removeEventListener?.('loadingdone', schedule)
      ro?.disconnect()
      atLayout?.disconnect()
      io?.disconnect()
      layer.remove()
      els.clear()
      groups.clear()
    }
  }
}
