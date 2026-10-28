// The composer strip (design §2.6): replaces the card list above the input,
// rendered in COMPOSER_AREAS.top by capture/index.js (the pending-list slot).
//
//   <Strip deps ui ctl />      deps.uiBus — the seam to the original text
//
// One quiet row of numbered chips (number = send order; filled = comment,
// hollow = highlight), folded to "+N" past MAX_CHIPS or past what fits the
// row's width (chipCap, V3-D2-I); a meta row below (the
// ListFooter service: summary, status, actions). Hovering a chip shows a
// Markdown preview (never scrolls anything) and tells the original via
// uiBus.hover; clicking one asks uiBus.locate(itemId, { edit: true }). The
// locate side owns what follows: its notice when the original is gone and
// the one "← back to the composer" (capture/annotator.js) — the strip adds
// neither, only a hint when the original opened in another session. The
// bus's editor and hover events light the matching chip.
//
// V2.1 #2: an annotation whose editor has not saved it once (ui drafts) is
// not on the strip, nor in its count; a send still saves it first and takes it.
//
// Every composer renders this slot (split view): each instance finds the chat
// surface it sits in and shows THAT session's list (the focused one outside
// any surface).

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { PendingList } from '@diple/core'

import { resolveSurfaceKey, surfaceOf } from '../../capture/surfaces.js'
import { Markdown } from '../ui.jsx'
import { useViewportPlacement } from './placement.js'
import { chipText, originLabel } from './text.js'

export const MAX_CHIPS = 5
/** The narrowest a chip may get before it folds into "+N" (number + a few characters). */
export const CHIP_MIN = 76

/** The row's gap between chips and the width of the "+N" chip (styles.js). */
const CHIP_GAP = 4
const MORE_W = 34
/** How many chips a row `width` px wide shows out of `count` (V3-D2-I: a chat
 *  beside a docked review page is often 420–600px). Unmeasured (0) → the old
 *  rule: up to MAX_CHIPS, and never fold away a single chip. Measured → only
 *  when they do not all fit at CHIP_MIN (gaps counted): as many as fit beside
 *  the "+N" chip, never under one. */
export function chipCap(width, count) {
  const cap = count <= MAX_CHIPS + 1 ? count : MAX_CHIPS
  if (!(width > 0)) return cap
  const fits = (n, more) => n * CHIP_MIN + (n - 1) * CHIP_GAP + (more ? CHIP_GAP + MORE_W : 0) <= width
  if (cap === count && fits(count, false)) return count
  let n = Math.min(cap, count - 1)
  while (n > 1 && !fits(n, true)) n--
  return Math.max(1, n)
}
const PREVIEW_W = 340
const PREVIEW_GAP = 6
const HINT_MS = 4000

/** The session shown by the chat surface this slot sits in; undefined outside one. */
function useOwnKey(node, session) {
  const [own, setOwn] = useState(undefined)
  useLayoutEffect(() => {
    const compute = () => {
      const surface = node ? surfaceOf(node) : null
      setOwn(surface ? (resolveSurfaceKey(surface, session.currentKey()) ?? null) : undefined)
    }
    compute()
    window.addEventListener('hashchange', compute)
    const unsub = session.subscribe(compute)
    return () => {
      window.removeEventListener('hashchange', compute)
      unsub()
    }
  }, [node])
  return own
}

/** Editor/hover state from the bus: which item the editor has open, which original is hovered. */
function useBusState(uiBus) {
  const [active, setActive] = useState(null)
  const [lit, setLit] = useState(null)
  useEffect(() => {
    if (!uiBus) return undefined
    const offE = uiBus.onEditor?.((e, open) => {
      // the contract's event is { itemId, open }; (itemId, open) is accepted too
      const ev = e && typeof e === 'object' ? e : { itemId: e, open }
      setActive((cur) => (ev.open ? ev.itemId : cur === ev.itemId ? null : cur))
    })
    const offH = uiBus.onHover?.((id) => setLit(id ?? null))
    return () => {
      offE?.()
      offH?.()
    }
  }, [uiBus])
  return { active, lit }
}

function UndoBar({ undo, t, ctl, listKey }) {
  useEffect(() => {
    const timer = setTimeout(() => ctl.expireUndo(), Math.max(0, undo.until - Date.now()))
    return () => clearTimeout(timer)
  }, [undo.until])
  return (
    <div className="diple-undo" role="status">
      <span>{undo.kind === 'clear' ? t('capture.undoCleared', undo.count ?? 0) : t('capture.undoRemoved')}</span>
      <button type="button" className="diple-link" onClick={() => ctl.undo(listKey)}>
        {t('capture.undo')}
      </button>
    </div>
  )
}

