// V2-I: the UI in every host locale. Parity of keys and placeholders against
// en, every literal t('…') resolves, no stray CJK, the AI-facing language
// stays zh/en, and a language switch relabels the live UI (jsdom).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { ROOT, setupDom, loadPlugin, loadModule, makeCtx, tick } from './harness.mjs'
import { gapsOf, loadI18n, PLUGINS } from '../../scripts/i18n-gaps.mjs'

const w = setupDom()
const React = await import('react')
const { act, createElement } = React
const { createRoot } = await import('react-dom/client')

const HOST_LOCALES = ['en', 'zh', 'zh-hant', 'ja', 'ar', 'ru', 'fr', 'de', 'es']
const mods = Object.fromEntries(await Promise.all(PLUGINS.map(async (id) => [id, await loadI18n(id)])))

const leaf = (tree, key) => key.split('.').reduce((v, p) => v?.[p], tree)
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(js|jsx)$/.test(e.name)) out.push(p)
  }
  return out
}

test('the plugins ship exactly the host locales (apps/desktop/src/i18n LOCALE_OPTIONS)', () => {
  for (const id of PLUGINS) {
    assert.deepEqual([...mods[id].LOCALE_IDS].sort(), [...HOST_LOCALES].sort(), id)
    assert.deepEqual(Object.keys(mods[id].LOCALES).sort(), [...HOST_LOCALES].sort(), id)
    for (const l of HOST_LOCALES) assert.equal(typeof mods[id].LOCALE_NAMES[l], 'string', `${id}: endonym for ${l}`)
  }
})

