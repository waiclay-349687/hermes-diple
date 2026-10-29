// jsdom + SDK stub harness: build a plugin against the stub, load it, and
// drive it from register(ctx) only.
// Computed loads reviewed: see the override in publish/public-export-manifest.json.
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
// The test bundles go under dist/; a fresh checkout has none yet (P2: the first
// `npm test` after a clone must start, also with the files running in parallel).
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true })

let dom
export function setupDom(html = '<!doctype html><html><head></head><body></body></html>') {
  dom = new JSDOM(html, { pretendToBeVisual: true, url: 'http://localhost/' })
  const w = dom.window
  for (const k of ['window', 'document', 'navigator', 'Node', 'HTMLElement', 'Element', 'getComputedStyle', 'MutationObserver', 'KeyboardEvent', 'MouseEvent', 'FocusEvent', 'Event', 'InputEvent']) {
    Object.defineProperty(globalThis, k, { value: k === 'window' ? w : w[k], configurable: true, writable: true })
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  return w
}

const cache = new Map()
export async function loadPlugin(id) {
  if (cache.has(id)) return cache.get(id)
  const { buildPlugin } = await import(pathToFileURL(path.join(ROOT, 'scripts/build.mjs')).href)
  const outDir = fs.mkdtempSync(path.join(ROOT, 'dist', `.test-${id}-`))
  const { outfile } = await buildPlugin(id, { sdkStub: path.join(ROOT, 'tests/desktop/stub-sdk.mjs'), outDir })
  // Resolve bare 'react' from the repo: the bundle lives under dist/.
  const mod = await import(pathToFileURL(outfile).href)
  process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }))
  cache.set(id, mod.default)
  return mod.default
}

/** W3: build a test-only entry (e.g. tests/desktop/fixtures/diple-send-only.js)
 *  against the stub, under the plugin id's build settings. */
export async function loadEntry(id, entry) {
  const key = `${id}:${entry}`
  if (cache.has(key)) return cache.get(key)
  const { buildPlugin } = await import(pathToFileURL(path.join(ROOT, 'scripts/build.mjs')).href)
  const outDir = fs.mkdtempSync(path.join(ROOT, 'dist', `.test-${id}-entry-`))
  const { outfile } = await buildPlugin(id, { sdkStub: path.join(ROOT, 'tests/desktop/stub-sdk.mjs'), outDir, entry: path.join(ROOT, entry) })
  const mod = await import(pathToFileURL(outfile).href)
  process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }))
  cache.set(key, mod.default)
  return mod.default
}

/** V2-X: a source module that imports @diple/core, bundled the plugin's way;
 *  → all its exports (e.g. a stylesheet built from MarkLook). */
export async function loadModule(id, entry) {
  const key = `module:${id}:${entry}`
  if (cache.has(key)) return cache.get(key)
  const { buildPlugin } = await import(pathToFileURL(path.join(ROOT, 'scripts/build.mjs')).href)
  const outDir = fs.mkdtempSync(path.join(ROOT, 'dist', `.test-${id}-module-`))
  const { outfile } = await buildPlugin(id, { sdkStub: path.join(ROOT, 'tests/desktop/stub-sdk.mjs'), outDir, entry: path.join(ROOT, entry) })
  const mod = await import(pathToFileURL(outfile).href)
  process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }))
  cache.set(key, mod)
  return mod
}

/** A fake backend for ctx.rest: the Diple routes, in memory. */
export function fakeDipleBackend() {
  const batches = new Map()
  const calls = []
  const rest = async (p, opts = {}) => {
    calls.push({ path: p, method: opts.method ?? 'GET', body: opts.body })
    const m = p.match(/^\/batches\/([^/?]+)(\/\w+)?$/)
    if (m && opts.method === 'PUT') {
      const b = { batchId: m[1], status: 'registered', ...opts.body }
      batches.set(m[1], b)
      return b
    }
    if (m && !m[2] && (opts.method ?? 'GET') === 'GET') {
      const b = batches.get(m[1])
      if (!b) throw Object.assign(new Error('unknown batch'), { status: 404 })
      return b
    }
    if (m && m[2] === '/failed') {
      const b = batches.get(m[1])
      if (b && b.status === 'registered') b.status = 'failed'
      return b
    }
    throw Object.assign(new Error(`unhandled ${p}`), { status: 404 })
  }
  return { rest, batches, calls, expand: (id) => (batches.get(id).status = 'expanded') }
}

export function makeCtx({ rest } = {}) {
  const contributions = []
  const disposers = []
  const events = new Map()
  const store = new Map()
  const i18nBundles = {}
  const sdk = globalThis.__sdk
  sdk.i18n ??= new Map()
  const ctx = {
    source: 'plugin:test',
    register(c) {
      contributions.push(c)
      return () => {}
    },
    registerMany(cs) {
      cs.forEach((c) => contributions.push(c))
      return () => {}
    },
    rest: rest ?? (async () => ({})),
    onEvent(type, fn) {
      if (!events.has(type)) events.set(type, new Set())
      events.get(type).add(fn)
      return () => events.get(type).delete(fn)
    },
    onDispose: (fn) => disposers.push(fn),
    storage: {
      get: (k, d) => (store.has(k) ? JSON.parse(store.get(k)) : d),
      set: (k, v) => store.set(k, JSON.stringify(v)),
      remove: (k) => store.delete(k)
    },
    i18n: {
      register(b) {
        Object.assign(i18nBundles, b)
      },
      t(key, ...args) {
        for (const l of [sdk.locale.get(), 'en']) {
          let v = i18nBundles[l]
          for (const part of key.split('.')) v = v?.[part]
          if (typeof v === 'string') return v
          if (typeof v === 'function') return v(...args)
        }
        return key
      },
      onLocaleChange: (fn) => sdk.locale.listen(fn)
    }
  }
  return {
    ctx,
    contributions,
    store,
    emit(type, payload) {
      for (const fn of events.get(type) ?? []) fn({ type, payload })
    },
    find: (area, pred = () => true) => contributions.find((c) => c.area === area && pred(c)),
    dispose: () => disposers.splice(0).forEach((fn) => fn()),
    registerI18n: (id) => sdk.i18n.set(id, ctx.i18n)
  }
}

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))

/** V2.1 #2: a new annotation joins the strip once its editor saved it. Press ⏎
 *  in the open editor (what the user does) — a no-op when none is open.
 *  Call inside act(). */
export function saveOpenEditor(doc = globalThis.document) {
  const box = doc.querySelector('[data-diple-editor-input]')
  if (!box) return false
  const KE = doc.defaultView?.KeyboardEvent ?? globalThis.KeyboardEvent
  box.dispatchEvent(new KE('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  return true
}
