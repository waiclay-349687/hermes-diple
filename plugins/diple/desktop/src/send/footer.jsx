// ListFooter (service: the meta row of the composer strip — summary, status,
// preview / clear / this session's annotations / send) and the receipt row
// under the composer. W2b; V2-C restyled it as the strip's second row.

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { CopyText, Envelope, PendingList, SendSize } from '@diple/core'
import { SendMenu } from '@diple/desktop-kit'

import { resolveSurfaceKey, surfaceOf } from '../capture/surfaces.js'
import { DialogHost } from './dialogs.jsx'
import { DrawerHost } from './drawer/drawer.jsx'
import { useSending } from './sending.js'
import { originLabel } from './strip/text.js'
import { Btn, Hint } from './ui.jsx'

/** ⌘/Ctrl+Enter, not while an IME is composing. */
export function isSendChord(e) {
  if (e.key !== 'Enter' || e.shiftKey || e.altKey) return false
  if (e.isComposing || e.keyCode === 229) return false
  return Boolean(e.metaKey || e.ctrlKey)
}

/** Before any send (R8 XV-02): what the user is still typing goes into its
 *  list first — the editor beside the text (capture's commitEditor) and any
 *  field in the strip (saves on blur). → false when the editor's list refused
 *  the save: the draft stays open and the send must not go ahead. */
export function flushEditing(services = null, root = document) {
  const el = root.activeElement
  if (el && el.closest?.('[data-diple-list]') && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) el.blur()
  const r = services?.get?.('commitEditor')?.()
  return r?.ok !== false
}