function ChipPreview({ item, index, listKey, t, ctl, changed, anchor }) {
  const kind = PendingList.kindOf(item)
  const ref = useRef(null)
  // above the chip, left-aligned with it, kept inside the window
  useViewportPlacement(
    ref,
    () => {
      const r = anchor?.getBoundingClientRect?.()
      if (!r || !r.width) return null
      const w = ref.current?.offsetWidth || PREVIEW_W
      return { left: Math.max(PREVIEW_GAP, Math.min(r.left, window.innerWidth - w - PREVIEW_GAP)), bottom: window.innerHeight - r.top + PREVIEW_GAP }
    },
    [anchor, item.id]
  )
  return (
    <div ref={ref} className="diple-chip-preview" data-diple-chip-preview={item.id} role="tooltip" id={`diple-pv-${item.id}`}>
      <div className="diple-preview-head">
        <span className="diple-chip-n" data-kind={kind}>
          {index + 1}
        </span>
        <span className="diple-preview-kind">{t(kind === 'comment' ? 'capture.kindComment' : 'capture.kindHighlight')}</span>
        <span className="diple-preview-origin">{originLabel(item.origin, listKey, t, ctl.titleOf)}</span>
        {changed ? <span className="diple-preview-changed">{t('capture.changed')}</span> : null}
      </div>
      <div className="diple-preview-text">
        <Markdown text={item.text ?? ''} />
      </div>
      {kind === 'comment' ? (
        <div className="diple-preview-comment">
          <Markdown text={item.comment} />
        </div>
      ) : null}
      <div className="diple-preview-foot">{t('send.strip.chipTip')}</div>
    </div>
  )
}

