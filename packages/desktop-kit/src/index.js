// What the two desktop plugins share beyond the pure core (D1 L1, ADR 0009):
// the host-locale list and policy, the locale runtime (i18n + dir), the
// settings store. Bundled into each plugin separately, like packages/core:
// one source, two independent instances, nothing shared at run time. Imports
// the host SDK and React, never a plugin.
export { LOCALE_IDS, LOCALE_NAMES, RTL_LOCALES, LANGUAGE_SETTINGS, isLocale, dirOf, envelopeLangOf, localeFromTag, languageOptions } from './locale-ids.js'
export { createLocaleRuntime, mergeBundles, translateIn, messageKeys } from './locale-runtime.js'
export { createSettingsStore } from './settings-store.js'
export { SendMenu, SEND_MENU_CSS } from './send-menu.js'
