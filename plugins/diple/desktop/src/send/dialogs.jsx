// "What the AI will receive" (before sending) and "What the AI received"
// (after): one dialog, two sources. Only ONE mounted host renders it — composer
// slots mount once per visible composer (split tiles), and a dialog per tile
// would stack.
//
//   const dialogs = createDialogs()
//   dialogs.openPreview(key) / dialogs.openReceived(key, batchId) / dialogs.close()
//   dialogs.confirmTarget(key, title) → Promise<boolean>   (V2-C, design §2.10b)
//       "send to another session?" before a send from a strip whose session
//       is not the focused one; false when dismissed or when no host is mounted
//   <DialogHost deps flow dialogs />   (render in every slot; only the first one paints)

import { useEffect, useState, useSyncExternalStore } from 'react'
import { Envelope } from '@diple/core'

import * as SDK from '@hermes/plugin-sdk'

import { Btn, Modal } from './ui.jsx'

export function createDialogs() {
  let value = null
  let owner = null
  const listeners = new Set()
  const emit = () => [...listeners].forEach((fn) => fn())
  const set = (v) => {
    value = v
    emit()
  }
  return {
    get: () => value,
    subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    openPreview: (key, body = '') => set({ kind: 'preview', key, body }),
    openReceived: (key, batchId) => set({ kind: 'received', key, batchId }),
    close() {
      value?.resolve?.(false)
      set(null)
    },
    confirmTarget(key, title) {
      if (owner === null) return Promise.resolve(false)
      value?.resolve?.(false)
      return new Promise((resolve) => set({ kind: 'confirm', key, title, resolve }))
    },
    answer(ok) {
      const v = value
      set(null)
      v?.resolve?.(Boolean(ok))
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
    },
    owner: () => owner,
    hasHost: () => owner !== null
  }
}

function TextBlock({ title, text }) {
  return (
    <section className="diple-dialog-section">
      <div className="diple-dialog-label">{title}</div>
      <pre className="diple-dialog-pre">{text}</pre>
    </section>
  )
}

function PreviewBody({ deps, sending, open, t }) {
  const state = deps.lists.useList(open.key)
  const p = state.items.length ? sending.preview(open.key, open.body) : null
  if (!p) return <div className="diple-dialog-empty">{t('send.reason.empty')}</div>
  const stats = p.size.pct == null ? t('send.dialogStats', p.stats.chars, p.stats.tokens) : t('send.dialogStatsPct', p.stats.chars, p.stats.tokens, p.size.pct)
  return (
    <div className="diple-dialog-body" data-diple-preview="">
      <div className={`diple-dialog-stats diple-size-${p.size.level}`}>{stats}</div>
      <TextBlock title={t('send.dialogDisplay')} text={p.display} />
      <TextBlock title={t('send.dialogFull')} text={p.full} />
    </div>
  )
}

function ReceivedBody({ deps, open, t }) {
  const [res, setRes] = useState({ loading: true })
  useEffect(() => {
    let live = true
    setRes({ loading: true })
    deps.api
      .getBatch(open.batchId)
      .then((b) => live && setRes({ batch: b }))
      .catch(() => live && setRes({ error: true }))
    return () => {
      live = false
    }
  }, [open.batchId])
  if (res.loading) return <div className="diple-dialog-empty">{t('send.dialogLoading')}</div>
  if (res.error || !res.batch) return <div className="diple-dialog-empty">{t('send.dialogLoadFailed')}</div>
  const b = res.batch
  const delivered = b.status === 'expanded' || b.status === 'answered'
  return (
    <div className="diple-dialog-body" data-diple-received={b.batchId}>
      {!delivered ? <div className="diple-dialog-stats diple-size-soft">{t('send.dialogNotDelivered')}</div> : null}
      <div className="diple-dialog-stats">{t('send.dialogStats', Array.from(b.full ?? '').length, Envelope.estimateTokens(b.full ?? ''))}</div>
      {b.display ? <TextBlock title={t('send.dialogDisplay')} text={b.display} /> : null}
      <TextBlock title={t('send.dialogFull')} text={b.full ?? ''} />
    </div>
  )
}

