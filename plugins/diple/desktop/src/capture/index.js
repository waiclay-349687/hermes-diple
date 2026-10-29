// capture/ — selection → pending list, list view, locate, highlights, and
// (V2-T) the selection toolbar, the editor beside the text, numbered pins,
// mark states and uiBus.locate. install(ctx, deps) is the group's only entry;
// it touches only capture/ files, provides the `locate` service and
// implements deps.uiBus.onLocate.

import * as SDK from '@hermes/plugin-sdk'
import { COMPOSER_AREAS, KEYBINDS_AREA, PALETTE_AREA } from '@hermes/plugin-sdk'
import { createElement } from 'react'

import { createAnnotator } from './annotator.js'
import { createMarkdownMirror } from './editor/markdown-mirror.js'
import { createHighlighter } from './highlights.js'
import { Strip } from '../send/strip/strip.jsx'
import { createLocator } from './locate.js'
import { createSentMarks } from './mark-states.js'
import { createOriginResolver, sameOriginState, RUN_ID } from './origin.js'
import { createTurnLedger } from './turns.js'
import { installSelectionToolbar } from './selection-toolbar/index.js'
import { canCapture, readSelection } from './selection.js'
import { ownedElsewhere, resolveSurfaceKey } from './surfaces.js'
import { CAPTURE_CSS } from './styles.js'
import { sessionHistory as readHistory } from '../shared/history.js'
import { createUiState } from './ui-state.js'

const RESOLVE_TIMEOUT_MS = 1500
const OPEN_INTENT = 'tab' // host.openSession: a session tile beside the current one

const host = () => SDK.host ?? {}

const withTimeout = (p, ms, fallback) =>
  Promise.race([p.catch(() => fallback), new Promise((r) => setTimeout(() => r(fallback), ms))])

/** Session titles for "from another session" labels (best effort, cached). */
function createTitles() {
  const map = new Map()
  const listeners = new Set()
  let version = 0
  let loading = null
  const load = () => {
    if (loading) return loading
    const h = host()
    const profile = h.state?.profile?.get?.() || h.state?.focusedSessionProfile?.get?.() || 'default'
    loading = Promise.resolve()
      .then(() => h.listPersistedSessions?.(null, { profile, limit: 300 }))
      .then((res) => {
        for (const s of res?.sessions ?? []) if (s?.id) map.set(s.id, s.title || s.preview || null)
        version++
        for (const fn of [...listeners]) fn()
      })
      .catch(() => {})
      .finally(() => setTimeout(() => (loading = null), 30_000))
    return loading
  }
  return {
    titleOf(id) {
      if (!map.has(id)) {
        map.set(id, null)
        load()
      }
      return map.get(id)
    },
    subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    version: () => version
  }
}

const sessionHistory = (storedId) => readHistory(host(), storedId)