export function createFooter({ deps, sending: sendModule, live, dialogs, sendFromUi, openPreview = (key) => dialogs.openPreview(key), drawer = null, titles = null }) {
  const { lists, i18n } = deps

  /** "Copy for AI" (V2.1 #8): the list as one Markdown prompt, the pin card's block per annotation. */
  const copyForAgent = (key, items, t) => {
    const md = CopyText.forAgent({
      title: t('send.drawer.mdTitle', items.length),
      entries: items.map((it) => ({ label: originLabel(it.origin, key, t, titles?.titleOf), text: it.text, comment: it.comment }))
    })
    globalThis.navigator?.clipboard?.writeText?.(md)?.then?.(
      () => deps.notifyOverStrip({ kind: 'success', title: t('send.copiedForAgent', items.length) }),
      () => {}
    )
  }

  // The strip's send (V2.1 #8, after Orca): "Send N" and a small chevron menu
  // with "Send now" (the same send as the button and the send keybind) and
  // "Copy for AI". The target is this session.
  function SendSplit({ sessionKey, count, items, onSend, disabled, t }) {
    const [open, setOpen] = useState(false)
    const toggle = useRef(null)
    // back to the toggle only after Esc, a pick or Tab; a click outside (the composer) keeps its focus
    const close = (reason) => {
      setOpen(false)
      if (reason === 'escape' || reason === 'select' || reason === 'tab') toggle.current?.focus({ preventScroll: true })
    }
    return (
      <span className="diple-send-split">
        <Btn variant="default" data-diple-send="" onClick={onSend} disabled={disabled}>
          {t('send.sendCount', count)}
        </Btn>
        <button
          ref={toggle}
          type="button"
          className="diple-send-more"
          data-diple-send-menu-toggle=""
          data-send-menu-trigger=""
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t('send.sendOptions')}
          onClick={() => setOpen((v) => !v)}
        >
          <i className="codicon codicon-chevron-down" aria-hidden="true" />
        </button>
        {open ? (
          <SendMenu
            label={t('send.sendOptions')}
            attrs={{ 'data-diple-send-menu': '', 'data-diple-ui': '' }}
            onClose={close}
            sections={[
              {
                key: 'act',
                items: [
                  { key: 'send', label: t('send.sendDirect'), default: true, disabled, onSelect: () => void onSend() },
                  { key: 'copy', label: t('send.copyForAgent'), disabled: !items.length, onSelect: () => copyForAgent(sessionKey, items, t) }
                ]
              }
            ]}
          />
        ) : null}
      </span>
    )
  }

  function Info({ kind, children }) {
    return (
      <span className={`diple-footer-info diple-footer-${kind}`} role={kind === 'error' ? 'alert' : undefined}>
        {children}
      </span>
    )
  }

  // shown: the annotations the strip shows (V2.1 #2: not a never-saved one) —
  // what the summary counts; the send still takes the whole list
  return function ListFooter({ sessionKey, shown = null, status: extra = null, canClear = false, onClear = null }) {
    const t = i18n.useT()
    const state = lists.useList(sessionKey)
    const busy = live.useBusy(sessionKey)
    const contextMax = live.useContextMax(sessionKey)
    const { queued, status } = useSending(sendModule, sessionKey)
    const [pending, setPending] = useState(false)
    const ref = useRef(null)

    const send = async () => {
      if (pending) return
      setPending(true)
      try {
        await sendFromUi(sessionKey)
      } finally {
        setPending(false)
      }
    }
    const sendRef = useRef(send)
    sendRef.current = send

    // ⌘↩ while focus is anywhere inside the list (the composer's own ⌘↩ is
    // the host's "queue" and stays untouched).
    useEffect(() => {
      const root = ref.current?.closest('[data-diple-list]') ?? ref.current?.parentElement
      if (!root) return
      const onKey = (e) => {
        if (!isSendChord(e) || e.defaultPrevented) return
        e.preventDefault()
        e.stopPropagation()
        void sendRef.current()
      }
      root.addEventListener('keydown', onKey)
      return () => root.removeEventListener('keydown', onKey)
    }, [])

    const sending = Boolean(PendingList.summary(state).sending)
    let sz = { level: 'ok' }
    if (state.items.length) {
      const { stats } = Envelope.compose({ body: '', items: state.items, batchId: 'preview', lang: i18n.lang(), sessionId: sessionKey })
      sz = SendSize.level(stats.tokens, contextMax)
    }

    let info = null
    let actions
    if (sending) {
      const delivered = status?.phase === 'delivered'
      info = <Info kind="muted">{delivered ? t('send.delivered') : t('send.sending')}</Info>
      actions = (
        <Btn variant="default" disabled data-diple-send="">
          {t('send.sending')}
        </Btn>
      )
    } else if (queued) {
      const idleStuck = !busy && (queued.stalled || queued.waiting)
      info = <Info kind="muted">{queued.waiting ? t('send.queueWaiting') : queued.stalled ? t('send.queuedStalled') : t('send.queued')}</Info>
      actions = (
        <>
          <Btn variant="ghost" data-diple-queue-cancel="" onClick={async () => (await sendModule.resolve(sessionKey, { type: 'cancel-queue' })).ok && deps.notifyOverStrip({ kind: 'info', title: t('send.queueCancelled') })}>
            {t('send.cancelQueue')}
          </Btn>
          {idleStuck ? (
            <Btn variant="default" data-diple-send="" onClick={send} disabled={pending}>
              {t('send.sendQueuedNow')}
            </Btn>
          ) : null}
        </>
      )
    } else if (busy) {
      info = <Info kind="muted">{t('send.steerHint')}</Info>
      actions = (
        <Btn variant="default" data-diple-send="" data-diple-send-after="" onClick={send} disabled={pending || sz.level === 'hard'}>
          {t('send.sendAfterReply')}
        </Btn>
      )
    } else {
      const count = (shown ?? state.items).length
      actions = pending ? (
        <Btn variant="default" disabled data-diple-send="">
          {t('send.sending')}
        </Btn>
      ) : (
        <SendSplit sessionKey={sessionKey} count={count} items={state.items} onSend={send} disabled={sz.level === 'hard'} t={t} />
      )
    }
    if (!sending && sz.level === 'hard') info = <Info kind="error">{t('send.sizeHard', sz.tokens, sz.pct)}</Info>
    else if (!sending && !queued && sz.level === 'soft') info = <Info kind="warn">{t('send.sizeSoft', sz.tokens, sz.pct)}</Info>

    const s = PendingList.summary(shown ? { ...state, items: shown } : state)
    return (
      <div ref={ref} className="diple-list-footer" data-diple-footer="">
        <div className="diple-footer-left">
          {/* the summary yields first in a narrow chat: it wraps under a 0-width
              strut into a clipped second line, so it hides whole, never cut (V3-D2-I) */}
          <span className="diple-strip-fit">
            <span className="diple-strip-summary">{t('send.strip.summary', s.total, s.comments)}</span>
          </span>
          {extra}
          {info}
        </div>
        <div className="diple-footer-actions">
          {drawer ? (
            <Hint label={t('send.drawer.title')}>
              <Btn variant="ghost" data-diple-drawer-open="" onClick={() => drawer.open(sessionKey)}>
                {t('send.drawer.open')}
              </Btn>
            </Hint>
          ) : null}
          {onClear && canClear && !sending ? (
            <Btn variant="ghost" className="diple-clear" onClick={onClear}>
              {t('capture.clearAll')}
            </Btn>
          ) : null}
          <Hint label={t('send.preview')}>
            <Btn variant="ghost" data-diple-preview-open="" onClick={() => void openPreview(sessionKey)} disabled={!state.items.length}>
              {t('send.previewShort')}
            </Btn>
          </Hint>
          {actions}
        </div>
      </div>
    )
  }
}

