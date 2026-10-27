// The locale behaviour both plugins share (D1 L1): follow the app's locale or
// a pinned one, fall back to en, keep `dir` on the plugin's roots in step
// (RTL for ar, roots added later included), and give the AI-facing language
// (zh or en). The plugin brings its data — id, merged locale trees, root
// selector — and keeps its own texts.
//
//   const i18n = createLocaleRuntime(ctx, settings, { pluginId, locales, roots })
//   i18n.t(key, ...args)    → string (non-React code)
//   i18n.useT()             → t, re-rendering on app-locale or pin change
//   i18n.locale()           → the effective UI locale (one of LOCALE_IDS)
//   i18n.useLocale()        → the same, reactive;  i18n.useDir() → 'ltr' | 'rtl'
//   i18n.envelopeLang()     → 'zh' | 'en' (zh, zh-hant → zh; every other locale → en)
//   i18n.lang()             → alias of envelopeLang() (older call sites)
//   i18n.onLocaleChange(fn) → off (the host's; undefined on an older host)
//
// settings: { get() → { language }, subscribe(fn) → off } — language is 'auto'
// or a pinned locale. ctx: the plugin ctx; ctx.i18n may be missing (an older
// host): then t() translates from `locales` itself (pin, else navigator.language,
// else en). Every subscription and the root observer end with ctx.onDispose.
// Invariants: an unknown locale → en; an unknown key → the key itself; a pin
// affects only this plugin (one runtime per plugin, nothing module-global).

import * as SDK from '@hermes/plugin-sdk'
import { useSyncExternalStore } from 'react'

import { installDirSync } from './dir-sync.js'
import { dirOf, envelopeLangOf, isLocale, localeFromTag } from './locale-ids.js'

/** { ns: { zh, en } } module bundles + { locale: tree } extra locales → { locale: tree }. */
export function mergeBundles(bundles, extra = {}) {
  const out = { zh: {}, en: {} }
  for (const [ns, b] of Object.entries(bundles)) {
    out.zh[ns] = b.zh
    out.en[ns] = b.en
  }
  for (const [l, tree] of Object.entries(extra)) out[l] = tree
  return out
}

/** key in `locale`, else en, else the key itself; a function entry is called with args. */
export function translateIn(locales, locale, key, args = []) {
  for (const l of [locale, 'en']) {
    let v = locales[l]
    for (const part of key.split('.')) v = v?.[part]
    if (typeof v === 'string') return v
    if (typeof v === 'function') return v(...args)
  }
  return key
}

/** Leaf key paths of a bundle (for the locale parity tests). */
export function messageKeys(bundle, prefix = '') {
  return Object.entries(bundle).flatMap(([k, v]) => (v && typeof v === 'object' ? messageKeys(v, `${prefix}${k}.`) : [`${prefix}${k}`]))
}

export function createLocaleRuntime(ctx, settings, { pluginId, locales, roots }) {
  const translateWith = (locale, key, args) => translateIn(locales, locale, key, args)
  const hostI18n = ctx.i18n?.register ? ctx.i18n : null
  hostI18n?.register(locales)
  const pinned = () => {
    const l = settings.get().language
    return isLocale(l) ? l : null
  }
  const appLocale = () => {
    // Each bundle answers common.langProbe with its own id; a host locale we do
    // not ship falls back to the en bundle.
    const probe = hostI18n?.t?.('common.langProbe')
    return isLocale(probe) ? probe : (localeFromTag(globalThis.navigator?.language) ?? 'en')
  }
  const locale = () => pinned() ?? appLocale()
  const envelopeLang = () => envelopeLangOf(locale())
  const t = (key, ...args) => (pinned() || !hostI18n ? translateWith(locale(), key, args) : hostI18n.t(key, ...args))
  const useAppT = hostI18n && typeof SDK.usePluginI18n === 'function' ? () => SDK.usePluginI18n(pluginId) : () => t
  const useT = () => {
    const appT = useAppT()
    const pin = useSyncExternalStore(settings.subscribe, () => settings.get().language)
    return isLocale(pin) ? (key, ...args) => translateWith(pin, key, args) : appT
  }
  const useLocale = () => {
    const appT = useAppT()
    const pin = useSyncExternalStore(settings.subscribe, () => settings.get().language)
    if (isLocale(pin)) return pin
    const probe = appT('common.langProbe')
    return isLocale(probe) ? probe : appLocale()
  }
  const useDir = () => dirOf(useLocale())
  // `dir` on the plugin's roots follows the effective locale (RTL for ar).
  const offDir = installDirSync({
    selector: roots,
    dir: () => dirOf(locale()),
    subscribe: [settings.subscribe, (fn) => hostI18n?.onLocaleChange?.(fn)]
  })
  ctx.onDispose?.(offDir)
  return { t, useT, locale, useLocale, useDir, envelopeLang, lang: envelopeLang, onLocaleChange: (fn) => hostI18n?.onLocaleChange?.(fn) }
}
