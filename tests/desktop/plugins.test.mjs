// Cross-cutting checks for the desktop plugin: i18n parity, no stray
// Chinese literals, bundle externals.
// Computed loads reviewed: see the override in publish/public-export-manifest.json.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

import { ROOT, setupDom, loadPlugin, makeCtx } from './harness.mjs'
import { aliasesAt } from '../../scripts/build.mjs'

setupDom()

async function loadI18n(id) {
  // The i18n module imports the SDK; bundle it against the stub to read LOCALES.
  const out = await build({
    entryPoints: [path.join(ROOT, 'plugins', id, 'desktop/src/shared/i18n.js')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    alias: { '@hermes/plugin-sdk': path.join(ROOT, 'tests/desktop/stub-sdk.mjs'), ...aliasesAt(ROOT) },
    external: ['react']
  })
  const file = path.join(ROOT, 'dist', `.i18n-${id}-${process.pid}.mjs`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, out.outputFiles[0].text)
  try {
    return await import(pathToFileURL(file).href)
  } finally {
    fs.rmSync(file, { force: true })
  }
}

for (const id of ['diple']) {
  test(`${id}: zh and en have exactly the same keys, and every value resolves`, async () => {
    const { LOCALES, messageKeys, translateWith } = await loadI18n(id)
    const zh = messageKeys(LOCALES.zh).sort()
    const en = messageKeys(LOCALES.en).sort()
    assert.deepEqual(zh, en)
    assert.ok(zh.length > 0)
    for (const key of zh) {
      for (const l of ['zh', 'en']) assert.notEqual(translateWith(l, key, [1, 2]), key, `${l}:${key}`)
    }
  })

  test(`${id}: no Chinese literals outside messages files`, () => {
    const dir = path.join(ROOT, 'plugins', id, 'desktop/src')
    const offenders = []
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) {
          // locales/<id>.js hold the other UI languages, like messages.js
          if (e.name !== 'locales') walk(p)
        }
        else if (/\.(js|jsx)$/.test(e.name) && e.name !== 'messages.js') {
          fs.readFileSync(p, 'utf8')
            .split('\n')
            .forEach((line, i) => {
              const code = line.replace(/\/\/.*$/, '')
              if (/[\u4e00-\u9fff]/.test(code) && !line.includes('i18n-allow')) offenders.push(`${path.relative(ROOT, p)}:${i + 1}`)
            })
        }
      }
    }
    walk(dir)
    assert.deepEqual(offenders, [])
  })

  test(`${id}: the production bundle imports only the SDK and React`, async () => {
    const { buildPlugin } = await import(pathToFileURL(path.join(ROOT, 'scripts/build.mjs')).href)
    const outDir = fs.mkdtempSync(path.join(ROOT, 'dist', '.ext-'))
    try {
      const { imports } = await buildPlugin(id, { outDir })
      assert.deepEqual(
        imports.filter((p) => !['@hermes/plugin-sdk', 'react', 'react/jsx-runtime'].includes(p)),
        []
      )
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true })
    }
  })
}
