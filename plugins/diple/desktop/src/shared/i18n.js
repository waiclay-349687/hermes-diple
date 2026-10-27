// i18n of the chat plugin: its message bundles and its id, run by the shared
// locale runtime (@diple/desktop-kit createLocaleRuntime — app locale or a
// pinned one, en fallback, `dir` on the plugin's roots, the AI-facing language).
// W1-owned. Modules only add their own messages file below.
//
//   const i18n = createI18n(ctx, settings)
//   i18n.t(key, ...args)    → string (non-React code)
//   i18n.useT()             → t, re-rendering on app-locale or pin change
//   i18n.locale()           → the effective UI locale (one of LOCALE_IDS)
//   i18n.useLocale()        → the same, reactive (for `dir` on plugin roots)
//   i18n.envelopeLang()     → 'zh' | 'en': the language of the rules sent to
//                             the AI (zh, zh-hant → zh; every other locale → en)
//   i18n.lang()             → alias of envelopeLang() (older call sites)
//
// Keys are namespaced by module: common.*, capture.*, send.*.
// zh and en live in each module's messages.js; the other locales live in
// ../locales/<id>.js (one file per locale, the same namespaces), and a key
// missing there falls back to en.

import { Envelope } from '@diple/core'
import { createLocaleRuntime, mergeBundles, messageKeys, translateIn } from '@diple/desktop-kit'

import common from './messages.js'
import capture from '../capture/messages.js'
import send from '../send/messages.js'
import { EXTRA_LOCALES } from '../locales/index.js'

export { LOCALE_IDS, LOCALE_NAMES, dirOf, envelopeLangOf } from '@diple/desktop-kit'
export { mergeBundles, messageKeys }

// One name for the plugin id, its event namespace (plugin.<id>.*) and the
// @-reference prefix the AI sees (core Envelope.REFERENCE_PREFIX).
export const PLUGIN_ID = Envelope.REFERENCE_PREFIX
export const BUNDLES = { common, capture, send }
export const LOCALES = mergeBundles(BUNDLES, EXTRA_LOCALES)
// The plugin's roots that carry `dir`: the composer strip, editor, pins, dialogs, settings page.
const ROOTS = '[data-diple-ui], [data-diple-settings]'

export const translateWith = (locale, key, args = []) => translateIn(LOCALES, locale, key, args)

export const createI18n = (ctx, settings) => createLocaleRuntime(ctx, settings, { pluginId: PLUGIN_ID, locales: LOCALES, roots: ROOTS })
