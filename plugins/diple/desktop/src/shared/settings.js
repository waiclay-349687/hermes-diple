// Plugin settings (W1 defines the shape; W2b owns the settings page UI).
//   enabled  — master switch: keybinds, list and highlights all stop when false
//   language — 'auto' (follow the app) | one of LOCALE_IDS (@diple/desktop-kit)
//   selectionButton — V2: show the selection toolbar (标注) on chat selections
//                     (capture/selection-toolbar; its toggle lives in send/'s settings page)
//   marksQuiet    — V2: transcript marks show only the numbered pins (no fill, no line)
//   marksKeepSent — V2: sent annotations stay marked in the transcript

import { createSettingsStore, LANGUAGE_SETTINGS } from '@diple/desktop-kit'

export const DEFAULT_SETTINGS = Object.freeze({ enabled: true, language: 'auto', selectionButton: true, marksQuiet: false, marksKeepSent: true })

export function normalizeSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {}
  return {
    enabled: typeof s.enabled === 'boolean' ? s.enabled : DEFAULT_SETTINGS.enabled,
    language: LANGUAGE_SETTINGS.includes(s.language) ? s.language : DEFAULT_SETTINGS.language,
    selectionButton: typeof s.selectionButton === 'boolean' ? s.selectionButton : DEFAULT_SETTINGS.selectionButton,
    marksQuiet: typeof s.marksQuiet === 'boolean' ? s.marksQuiet : DEFAULT_SETTINGS.marksQuiet,
    marksKeepSent: typeof s.marksKeepSent === 'boolean' ? s.marksKeepSent : DEFAULT_SETTINGS.marksKeepSent
  }
}

/** The chat plugin's settings: the shared store with these rules. */
export const createSettings = (storage) => createSettingsStore(storage, normalizeSettings)
