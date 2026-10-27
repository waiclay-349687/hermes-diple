// Settings ▸ Plugins ▸ Diple. W2b.
// A one-line note on the name, then language (the user's app runs in English but they want Chinese UI),
// then the master switch, the toolbar on selection (V2-X: on by default; off
// leaves ⌘⇧E and the palette), how marks look on the original (V2: quiet
// mode, keep after sending) and the shortcut summary.

import { DEFAULT_SETTINGS } from '../shared/settings.js'
import * as SDK from '@hermes/plugin-sdk'
import { languageOptions } from '@diple/desktop-kit'
import { Btn, Choice, Row, Toggle } from './ui.jsx'

// V2.1 #3: the settings page is the one place that shows shortcuts (the use
// surfaces show none); keycaps live here only.
const isMac = () => /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '') || /Mac OS X/.test(globalThis.navigator?.userAgent ?? '')
export const modEnterLabel = () => (isMac() ? '⌘\u21A9\uFE0E' : 'Ctrl+Enter')

export function KeyCombo({ keys }) {
  const Kbd = typeof SDK.Kbd === 'function' || (SDK.Kbd && typeof SDK.Kbd === 'object') ? SDK.Kbd : null
  // key combos read left to right in every UI language (⌘⇧E, not E⇧⌘ in Arabic)
  return <bdi dir="ltr">{Kbd ? <Kbd>{keys}</Kbd> : <kbd className="diple-settings-kbd">{keys}</kbd>}</bdi>
}

export const comboLabel = (combo) =>
  combo
    .split('+')
    .map((p) => (p === 'mod' ? (isMac() ? '⌘' : 'Ctrl+') : p === 'shift' ? (isMac() ? '⇧' : 'Shift+') : p === 'enter' ? '\u21A9\uFE0E' : p.toUpperCase()))
    .join('')

export function createSettingsPage({ deps, openKeybinds, sendDefaults }) {
  const { i18n, settings, notify } = deps

  return function SettingsPage() {
    const t = i18n.useT()
    const s = settings.use()
    return (
      <div className="diple-settings" data-diple-settings="">
        <span className="diple-setting-desc diple-settings-about" data-diple-about="">{t('send.settings.about')}</span>
        <Row
          id="language"
          title={t('send.settings.language')}
          description={t('send.settings.languageDesc')}
          action={
            <Choice
              id="diple-language"
              label={t('send.settings.language')}
              value={s.language}
              onChange={(language) => settings.set({ language })}
              options={languageOptions(t('send.settings.langAuto'))}
            />
          }
        />
        <Toggle
          id="enabled"
          label={t('send.settings.enabled')}
          description={t('send.settings.enabledDesc')}
          checked={s.enabled}
          onChange={(enabled) => settings.set({ enabled })}
        />
        <Toggle
          id="selection-button"
          label={t('send.settings.selectionButton')}
          description={t('send.settings.selectionButtonDesc')}
          checked={s.selectionButton !== false}
          disabled={!s.enabled}
          onChange={(selectionButton) => settings.set({ selectionButton })}
        />
        <Toggle
          id="marks-quiet"
          label={t('send.settings.marksQuiet')}
          description={t('send.settings.marksQuietDesc')}
          checked={s.marksQuiet === true}
          disabled={!s.enabled}
          onChange={(marksQuiet) => settings.set({ marksQuiet })}
        />
        <Toggle
          id="marks-keep-sent"
          label={t('send.settings.marksKeepSent')}
          description={t('send.settings.marksKeepSentDesc')}
          checked={s.marksKeepSent !== false}
          disabled={!s.enabled}
          onChange={(marksKeepSent) => settings.set({ marksKeepSent })}
        />
        <Row
          id="keys"
          title={t('send.settings.keys')}
          description={
            <span className="diple-settings-keys">
              <span>{t('send.settings.keysDesc')}</span>
              <span className="diple-settings-keyline">
                {t('send.settings.keyAdd')} <KeyCombo keys={comboLabel('mod+shift+e')} />
                {'  ·  '}
                {t('send.settings.keySend')} <KeyCombo keys={comboLabel(sendDefaults[0])} />
                {'  ·  '}
                {t('send.settings.keyInList')} <KeyCombo keys={modEnterLabel()} />
              </span>
            </span>
          }
          action={
            <Btn variant="secondary" size="sm" data-diple-open-keybinds="" onClick={openKeybinds}>
              {t('send.settings.openKeybinds')}
            </Btn>
          }
        />
        <Row
          id="reset"
          title={t('send.settings.reset')}
          description={t('send.settings.resetDesc')}
          action={
            <Btn
              variant="secondary"
              size="sm"
              data-diple-reset=""
              onClick={() => {
                settings.set({ ...DEFAULT_SETTINGS, language: settings.get().language })
                notify({ kind: 'success', title: i18n.t('send.settings.resetDone') })
              }}
            >
              {t('send.settings.reset')}
            </Btn>
          }
        />
      </div>
    )
  }
}

export const SETTINGS_CSS = `
.diple-settings{display:flex;flex-direction:column;gap:2px}
.diple-settings kbd{direction:ltr;unicode-bidi:isolate}
.diple-settings-kbd{font:inherit;font-size:11px;padding:0 4px;border-radius:var(--radius-sm,2px);border:1px solid var(--ui-stroke-secondary);color:var(--ui-text-secondary)}
.diple-settings-about{display:block;padding:0 0 8px}
.diple-settings-keys{display:flex;flex-direction:column;gap:4px}
.diple-settings-keyline{white-space:pre-wrap;color:var(--ui-text-secondary)}
.diple-choice{min-width:9.5rem}
.diple-choice-native{height:28px;padding:0 6px;border:1px solid var(--ui-stroke-secondary);border-radius:var(--radius-md,4px);background:var(--ui-bg-secondary);color:inherit;font:inherit}
`