for (const id of PLUGINS) {
  test(`${id}: every locale has exactly the keys of en (no gaps, no extras)`, () => {
    assert.deepEqual(gapsOf(mods[id]), {})
  })

  test(`${id}: every locale's common.langProbe answers its own id`, () => {
    for (const l of HOST_LOCALES) assert.equal(mods[id].translateWith(l, 'common.langProbe'), l)
  })

  test(`${id}: placeholders match en (same kind, same interpolated arguments)`, () => {
    const { LOCALES, messageKeys } = mods[id]
    const S = ['⟦a⟧', '⟦b⟧', '⟦c⟧']
    const used = (fn) => S.filter((s) => fn(...S).includes(s))
    const bad = []
    for (const key of messageKeys(LOCALES.en)) {
      const en = leaf(LOCALES.en, key)
      for (const l of HOST_LOCALES) {
        const v = leaf(LOCALES[l], key)
        if (typeof v !== typeof en) {
          bad.push(`${l}:${key} is ${typeof v}, en is ${typeof en}`)
          continue
        }
        if (typeof en !== 'function') continue
        if (v.length !== en.length) bad.push(`${l}:${key} takes ${v.length} args, en ${en.length}`)
        const a = used(en).join(',')
        const b = used(v).join(',')
        if (a !== b) bad.push(`${l}:${key} interpolates [${b}], en [${a}]`)
        for (const n of [0, 1, 2, 3, 5, 11, 21, 100]) {
          const out = v(n, n, n)
          if (typeof out !== 'string' || !out.trim()) bad.push(`${l}:${key}(${n}) → ${JSON.stringify(out)}`)
        }
      }
    }
    assert.deepEqual(bad, [])
  })

  test(`${id}: every literal t('…') in the source resolves in every locale`, () => {
    const { LOCALES, messageKeys } = mods[id]
    const keySets = Object.fromEntries(HOST_LOCALES.map((l) => [l, new Set(messageKeys(LOCALES[l]))]))
    const src = path.join(ROOT, 'plugins', id, 'desktop/src')
    const missing = []
    let seen = 0
    for (const f of walk(src)) {
      if (f.includes(`${path.sep}locales${path.sep}`) || f.endsWith('messages.js')) continue
      const code = fs.readFileSync(f, 'utf8')
      for (const m of code.matchAll(/\bt\(\s*(['"])((?:common|capture|send|review)\.[\w.-]+)\1/g)) {
        seen++
        // t('send.reason.' + why): a prefix — the subtree must exist in every locale
        if (m[2].endsWith('.')) {
          for (const l of HOST_LOCALES) if (![...keySets[l]].some((k) => k.startsWith(m[2]))) missing.push(`${path.relative(ROOT, f)} ${l}:${m[2]}*`)
          continue
        }
        for (const l of HOST_LOCALES) if (!keySets[l].has(m[2])) missing.push(`${path.relative(ROOT, f)} ${l}:${m[2]}`)
      }
    }
    assert.ok(seen > 30, `found ${seen} t() calls`)
    assert.deepEqual(missing, [])
  })

  test(`${id}: CJK only in messages, Chinese/Japanese locale files and allow-listed lines`, () => {
    const src = path.join(ROOT, 'plugins', id, 'desktop/src')
    const CJK = /[\u3040-\u30ff\u3400-\u9fff\uff00-\uffef]/
    const offenders = []
    for (const f of walk(src)) {
      const rel = path.relative(src, f)
      if (rel.endsWith('messages.js') || rel === path.join('locales', 'zh-hant.js') || rel === path.join('locales', 'ja.js')) continue
      fs.readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const code = line.replace(/\/\/.*$/, '')
          // the language picker shows 中文 / 日本語 in their own script (endonyms)
          if (CJK.test(code) && !line.includes('i18n-allow') && !/^\s*langZh: '中文',$/.test(line)) offenders.push(`${rel}:${i + 1}`)
        })
    }
    assert.deepEqual(offenders, [])
  })

  test(`${id}: the AI-facing language stays zh or en (zh, zh-hant → zh; others → en)`, () => {
    const { envelopeLangOf } = mods[id]
    const want = { en: 'en', zh: 'zh', 'zh-hant': 'zh', ja: 'en', ar: 'en', ru: 'en', fr: 'en', de: 'en', es: 'en' }
    for (const l of HOST_LOCALES) assert.equal(envelopeLangOf(l), want[l], l)
  })

  test(`${id}: createI18n — pinned language, app language, fallback to en, envelopeLang`, () => {
    const { createI18n } = mods[id]
    let lang = 'auto'
    const subs = new Set()
    const settings = { get: () => ({ language: lang }), subscribe: (fn) => (subs.add(fn), () => subs.delete(fn)) }
    let appLocale = 'zh'
    const bundles = {}
    const ctx = {
      onDispose() {},
      i18n: {
        register: (b) => Object.assign(bundles, b),
        t: (key, ...args) => {
          for (const l of [appLocale, 'en']) {
            const v = leaf(bundles[l], key)
            if (typeof v === 'string') return v
            if (typeof v === 'function') return v(...args)
          }
          return key
        },
        onLocaleChange: () => () => {}
      }
    }
    const i18n = createI18n(ctx, settings)
    const probeKey = 'common.pluginName'
    const expectName = { zh: id === 'diple' ? '圈批' : '圈批·文档', 'zh-hant': id === 'diple' ? '圈批' : '圈批·文檔' } // i18n-allow: product names
    for (const l of HOST_LOCALES) {
      lang = l
      assert.equal(i18n.locale(), l)
      assert.equal(i18n.envelopeLang(), l === 'zh' || l === 'zh-hant' ? 'zh' : 'en')
      assert.equal(i18n.lang(), i18n.envelopeLang(), 'lang() stays the envelope language')
      assert.equal(i18n.t(probeKey), expectName[l] ?? (id === 'diple' ? 'Diple' : 'Diple Docs'))
    }
    lang = 'auto'
    for (const l of HOST_LOCALES) {
      appLocale = l
      assert.equal(i18n.locale(), l, `follows the app: ${l}`)
    }
    appLocale = 'ko' // a host language the plugin does not ship → en
    assert.equal(i18n.locale(), 'en')
    assert.equal(i18n.envelopeLang(), 'en')
    // a key missing in a locale falls back to en
    const { LOCALES, translateWith } = mods[id]
    const key = id === 'diple' ? 'send.settings.language' : 'review.settings.language'
    const parent = leaf(LOCALES.ja, key.split('.').slice(0, -1).join('.'))
    const saved = parent.language
    delete parent.language
    try {
      assert.equal(translateWith('ja', key), leaf(LOCALES.en, key))
    } finally {
      parent.language = saved
    }
  })
}

test('settings normalisation accepts auto and every locale, nothing else', async () => {
  // every plugin of this tree (the public one has only the chat plugin)
  const mods = await Promise.all(PLUGINS.map((id) => loadModule(id, path.join('plugins', id, 'desktop/src/shared/settings.js'))))
  for (const norm of mods.map((m) => m.normalizeSettings)) {
    for (const l of ['auto', ...HOST_LOCALES]) assert.equal(norm({ language: l }).language, l)
    for (const l of ['ko', 'zh-Hant', 'EN', '', null]) assert.equal(norm({ language: l }).language, 'auto')
  }
})

test('the gap report names the locales and keys that zh/en gained', () => {
  const m = mods.diple
  const en = { ...m.LOCALES.en, send: { ...m.LOCALES.en.send, brandNew: 'New', settings: { ...m.LOCALES.en.send.settings, alsoNew: 'x' } } }
  const LOCALES = { ...m.LOCALES, en }
  const gaps = gapsOf({ LOCALES, LOCALE_IDS: m.LOCALE_IDS, messageKeys: m.messageKeys })
  assert.deepEqual(Object.keys(gaps).sort(), HOST_LOCALES.filter((l) => l !== 'en').sort())
  assert.deepEqual(gaps.ja.missing, ['send.brandNew', 'send.settings.alsoNew'])
  assert.deepEqual(gaps.ja.extra, [])
})

// --- live switch in jsdom ---------------------------------------------------------------
test('chat settings page relabels live: zh → en → ja → ar → zh-hant (and dir flips for ar)', async () => {
  const plugin = await loadPlugin('diple')
  const sdk = globalThis.__sdk
  sdk.locale.set('zh')
  const h = makeCtx()
  h.ctx.onEvent = () => () => {}
  h.registerI18n('diple')
  const deps = plugin.register(h.ctx)
  const page = h.find('settings.plugins')
  assert.ok(page, 'settings page registered')
  const el = document.createElement('div')
  el.setAttribute('data-test-mount', '')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => root.render(createElement(() => page.render())))
  const settingsApi = deps?.settings ?? null
  const set = async (language) => {
    const select = el.querySelector('[data-diple-choice]')
    assert.ok(select, 'the language control is a dropdown')
    await act(async () => {
      Object.getOwnPropertyDescriptor(w.HTMLSelectElement.prototype, 'value').set.call(select, language)
      select.dispatchEvent(new w.Event('change', { bubbles: true }))
      await tick(5)
    })
  }
  const title = () => el.querySelector('[data-diple-settings]').textContent
  const options = [...el.querySelectorAll('[data-diple-choice] option')].map((o) => o.textContent)
  assert.deepEqual(options.slice(1), ['English', '简体中文', '繁體中文', '日本語', 'العربية', 'Русский', 'Français', 'Deutsch', 'Español']) // i18n-allow: endonyms
  const steps = [
    ['zh', '界面语言', 'ltr'], // i18n-allow: expected zh label
    ['en', 'Language', 'ltr'],
    ['ja', '言語', 'ltr'], // i18n-allow: expected ja label
    ['ar', 'اللغة', 'rtl'],
    ['zh-hant', '介面語言', 'ltr'] // i18n-allow: expected zh-hant label
  ]
  const palette = (id) => h.contributions.filter((c) => c.area === 'palette' && c.data?.id === id).at(-1)?.data.label
  const seen = new Set()
  for (const [lang, label, dir] of steps) {
    await set(lang)
    assert.match(title(), new RegExp(label), `${lang}: label`)
    assert.equal(el.querySelector('[data-diple-choice]').value, lang)
    assert.equal(el.querySelector('[data-diple-settings]').getAttribute('dir'), dir, `${lang}: dir`)
    seen.add(palette('diple.settings'))
  }
  assert.equal(seen.size, steps.length, 'the palette relabels on every switch')
  // follow the app again: the app locale drives the page
  await set('auto')
  await act(async () => {
    sdk.locale.set('fr')
    await tick(5)
  })
  assert.match(title(), /Langue/)
  await act(async () => {
    sdk.locale.set('ar')
    await tick(5)
  })
  assert.match(title(), /اللغة/)
  assert.ok(settingsApi == null || settingsApi.get?.().language === 'auto')
  await act(async () => root.unmount())
  el.remove()
  h.dispose()
  sdk.locale.set('zh')
})
