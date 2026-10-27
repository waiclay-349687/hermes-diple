// send/ — W2b: send flow, response markers, missing answers, hand-off
// receiver, settings page. install(ctx, deps) is the group's only entry.
//
// Provides services: ListFooter, sendNow (shared/services.js).
// V2-C: the composer strip (strip/, rendered by capture in its pending-list slot),
// the session drawer (drawer/), uiBus.onSendNow → the one send flow, a
// confirm before sending into a session that is not the focused one, and an
// SDK self-check at load.
// Contributes: composer middleware (main send button), the composer underside
// row (receipt + missing-answer notices + the dialog and drawer hosts), the `ann`
// transcript directive, the "send" keybind and palette commands, the
// Settings ▸ Plugins page. Listens: message.start / message.complete / error,
// plugin.diple.batch.sent, plugin.diple-docs.handoff.

import * as SDK from '@hermes/plugin-sdk'
import { COMPOSER_AREAS, host, KEYBINDS_AREA, PALETTE_AREA, TRANSCRIPT_DIRECTIVE_AREA } from '@hermes/plugin-sdk'
import { createElement } from 'react'

import { createDialogs, DIALOG_CSS } from './dialogs.jsx'
import { createDrawer } from './drawer/drawer.jsx'
import { createFooter, createReceiptRow, flushEditing, FOOTER_CSS } from './footer.jsx'
import { createMarker, MARKER_CSS } from './marker.jsx'
import { bindSending, createSending } from './sending.js'
import { reportSdk } from './sdk-check.js'
import { createSettingsPage, SETTINGS_CSS } from './settings-page.jsx'
import { STRIP_CSS } from './strip/styles.js'
import { createTitles } from './titles.js'
import { UI_CSS } from './ui.jsx'
import { rowHasBatch, sessionHistory } from '../shared/history.js'
import { createLive } from '../shared/live.js'
import { SendRequest } from '@diple/core'

export const SEND_DEFAULTS = ['mod+shift+enter']
// Optional SDK exports, looked up by name (older hosts lack them).
const sdkExport = (name) => SDK[name]
const UNDERSIDE = COMPOSER_AREAS.underside ?? 'composer.underside'
const COMPOSER_INPUT = '[data-slot="composer-rich-input"]'

