// Build the desktop plugin: plugins/<id>/desktop/src/index.js → dist/<id>/plugin.js
// Pure ESM; only @hermes/plugin-sdk, react and react/jsx-runtime stay external;
// packages/core and packages/desktop-kit are bundled into the plugin (ADR 0004, ADR 0009).
//
//   node scripts/build.mjs            build it
//   node scripts/build.mjs --sdk <f>  alias @hermes/plugin-sdk to a stub (tests);
//                                     output goes to dist/test/<id>/plugin.js
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const PLUGINS = ['diple']
export const EXTERNAL = ['@hermes/plugin-sdk', 'react', 'react/jsx-runtime']
// The shared packages, by source path (relative to the repository root). The
// public export checks its import closure against the same table.
export const SHARED_ALIASES = { '@diple/core': 'packages/core/src/index.js', '@diple/desktop-kit': 'packages/desktop-kit/src/index.js' }
export const aliasesAt = (base = root) => Object.fromEntries(Object.entries(SHARED_ALIASES).map(([k, v]) => [k, path.join(base, v)]))

export async function buildPlugin(id, { sdkStub, outDir, entry } = {}) {
  const outfile = path.join(outDir ?? path.join(root, 'dist'), id, 'plugin.js')
  const result = await build({
    // entry: tests only (e.g. a send-only bundle without capture)
    entryPoints: [entry ?? path.join(root, 'plugins', id, 'desktop', 'src', 'index.js')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    loader: { '.js': 'jsx' },
    outfile,
    alias: {
      ...aliasesAt(root),
      ...(sdkStub ? { '@hermes/plugin-sdk': path.resolve(sdkStub) } : {})
    },
    external: sdkStub ? ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'] : EXTERNAL,
    legalComments: 'eof',
    metafile: true,
    logLevel: 'warning'
  })
  const imports = new Set()
  for (const out of Object.values(result.metafile.outputs)) for (const imp of out.imports) if (imp.external) imports.add(imp.path)
  if (!sdkStub) {
    const stray = [...imports].filter((p) => !EXTERNAL.includes(p))
    if (stray.length) throw new Error(`${id}: unexpected external imports ${stray.join(', ')}`)
  }
  return { outfile, imports: [...imports] }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const i = process.argv.indexOf('--sdk')
  const sdkStub = i > 0 ? process.argv[i + 1] : undefined
  for (const id of PLUGINS) {
    const { outfile } = await buildPlugin(id, sdkStub ? { sdkStub, outDir: path.join(root, 'dist', 'test') } : {})
    console.log(`built ${path.relative(root, outfile)} (${fs.statSync(outfile).size} bytes)`)
  }
}
