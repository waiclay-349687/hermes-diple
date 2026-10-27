// List, per plugin, which UI locales lack (or have extra) keys against en.
// Run after zh/en messages gain keys:  node scripts/i18n-gaps.mjs [--json]
// Exit code 1 when any locale differs from en (so CI can gate on it).
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

import { aliasesAt } from './build.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const PLUGINS = ['diple']

export async function loadI18n(id) {
  const out = await build({
    entryPoints: [path.join(ROOT, 'plugins', id, 'desktop/src/shared/i18n.js')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    loader: { '.js': 'jsx' },
    alias: { '@hermes/plugin-sdk': path.join(ROOT, 'tests/desktop/stub-sdk.mjs'), ...aliasesAt(ROOT) },
    external: ['react'],
    logLevel: 'silent'
  })
  const file = path.join(ROOT, 'dist', `.i18n-gaps-${id}-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, out.outputFiles[0].text)
  try {
    return await import(pathToFileURL(file).href)
  } finally {
    fs.rmSync(file, { force: true })
  }
}

/** { [locale]: { missing: [...], extra: [...] } } for locales that differ from en. */
export function gapsOf({ LOCALES, LOCALE_IDS, messageKeys }) {
  const en = new Set(messageKeys(LOCALES.en))
  const gaps = {}
  for (const l of LOCALE_IDS) {
    if (l === 'en') continue
    const keys = new Set(messageKeys(LOCALES[l] ?? {}))
    const missing = [...en].filter((k) => !keys.has(k)).sort()
    const extra = [...keys].filter((k) => !en.has(k)).sort()
    if (missing.length || extra.length) gaps[l] = { missing, extra }
  }
  return gaps
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const all = {}
  for (const id of PLUGINS) all[id] = gapsOf(await loadI18n(id))
  if (process.argv.includes('--json')) console.log(JSON.stringify(all, null, 2))
  else {
    for (const [id, gaps] of Object.entries(all)) {
      const ls = Object.keys(gaps)
      if (!ls.length) {
        console.log(`${id}: every locale matches en`)
        continue
      }
      for (const l of ls) {
        const { missing, extra } = gaps[l]
        if (missing.length) console.log(`${id} ${l}: missing ${missing.length}\n  ${missing.join('\n  ')}`)
        if (extra.length) console.log(`${id} ${l}: extra ${extra.length}\n  ${extra.join('\n  ')}`)
      }
    }
  }
  process.exitCode = Object.values(all).some((g) => Object.keys(g).length) ? 1 : 0
}
