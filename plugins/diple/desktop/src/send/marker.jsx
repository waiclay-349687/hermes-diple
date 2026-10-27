// Response marker `::ann{b n}` → "↩ 批注 ①③" (ADR 0002). W2b.
//
// The AI writes only the batch id and numbers; everything shown comes from
// the plugin's own record of the batch (local first, then GET /batches/<b>).
// Numbers that are not comments of that batch are ignored; nothing valid →
// renders nothing. Hover: each comment + the opening of its text. Click: jump
// to the original text through capture's `locate` service (fallback: scroll
// to the message by its id, or say where the text is).
// Master switch off → the marker degrades to its plain source text.

import { useEffect, useState } from 'react'
import { Envelope, Markers } from '@diple/core'

import { Hint } from './ui.jsx'

const isComment = (it) => typeof it?.comment === 'string' && it.comment.trim() !== ''
const opening = (text, n = 40) => {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim()
  const cs = Array.from(flat)
  return cs.length > n ? cs.slice(0, n).join('') + '…' : flat
}

export function commentNumbers(batch, nAttr) {
  if (!batch?.items) return []
  return Markers.parseNumbers(nAttr).filter((n) => isComment(batch.items[n - 1]))
}

const ROOTS = { user: '[data-slot="aui_user-message-root"]', assistant: '[data-slot="aui_assistant-message-root"]' }
const flat = (s) => (s ?? '').replace(/\s+/g, '')

/**
 * Degraded locate while capture's `locate` is not installed: scroll the
 * original message into view. By message id when there is one, else the
 * message whose text contains the annotation's opening (role ordinal first).
 */
export function fallbackLocate(origin, text) {
  if (!origin || origin.path) return 'changed'
  const show = (el) => (el.scrollIntoView?.({ block: 'center', behavior: 'smooth' }), 'shown')
  if (origin.messageId) {
    const esc = globalThis.CSS?.escape ? globalThis.CSS.escape(origin.messageId) : origin.messageId.replace(/"/g, '\\"')
    const el = document.querySelector(`[data-message-id="${esc}"]`)
    if (el) return show(el)
  }
  const head = Array.from(flat(text)).slice(0, 24).join('')
  if (!head) return 'not-loaded'
  const roots = [...document.querySelectorAll(ROOTS[origin.role] ?? `${ROOTS.user},${ROOTS.assistant}`)]
  const byOrdinal = roots[(origin.roleOrdinal ?? 0) - 1]
  if (byOrdinal && flat(byOrdinal.textContent).includes(head)) return show(byOrdinal)
  const any = roots.find((el) => flat(el.textContent).includes(head))
  return any ? show(any) : 'not-loaded'
}

// U+21A9 falls back to the colour-emoji font in the app's UI font; pin a
// symbol font for the arrow alone (textContent stays the same).
const ARROW = '\u21A9'
function arrowed(label) {
  const i = label.indexOf(ARROW)
  if (i < 0) return label
  return (
    <>
      {label.slice(0, i)}
      <span className="diple-ann-arrow">{ARROW}</span>
      {label.slice(i + 1)}
    </>
  )
}

export function createMarker({ deps, batches }) {
  const { i18n, services, notify } = deps

  async function jump(item, t) {
    const origin = item.origin
    const locate = services.get('locate')
    let r
    try {
      r = locate ? await locate(origin) : fallbackLocate(origin, item.text)
    } catch {
      r = null
    }
    if (r === 'shown' || r === 'loaded-and-shown' || r === 'other-session-opened') return
    // capture's locate already told the user what happened (W3 merge: avoid double notices).
    if (locate && r) return
    if (origin?.path) notify({ kind: 'info', title: t('send.locateFile', origin.path, origin.line) })
    else if (r === 'not-loaded') notify({ kind: 'info', title: t('send.locateNotLoaded') })
    else if (r === 'changed') notify({ kind: 'warning', title: t('send.locateChanged') })
    else if (!r) notify({ kind: 'warning', title: t('send.locateUnavailable') })
  }

  function TipBody({ ns, items, t }) {
    return (
      <span className="diple-ann-tip">
        {items.map((it, i) => (
          <span key={ns[i]} className="diple-ann-tip-item">
            <span className="diple-ann-tip-n">{Envelope.circled(ns[i])}</span>
            <span>
              {t('send.markerTipComment')}
              {it.comment.trim()}
            </span>
            <span className="diple-ann-tip-text">
              {t('send.markerTipText')}
              {opening(it.text)}
            </span>
          </span>
        ))}
        <span className="diple-ann-tip-hint">{t('send.markerTipClick')}</span>
      </span>
    )
  }

  return function AnnMarker({ attrs, source }) {
    const t = i18n.useT()
    const settings = deps.settings.use()
    const b = typeof attrs?.b === 'string' ? attrs.b.trim() : ''
    const [batch, setBatch] = useState(() => (b ? batches.peek(b) : null))
    useEffect(() => {
      let live = true
      if (!b || batch?.batchId === b) return
      batches.read(b).then((rec) => live && setBatch(rec))
      return () => {
        live = false
      }
    }, [b])
    if (!settings.enabled) {
      const plain = typeof source === 'string' && source ? source : b ? Markers.markerFor(b, Markers.parseNumbers(attrs?.n)) : ''
      return <span className="diple-ann-plain">{plain}</span>
    }
    const rec = batch?.batchId === b ? batch : null
    const ns = commentNumbers(rec, attrs?.n)
    if (!ns.length) return null
    const items = ns.map((n) => rec.items[n - 1])
    const label = ns.map(Envelope.circled).join('')
    const plainTip = items
      .map((it, i) => `${Envelope.circled(ns[i])} ${t('send.markerTipComment')}${it.comment.trim()}\n${t('send.markerTipText')}${opening(it.text)}`)
      .join('\n')
    return (
      <Hint label={<TipBody ns={ns} items={items} t={t} />} text={plainTip}>
        <button
          type="button"
          className="diple-ann"
          data-diple-ann={b}
          data-n={ns.join(',')}
          aria-label={t('send.markerAria', label)}
          onClick={() => jump(items[0], t)}
        >
          {arrowed(t('send.markerLabel', label))}
        </button>
      </Hint>
    )
  }
}

export const MARKER_CSS = `
.diple-ann{display:inline-flex;align-items:center;gap:4px;margin:2px 0;padding:1px 8px;border-radius:999px;border:1px solid color-mix(in srgb,var(--ui-accent) 35%,transparent);background:color-mix(in srgb,var(--ui-accent) 8%,transparent);color:var(--ui-accent);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
.diple-ann-arrow{font-family:'Apple Symbols','Segoe UI Symbol','Noto Sans Symbols',sans-serif;font-variant-emoji:text;font-size:1.2em;line-height:1}
.diple-ann:hover{background:color-mix(in srgb,var(--ui-accent) 16%,transparent)}
.diple-ann:focus-visible{outline:2px solid var(--ui-accent);outline-offset:1px}
.diple-ann-tip{display:flex;flex-direction:column;gap:6px;max-width:360px;white-space:normal}
.diple-ann-tip-item{display:flex;flex-direction:column;gap:1px}
.diple-ann-tip-n{font-weight:600}
.diple-ann-tip-text{opacity:.75}
.diple-ann-tip-hint{opacity:.6;font-size:11px}
.diple-ann-plain{white-space:pre-wrap}
`
