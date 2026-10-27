// The UI locales both plugins ship — the host's bundled set
// (host apps/desktop/src/i18n/languages.ts LOCALE_OPTIONS). The texts stay in
// each plugin: zh and en in its modules' messages.js, every other locale in
// its locales/<id>.js.

export const LOCALE_IDS = ['en', 'zh', 'zh-hant', 'ja', 'ar', 'ru', 'fr', 'de', 'es']

/** Each language in its own name (the picker shows these, never translated). */
export const LOCALE_NAMES = {
  en: 'English',
  zh: '简体中文', // i18n-allow: endonym
  'zh-hant': '繁體中文', // i18n-allow: endonym
  ja: '日本語', // i18n-allow: endonym
  ar: 'العربية',
  ru: 'Русский',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español'
}

export const RTL_LOCALES = new Set(['ar'])

/** Values of settings.language: follow the app, or pin one locale. */
export const LANGUAGE_SETTINGS = ['auto', ...LOCALE_IDS]

export const isLocale = (l) => LOCALE_IDS.includes(l)

/** Text direction for a locale (for a `dir` attribute on plugin roots). */
export const dirOf = (l) => (RTL_LOCALES.has(l) ? 'rtl' : 'ltr')

/** The language of the rules sent to the AI: only zh or en exist there.
 *  Both Chinese scripts get zh; every other UI locale gets en. */
export const envelopeLangOf = (l) => (l === 'zh' || l === 'zh-hant' ? 'zh' : 'en')

/** A BCP-47 tag (navigator.language) → one of our locales, else null. */
export function localeFromTag(tag) {
  if (typeof tag !== 'string' || !tag) return null
  const t = tag.toLowerCase()
  if (t.startsWith('zh')) return /hant|-tw|-hk|-mo/.test(t) ? 'zh-hant' : 'zh'
  const base = t.split(/[-_]/)[0]
  return isLocale(base) ? base : null
}

/** Options for a language picker: follow the app, then every locale in its
 *  own name (with its own lang/dir so Arabic renders right-to-left). */
export const languageOptions = (autoLabel) => [
  { id: 'auto', label: autoLabel },
  ...LOCALE_IDS.map((l) => ({ id: l, label: LOCALE_NAMES[l], lang: l, dir: dirOf(l) }))
]