function ConfirmTarget({ open, dialogs, t }) {
  const title = open.title || t('capture.otherSession')
  const Confirm = typeof SDK.ConfirmDialog === 'function' || (SDK.ConfirmDialog && typeof SDK.ConfirmDialog === 'object') ? SDK.ConfirmDialog : null
  // focus on OK without scrolling anything (not autoFocus: R11-L). Once the box is in
  // the page (a host dialog may portal it a render later), in an effect, which runs
  // after the dialog's own initial focus: OK keeps the focus.
  const [box, setBox] = useState(null)
  useEffect(() => {
    box?.querySelector('[data-diple-confirm-ok]')?.focus({ preventScroll: true })
  }, [box])
  if (Confirm) {
    return (
      <Confirm
        open
        onClose={() => dialogs.answer(false)}
        onConfirm={() => dialogs.answer(true)}
        dismissOnConfirm
        title={t('send.cross.title')}
        description={t('send.cross.body', title)}
        confirmLabel={t('send.cross.confirm')}
        cancelLabel={t('send.cross.cancel')}
      />
    )
  }
  return (
    <Modal open onClose={() => dialogs.answer(false)} title={t('send.cross.title')}>
      <div ref={setBox} className="diple-confirm" data-diple-confirm-target={open.key}>
        <p className="diple-confirm-body">{t('send.cross.body', title)}</p>
        <div className="diple-confirm-actions">
          <Btn variant="ghost" data-diple-confirm-cancel="" onClick={() => dialogs.answer(false)}>
            {t('send.cross.cancel')}
          </Btn>
          <Btn variant="default" data-diple-confirm-ok="" onClick={() => dialogs.answer(true)}>
            {t('send.cross.confirm')}
          </Btn>
        </div>
      </div>
    </Modal>
  )
}

export function DialogHost({ deps, sending, dialogs }) {
  const t = deps.i18n.useT()
  const [token] = useState(() => ({}))
  useEffect(() => {
    dialogs.claim(token)
    return () => dialogs.release(token)
  }, [])
  const owner = useSyncExternalStore(dialogs.subscribe, dialogs.owner)
  const open = useSyncExternalStore(dialogs.subscribe, dialogs.get)
  if (owner !== token || !open) return null
  if (open.kind === 'confirm') return <ConfirmTarget open={open} dialogs={dialogs} t={t} />
  const title = open.kind === 'preview' ? t('send.dialogPreviewTitle') : t('send.dialogReceivedTitle')
  return (
    <Modal open onClose={dialogs.close} title={title}>
      {open.kind === 'preview' ? <PreviewBody deps={deps} sending={sending} open={open} t={t} /> : <ReceivedBody deps={deps} open={open} t={t} />}
    </Modal>
  )
}

export const DIALOG_CSS = `
.diple-dialog{max-width:min(820px,92vw)}
.diple-confirm{display:flex;flex-direction:column;gap:12px;max-width:420px}
.diple-confirm-body{margin:0;color:var(--ui-text-secondary);line-height:1.5}
.diple-confirm-actions{display:flex;justify-content:flex-end;gap:6px}
.diple-dialog-body{display:flex;flex-direction:column;gap:10px;max-height:70vh;overflow:auto}
.diple-dialog-section{display:flex;flex-direction:column;gap:4px}
.diple-dialog-label{font-size:11.5px;font-weight:600;color:var(--ui-text-secondary)}
.diple-dialog-pre{margin:0;padding:8px 10px;border-radius:var(--radius-md,2px);background:var(--ui-bg-tertiary);color:var(--ui-text-primary);font:12px/1.5 var(--font-mono,ui-monospace,monospace);white-space:pre-wrap;word-break:break-word}
.diple-dialog-stats{font-size:11.5px;color:var(--ui-text-secondary)}
.diple-dialog-empty{color:var(--ui-text-secondary);padding:8px 0}
`
