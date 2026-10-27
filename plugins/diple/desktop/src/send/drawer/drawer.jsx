// "This session's annotations" drawer (design §2.7): every annotation of the
// session in four states — pending, sent, answered, missing — filterable;
// a row goes back to the original (uiBus.locate); "copy as Markdown".
//
//   const drawer = createDrawer()
//   drawer.open(key) / drawer.close() / drawer.get() → { key } | null
//   <DrawerHost deps drawer titles />   render in every composer slot; only
//                                       the first mounted one paints
//
// The composer surface clips its overflow, so the drawer is a fixed layer
// placed over the composer it belongs to (above it, right-aligned), and
// re-placed on resize.
//
// Data: the pending list (live) + GET /batches?sessionId= (read on open and
// whenever the list changes — a send leaves the list), built by records.js.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { useViewportPlacement } from '../strip/placement.js'
import { chipText, originLabel } from '../strip/text.js'
import { buildRecords, countByStatus, STATUSES, toMarkdown } from './records.js'

export function createDrawer() {
  let value = null
  let owner = null
  const listeners = new Set()
  const emit = () => [...listeners].forEach((fn) => fn())
  return {
    get: () => value,
    owner: () => owner,
    subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    open(key) {
      if (!key) return
      value = { key }
      emit()
    },
    close() {
      value = null
      emit()
    },
    claim(token) {
      if (owner === null) owner = token
      emit()
      return owner === token
    },
    release(token) {
      if (owner === token) {
        owner = null
        emit()
      }
    }
  }
}

const FILTERS = ['all', ...STATUSES]
const ROW_CHARS = 60

function useBatches(api, key, version) {
  const [res, setRes] = useState({ loading: true, batches: [] })
  useEffect(() => {
    let live = true
    setRes((r) => ({ ...r, loading: true }))
    api
      .listBatches({ sessionId: key, limit: 200 })
      .then((r) => live && setRes({ loading: false, batches: r?.batches ?? [] }))
      .catch(() => live && setRes({ loading: false, batches: [], error: true }))
    return () => {
      live = false
    }
  }, [key, version])
  return res
}

const GAP = 8

/** Above the composer showing `key` (else the first composer), right-aligned with it. */
function placeAbove(key) {
  const strip = document.querySelector(`[data-diple-list][data-session-key="${globalThis.CSS?.escape?.(key) ?? key}"]`)
  const surface = strip?.closest?.('[data-slot="composer-surface"]') ?? strip ?? document.querySelector('[data-slot="composer-surface"]')
  const r = surface?.getBoundingClientRect?.()
  if (!r || !r.width) return null
  return { right: Math.max(GAP, window.innerWidth - r.right), bottom: Math.max(GAP, window.innerHeight - r.top + GAP), maxHeight: Math.max(160, r.top - 2 * GAP - 40) }
}

function Drawer({ deps, drawer, titles, open }) {
  const { lists, api, i18n, uiBus, notify } = deps
  const t = i18n.useT()
  const state = lists.useList(open.key)
  useSyncExternalStore(titles.subscribe, titles.version)
  // re-read the records whenever the list changes size (a send, a put-back)
  const { loading, batches, error } = useBatches(api, open.key, state.items.length)
  const [filter, setFilter] = useState('all')
  const ref = useRef(null)
  useViewportPlacement(ref, () => placeAbove(open.key), [open.key])
  const records = buildRecords({ items: state.items, batches })
  const counts = countByStatus(records)
  const label = (o) => originLabel(o, open.key, t, titles.titleOf)
  const shown = filter === 'all' ? records : records.filter((r) => r.status === filter)

  useEffect(() => {
    ref.current?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape' && !e.isComposing) {
        e.stopPropagation()
        drawer.close()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const copy = async () => {
    const md = toMarkdown(shown, { t, originLabel: label })
    try {
      await navigator.clipboard.writeText(md)
      notify({ kind: 'success', title: t('send.drawer.copied', shown.length) })
    } catch {
      notify({ kind: 'error', title: t('send.drawer.copyFailed') })
    }
  }

  const sections = filter === 'all' ? STATUSES.filter((s) => counts[s]) : [filter]
  return (
    <aside ref={ref} tabIndex={-1} className="diple-drawer" data-diple-ui="" data-diple-drawer={open.key} role="dialog" aria-label={t('send.drawer.title')}>
      <header className="diple-drawer-head">
        <span className="diple-drawer-title">{t('send.drawer.title')}</span>
        <span className="diple-drawer-count">{counts.all}</span>
        <span className="diple-spacer" />
        <button type="button" className="diple-drawer-action" data-diple-drawer-copy="" disabled={!shown.length} onClick={() => void copy()}>
          {t('send.drawer.copy')}
        </button>
        <button type="button" className="diple-drawer-close" aria-label={t('send.close')} title={t('send.close')} onClick={() => drawer.close()}>
          ×
        </button>
      </header>
      <div className="diple-drawer-filters" role="group" aria-label={t('send.drawer.filter')}>
        {FILTERS.map((f) => (
          <button key={f} type="button" className="diple-drawer-filter" data-diple-filter={f} aria-pressed={filter === f} disabled={f !== 'all' && !counts[f]} onClick={() => setFilter(f)}>
            {t(`send.drawer.status.${f}`)}
            <span className="diple-drawer-filter-n">{counts[f]}</span>
          </button>
        ))}
      </div>
      <div className="diple-drawer-list">
        {!records.length ? (
          <div className="diple-drawer-empty">{loading ? t('send.dialogLoading') : error ? t('send.drawer.loadFailed') : t('send.drawer.empty')}</div>
        ) : null}
        {sections.map((status) => (
          <section key={status} className="diple-drawer-section" data-diple-section={status}>
            {filter === 'all' ? (
              <div className="diple-drawer-section-title">
                {t(`send.drawer.status.${status}`)} · {counts[status]}
              </div>
            ) : null}
            {shown
              .filter((r) => r.status === status)
              .map((r) => (
                <button
                  key={r.key}
                  type="button"
                  className="diple-drawer-row"
                  data-diple-record={r.key}
                  data-status={r.status}
                  disabled={!r.itemId}
                  onClick={() => r.itemId && void uiBus?.locate(r.itemId, { edit: r.status === 'pending' })}
                >
                  <span className="diple-chip-n" data-kind={r.kind} data-status={r.status}>
                    {r.n}
                  </span>
                  <span className="diple-drawer-row-body">
                    <span className="diple-drawer-row-text">{chipText(r.text, ROW_CHARS)}</span>
                    {r.comment.trim() ? <span className="diple-drawer-row-comment">{chipText(r.comment, ROW_CHARS * 2)}</span> : null}
                    <span className="diple-drawer-row-origin">{label(r.origin)}</span>
                  </span>
                </button>
              ))}
          </section>
        ))}
      </div>
    </aside>
  )
}

export function DrawerHost({ deps, drawer, titles }) {
  const [token] = useState(() => ({}))
  useEffect(() => {
    drawer.claim(token)
    return () => drawer.release(token)
  }, [])
  const owner = useSyncExternalStore(drawer.subscribe, drawer.owner)
  const open = useSyncExternalStore(drawer.subscribe, drawer.get)
  const settings = deps.settings.use()
  if (owner !== token || !open || !settings.enabled) return null
  return <Drawer key={open.key} deps={deps} drawer={drawer} titles={titles} open={open} />
}
