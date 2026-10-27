// SDK self-check at load (design §2.10c, after quote-selection's check).
//
//   checkSdk(sdk) → { missing: string[], degraded: string[] }
//       missing  — exports the plugin cannot work without (it degrades: the
//                  part that needs one is not registered)
//       degraded — optional exports with a plain fallback (Markdown previews
//                  become plain text, dialogs our own, …)
//   reportSdk({ sdk, storage, notify, t }) → { missing, degraded }
//       a missing export: one warning per distinct gap (remembered in
//       storage), naming the degraded ones too; degraded ones alone have a
//       working fallback and are only logged.

export const REQUIRED = ['COMPOSER_AREAS', 'KEYBINDS_AREA', 'PALETTE_AREA', 'TRANSCRIPT_DIRECTIVE_AREA', 'host', 'usePluginI18n']
// composer areas the plugin mounts into
const AREAS = ['top', 'middleware']
export const OPTIONAL = ['MessageTextContent', 'Streamdown', 'Button', 'Tip', 'Dialog', 'DialogContent', 'DialogTitle', 'ConfirmDialog', 'ToggleRow', 'ListRow', 'SegmentedControl', 'Kbd']

const present = (v) => v !== undefined && v !== null

export function checkSdk(sdk) {
  const s = sdk ?? {}
  const missing = []
  for (const k of REQUIRED) {
    if (!present(s[k])) missing.push(k)
    else if (k === 'COMPOSER_AREAS') for (const a of AREAS) if (!present(s[k][a])) missing.push(`${k}.${a}`)
  }
  const degraded = OPTIONAL.filter((k) => !present(s[k]))
  return { missing, degraded }
}

const SEEN_KEY = 'sdkcheck.seen'

export function reportSdk({ sdk, storage, notify, t }) {
  const r = checkSdk(sdk)
  if (!r.missing.length) {
    if (r.degraded.length) console.debug?.('[diple] SDK check: optional exports missing, using fallbacks:', r.degraded.join(', '))
    return r
  }
  const sig = `${r.missing.join(',')}|${r.degraded.join(',')}`
  if (storage?.get?.(SEEN_KEY, null) === sig) return r
  storage?.set?.(SEEN_KEY, sig)
  const parts = []
  if (r.missing.length) parts.push(t('send.sdk.missing', r.missing.join(', ')))
  if (r.degraded.length) parts.push(t('send.sdk.degraded', r.degraded.join(', ')))
  try {
    notify({ kind: 'warning', title: t('send.sdk.title'), message: parts.join(' ') })
  } catch {
    /* no notifications on this host */
  }
  console.warn('[diple] SDK check:', r)
  return r
}