export function Strip({ deps, ui, ctl }) {
  const { lists, session, services, i18n, uiBus } = deps
  const t = i18n.useT()
  const [node, setNode] = useState(null)
  const focused = useSyncExternalStore(session.subscribe, session.currentKey)
  const own = useOwnKey(node, session)
  const key = own === undefined ? focused : own
  const state = lists.useList(key)
  const view = ui.use()
  const settings = deps.settings.use()
  useSyncExternalStore(ctl.titles.subscribe, ctl.titles.version)
  const { active, lit } = useBusState(uiBus)
  const [showAll, setShowAll] = useState(false)
  const [hovered, setHovered] = useState(null) // { id, left }
  const [hint, setHint] = useState(null) // { text, until }

  useEffect(() => {
    if (!hint) return undefined
    const timer = setTimeout(() => setHint(null), Math.max(0, hint.until - Date.now()))
    return () => clearTimeout(timer)
  }, [hint])
  const items = state.items.filter((it) => !view.drafts?.[it.id])
  // "show all" belongs to one list while it is long: a new session, or a list
  // short enough again, folds back
  const [row, setRow] = useState(null)
  const [rowWidth, setRowWidth] = useState(0) // in 4px steps: a resize within one re-renders nothing
  useEffect(() => {
    if (!row || typeof ResizeObserver !== 'function') return undefined
    // The row is a stretched block (styles.js .diple-chips): its width is the
    // strip's, never its chips', so folding cannot feed back into the measure.
    const ro = new ResizeObserver((entries) => {
      const width = entries[entries.length - 1]?.contentRect?.width ?? 0
      setRowWidth(Math.floor(width / 4) * 4)
    })
    ro.observe(row)
    return () => ro.disconnect()
  }, [row])
  const foldable = chipCap(rowWidth, items.length) < items.length
  useEffect(() => {
    if (!foldable) setShowAll(false)
  }, [foldable])
  useEffect(() => setShowAll(false), [key])
  // capture asks for an annotation to come forward (just added, a duplicate
  // re-added): the editor beside the text takes it (V2-T); the strip only
  // consumes the request — no chip flash (V2.1 #1).
  useEffect(() => {
    const f = view.focus
    if (!f || f.key !== key || !state.items.some((it) => it.id === f.id)) return
    ui.consumeFocus?.(f.id)
  }, [view.focus, key])
  // a hovered chip that went away (removed, sent) takes its preview along
  useEffect(() => {
    if (hovered && !items.some((it) => it.id === hovered.id)) {
      setHovered(null)
      uiBus?.hover(null)
    }
  }, [state.items, hovered])

  const undo = view.undo && view.undo.key === key && view.undo.until > Date.now() ? view.undo : null
  if (!settings.enabled || (!node && !focused)) return null
  // A hidden probe: lets this slot find its own chat surface before showing anything.
  if (!node || !key || (!items.length && !undo)) return <span ref={setNode} data-diple-ui="" data-diple-slot="" hidden />

  const Footer = services.get('ListFooter')
  const expandedId = view.expanded?.key === key ? view.expanded.id : null
  const cap = chipCap(rowWidth, items.length)
  const folded = !showAll && cap < items.length
  const shown = folded ? items.slice(0, cap) : items
  const hiddenLit = folded && items.slice(cap).some((it) => it.id === lit || it.id === active)
  const anyUnlocked = items.some((it) => !PendingList.isLocked(state, it.id))

  // The preview is a fixed layer above the chip (placement.js); it never scrolls anything.
  const enter = (item, el) => {
    setHovered({ id: item.id, anchor: el })
    uiBus?.hover(item.id)
  }
  const leave = (item) => {
    setHovered((h) => (h?.id === item.id ? null : h))
    uiBus?.hover(null)
  }
  const locate = async (item) => {
    setHovered(null)
    uiBus?.hover(null)
    // "missing" was already told by the locator (one notice, its words).
    const r = uiBus ? await uiBus.locate(item.id, { edit: true }) : 'missing'
    setHint(r === 'other-session' ? { text: t('send.strip.locateOtherSession'), until: Date.now() + HINT_MS } : null)
  }

  const hoveredIndex = hovered ? items.findIndex((it) => it.id === hovered.id) : -1
  const status = hint ? (
    <span className="diple-strip-hint" data-diple-hint="" role="status">
      {hint.text}
    </span>
  ) : null

  return (
    <section ref={setNode} className="diple-strip" data-diple-ui="" data-diple-list="" data-session-key={key} aria-label={t('capture.listLabel')}>
      {items.length > 0 && (
        <div ref={setRow} className="diple-chips" role="list" data-all={showAll ? '' : undefined}>
          {shown.map((item, i) => {
            const kind = PendingList.kindOf(item)
            const locked = PendingList.isLocked(state, item.id)
            return (
              <span key={item.id} className="diple-chip-wrap" role="listitem" data-diple-id={item.id} data-changed={view.changed[item.id] ? '' : undefined} data-expanded={expandedId === item.id ? '' : undefined}>
                <button
                  type="button"
                  className="diple-chip"
                  data-diple-chip={item.id}
                  data-kind={kind}
                  data-active={active === item.id || expandedId === item.id ? '' : undefined}
                  data-lit={lit === item.id ? '' : undefined}
                  data-changed={view.changed[item.id] ? '' : undefined}
                  data-locked={locked ? '' : undefined}
                  aria-describedby={hovered?.id === item.id ? `diple-pv-${item.id}` : undefined}
                  aria-label={t('send.strip.chipLabel', i + 1, originLabel(item.origin, key, t, ctl.titleOf))}
                  onMouseEnter={(e) => enter(item, e.currentTarget)}
                  onMouseLeave={() => leave(item)}
                  onFocus={(e) => enter(item, e.currentTarget)}
                  onBlur={() => leave(item)}
                  onClick={() => void locate(item)}
                >
                  <span className="diple-chip-n" data-kind={kind}>
                    {i + 1}
                  </span>
                  <span className="diple-chip-text">{chipText(item.text)}</span>
                  {view.changed[item.id] ? <span className="diple-sr">{t('capture.changed')}</span> : null}
                </button>
                {!locked ? (
                  <button type="button" className="diple-chip-remove diple-card-remove" aria-label={t('capture.removeN', i + 1)} title={t('capture.remove')} onClick={() => ctl.remove(key, item.id)}>
                    ×
                  </button>
                ) : null}
              </span>
            )
          })}
          {folded ? (
            <button type="button" className="diple-chip diple-chip-more" data-diple-more="" data-lit={hiddenLit ? '' : undefined} aria-label={t('send.strip.moreLabel', items.length - cap)} onClick={() => setShowAll(true)}>
              +{items.length - cap}
            </button>
          ) : showAll && foldable ? (
            <button type="button" className="diple-chip diple-chip-more" data-diple-less="" aria-label={t('send.strip.lessLabel')} onClick={() => setShowAll(false)}>
              −
            </button>
          ) : null}
          {hoveredIndex >= 0 ? (
            <ChipPreview item={items[hoveredIndex]} index={hoveredIndex} listKey={key} t={t} ctl={ctl} changed={Boolean(view.changed[items[hoveredIndex].id])} anchor={hovered.anchor} />
          ) : null}
        </div>
      )}
      {undo ? <UndoBar undo={undo} t={t} ctl={ctl} listKey={key} /> : null}
      {Footer && items.length > 0 ? <Footer sessionKey={key} shown={items} status={status} canClear={anyUnlocked} onClear={() => ctl.clear(key)} /> : status}
    </section>
  )
}