export function installCapture(ctx, deps) {
  const { lists, session, i18n, ids, settings, notify, services, api } = deps
  const bus = deps.uiBus
  const live = deps.live
  /** busy state of a stored session: true / false / null (unknown) — R2 XE-10 */
  const busyOf = async (storedId) => {
    if (!live) return storedId === session.currentKey() ? Boolean(host().state?.busy?.get?.()) : null
    try {
      return await withTimeout(live.probeBusy(storedId), RESOLVE_TIMEOUT_MS, null)
    } catch {
      return null
    }
  }
  const ui = createUiState(ctx.storage)
  const titles = createTitles()

  const style = document.createElement('style')
  style.setAttribute('data-diple-style', 'capture')
  style.textContent = CAPTURE_CSS
  document.head.appendChild(style)
  ctx.onDispose(() => style.remove())

  const say = (kind, title) => notify({ kind, title })
  const refuse = (reason) => say('warning', i18n.t('capture.reason.' + reason))

  const resolver = createOriginResolver({ history: sessionHistory })
  // completed turns, in arrival order, for the captures waiting on one (R5 XE5-01)
  const turns = createTurnLedger({ storedIdFor: (rid) => live?.storedIdFor?.(rid) ?? null })
  const waitingForTurn = (o) => o?.pending && o.bind?.mode === 'turn' && o.bind.run === RUN_ID
  const inflight = new Map() // capture token → its bind.after, while its origin is being resolved
  let nextToken = 0
  // sent / answered / missing, read from the send flow's batch records and the backend (read-only)
  const sentMarks = createSentMarks({ batches: deps.batches, api, enabled: () => settings.get().enabled && settings.get().marksKeepSent })
  ctx.onDispose(() => sentMarks.dispose())
  const highlighter = createHighlighter({
    lists,
    ui,
    enabled: () => settings.get().enabled,
    focusedKey: session.currentKey,
    quiet: () => settings.get().marksQuiet,
    sent: sentMarks
  })
  const locateOrigin = createLocator({
    highlighter,
    ui,
    notify,
    t: i18n.t,
    openSession: (id) => host().openSession?.(id, { intent: OPEN_INTENT })
  })

  const focusComposer = (key) => {
    try {
      host().composer?.focus?.(key ?? null)
    } catch {
      /* no composer to focus */
    }
  }

  const handleUndoable = (key, effects, count) => {
    const u = effects.find((e) => e.type === 'undoable')
    if (u) ui.setUndo(key, u.kind, u.until, count)
    return u
  }
  const focusLater = (selector, fallbackKey) =>
    setTimeout(() => {
      const el = selector && document.querySelector(selector)
      if (el) el.focus({ preventScroll: true })
      else if (fallbackKey !== undefined) focusComposer(fallbackKey)
    }, 0)

  const ctl = {
    titles,
    titleOf: (id) => titles.titleOf(id),
    focusComposer,
    editComment: (key, id, comment) => lists.dispatch(key, { type: 'editComment', id, comment }),
    remove(key, id) {
      const items = lists.get(key).items
      const i = items.findIndex((it) => it.id === id)
      const effects = lists.dispatch(key, { type: 'remove', id })
      handleUndoable(key, effects, 1)
      if (ui.expandedIn(key) === id) ui.collapseCard()
      // Keep keyboard focus inside the list: the next card's ×, else the undo button.
      const rest = lists.get(key).items
      const next = rest[Math.min(i, rest.length - 1)]
      focusLater(next ? `[data-diple-id="${next.id}"] .diple-card-remove` : `[data-diple-list][data-session-key="${key}"] .diple-undo .diple-link`, key)
    },
    clear(key) {
      const n = lists.get(key).items.length
      const effects = lists.dispatch(key, { type: 'clear' })
      handleUndoable(key, effects, n - lists.get(key).items.length)
      ui.collapseCard()
      focusLater(`[data-diple-list][data-session-key="${key}"] .diple-undo .diple-link`, key)
    },
    undo(key) {
      const kind = ui.get().undo?.kind
      const effects = lists.dispatch(key, { type: kind === 'clear' ? 'undoClear' : 'undoRemove' })
      ui.clearUndo()
      if (effects.some((e) => e.type === 'rejected')) return
      const first = lists.get(key).items[0]
      if (first) focusLater(`[data-diple-id="${first.id}"] .diple-card-origin`)
    },
    expireUndo: () => ui.clearUndo(),
    locate: (item) => locateOrigin(item.origin, { itemId: item.id })
  }

  /** Bind the pieces of a selection to their messages: persisted messages to
   *  their rows first (fast, bounded); captures without a durable message id
   *  as they are (synchronously). Then `use(pieces)`; turns that completed
   *  meanwhile are settled after it. → use's result (or a Promise of it) */
  const bindPieces = (pieces, use) => {
    if (!pieces.some((p) => p.origin.messageTs || p.origin.pending)) return use(pieces)
    // The moment of capture, taken NOW (R5 XE5-01): only a turn completing after
    // it can be the one producing this text — also one that completes while the
    // origin below is still being resolved — and the runtime its session runs on.
    const after = turns.seq()
    const token = ++nextToken
    inflight.set(token, after)
    const runtimes = new Map(pieces.map((p) => [p.origin.sessionId, live?.currentRuntime?.(p.origin.sessionId) ?? null]))
    const stamp = (o) => (waitingForTurn(o) ? { ...o, bind: { ...o.bind, after, rt: runtimes.get(o.sessionId) ?? null } } : o)
    // The resolver decides how a temporary-id capture may be verified (R2
    // XE-02): it needs the session's busy state — the background tile's too.
    const bind = async (p) => {
      const busy = p.origin.pending ? await busyOf(p.origin.sessionId) : null
      const fallback = p.origin.pending ? { ...p.origin, verified: false, bind: { mode: 'turn', run: RUN_ID } } : p.origin
      return stamp(await withTimeout(resolver.capture(p.origin, p.text, { busy }), RESOLVE_TIMEOUT_MS, fallback))
    }
    return Promise.all(pieces.map(async (p) => ({ ...p, origin: await bind(p) })))
      .then(use)
      .finally(() => {
        inflight.delete(token)
        settleTurns({ verify: true }) // a completion that arrived while it was resolved
      })
  }

  /** The current selection, read for capture: { ok, reason?, key, sel, pieces? } */
  const readCurrent = (kept = null) => {
    const sel = document.getSelection()
    // #144421: the host cleared the selection the toolbar was shown for — put that Range back.
    if (kept && sel && (sel.isCollapsed || !sel.rangeCount)) {
      try {
        sel.removeAllRanges()
        sel.addRange(kept)
      } catch {
        // detached meanwhile: read what is there
      }
    }
    // Another plugin's capture UI (Diple Docs's document) handles ⌘⇧E itself.
    if (ownedElsewhere(document.activeElement) || (sel?.rangeCount && (ownedElsewhere(sel.anchorNode) || ownedElsewhere(sel.focusNode)))) return { ok: false, reason: 'foreign' }
    if (!settings.get().enabled) return { ok: false, reason: 'disabled' }
    const key = session.currentKey()
    if (!key) return { ok: false, reason: 'no-session' }
    const r = readSelection(sel, { fallbackSessionKey: key })
    return { ...r, key, sel }
  }

  let annotator = null

  /** ⌘⇧E / palette / the toolbar: add the selection to the focused session's
   *  list and open the editor beside it (V2). The same passage again opens
   *  that annotation instead. */
  const addSelection = ({ range = null, at = null } = {}) => {
    // From the toolbar: its kept Range and its place. ⌘⇧E / palette while it is up: the same.
    const tb = range ? { range, at } : button?.current?.() ?? null
    button?.hide() // it is done: our own removeAllRanges below must not leave it up
    const r = readCurrent(tb?.range ?? null)
    if (r.reason === 'foreign') return
    if (!r.ok) return refuse(r.reason)
    const { key, sel } = r
    annotator?.commitOpen() // one editor at a time
    sel.removeAllRanges()
    const commit = (pieces) => {
      const all = []
      let first = null
      let dup = null
      for (const p of pieces) {
        const effects = lists.dispatch(key, { type: 'add', id: ids.newItemId(), item: { origin: p.origin, text: p.text } })
        all.push(...effects)
        const focus = effects.find((e) => e.type === 'focus')
        if (focus && !focus.duplicate) first ??= focus.id
        if (focus?.duplicate) dup ??= focus.id
      }
      if (first) annotator?.openNew(key, first, { at: tb?.at ?? null })
      else if (dup) {
        say('info', i18n.t('capture.duplicate'))
        annotator?.openEdit(key, dup)
      }
      if (first && pieces.length > 1) say('success', i18n.t('capture.added', pieces.length))
      return all
    }
    return bindPieces(r.pieces, commit)
  }

  /** The editor's "replace with the current selection": the selection, bound, without touching the list. */
  const readReplacement = async () => {
    const r = readCurrent()
    if (!r.ok) return r.reason === 'foreign' ? { ok: false } : r
    return { ok: true, pieces: await bindPieces(r.pieces, (pieces) => pieces) }
  }

  // The selection toolbar: one button, 标注 (design §2.3).
  const button = installSelectionToolbar({
    enabled: () => settings.get().enabled && settings.get().selectionButton,
    canCapture: (sel) => canCapture(sel),
    onActivate: (cur) => void addSelection(cur),
    label: () => i18n.t('capture.selectionButton'),
    // never over a pin (V3-T)
    avoid: () => [...document.querySelectorAll('[data-diple-pin]:not([hidden])')].map((p) => p.getBoundingClientRect()).filter((r) => r.width && r.height)
  })
  ctx.onDispose(() => button.dispose())

  // Markdown for the overlays, drawn by the host renderer (editor/markdown-mirror.js).
  const md = createMarkdownMirror()
  ctx.onDispose(() => md.dispose())

  annotator = createAnnotator({
    lists,
    bus,
    highlighter,
    md,
    t: i18n.t,
    notify,
    locateOrigin,
    findSent: (itemId, key) => sentMarks.find(itemId, key),
    onFocusChange: (fn) => session.subscribe(fn),
    focusComposer,
    currentKey: session.currentKey,
    readReplacement,
    canReplace: () => {
      const sel = document.getSelection()
      return Boolean(sel && !sel.isCollapsed && !sel.anchorNode?.parentElement?.closest?.('[data-diple-ui]') && canCapture(sel))
    },
    onRemoved: (key, effects) => handleUndoable(key, effects, 1),
    onDraft: (id, value) => ui.markDraft(id, value)
  })
  ctx.onDispose(() => annotator.dispose())
  ctx.onDispose(bus.onLocate((itemId, opts) => annotator.locate(itemId, opts)))

  ctx.onDispose(services.provide('capture', 'locate', (origin) => locateOrigin(origin)))
  // Before any send (R8 XV-02): the editor's draft into its list first.
  ctx.onDispose(services.provide('capture', 'commitEditor', () => annotator.commitOpen()))

  const labels = () => ({ label: i18n.t('capture.addCommand'), category: i18n.t('capture.keybindCategory') })
  const registerCommands = () => {
    const { label, category } = labels()
    return ctx.registerMany([
      {
        id: 'add',
        area: KEYBINDS_AREA,
        data: {
          id: 'diple.add',
          label,
          category,
          // ⌘⇧L is the host's view.showBrowser (built-ins win), so the default is ⌘⇧E.
          defaults: ['mod+shift+e'],
          run: () => void addSelection({})
        }
      },
      {
        id: 'add-palette',
        area: PALETTE_AREA,
        data: {
          id: 'diple.add',
          label,
          keywords: ['diple', 'quanpi', 'highlight', 'annotate', 'comment', 'pending', 'biaozhu', '\u5708\u6279', '\u6807\u6ce8', '\u5212\u7ebf', '\u6279\u6ce8', '\u5f85\u53d1'],
          run: () => void addSelection({})
        }
      }
    ])
  }
  ctx.register({
    id: 'list',
    area: COMPOSER_AREAS.top,
    order: 10,
    render: () => createElement(Strip, { deps, ui, ctl })
  })
  // after the list: hidden, it only feeds the overlays' Markdown
  ctx.register({ id: 'md-mirror', area: COMPOSER_AREAS.top, order: 99, render: () => createElement(md.Mirror) })
  let disposeCommands = registerCommands()
  const relabelCommands = () => {
    if (typeof disposeCommands === 'function') disposeCommands()
    disposeCommands = registerCommands()
    button.relabel()
    annotator.relabel()
  }
  ctx.onDispose(() => typeof disposeCommands === 'function' && disposeCommands())
  const offLocale = i18n.onLocaleChange?.(relabelCommands)
  if (typeof offLocale === 'function') ctx.onDispose(offLocale)
  let lastLang = settings.get().language
  const offSettings = settings.subscribe((v) => {
    if (v.language !== lastLang) {
      lastLang = v.language
      relabelCommands()
    }
    if (!v.enabled || !v.selectionButton) button.hide()
    highlighter.schedule()
    for (const key of lists.keys()) sentMarks.refresh(key)
  })
  ctx.onDispose(offSettings)

  // Marks, pins and their states (V2): the old click-a-highlight-to-open-its-card is gone.
  highlighter.start()
  ctx.onDispose(() => highlighter.dispose())
  // A send changes what is pending and what is sent: re-read the batch states.
  const offSentLists = lists.subscribe(() => {
    const key = session.currentKey()
    if (key) sentMarks.refresh(key)
  })
  ctx.onDispose(offSentLists)

  // Typing in the main input closes an expanded card (so ⌘⇧E adds again).
  // Not on focus: the host focuses the composer on transcript mousedown, and
  // a card collapsing mid-drag shifts the transcript under the pointer.
  const onComposerInput = (e) => {
    if (ui.get().expanded && e.target?.closest?.('[data-slot="composer-rich-input"]')) ui.collapseCard()
  }
  document.addEventListener('input', onComposerInput, true)
  ctx.onDispose(() => document.removeEventListener('input', onComposerInput, true))

  // Esc anywhere closes an open card (inside the list the card handles it).
  const onEscape = (e) => {
    if (e.key !== 'Escape' || e.isComposing || e.keyCode === 229 || !ui.get().expanded) return
    if (e.target?.closest?.('[data-diple-list]')) return
    ui.collapseCard()
  }
  document.addEventListener('keydown', onEscape)
  ctx.onDispose(() => document.removeEventListener('keydown', onEscape))

  const replaceOrigin = (key, id, origin) => {
    const cur = origin && lists.get(key).items.find((it) => it.id === id)
    if (cur) lists.dispatch(key, { type: 'replaceText', id: cur.id, text: cur.text, origin })
  }
  /** Write back an async verdict only if the stored origin is still the
   *  snapshot it was computed on (R4 XE4-01): not pinned elsewhere, not
   *  verified meanwhile, not replaced. A stale verdict is dropped. */
  const settleOrigin = (key, id, snapshot, origin) => {
    if (!origin) return
    const cur = lists.get(key).items.find((it) => it.id === id)
    if (cur && sameOriginState(cur.origin, snapshot)) replaceOrigin(key, id, origin)
  }
  const verifyPinned = (key, item) => {
    const snapshot = item.origin
    resolver.verifyPinned(snapshot, item.text).then((origin) => settleOrigin(key, item.id, snapshot, origin), () => {})
  }
  // Streaming captures: bound by the completed turn of THEIR session only.
  // The event's session id is a runtime id; the stored id comes from live
  // (focus pairs, the gateway's live session list). A completion is recorded
  // and its captures pinned SYNCHRONOUSLY when it arrives (R4 XE4-01, R5
  // XE5-01): the ledger (turns.js) decides, per capture, which completion is
  // its own — the first one after the capture that is of its session. A
  // completion whose runtime is not mapped yet holds back only the captures
  // it might belong to, until a lookup (bounded, RESOLVE_TIMEOUT_MS) maps it;
  // unmapped, they stay unverified. Nothing is read from "the list as it is
  // when an async step finishes": a capture made later never joins an
  // earlier completion.
  const turnCandidates = () => {
    const out = []
    for (const key of lists.keys()) for (const item of lists.get(key).items) if (waitingForTurn(item.origin)) out.push({ key, item })
    return out
  }
  const verifyAllPinned = () => {
    for (const key of lists.keys()) {
      for (const item of lists.get(key).items) if (item.origin?.pending && item.origin.bind?.mode === 'rows') verifyPinned(key, item)
    }
  }
  /** Pin every waiting capture whose own completion is known now; forget what no one needs. */
  function settleTurns({ verify = false } = {}) {
    let minAfter = Infinity
    for (const { key, item } of turnCandidates()) {
      const o = item.origin
      const d = turns.decide({ sessionId: o.sessionId, after: o.bind.after, rt: o.bind.rt ?? null })
      const pinned = d?.turn ? resolver.pinTurn(o, d.turn, o.sessionId) : null
      if (pinned) {
        replaceOrigin(key, item.id, pinned)
        const now = lists.get(key).items.find((it) => it.id === item.id)
        if (verify && now) verifyPinned(key, now)
      } else if (typeof o.bind.after === 'number') minAfter = Math.min(minAfter, o.bind.after)
    }
    for (const a of inflight.values()) minAfter = Math.min(minAfter, a)
    turns.prune(minAfter === Infinity ? turns.seq() : minAfter)
  }
  // Map runtime ids no one knows yet: one bounded lookup at a time; completions
  // that arrived during it get another.
  let looking = false
  const lookup = () => {
    if (looking || !live?.refreshPairs) return
    looking = true
    const upto = turns.seq()
    withTimeout(live.refreshPairs(), RESOLVE_TIMEOUT_MS, false).then(() => {
      looking = false
      if (disposed) return
      settleTurns({ verify: true })
      if (turns.unresolved(upto) && turnCandidates().length) lookup()
    })
  }
  let disposed = false
  ctx.onDispose(() => (disposed = true))
  const onComplete = (e) => {
    const turn = e?.payload?.persisted_turn
    if (!turn) return
    const candidates = turnCandidates().length > 0 || inflight.size > 0
    if (candidates) {
      const rid = e?.session_id || e?.payload?.session_id || ''
      // events without a session id: the focused chat's; no live pairs (old host): the id as given
      const known = !rid ? session.currentKey() : !live ? rid : live.storedIdFor?.(rid) ?? null
      turns.arrive({ turn, rid, session: known })
      settleTurns()
      if (known == null) lookup()
    }
    verifyAllPinned() // earlier pinned captures whose history read failed retry their own rows
    const key = session.currentKey()
    if (key) sentMarks.refresh(key) // an answer may have been checked
  }
  const offComplete = ctx.onEvent?.('message.complete', onComplete)
  if (typeof offComplete === 'function') ctx.onDispose(offComplete)

  // Captures still waiting from an earlier run (the turn completed while the
  // app was closed): settle them when their session is on screen and idle.
  const tried = new Set()
  const bindStale = async () => {
    for (const surface of document.querySelectorAll('[data-chat-surface]')) {
      const key = resolveSurfaceKey(surface, session.currentKey())
      if (!key) continue
      for (const item of lists.get(key).items) {
        if (!item.origin?.pending || tried.has(item.id)) continue
        tried.add(item.id)
        const busy = await busyOf(item.origin.sessionId)
        const snapshot = lists.get(key).items.find((it) => it.id === item.id)?.origin
        if (!snapshot?.pending) continue
        resolver.onReload(snapshot, item.text, { busy }).then((origin) => settleOrigin(key, item.id, snapshot, origin), () => {})
      }
    }
  }
  const runStale = () => void bindStale()
  const staleTimer = setTimeout(runStale, 2500)
  window.addEventListener('hashchange', runStale)
  ctx.onDispose(() => {
    clearTimeout(staleTimer)
    window.removeEventListener('hashchange', runStale)
  })

  return { addSelection, ui, highlighter, annotator }
}