/** The session of the chat surface a slot sits in (each split tile has its own
 *  composer); undefined outside any surface → the focused session (XE-16). */
function useSurfaceKey(node, session) {
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

/** The row under the composer: receipt of the last send + missing-answer notices. */
export function createReceiptRow({ deps, sending, dialogs, drawer = null, titles = null }) {
  const { session, i18n } = deps

  function NoticeLine({ sessionKey, notice, t }) {
    const [busy, setBusy] = useState(false)
    const putBack = async (numbers) => {
      setBusy(true)
      try {
        const { count: n } = await sending.resolve(sessionKey, { type: 'put-back-notice', batchId: notice.batchId, numbers })
        deps.notifyOverStrip({ kind: 'success', title: t('send.putBackDone', n) })
      } finally {
        setBusy(false)
      }
    }
    const dismiss = (
      <Btn variant="ghost" size="xs" aria-label={t('send.dismiss')} title={t('send.dismiss')} data-diple-notice-dismiss="" onClick={() => void sending.resolve(sessionKey, { type: 'dismiss-notice', batchId: notice.batchId })}>
        ×
      </Btn>
    )
    if (notice.kind === 'none') {
      return (
        <div className="diple-notice" data-diple-notice="none" data-batch={notice.batchId} role="status">
          <span>{t('send.noMarkers')}</span>
          <span className="diple-sep">·</span>
          <Btn variant="ghost" size="xs" disabled={busy} data-diple-put-back="" onClick={() => putBack(notice.numbers)}>
            {t('send.putBack')}
          </Btn>
          {dismiss}
        </div>
      )
    }
    return (
      <div className="diple-notice" data-diple-notice="missing" data-batch={notice.batchId} role="status">
        {notice.numbers.map((n) => (
          <span key={n} className="diple-notice-item" data-n={n}>
            <span>{t('send.missing', Envelope.circled(n))}</span>
            <span className="diple-sep">·</span>
            <Btn variant="ghost" size="xs" disabled={busy} data-diple-put-back={n} onClick={() => putBack([n])}>
              {t('send.putBack')}
            </Btn>
          </span>
        ))}
        {dismiss}
      </div>
    )
  }

  return function ReceiptRow() {
    const t = i18n.useT()
    const settings = deps.settings.use()
    const [node, setNode] = useState(null)
    const focused = useSyncExternalStore(session.subscribe, session.currentKey)
    const own = useSurfaceKey(node, session)
    const key = own === undefined ? focused : own
    const { receipt, notices } = useSending(sending, key)
    // one 本会话 at a time: the strip's own while it has annotations, this one after it emptied
    const stripEmpty = deps.lists.useList(key || '__none__').items.length === 0
    const host = (
      <>
        <DialogHost deps={deps} sending={sending} dialogs={dialogs} />
        {drawer && titles ? <DrawerHost deps={deps} drawer={drawer} titles={titles} /> : null}
      </>
    )
    // A hidden probe finds this slot's own chat surface before anything shows.
    if (!settings.enabled || !node || !key || (!receipt && !notices?.length))
      return (
        <>
          <span ref={setNode} data-diple-under-probe="" hidden />
          {host}
        </>
      )
    return (
      <div ref={setNode} className="diple-under" data-diple-under="" data-session-key={key}>
        {receipt ? (
          <div className="diple-receipt" data-diple-receipt={receipt.batchId}>
            {receipt.delivered ? (
              <>
                <span>{t('send.receipt', receipt.count)}</span>
                <span className="diple-sep">·</span>
                <Btn variant="ghost" size="xs" data-diple-receipt-view="" onClick={() => dialogs.openReceived(key, receipt.batchId)}>
                  {t('send.receiptView')}
                </Btn>
                {drawer && stripEmpty ? (
                  // V2-X: after a send the strip is empty; the session's annotations stay one click away
                  <>
                    <span className="diple-sep">·</span>
                    <Btn variant="ghost" size="xs" data-diple-drawer-open="" onClick={() => drawer.open(key)}>
                      {t('send.drawer.open')}
                    </Btn>
                  </>
                ) : null}
              </>
            ) : receipt.unconfirmed ? (
              // R2 XE-01: the history could not say whether the turn carried it — the user decides
              <>
                <span>{t('send.receiptUnconfirmed', receipt.count)}</span>
                <span className="diple-sep">·</span>
                <Btn variant="ghost" size="xs" data-diple-unconfirmed-put-back="" onClick={() => void sending.resolve(key, { type: 'put-back-confirmation', batchId: receipt.batchId })}>
                  {t('send.putBack')}
                </Btn>
                <span className="diple-sep">·</span>
                <Btn variant="ghost" size="xs" data-diple-unconfirmed-keep="" onClick={() => void sending.resolve(key, { type: 'keep-confirmation', batchId: receipt.batchId })}>
                  {t('send.receiptKeep')}
                </Btn>
              </>
            ) : (
              <span>{t(receipt.confirming ? 'send.receiptConfirming' : 'send.receiptPending', receipt.count)}</span>
            )}
          </div>
        ) : null}
        {(notices ?? []).map((n) => (
          <NoticeLine key={n.batchId} sessionKey={key} notice={n} t={t} />
        ))}
        {host}
      </div>
    )
  }
}

export const FOOTER_CSS = `
.diple-list-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;padding-top:2px}
.diple-footer-left{flex:1;min-width:0}
.diple-footer-info{display:block;font-size:11.5px;line-height:1.4;color:var(--ui-text-secondary)}
.diple-footer-warn{color:var(--ui-yellow)}
.diple-footer-error{color:var(--ui-danger,var(--destructive))}
.diple-footer-actions{display:flex;align-items:center;gap:4px;flex-shrink:0}
.diple-under{display:flex;flex-direction:column;gap:2px;padding:2px 12px;font-size:11.5px;color:var(--ui-text-secondary)}
.diple-receipt,.diple-notice{display:flex;flex-wrap:wrap;align-items:center;gap:4px}
.diple-notice{color:var(--ui-text-primary)}
.diple-notice-item{display:inline-flex;align-items:center;gap:4px;margin-inline-end:6px}
.diple-sep{color:var(--ui-text-quaternary)}
`
