// Shared rig of the V2-C jsdom tests: the Diple plugin registered with the
// SDK stub, the composer slots mounted, and the deps (uiBus, lists) in reach.
// The fake backend is the one of send.test.mjs (same rules as the real one).
import { setupDom, loadPlugin, makeCtx, tick } from './harness.mjs'

export const HTML = `<!doctype html><html><head></head><body>
<div data-chat-surface="" data-composer-target="main" data-session-anchor="workspace" id="thread">
  <div data-slot="aui_thread-viewport"><div data-slot="aui_thread-content">
    <div data-slot="aui_user-message-root" data-role="user" data-message-id="100-0-user"><span data-slot="aui_user-message-text"><span data-slot="aui_user-inline-text" id="u1">第一个问题是关于缓存的</span></span></div>
    <div data-slot="aui_assistant-message-root" data-role="assistant" data-message-id="101-1-assistant"><div data-slot="aui_assistant-message-content"><p id="a1">缓存要先更新数据库，再删除缓存。</p><p id="a1b">并发写的时候可以延迟双删。</p></div></div>
    <div data-slot="aui_assistant-message-root" data-role="assistant" data-message-id="103-3-assistant"><div data-slot="aui_assistant-message-content"><p id="a2">第二条回复的内容在这里。</p></div></div>
  </div></div>
  <div data-slot="composer-rich-input" contenteditable="true" id="composer"></div>
  <div id="slot-main"></div>
</div>
<div data-chat-surface="" data-composer-target="tile:stored-2" data-session-anchor="session-tile:stored-2" id="tile">
  <div data-slot="aui_thread-viewport"><div data-slot="aui_thread-content"></div></div>
  <div id="slot-tile"></div>
</div>
</body></html>`

export const w = setupDom(HTML)
w.location.hash = '#/stored-1'
export const scrolled = []
w.Element.prototype.scrollIntoView = function () {
  scrolled.push(this)
}
const React = await import('react')
export const { act, createElement } = React
const { createRoot } = await import('react-dom/client')
export const plugin = await loadPlugin('diple')
export const sdk = globalThis.__sdk
export { tick }

export function fakeBackend() {
  const batches = new Map()
  const calls = []
  const err = (status, message) => Object.assign(new Error(message), { status })
  const rest = async (p, opts = {}) => {
    const method = opts.method ?? 'GET'
    calls.push({ path: p, method, body: opts.body })
    let m
    if ((m = p.match(/^\/batches\/([^/?]+)$/)) && method === 'PUT') {
      const b = { batchId: m[1], status: 'registered', createdAt: Date.now() / 1000, ...opts.body }
      batches.set(m[1], b)
      return b
    }
    if ((m = p.match(/^\/batches\/([^/?]+)$/)) && method === 'GET') {
      const b = batches.get(m[1])
      if (!b) throw err(404, 'unknown batch')
      return b
    }
    if ((m = p.match(/^\/batches\?(.*)$/))) {
      const q = new URLSearchParams(m[1])
      const list = [...batches.values()].filter((b) => (!q.get('sessionId') || b.sessionId === q.get('sessionId')) && (!q.get('status') || b.status === q.get('status')))
      return { batches: list.reverse().slice(0, Number(q.get('limit') ?? 20)) }
    }
    if ((m = p.match(/^\/batches\/([^/]+)\/failed$/))) {
      const b = batches.get(m[1])
      if (b?.status === 'registered' || (b?.status === 'expanded' && opts.body?.rejected === true)) b.status = 'failed'
      return b
    }
    if ((m = p.match(/^\/batches\/([^/]+)\/answered$/))) {
      const b = batches.get(m[1])
      if (!b) throw err(404, 'unknown batch')
      const first = b.status === 'expanded'
      if (first) Object.assign(b, { status: 'answered', answer: opts.body })
      return { first, batch: b }
    }
    if ((m = p.match(/^\/batches\/([^/]+)\/final$/))) return { ok: true }
    if (p === '/events/batch-answered') return { ok: true }
    throw err(404, `unhandled ${method} ${p}`)
  }
  return {
    rest,
    batches,
    calls,
    expand(id) {
      const b = batches.get(id)
      b.status = 'expanded'
      b.expandedAt = Date.now() / 1000
    },
    puts: () => calls.filter((c) => c.method === 'PUT')
  }
}

export function resetSdk() {
  sdk.submits.length = 0
  sdk.notifications.length = 0
  sdk.submitResult = true
  sdk.drafts.clear()
  sdk.navigations.length = 0
  sdk.focusCalls = []
  sdk.request = undefined
  sdk.locale.set('zh')
  sdk.sessions = [
    { id: 'stored-1', title: '缓存方案' },
    { id: 'stored-2', title: '迁移 nanostores' }
  ]
  sdk.state.focusedStoredSessionId.set('stored-1')
  sdk.state.focusedSessionId.set(null)
  sdk.state.busy.set(false)
  sdk.state.busyBySession.set({})
  sdk.state.focusedUsage.set(null)
}

const live = []
export function fresh({ settings, backend = fakeBackend() } = {}) {
  resetSdk()
  scrolled.length = 0
  const h = makeCtx({ rest: backend.rest })
  if (settings) h.ctx.storage.set('settings', { enabled: true, language: 'auto', ...settings })
  const bus = new Map()
  h.ctx.onEvent = (type, fn) => {
    if (!bus.has(type)) bus.set(type, new Set())
    bus.get(type).add(fn)
    return () => bus.get(type).delete(fn)
  }
  h.fire = async (type, payload = {}, session_id = 'stored-1') => {
    await act(async () => {
      await Promise.all([...(bus.get(type) ?? [])].map((fn) => fn({ type, session_id, payload })))
      await tick(5)
    })
  }
  h.registerI18n('diple')
  h.deps = plugin.register(h.ctx)
  h.backend = backend
  live.push(h)
  return h
}

const roots = []
/** Mount the composer slots (top + underside) inside a chat surface's slot. */
export async function mount(h, slot = 'slot-main') {
  const el = document.getElementById(slot)
  const root = createRoot(el)
  roots.push(root)
  const top = h.find('composer.top')
  const under = h.find('composer.underside')
  await act(async () => root.render(createElement('div', null, createElement(() => top.render()), createElement(() => under.render()))))
  await act(async () => tick(0))
  return { el, q: (s) => el.querySelector(s), qa: (s) => [...el.querySelectorAll(s)] }
}

export async function cleanupAll() {
  for (const r of roots.splice(0)) await act(async () => r.unmount())
  for (const h of live.splice(0)) h.dispose()
  for (const el of [...document.querySelectorAll('body > [data-diple-ui]')]) el.remove()
}

/** Put items straight into a session's list (the capture side is not under test here). */
export async function seed(h, key, items) {
  await act(async () => {
    for (const it of items) h.deps.lists.dispatch(key, { type: 'add', id: it.id, item: { origin: it.origin, text: it.text } })
    for (const it of items) if (it.comment) h.deps.lists.dispatch(key, { type: 'editComment', id: it.id, comment: it.comment })
    await tick(0)
  })
}

export const origin = (n, extra = {}) => ({ sessionId: 'stored-1', role: 'assistant', roleOrdinal: n, ordinal: n * 2, rowId: 10 + n, verified: true, ...extra })

export const click = async (el) => {
  if (!el) throw new Error('element to click is missing')
  await act(async () => {
    el.click()
    await tick(5)
  })
}
export const hover = (el, type = 'mouseover') => act(async () => el.dispatchEvent(new w.MouseEvent(type, { bubbles: true })))