export function installSend(ctx, deps) {
  const { lists, services, i18n, notify, settings, session } = deps

  const style = document.createElement('style')
  style.setAttribute('data-diple-style', 'send')
  style.textContent = UI_CSS + MARKER_CSS + FOOTER_CSS + DIALOG_CSS + SETTINGS_CSS + STRIP_CSS
  document.head.appendChild(style)
  ctx.onDispose(() => style.remove())

  // SDK self-check (design §2.10c): a missing export is said once, then the plugin degrades.
  reportSdk({ sdk: SDK, storage: ctx.storage, notify, t: i18n.t })

  let live = deps.live
  if (!live) {
    live = createLive()
    ctx.onDispose(live.dispose)
  }
  const env = {
    submit: (key, text) => Boolean(host.composer?.submit?.(key, text)),
    getDraft: async (key) => (host.composer?.getDraft ? host.composer.getDraft(key) : null),
    setDraft: async (key, text) => (host.composer?.setDraft ? host.composer.setDraft(key, text) : false),
    isBusy: live.isBusy,
    probeBusy: live.probeBusy,
    contextMax: live.contextMax,
    storedIdFor: live.storedIdFor,
    findUserRow: async (key, batchId, rowId) => {
      let rows
      try {
        rows = await sessionHistory(host, key)
      } catch {
        return null
      }
      const users = rows.filter((r) => r?.role === 'user')
      if (rowId != null) {
        const row = users.find((r) => String(r.row_id) === String(rowId))
        return row ? rowHasBatch(row, batchId) : null
      }
      return users.some((r) => rowHasBatch(r, batchId))
    },
    storage: ctx.storage,
    now: () => Date.now(),
    setTimeout: (fn, ms) => {
      const t = setTimeout(fn, ms)
      t?.unref?.() // never keeps a test process alive; no-op in the renderer
      return t
    },
    clearTimeout: (t) => clearTimeout(t),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms))
  }
  const REVEAL_SETTLE_MS = 1500
  // the send module (sending.js): the UI below gets only its role interface
  const sending = createSending(deps, env, {
    reveal: async (key) => {
      await host.openSession?.(key)
      await new Promise((r) => setTimeout(r, REVEAL_SETTLE_MS))
    }
  })
  const dialogs = createDialogs()
  const drawer = createDrawer()
  const titles = createTitles(() => host)
  /** Preview what this send would carry: the session's composer text too (XE-09). */
  const openPreview = async (key) => {
    let body = ''
    try {
      body = (await env.getDraft(key)) ?? ''
    } catch {
      body = ''
    }
    dialogs.openPreview(key, body)
  }

  const failNotice = (r) =>
    r && !r.ok && notify({ kind: r.reason === 'disabled' || r.reason === 'empty' ? 'warning' : 'error', title: i18n.t('send.failed'), message: i18n.t('send.reason.' + r.reason) })

  /** A send into a session that is not the focused one asks first, naming
   *  it (design §2.10b). Only a gate in front of the one flow. */
  //  The rule is core SendRequest's (V2.1 #8, shared with Diple Docs' menu): a
  //  target nobody picked (every chat entry: the target is the list's session)
  //  asks when it is not the focused session.
  const confirmTarget = async (key) => {
    const focused = session.currentKey()
    const req = SendRequest.plan({ scope: { kind: 'unsent' }, target: { kind: 'session', sessionId: key }, items: [{ id: 'list', unsent: true }], focusedSessionId: focused ?? key, explicit: false })
    if (!req.ok || !req.confirm) return true
    const title = String((await titles.titleNow(key)) ?? '').replace(/\s+/g, ' ').trim()
    const cs = Array.from(title)
    return dialogs.confirmTarget(key, cs.length > 32 ? `${cs.slice(0, 31).join('')}…` : title)
  }

  /** Every user-initiated send: strip button, ⌘↩ in the strip, the editor's ⌘⏎, keybind, palette. */
  const sendFromUi = async (key) => {
    if (!flushEditing(services)) return { ok: false, reason: 'editing' }
    if (!(await confirmTarget(key))) return { ok: false, reason: 'cancelled' }
    const r = await sending.request(key, { bodySource: 'draft' })
    failNotice(r)
    return r
  }

  const sendNow = async (key) => {
    const target = key ?? session.currentKey() // read now, not after an await
    if (!flushEditing(services)) return { ok: false, reason: 'editing' }
    const r = await sending.request(target, { bodySource: 'draft' })
    if (!r.ok) {
      failNotice(r)
      return r
    }
    return r.done ? r.done : { ok: true, queued: Boolean(r.queued) }
  }

  ctx.onDispose(services.provide('send', 'ListFooter', createFooter({ deps, sending, live, dialogs, sendFromUi, openPreview, drawer, titles })))
  ctx.onDispose(services.provide('send', 'sendNow', sendNow))

  // ⌘⏎ in the editor beside the original (V2-T) → the one send flow, for the
  // list holding the item being edited (R8 XV-03): the key the editor fixed at
  // the key press, else the list of the item open at that moment (recorded
  // when it opened), and the focused session only with no editor at all.
  const uiBus = deps.uiBus
  let editing = null // { itemId, key } of the open editor
  if (uiBus) {
    const listOf = (itemId) => (itemId ? [...lists.keys()].find((k) => lists.get(k).items.some((it) => it.id === itemId)) : null)
    ctx.onDispose(
      uiBus.onEditor((e, open) => {
        const ev = e && typeof e === 'object' ? e : { itemId: e, open }
        if (ev.open) editing = { itemId: ev.itemId, key: listOf(ev.itemId) }
        else if (editing?.itemId === ev.itemId) editing = null
      })
    )
    ctx.onDispose(
      uiBus.onSendNow((req) => {
        if (!settings.get().enabled) return failNotice({ ok: false, reason: 'disabled' })
        const key = req?.key ?? (editing ? listOf(editing.itemId) ?? editing.key : null) ?? session.currentKey()
        if (!key) return failNotice({ ok: false, reason: 'no-session' })
        void sendFromUi(key)
      })
    )
  }

  // -- events: the host seam of the send module ---------------------------------------
  let steerNoted = false
  const bound = bindSending(ctx, sending, {
    live,
    session,
    gateway: host.state?.gateway,
    beforeEvent: (e) => {
      if (e?.type === 'message.complete') steerNoted = false
    }
  })

  // A steer never carries annotations (ADR 0006): say so when the user steers
  // with a non-empty list. Observes only; never prevents the key.
  const onKeyDown = (e) => {
    if (steerNoted || e.key !== 'Enter' || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return
    if (e.isComposing || e.keyCode === 229 || !settings.get().enabled) return
    const input = e.target?.closest?.(COMPOSER_INPUT)
    if (!input || !(input.textContent ?? '').trim()) return
    const key = session.currentKey()
    if (!key || !live.isBusy(key) || !lists.get(key).items.length) return
    steerNoted = true
    notify({ kind: 'info', title: i18n.t('send.steered') })
  }
  document.addEventListener('keydown', onKeyDown, true)
  ctx.onDispose(() => document.removeEventListener('keydown', onKeyDown, true))

  // -- contributions ----------------------------------------------------------------
  const AnnMarker = createMarker({ deps, batches: deps.batches })
  const ReceiptRow = createReceiptRow({ deps, sending, dialogs, drawer, titles })
  ctx.register({
    id: 'ann',
    area: TRANSCRIPT_DIRECTIVE_AREA,
    data: { name: 'ann', render: ({ attrs, source }) => createElement(AnnMarker, { attrs, source }) }
  })
  // The main send button: an open editor's draft goes into its list first (R8 XV-02).
  ctx.register({ id: 'send-middleware', area: COMPOSER_AREAS.middleware, order: 50, data: { handler: (draft) => (flushEditing(services), bound.middleware(draft)) } })
  ctx.register({ id: 'receipt', area: UNDERSIDE, order: 10, render: () => createElement(ReceiptRow) })

  const openSettings = () => {
    const hrefFor = sdkExport('pluginSettingsHref')
    const href = typeof hrefFor === 'function' ? hrefFor('diple') : '/settings?tab=plugins&plugin=diple'
    host.navigate?.(href)
  }
  const openKeybinds = () => {
    const r = ctx.runAction?.('keybinds.openPanel')
    if (!r || r.ok === false) host.navigate?.('/settings?tab=keybinds')
  }
  const sendCommand = () => {
    if (!settings.get().enabled) return failNotice({ ok: false, reason: 'disabled' })
    const key = session.currentKey()
    if (!key) return failNotice({ ok: false, reason: 'no-session' })
    void sendFromUi(key)
  }
  const drawerCommand = () => {
    const key = session.currentKey()
    if (!key) return failNotice({ ok: false, reason: 'no-session' })
    drawer.open(key)
  }
  const previewCommand = () => {
    const key = session.currentKey()
    if (!key) return failNotice({ ok: false, reason: 'no-session' })
    if (!lists.get(key).items.length) return failNotice({ ok: false, reason: 'empty' })
    void openPreview(key)
  }

  // Labels are read at registration: re-register on a language change.
  const SettingsPage = createSettingsPage({ deps, openKeybinds, sendDefaults: SEND_DEFAULTS })
  let disposeLabels = []
  const registerLabelled = () => {
    disposeLabels.forEach((d) => d?.())
    const t = i18n.t
    disposeLabels = [
      ctx.register({
        id: 'send-key',
        area: KEYBINDS_AREA,
        data: { id: 'diple.send', label: t('send.command.send'), category: t('send.command.category'), defaults: SEND_DEFAULTS, run: () => void sendCommand() }
      }),
      ctx.register({
        id: 'send-palette',
        area: PALETTE_AREA,
        data: { id: 'diple.send', label: t('send.command.send'), keywords: ['diple', 'send', 'pending', 'quanpi', 'fasong'], run: () => void sendCommand() }
      }),
      ctx.register({
        id: 'preview-palette',
        area: PALETTE_AREA,
        data: { id: 'diple.preview', label: t('send.command.preview'), keywords: ['diple', 'preview', 'yulan'], run: () => void previewCommand() }
      }),
      ctx.register({
        id: 'drawer-palette',
        area: PALETTE_AREA,
        data: { id: 'diple.drawer', label: t('send.command.drawer'), keywords: ['diple', 'annotations', 'history', 'biaozhu', 'jilu'], run: () => drawerCommand() }
      }),
      ctx.register({
        id: 'settings-palette',
        area: PALETTE_AREA,
        data: { id: 'diple.settings', label: t('send.command.settings'), keywords: ['diple', 'settings', 'shezhi'], run: () => openSettings() }
      }),
      registerSettingsPage(ctx, { id: 'settings', title: t('send.settings.title'), icon: 'quote', render: () => createElement(SettingsPage) })
    ]
  }
  registerLabelled()
  let lastLang = i18n.locale()
  const relabel = () => {
    const l = i18n.locale()
    if (l === lastLang) return
    lastLang = l
    registerLabelled()
  }
  const offLocale = i18n.onLocaleChange?.(relabel)
  if (typeof offLocale === 'function') ctx.onDispose(offLocale)
  ctx.onDispose(settings.subscribe(relabel))
  ctx.onDispose(() => disposeLabels.forEach((d) => d?.()))

  void bound.resume()
  return { sending, dialogs, drawer }
}

function registerSettingsPage(ctx, page) {
  if (typeof ctx.registerSettingsPage === 'function') return ctx.registerSettingsPage(page)
  const area = typeof sdkExport('SETTINGS_PLUGINS_AREA') === 'string' ? sdkExport('SETTINGS_PLUGINS_AREA') : 'settings.plugins'
  return ctx.register({ id: page.id, area, title: page.title, render: page.render, data: { icon: page.icon } })
}
