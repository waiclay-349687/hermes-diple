// The host's UI primitives, with plain fallbacks for older hosts (and the jsdom
// SDK stub). Looked up by name at call time: a NAMED import of a missing export
// would fail the whole module load on an older host.

import * as SDK from '@hermes/plugin-sdk'
import { cloneElement, isValidElement, useEffect, useRef } from 'react'

const pick = (name) => {
  const v = SDK[name]
  return typeof v === 'function' || (v && typeof v === 'object') ? v : null
}

export function Btn({ variant = 'secondary', size = 'xs', className = '', children, ...props }) {
  const Button = pick('Button')
  if (Button) {
    return (
      <Button variant={variant} size={size} className={className} {...props}>
        {children}
      </Button>
    )
  }
  return (
    <button type="button" className={`diple-btn diple-btn-${variant} ${className}`} {...props}>
      {children}
    </button>
  )
}

/** Hover hint. `text` is a plain-string twin for the fallback `title`. */
export function Hint({ label, text, children }) {
  const Tip = pick('Tip')
  if (Tip && label) return <Tip label={label}>{children}</Tip>
  const title = text ?? (typeof label === 'string' ? label : undefined)
  return isValidElement(children) ? cloneElement(children, { title }) : <span title={title}>{children}</span>
}

function FallbackDialog({ open, onClose, title, children }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement
    ref.current?.focus()
    return () => prev?.focus?.()
  }, [open])
  if (!open) return null
  return (
    <div className="diple-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="diple-modal"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
      >
        <div className="diple-modal-title">{title}</div>
        {children}
      </div>
    </div>
  )
}

export function Modal({ open, onClose, title, description, children }) {
  const Dialog = pick('Dialog')
  const DialogContent = pick('DialogContent')
  const DialogHeader = pick('DialogHeader')
  const DialogTitle = pick('DialogTitle')
  const DialogDescription = pick('DialogDescription')
  if (Dialog && DialogContent && DialogTitle) {
    const Header = DialogHeader ?? 'div'
    return (
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="diple-dialog" data-diple-dialog="">
          <Header>
            <DialogTitle>{title}</DialogTitle>
            {description && DialogDescription ? <DialogDescription>{description}</DialogDescription> : null}
          </Header>
          {children}
        </DialogContent>
      </Dialog>
    )
  }
  return (
    <FallbackDialog open={open} onClose={onClose} title={title}>
      <div data-diple-dialog="">
        {description ? <div className="diple-modal-desc">{description}</div> : null}
        {children}
      </div>
    </FallbackDialog>
  )
}

export function Toggle({ label, description, checked, onChange, disabled, id }) {
  const ToggleRow = pick('ToggleRow')
  if (ToggleRow) return <ToggleRow id={id} label={label} description={description} checked={checked} disabled={disabled} onChange={onChange} />
  return (
    <label className="diple-setting-row" data-diple-setting={id}>
      <span className="diple-setting-text">
        <span className="diple-setting-title">{label}</span>
        {description ? <span className="diple-setting-desc">{description}</span> : null}
      </span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

export function Row({ title, description, action, id }) {
  const ListRow = pick('ListRow')
  if (ListRow) return <ListRow id={id} title={title} description={description} action={action} />
  return (
    <div className="diple-setting-row" data-diple-setting={id}>
      <span className="diple-setting-text">
        <span className="diple-setting-title">{title}</span>
        {description ? <span className="diple-setting-desc">{description}</span> : null}
      </span>
      {action}
    </div>
  )
}

export function Segmented({ value, options, onChange }) {
  const SegmentedControl = pick('SegmentedControl')
  if (SegmentedControl) return <SegmentedControl value={value} options={options} onChange={onChange} sizing="content" />
  return (
    <div className="diple-segmented" role="group">
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Markdown through the host's chat renderer (MessageTextContent), else
 *  Streamdown, else plain text (design §2.8). What the AI receives stays the
 *  source Markdown; this is display only. */
export function Markdown({ text }) {
  const MTC = pick('MessageTextContent')
  if (MTC) return <MTC media={false} text={text ?? ''} />
  const Streamdown = pick('Streamdown')
  if (Streamdown) return <Streamdown>{text ?? ''}</Streamdown>
  return <div className="diple-md-plain">{text ?? ''}</div>
}

export const UI_CSS = `
.diple-btn{font:inherit;font-size:11.5px;line-height:16px;padding:2px 8px;border-radius:0;border:0;cursor:pointer;background:var(--ui-bg-quaternary);color:var(--ui-text-primary);transition:background-color 100ms ease-out,color 100ms ease-out}
.diple-btn:hover{background:var(--chrome-action-hover,var(--ui-bg-tertiary));transition:none}
.diple-btn:disabled{opacity:.5;cursor:default}
.diple-btn-default{background:var(--ui-accent);color:var(--ui-bg-primary,var(--background))}
.diple-btn-ghost,.diple-btn-text{background:transparent;color:var(--ui-text-secondary)}
.diple-modal-backdrop{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--ui-bg-primary,var(--background)) 55%,transparent)}
.diple-modal{max-width:min(760px,92vw);max-height:84vh;overflow:auto;padding:14px 16px;border-radius:var(--radius-xl,3px);border:1px solid var(--stroke-nous,var(--ui-stroke-secondary));box-shadow:var(--shadow-nous,none);background:var(--ui-bg-elevated,var(--ui-bg-secondary));color:var(--ui-text-primary);outline:none}
.diple-modal-title{font-weight:600;margin-bottom:8px}
.diple-modal-desc{color:var(--ui-text-secondary);margin-bottom:6px}
.diple-setting-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0}
/* the host switch (ToggleRow) does not mirror its thumb in RTL; keep the switch itself LTR (V2.1 overflow, ar) */
[data-diple-settings] [role="switch"]{direction:ltr}
.diple-setting-text{display:flex;flex-direction:column;gap:2px}
.diple-setting-desc{color:var(--ui-text-secondary);font-size:12px}
.diple-segmented{display:inline-flex;gap:2px;padding:2px;border-radius:var(--radius-md,2px);background:var(--ui-bg-tertiary)}
.diple-segmented button{font:inherit;font-size:11px;border:0;border-radius:var(--radius-sm,2px);padding:1px 10px;background:transparent;color:var(--ui-text-secondary);cursor:pointer}
.diple-segmented button[aria-pressed="true"]{background:var(--ui-bg-primary,var(--background));color:var(--ui-text-primary)}
.diple-md-plain{white-space:pre-wrap}
`

/** A dropdown for a setting with many options (the language): the host's
 *  Select (Radix) when present, else a native <select>. options: [{ id, label, dir? }] */
export function Choice({ value, options, onChange, label, id }) {
  const { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } = SDK
  if ([Select, SelectTrigger, SelectValue, SelectContent, SelectItem].every((c) => typeof c === 'function' || (c && typeof c === 'object'))) {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label} id={id} className="diple-choice" data-diple-choice="">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id} dir={o.dir} lang={o.lang}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
  return (
    <select id={id} className="diple-choice diple-choice-native" data-diple-choice="" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.id} value={o.id} dir={o.dir} lang={o.lang}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
