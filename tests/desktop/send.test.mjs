// W2b — the Diple send module, driven only through register(ctx) with the
// SDK stub: user stories 27–44, the hand-off receiver, the answer check.
import test from 'node:test'
import assert from 'node:assert/strict'

import { saveOpenEditor, setupDom, loadPlugin, makeCtx, tick } from './harness.mjs'
import { Envelope } from '../../packages/core/src/index.js'

// Same host structure as capture.test.mjs: a chat surface for the routed
// session, its thread viewport and the aui_*-message-content wrappers, so
// marker clicks go through capture's real `locate` (merged in W3).
const html = `<!doctype html><html><head></head><body>
<div data-chat-surface="" data-composer-target="main" data-session-anchor="workspace" id="thread">
  <div data-slot="aui_thread-viewport"><div data-slot="aui_thread-content">
    <div data-slot="aui_user-message-root" data-role="user" data-message-id="100-0-user"><span data-slot="aui_user-message-text"><span data-slot="aui_user-inline-text" id="u1">第一个问题是关于缓存的</span></span></div>
    <div data-slot="aui_assistant-message-root" data-role="assistant" data-message-id="101-1-assistant"><div data-slot="aui_assistant-message-content"><p id="a1">缓存要先更新数据库，再删除缓存。</p><p id="a1b">并发写的时候可以延迟双删。</p></div></div>
    <div data-slot="aui_assistant-message-root" data-role="assistant" data-message-id="103-3-assistant"><div data-slot="aui_assistant-message-content"><p id="a2">第二条回复的内容在这里。</p></div></div>
  </div></div>
  <div data-slot="composer-rich-input" contenteditable="true" id="composer"></div>
</div>
</body></html>`

const w = setupDom(html)
w.location.hash = '#/stored-1'
const scrolled = []
w.Element.prototype.scrollIntoView = function () {
  scrolled.push(this)
}
const React = await import('react')
const { act, createElement } = React
const { createRoot } = await import('react-dom/client')
const plugin = await loadPlugin('diple')
const sdk = globalThis.__sdk

// -- fakes -----------------------------------------------------------------------
function fakeBackend() {
  const batches = new Map()
  const claims = new Set()
  const calls = []
  const events = []
  let failPut = false
  const err = (status, message) => Object.assign(new Error(message), { status })
  const rest = async (p, opts = {}) => {
    const method = opts.method ?? 'GET'
    calls.push({ path: p, method, body: opts.body })
    let m
    if ((m = p.match(/^\/batches\/([^/?]+)$/)) && method === 'PUT') {
      if (failPut) throw err(500, 'down')
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
      // same rule as the real backend: expanded → failed only with rejected:true (W3)
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
    if ((m = p.match(/^\/handoff\/([^/]+)\/claim$/))) {
      const first = !claims.has(m[1])
      claims.add(m[1])
      return first ? { claimed: true, owner: opts.body?.owner, generation: 1, batchId: opts.body?.batchId } : { claimed: false }
    }
    if ((m = p.match(/^\/handoff\/([^/]+)\/progress$/))) return { ok: true } // R2 XE2-03
    if ((m = p.match(/^\/handoff\/([^/]+)\/replay$/))) return { receipt: null, settled: null }
    if ((m = p.match(/^\/batches\/([^/]+)\/final$/))) {
      events.push({ path: p, body: opts.body })
      return { ok: true }
    }
    if (p === '/events/batch-answered' || p === '/events/handoff-receipt') {
      // the holder's owner + generation ride along (ADR 0007); tests look at the receipt itself
      const { owner, generation, settles, ...body } = opts.body ?? {}
      events.push({ path: p, body, ...(owner ? { holder: { owner, generation } } : {}), ...(settles ? { settles } : {}) })
      return { ok: true }
    }
    throw err(404, `unhandled ${method} ${p}`)
  }
  return {
    rest,
    batches,
    calls,
    events,
    setFailPut: (v) => (failPut = v),
    expand(id) {
      const b = batches.get(id)
      b.status = 'expanded'
      b.expandedAt = Date.now() / 1000
    },
    puts: () => calls.filter((c) => c.method === 'PUT')
  }
}

function resetSdk() {
  sdk.submits.length = 0
  sdk.notifications.length = 0
  sdk.submitResult = true
  sdk.drafts.clear()
  sdk.navigations.length = 0
  sdk.locale.set('zh')
  sdk.state.focusedStoredSessionId.set('stored-1')
  sdk.state.focusedSessionId.set(null)
  sdk.state.busy.set(false)
  sdk.state.busyBySession.set({})
  sdk.state.focusedUsage.set(null)
}

const live = []
function fresh({ settings, backend = fakeBackend(), storage } = {}) {
  resetSdk()
  const h = makeCtx({ rest: backend.rest })
  if (storage) for (const [k, v] of storage) h.store.set(k, v)
  if (settings) h.ctx.storage.set('settings', { enabled: true, language: 'auto', selectionButton: true, ...settings })
  // Event bus that carries session_id like the host's gateway events.
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

test.afterEach(async () => {
  for (const h of live.splice(0)) h.dispose()
  for (const el of [...document.querySelectorAll('[data-test-mount]')]) el.remove()
})

async function mount(h) {
  const el = document.createElement('div')
  el.setAttribute('data-test-mount', '')
  document.body.appendChild(el)
  const root = createRoot(el)
  const top = h.find('composer.top')
  const under = h.find('composer.underside')
  await act(async () =>
    root.render(createElement('div', null, createElement(() => top.render()), createElement(() => under.render())))
  )
  return { el, root, q: (s) => el.querySelector(s), qa: (s) => [...el.querySelectorAll(s)] }
}

function select(id, from, to) {
  const node = document.getElementById(id).firstChild
  const range = document.createRange()
  range.setStart(node, from)
  range.setEnd(node, to ?? node.data.length)
  const sel = document.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
}

async function add(h, view, id, comment, from = 0, to) {
  const key = sdk.state.focusedStoredSessionId.get()
  const before = new Set(h.deps.lists.get(key).items.map((x) => x.id))
  select(id, from, to)
  await act(async () => h.find('keybinds', (c) => c.data.id === 'diple.add').data.run())
  await act(async () => (saveOpenEditor(), tick(5))) // V2.1 #2: saved once → on the strip
  if (comment !== undefined) {
    // V2-C: comments are written beside the original (V2-T editor), which
    // edits the list item; the send side only sees the list.
    const it = h.deps.lists.get(key).items.find((x) => !before.has(x.id))
    assert.ok(it, 'the annotation was added')
    await act(async () => h.deps.lists.dispatch(key, { type: 'editComment', id: it.id, comment }))
  }
}

const click = async (el) => {
  assert.ok(el, 'element to click exists')
  await act(async () => {
    el.click()
    await tick(5)
  })
}

const lastPut = (h) => h.backend.puts().at(-1)

/** Pick a value in the language dropdown (the native <select> fallback under the stub SDK). */
const choose = async (select, value) => {
  assert.ok(select, 'select exists')
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(select.ownerDocument.defaultView.HTMLSelectElement.prototype, 'value').set
    setter.call(select, value)
    select.dispatchEvent(new select.ownerDocument.defaultView.Event('change', { bubbles: true }))
    await tick(5)
  })
}
const batchIdOf = (h) => lastPut(h).path.split('/')[2]

/** The host side of an accepted turn: expand → batch.sent → message.complete. */
async function deliver(h, { answer = 'ok', persisted = true, status = 'complete', session = 'stored-1' } = {}) {
  const batchId = batchIdOf(h)
  h.backend.expand(batchId)
  await h.fire('message.start', {}, session)
  await h.fire('plugin.diple.batch.sent', { v: 1, batchId, sessionId: session, items: [] }, '')
  const text = typeof answer === 'function' ? answer(batchId) : answer
  await h.fire('message.complete', { status, text, ...(persisted ? { persisted_turn: { user_row_id: 9, row_ids: [9, 10] } } : {}) }, session)
  return batchId
}

const norm = (s, b) => s.split(b).join('<B>')

// -- 27, 28: three send paths, one result ---------------------------------------------
test('27/28: list button, ⌘↩ in the list and the main send button produce byte-identical display and full', async () => {
  const out = []
  for (const path of ['button', 'chord', 'middleware']) {
    const h = fresh()
    const view = await mount(h)
    await add(h, view, 'a1', '为什么不是先删缓存？')
    await add(h, view, 'a2')
    sdk.drafts.set('stored-1', '请逐条看一下')
    if (path === 'button') await click(view.q('[data-diple-send]'))
    if (path === 'chord') {
      const list = view.q('[data-diple-list]')
      await act(async () => {
        list.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }))
        await tick(5)
      })
    }
    let display
    if (path === 'middleware') {
      const mw = h.find('composer.middleware', (c) => c.id === 'send-middleware').data
      display = (await act(async () => mw.handler({ text: '请逐条看一下' }))).text
    } else {
      assert.equal(sdk.submits.length, 1, `${path}: one submit`)
      display = sdk.submits[0].text
    }
    const b = batchIdOf(h)
    out.push({ path, display: norm(display, b), full: norm(lastPut(h).body.full, b) })
  }
  assert.ok(out[0].display.startsWith('请逐条看一下\n\n—— 附 2 条标注 ——'))
  assert.ok(out[0].display.endsWith('@diple:<B>'))
  assert.equal(out[1].display, out[0].display)
  assert.equal(out[2].display, out[0].display)
  assert.equal(out[1].full, out[0].full)
  assert.equal(out[2].full, out[0].full)
})

test('27: the list sends without any body; the used draft is cleared from the composer', async () => {
  const h = fresh()
  const view = await mount(h)
  await add(h, view, 'a1')
  await click(view.q('[data-diple-send]'))
  assert.ok(sdk.submits[0].text.startsWith('—— 附 1 条标注 ——'))
  const h2 = fresh()
  const v2 = await mount(h2)
  await add(h2, v2, 'a1')
  sdk.drafts.set('stored-1', '正文')
  await click(v2.q('[data-diple-send]'))
  await act(async () => tick(5))
  assert.equal(sdk.drafts.get('stored-1'), '', 'draft taken as the body is cleared')
})

test('28: the middleware skips text that already carries @diple: and drafts with an empty list', async () => {
  const h = fresh()
  const mw = h.find('composer.middleware', (c) => c.id === 'send-middleware').data
  assert.deepEqual(await mw.handler({ text: 'hi' }), { text: 'hi' })
  const view = await mount(h)
  await add(h, view, 'a1')
  const own = { text: '—— 附 1 条标注 ——\n@diple:bxxxxaaaabbbbccccddddeeeeff' }
  assert.equal(await mw.handler(own), own)
  assert.equal(h.backend.puts().length, 0)
})

test('28b (B-1): a message that only mentions the @diple: prefix still gets the list attached', async () => {
  const h = fresh()
  const mw = h.find('composer.middleware', (c) => c.id === 'send-middleware').data
  const view = await mount(h)
  await add(h, view, 'a1')
  const out = await mw.handler({ text: '代码里的 `@diple:` 前缀建议改成别的' })
  assert.ok(out && typeof out.text === 'string')
  assert.ok(/@diple:b[a-z2-7]{26}$/.test(out.text), 'our own reference is appended')
  assert.equal(h.backend.puts().length, 1)
})

// -- 29, 30: preview and receipt ------------------------------------------------------
test('29: preview shows the bubble text and the full version, with the size', async () => {
  const h = fresh()
  sdk.state.focusedUsage.set({ context_max: 64000, calls: 1, input: 0, output: 0 })
  const view = await mount(h)
  await add(h, view, 'a1', '意见甲')
  await click(view.q('[data-diple-preview-open]'))
  const dlg = view.q('[data-diple-preview]')
  assert.ok(dlg, 'preview dialog open')
  assert.match(dlg.textContent, /对话气泡里显示/)
  assert.match(dlg.textContent, /用户的意见: 意见甲/)
  assert.match(dlg.textContent, /回应规则/)
  assert.match(dlg.textContent, /占上下文 \d+%/)
  assert.equal(h.backend.puts().length, 0, 'preview registers nothing')
})

test('30/36: success clears the list and leaves "已附 N 条标注 · 查看 AI 收到的内容" until the next send', async () => {
  const h = fresh()
  const view = await mount(h)
  await add(h, view, 'a1', '意见')
  await add(h, view, 'a2')
  await click(view.q('[data-diple-send]'))
  assert.equal(view.qa('[data-diple-id]').length, 2, 'locked, still listed while sending')
  const b = await deliver(h)
  assert.equal(view.q('[data-diple-id]'), null, 'list cleared')
  const row = view.q(`[data-diple-receipt="${b}"]`)
  assert.match(row.textContent, /已附 2 条标注/)
  await click(view.q('[data-diple-receipt-view]'))
  await act(async () => tick(10))
  const got = view.q(`[data-diple-received="${b}"]`)
  assert.ok(got, 'received dialog shows the backend batch')
  assert.match(got.textContent, /缓存要先更新数据库/)
  // a later plain send (another turn starts) removes the row
  await h.fire('message.start', {})
  assert.equal(view.q('[data-diple-receipt]'), null)
})

// -- 31, 32, 33: texts ------------------------------------------------------------------
test('31/32/33: bubble has comment and origin; full says who said it; long text is clipped', async () => {
  const h = fresh()
  const view = await mount(h)
  await add(h, view, 'u1', '我自己的话')
  await add(h, view, 'a1', 'AI 的话')
  const long = document.getElementById('a2')
  long.firstChild.data = '长'.repeat(4500)
  await add(h, view, 'a2')
  await click(view.q('[data-diple-send]'))
  const display = sdk.submits[0].text
  assert.match(display, /意见：我自己的话/)
  assert.match(display, /我的第 1 条消息/)
  const full = lastPut(h).body.full
  assert.match(full, /用户说的/)
  assert.match(full, /你（AI）说的/)
  assert.match(full, /中间省略 1500 字/)
  long.firstChild.data = '第二条回复的内容在这里。'
})

// -- 34: failures ----------------------------------------------------------------------
test('34: backend down → list kept, unlocked, reason shown', async () => {
  const backend = fakeBackend()
  backend.setFailPut(true)
  const h = fresh({ backend })
  const view = await mount(h)
  await add(h, view, 'a1')
  await click(view.q('[data-diple-send]'))
  assert.equal(sdk.submits.length, 0)
  assert.equal(view.qa('[data-diple-id]').length, 1)
  assert.equal(view.q('[data-diple-send]').disabled, false)
  assert.equal(sdk.notifications.at(-1).message, '无法登记这批标注（插件后端没有响应）')
})

test('34: expanded but refused over the hard limit → the same items come back, reason shown', async () => {
  const h = fresh()
  const view = await mount(h)
  await add(h, view, 'a1', '意见')
  const before = view.q('[data-diple-id]').getAttribute('data-diple-id')
  await click(view.q('[data-diple-send]'))
  await deliver(h, { persisted: false, answer: '@ context injection refused: 40134 tokens exceeds the 50% hard limit (32000).' })
  const cards = view.qa('[data-diple-id]')
  assert.equal(cards.length, 1, 'restored')
  assert.equal(cards[0].getAttribute('data-diple-id'), before, 'same item id')
  assert.equal(h.deps.lists.get('stored-1').items[0].comment, '意见', 'comment kept')
  assert.equal(sdk.notifications.at(-1).message, '宿主拒绝了这一轮（内容超过上下文上限）')
  assert.equal(view.q('[data-diple-receipt]'), null)
  assert.equal(view.q('[data-diple-notice]'), null, 'a refused turn is not answer-checked')
  const failed = h.backend.calls.find((c) => c.path === `/batches/${batchIdOf(h)}/failed`)
  assert.deepEqual(failed.body, { reason: 'refused', rejected: true }, 'W3: the expanded batch is marked failed')
  assert.equal(h.backend.batches.get(batchIdOf(h)).status, 'failed')
})

test('34: refused through the error event before batch.sent arrives → list unlocked, no notice later', async () => {
  const h = fresh()
  const view = await mount(h)
  await add(h, view, 'a1', '意见')
  await click(view.q('[data-diple-send]'))
  const b = batchIdOf(h)
  h.backend.expand(b)
  await h.fire('message.start', {})
  await h.fire('error', { message: '@ context injection refused: too big' })
  await h.fire('plugin.diple.batch.sent', { v: 1, batchId: b, sessionId: 'stored-1', items: [] }, '')
  await h.fire('message.complete', { status: 'complete', text: 'whatever' })
  assert.equal(view.qa('[data-diple-id]').length, 1)
  assert.equal(view.q('[data-diple-send]').disabled, false)
  assert.equal(view.q('[data-diple-notice]'), null)
  assert.equal(h.backend.batches.get(b).status, 'failed', 'W3: expanded, then refused → failed in the backend')
})

test('34: an error event for the session fails the send and unlocks the list', async () => {
  const h = fresh()
  const view = await mount(h)
  await add(h, view, 'a1')
  await click(view.q('[data-diple-send]'))
  await h.fire('error', { message: 'Context injection refused.' })
  assert.equal(view.q('[data-diple-send]').disabled, false)
  assert.equal(sdk.notifications.at(-1).message, '这一轮出错了，AI 没有收到标注')
  assert.equal(h.backend.batches.get(batchIdOf(h)).status, 'failed')
})

test('34: a message.complete of some other turn (batch never expanded) does not count as delivery', async () => {
  const h = fresh()
  const view = await mount(h)
  await add(h, view, 'a1')
  await click(view.q('[data-diple-send]'))
  await h.fire('message.complete', { status: 'complete', text: 'x', persisted_turn: { user_row_id: 3 } })
  assert.equal(view.qa('[data-diple-id]').length, 1, 'still pending')
  assert.equal(view.q('[data-diple-send]').disabled, true)
})

test('25%/50%: soft limit warns in the footer and on send; hard limit blocks the button and the middleware', async () => {
  const h = fresh()
  const view = await mount(h)
  await add(h, view, 'a1')
  await act(async () => sdk.state.focusedUsage.set({ context_max: 100, calls: 1, input: 0, output: 0 }))
  assert.match(view.q('[data-diple-footer]').textContent, /超过宿主 50% 的上限/)
  assert.equal(view.q('[data-diple-send]').disabled, true)
  const mw = h.find('composer.middleware', (c) => c.id === 'send-middleware').data
  assert.equal(await act(async () => mw.handler({ text: '正文' })), null, 'typed text stays in the composer')
  assert.match(sdk.notifications.at(-1).title, /消息没有发出/)
  const tokens = Envelope.compose({ body: '', items: [{ id: 'x', origin: { role: 'assistant', ordinal: 2, roleOrdinal: 1 }, text: '缓存要先更新数据库，再删除缓存。', comment: '' }], batchId: 'preview', lang: 'zh' }).stats.tokens
  await act(async () => sdk.state.focusedUsage.set({ context_max: Math.round(tokens * 3), calls: 1, input: 0, output: 0 }))
  assert.match(view.q('[data-diple-footer]').textContent, /宿主会提示内容偏长/)
  await click(view.q('[data-diple-send]'))
  assert.ok(sdk.notifications.some((n) => n.title === '标注内容偏长'))
  assert.equal(sdk.submits.length, 1, 'soft limit still sends')
})

// -- 35: busy ------------------------------------------------------------------------------
test('35: busy → "回答完后发送" queues (persisted), the reply ending sends it; steer leaves the list', async () => {
  const h = fresh()
  const view = await mount(h)
  await add(h, view, 'a1', '意见')
  await act(async () => sdk.state.busy.set(true))
  const btn = view.q('[data-diple-send-after]')
  assert.equal(btn.textContent, '回答完后发送')
  assert.match(view.q('[data-diple-footer]').textContent, /插话/)
  // a steer (plain Enter in the composer while busy) gets the notice, list untouched
  const composer = document.getElementById('composer')
  composer.textContent = '换个方向'
  composer.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  assert.equal(sdk.notifications.at(-1).title, '插话已发出；标注没有跟着发，会在下次发送时附上')
  composer.textContent = ''
  await click(btn)
  assert.equal(sdk.submits.length, 0)
  assert.ok(h.ctx.storage.get('queue.stored-1', null), 'queue persisted')
  assert.match(view.q('[data-diple-footer]').textContent, /回答完后自动发送/)
  // the running reply finishes
  sdk.state.busy.set(false)
  await h.fire('message.complete', { status: 'complete', text: 'w1 w2', persisted_turn: { user_row_id: 4 } })
  await act(async () => tick(20))
  assert.equal(sdk.submits.length, 1, 'sent after the reply')
  assert.match(sdk.submits[0].text, /@diple:/)
  assert.equal(h.ctx.storage.get('queue.stored-1', null), null)
})

test('35: the queue can be cancelled, and a stalled queue offers "现在发送"', async () => {
  const h = fresh()
  const view = await mount(h)
  await add(h, view, 'a1')
  await act(async () => sdk.state.busy.set(true))
  await click(view.q('[data-diple-send-after]'))
  await click(view.q('[data-diple-queue-cancel]'))
  assert.equal(h.ctx.storage.get('queue.stored-1', null), null)
  assert.equal(sdk.notifications.at(-1).title, '已取消排队，标注留在列表里')
  await click(view.q('[data-diple-send-after]'))
  await act(async () => sdk.state.busy.set(false))
  await h.fire('message.complete', { status: 'interrupted', text: '' })
  assert.equal(sdk.submits.length, 0, 'interrupted reply does not drain')
  assert.match(view.q('[data-diple-footer]').textContent, /没有正常结束/)
  await click(view.q('[data-diple-send]'))
  assert.equal(sdk.submits.length, 1)
})

test('35: a queued session that is not on screen waits, then sends when it is focused again', async () => {
  const h = fresh()
  const view = await mount(h)
  await add(h, view, 'a1')
  await act(async () => sdk.state.busy.set(true))
  await click(view.q('[data-diple-send-after]'))
  sdk.submitResult = false
  sdk.state.busy.set(false)
  await h.fire('message.complete', { status: 'complete', text: 'x' })
  await act(async () => tick(20))
  assert.equal(sdk.notifications.at(-1).message, '回答已结束，但这个会话不在前台；切回这个会话后会自动发出')
  assert.ok(h.ctx.storage.get('queue.stored-1', null).waiting)
  sdk.submitResult = true
  await act(async () => {
    sdk.state.focusedStoredSessionId.set('stored-2')
    sdk.state.focusedStoredSessionId.set('stored-1')
    await tick(20)
  })
  assert.equal(sdk.submits.filter((s) => s.text.includes('@diple:')).length, 2, 'refused once, then sent')
})

// -- 37, 38, 39: markers ------------------------------------------------------------------
async function renderMarker(h, attrs) {
  const ann = h.find('transcript.directives').data
  const el = document.createElement('div')
  el.setAttribute('data-test-mount', '')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => {
    root.render(ann.render({ attrs, source: `::ann{b="${attrs.b}" n="${attrs.n}"}`, streaming: false }))
    await tick(5)
  })
  return el
}

test('37/38/39: "↩ 批注 ①③", hover = comments + openings, highlights and unknown numbers ignored, click locates', async () => {
  const h = fresh()
  const view = await mount(h)
  await add(h, view, 'a1', '意见一')
  await add(h, view, 'a1b')
  await add(h, view, 'a2', '意见三')
  await click(view.q('[data-diple-send]'))
  const b = await deliver(h)
  const el = await renderMarker(h, { b, n: '1,2,3,9' })
  const btn = el.querySelector('[data-diple-ann]')
  assert.equal(btn.textContent, '↩ 批注 ①③')
  assert.match(btn.title, /意见一/)
  assert.match(btn.title, /意见三/)
  assert.match(btn.title, /缓存要先更新数据库/)
  const highlightOnly = await renderMarker(h, { b, n: '2' })
  assert.equal(highlightOnly.textContent, '', 'a highlight gets no marker')
  // click → capture's locate (merged in W3) or the fallback scrolls to the message
  scrolled.length = 0
  const before = sdk.notifications.length
  await click(btn)
  await tick(20)
  assert.ok(scrolled.some((el) => el.closest?.('[data-message-id="101-1-assistant"]')), 'the original passage is scrolled into view')
  assert.equal(sdk.notifications.length, before, 'a successful jump shows no notice')
})

test('37: original message no longer on screen → "not loaded" notice', async () => {
  const h = fresh()
  const view = await mount(h)
  await add(h, view, 'a1', '意见')
  await click(view.q('[data-diple-send]'))
  const b = await deliver(h)
  const el = await renderMarker(h, { b, n: '1' })
  const p = document.getElementById('a1')
  const saved = p.firstChild.data
  p.firstChild.data = '已经重新生成的内容'
  const before = sdk.notifications.length
  await click(el.querySelector('[data-diple-ann]'))
  await tick(20)
  // exactly one notice (capture's locate owns it once merged), warning the text moved on
  assert.equal(sdk.notifications.length, before + 1)
  assert.ok(sdk.notifications.at(-1).title, 'a notice explains why the jump failed')
  p.firstChild.data = saved
})

test('marker of a batch this window never sent is fetched from the backend', async () => {
  const backend = fakeBackend()
  backend.batches.set('bremote1', { batchId: 'bremote1', sessionId: 'stored-1', status: 'answered', items: [{ id: 'x', origin: null, text: 'T', comment: 'C' }] })
  const h = fresh({ backend })
  const el = await renderMarker(h, { b: 'bremote1', n: '1' })
  assert.equal(el.textContent, '↩ 批注 ①')
})

// -- 40, 41: missing answers --------------------------------------------------------------
test('40: a missing comment → "批注 ③ 没有回应 · 放回待发"; put back re-adds it; batch.answered broadcast', async () => {
  const h = fresh()
  const view = await mount(h)
  await add(h, view, 'a1', '意见一')
  await add(h, view, 'a1b')
  await add(h, view, 'a2', '意见三')
  await click(view.q('[data-diple-send]'))
  const b = await deliver(h, { answer: (b) => `::ann{b="${b}" n="1"}\n\n回答一` })
  const notice = view.q('[data-diple-notice="missing"]')
  assert.ok(notice, 'notice shown')
  assert.match(notice.textContent, /批注 ③ 没有回应·放回待发/)
  assert.doesNotMatch(notice.textContent, /批注 ①/)
  const answered = h.backend.events.find((e) => e.path === '/events/batch-answered')
  assert.equal(answered.body.batchId, b)
  assert.equal(answered.body.answered.length, 1)
  assert.deepEqual(h.backend.batches.get(b).answer, { answered: [1], missing: [3], noMarkers: false })
  await click(view.q('[data-diple-put-back="3"]'))
  await act(async () => tick(5))
  const cards = view.qa('[data-diple-id]')
  assert.equal(cards.length, 1)
  assert.equal(h.deps.lists.get('stored-1').items[0].comment, '意见三')
  assert.equal(view.q('[data-diple-notice]'), null, 'notice gone once everything is back')
})

test('40: all answered → no notice', async () => {
  const h = fresh()
  const view = await mount(h)
  await add(h, view, 'a1', '意见一')
  await click(view.q('[data-diple-send]'))
  await deliver(h, { answer: (b) => `::ann{b="${b}" n="1"}\n\n回答` })
  assert.equal(view.q('[data-diple-notice]'), null)
})

test('41: no markers at all → a single "这次回答没有逐条标注" notice; checked once per batch', async () => {
  const h = fresh()
  const view = await mount(h)
  await add(h, view, 'a1', '意见一')
  await add(h, view, 'a2', '意见二')
  await click(view.q('[data-diple-send]'))
  const b = await deliver(h, { answer: '我没有写任何标记。' })
  const notices = view.qa('[data-diple-notice]')
  assert.equal(notices.length, 1)
  assert.equal(notices[0].getAttribute('data-diple-notice'), 'none')
  assert.match(notices[0].textContent, /这次回答没有逐条标注/)
  // the same batch is never checked twice (other windows, reloads)
  await h.fire('message.complete', { status: 'complete', text: 'again', persisted_turn: { user_row_id: 12 } })
  assert.equal(view.qa('[data-diple-notice]').length, 1)
  assert.equal(h.backend.batches.get(b).status, 'answered')
  await click(view.q('[data-diple-put-back]'))
  await act(async () => tick(5))
  assert.equal(view.qa('[data-diple-id]').length, 2, 'both comments back')
})

test('40: only status=complete is checked (an interrupted reply is not)', async () => {
  const h = fresh()
  const view = await mount(h)
  await add(h, view, 'a1', '意见一')
  await click(view.q('[data-diple-send]'))
  const b = await deliver(h, { status: 'interrupted', answer: 'partial' })
  assert.equal(view.q('[data-diple-notice]'), null)
  assert.equal(h.backend.batches.get(b).status, 'expanded')
})

test('39: a batch of highlights only never produces a missing-answer notice', async () => {
  const h = fresh()
  const view = await mount(h)
  await add(h, view, 'a1')
  await click(view.q('[data-diple-send]'))
  await deliver(h, { answer: 'no markers' })
  assert.equal(view.q('[data-diple-notice]'), null)
})

// -- hand-off --------------------------------------------------------------------------------
const handoff = (over = {}) => ({
  v: 1,
  handoffId: 'h-1234',
  targetSessionId: 'stored-1',
  sendNow: false,
  items: [
    { origin: { plugin: 'diple-docs', itemId: 'r1', revision: 2, path: 'docs/plan.md', line: 12 }, text: '第一段原文', comment: '这里要改' },
    { origin: { plugin: 'diple-docs', itemId: 'r2', revision: 1, path: 'docs/plan.md', line: 30 }, text: '第二段原文', comment: '' }
  ],
  ...over
})

test('hand-off: two windows hear it, only one claim wins; the items land once; receipt lists them', async () => {
  const backend = fakeBackend()
  const a = fresh({ backend })
  const b = fresh({ backend })
  const view = await mount(a)
  await a.fire('plugin.diple-docs.handoff', handoff(), '')
  await b.fire('plugin.diple-docs.handoff', handoff(), '')
  assert.equal(backend.calls.filter((c) => c.path.startsWith('/handoff/h-1234/claim')).length, 2)
  const receipts = backend.events.filter((e) => e.path === '/events/handoff-receipt')
  assert.equal(receipts.length, 1, 'exactly one receipt')
  assert.deepEqual(receipts[0].body, { handoffId: 'h-1234', accepted: ['r1', 'r2'] })
  assert.equal(receipts[0].settles, true, 'this receiver declares it settles (ADR 0007)')
  assert.equal(view.qa('[data-diple-id]').length, 2)
  assert.equal(sdk.submits.length, 0)
})

test('hand-off sendNow: claimed, added and sent through the one flow; receipt carries the batch id', async () => {
  const h = fresh()
  await h.fire('plugin.diple-docs.handoff', handoff({ handoffId: 'h-send1', sendNow: true }), '')
  assert.equal(sdk.submits.length, 1)
  const b = batchIdOf(h)
  const receipt = h.backend.events.find((e) => e.path === '/events/handoff-receipt')
  assert.deepEqual(receipt.body, { handoffId: 'h-send1', accepted: ['r1', 'r2'], batchId: b })
  const full = lastPut(h).body.full
  assert.match(full, /docs\/plan\.md 第 12 行/)
  assert.match(full, /文件内容/)
})

test('W3 hand-off end to end: review origins survive verbatim into the batch and come back in batch.answered', async () => {
  const h = fresh()
  const sent = handoff({ handoffId: 'h-e2e1', sendNow: true })
  await h.fire('plugin.diple-docs.handoff', sent, '')
  const b = batchIdOf(h)
  const put = lastPut(h).body
  assert.deepEqual(
    put.items.map((it) => it.origin),
    sent.items.map((it) => it.origin),
    'batch items keep { plugin, itemId, revision, path, line } exactly'
  )
  const receipt = h.backend.events.find((e) => e.path === '/events/handoff-receipt')
  assert.deepEqual(receipt.body.accepted, ['r1', 'r2'])
  // r1 has a comment (comment ①); r2 is a highlight. The AI answers ①.
  await deliver(h, { answer: (id) => `::ann{b="${id}" n="1"}\n\n改好了` })
  const answered = h.backend.events.find((e) => e.path === '/events/batch-answered')
  assert.ok(answered, 'batch.answered is broadcast')
  assert.equal(answered.body.batchId, b)
  assert.deepEqual(answered.body.answered, [{ origin: sent.items[0].origin }])
})

test('W3 XE-05/XR-02: a re-sent review item updates its card; same text from another item is kept; accepted = what is stored', async () => {
  const h = fresh()
  const view = await mount(h)
  const item = (itemId, revision, line, text, comment) => ({ origin: { plugin: 'diple-docs', itemId, revision, path: 'docs/plan.md', line }, text, comment })
  const receipt = (id) => h.backend.events.find((e) => e.path === '/events/handoff-receipt' && e.body.handoffId === id)?.body
  await h.fire('plugin.diple-docs.handoff', handoff({ handoffId: 'h-v1', items: [item('r1', 1, 4, '同一段原文', '旧意见')] }), '')
  await h.fire('plugin.diple-docs.handoff', handoff({ handoffId: 'h-v2', items: [item('r1', 2, 4, '同一段原文', '新意见')] }), '')
  await h.fire('plugin.diple-docs.handoff', handoff({ handoffId: 'h-r2', items: [item('r2', 1, 20, '同一段原文', '另一处的意见')] }), '')
  const stored = () => h.ctx.storage.get('list.stored-1', { items: [] }).items
  assert.deepEqual(
    stored().map((it) => [it.origin.itemId, it.origin.revision, it.comment]),
    [['r1', 2, '新意见'], ['r2', 1, '另一处的意见']]
  )
  assert.equal(view.qa('[data-diple-id]').length, 2)
  assert.deepEqual(receipt('h-v1').accepted, ['r1'])
  assert.deepEqual(receipt('h-v2').accepted, ['r1'])
  assert.deepEqual(receipt('h-r2').accepted, ['r2'])
  // an older revision arriving late is not stored and not confirmed
  await h.fire('plugin.diple-docs.handoff', handoff({ handoffId: 'h-old', items: [item('r1', 1, 4, '同一段原文', '旧意见')] }), '')
  assert.deepEqual(receipt('h-old').accepted, [])
  assert.equal(stored()[0].comment, '新意见')
})

test('W3 XE-05: a review item whose card is being sent is not overwritten nor confirmed', async () => {
  const h = fresh()
  const item = (revision, comment) => ({ origin: { plugin: 'diple-docs', itemId: 'r9', revision, path: 'docs/plan.md', line: 2 }, text: '锁定中的原文', comment })
  await h.fire('plugin.diple-docs.handoff', handoff({ handoffId: 'h-l1', items: [item(1, '第一版')] }), '')
  await act(async () => sdk.state.busy.set(false))
  const view = await mount(h)
  await click(view.q('[data-diple-send]')) // registered + submitted: the card is locked until delivery
  await h.fire('plugin.diple-docs.handoff', handoff({ handoffId: 'h-l2', items: [item(2, '第二版')] }), '')
  const r = h.backend.events.find((e) => e.path === '/events/handoff-receipt' && e.body.handoffId === 'h-l2').body
  assert.deepEqual(r.accepted, [])
  const st = h.ctx.storage.get('list.stored-1')
  assert.equal(st.items[0].comment, '第一版')
})

// Wait for a condition instead of a fixed sleep: the timers under test run on wall
// time, which a loaded machine stretches; `within` is only a generous deadline.
async function until(cond, what, { within = 15_000, step = 25 } = {}) {
  const end = Date.now() + within
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out after ${within} ms waiting for ${what}`)
    await act(async () => tick(step))
  }
}

test('W3 hand-off sendNow from the review page: composer not on screen → the session is opened and the send retried', async () => {
  const h = fresh()
  const opened = []
  const prevOpen = sdk.openSession
  sdk.openSession = async (id) => {
    opened.push(id)
    sdk.submitResult = true
  }
  sdk.submitResult = false
  try {
    await h.fire('plugin.diple-docs.handoff', handoff({ handoffId: 'h-reveal', sendNow: true }), '')
    const receiptOf = () => h.backend.events.find((e) => e.path === '/events/handoff-receipt' && e.body.handoffId === 'h-reveal')
    await until(() => receiptOf() && sdk.submits.filter((x) => x.text.includes('@diple:')).length >= 2, 'the retried send and its receipt')
    assert.deepEqual(opened, ['stored-1'])
    const receipt = h.backend.events.find((e) => e.path === '/events/handoff-receipt' && e.body.handoffId === 'h-reveal')
    assert.ok(receipt?.body.batchId, 'the retried send carries a batch')
    assert.equal(sdk.submits.filter((x) => x.text.includes('@diple:')).length, 2, 'refused while hidden, then accepted')
  } finally {
    sdk.openSession = prevOpen
    sdk.submitResult = true
  }
})

test('hand-off for a session this window is not showing: claims only after a pause', async () => {
  const h = fresh()
  sdk.state.focusedStoredSessionId.set('stored-9')
  const t0 = Date.now()
  await h.fire('plugin.diple-docs.handoff', handoff({ handoffId: 'h-late1' }), '')
  const claimOf = () => h.backend.calls.find((c) => c.path === '/handoff/h-late1/claim')
  await act(async () => tick(0))
  assert.equal(claimOf(), undefined, 'not claimed at once')
  await until(claimOf, 'the claim')
  assert.ok(Date.now() - t0 >= 1500, 'only after the pause')
  sdk.state.focusedStoredSessionId.set('stored-1')
  const view = await mount(h)
  assert.equal(view.qa('[data-diple-id]').length, 2, 'items in the target session list')
})

test('hand-off while the plugin is off: ignored, no claim, no receipt', async () => {
  const h = fresh({ settings: { enabled: false } })
  await h.fire('plugin.diple-docs.handoff', handoff({ handoffId: 'h-off1' }), '')
  assert.equal(h.backend.calls.length, 0)
})

// -- 42: master switch -----------------------------------------------------------------------
test('42: master switch off → middleware passes through, markers are plain text, no receipt row, send refused', async () => {
  const h = fresh({ settings: { enabled: false } })
  const mw = h.find('composer.middleware', (c) => c.id === 'send-middleware').data
  assert.deepEqual(await mw.handler({ text: 'x' }), { text: 'x' })
  const el = await renderMarker(h, { b: 'bsome1234', n: '1' })
  assert.equal(el.textContent, '::ann{b="bsome1234" n="1"}')
  assert.equal(el.querySelector('button'), null)
  await act(async () => h.find('keybinds', (c) => c.data.id === 'diple.send').data.run())
  assert.equal(sdk.notifications.at(-1).message, '圈批插件已停用')
})

// -- 43: shortcuts ---------------------------------------------------------------------------
test('43: "send" is a rebindable keybind that does not take ⌘↩ from the composer; ⌘↩ works inside the list only', async () => {
  const h = fresh()
  const k = h.find('keybinds', (c) => c.data.id === 'diple.send').data
  assert.deepEqual(k.defaults, ['mod+shift+enter'])
  assert.equal(k.label, '圈批：发送待发列表')
  const view = await mount(h)
  await add(h, view, 'a1')
  // ⌘↩ in the composer is the host's queue: untouched
  document.getElementById('composer').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }))
  assert.equal(sdk.submits.length, 0)
  // IME composition ⌘↩ inside the list: nothing
  const list = view.q('[data-diple-list]')
  list.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', metaKey: true, keyCode: 229, bubbles: true }))
  assert.equal(sdk.submits.length, 0)
  await act(async () => {
    k.run()
    await tick(5)
  })
  assert.equal(sdk.submits.length, 1, 'the keybind sends')
})

test('43: ⌘⏎ while typing a comment saves the comment first', async () => {
  // V2: the comment is typed in the editor beside the original (V2-T). Its
  // ⌘⏎ saves into the list, then says uiBus.sendNow(); the send goes out
  // with the comment through the one send flow.
  const h = fresh()
  const view = await mount(h)
  await add(h, view, 'a1', undefined, 0, 6)
  const [it] = h.deps.lists.get('stored-1').items
  await act(async () => {
    h.deps.uiBus.editorOpened(it.id)
    h.deps.lists.dispatch('stored-1', { type: 'editComment', id: it.id, comment: '还没按回车的意见' })
    h.deps.uiBus.sendNow()
    await tick(5)
  })
  // V2: ⌘↩ in the editor beside the text saves the comment, then asks uiBus.sendNow();
  // the send itself is send/'s subscription (V2-C), tested there.
  assert.equal(h.ctx.storage.get('list.stored-1').items[0].comment, '还没按回车的意见')
  void lastPut
})

// -- 44: language ------------------------------------------------------------------------------
test('44: pinned English → footer, marker and envelope in English; keybind and palette relabel live', async () => {
  const h = fresh({ settings: { language: 'en' } })
  const view = await mount(h)
  await add(h, view, 'a1', 'why?')
  assert.equal(view.q('[data-diple-send]').textContent, 'Send 1')
  assert.equal(view.q('[data-diple-preview-open]').textContent, 'Preview')
  const lastLabel = (id) => h.contributions.filter((c) => c.data?.id === id && c.area === 'palette').at(-1).data.label
  assert.equal(lastLabel('diple.send'), 'Diple: Send pending annotations')
  await click(view.q('[data-diple-send]'))
  assert.ok(sdk.submits[0].text.startsWith('—— 1 annotation attached ——'))
  const b = await deliver(h, { answer: (b) => `::ann{b="${b}" n="1"}\n\nok` })
  const el = await renderMarker(h, { b, n: '1' })
  assert.equal(el.textContent, '↩ Comment ①')
  // switch to Chinese from the settings page
  const page = h.find('settings.plugins')
  const host = document.createElement('div')
  host.setAttribute('data-test-mount', '')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(createElement(() => page.render())))
  await choose(host.querySelector('[data-diple-choice]'), 'zh')
  assert.equal(lastLabel('diple.send'), '圈批：发送待发列表')
  assert.equal(h.contributions.filter((c) => c.area === 'keybinds' && c.data.id === 'diple.send').at(-1).data.label, '圈批：发送待发列表')
  assert.ok([...host.querySelectorAll('[data-diple-choice] option')].some((x) => x.textContent === '跟随 app'))
  assert.match(host.querySelector('[data-diple-about]').textContent, /^Diple（›）是古希腊抄本页边的标记/, 'the one-line note on the name tops the settings page')
})

test('settings page: master switch, mark options and reset (keeps the language)', async () => {
  const h = fresh({ settings: { language: 'zh' } })
  const page = h.find('settings.plugins')
  const host = document.createElement('div')
  host.setAttribute('data-test-mount', '')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(createElement(() => page.render())))
  // V2-X: the toolbar on selection can be switched off (default on): an older
  // selectionButton:false would otherwise hide it with no way back
  const bar = host.querySelector('[data-diple-setting="selection-button"] input')
  assert.equal(bar.checked, true)
  assert.match(host.querySelector('[data-diple-setting="selection-button"]').textContent, /选中后显示工具条/)
  await act(async () => bar.click())
  assert.equal(h.ctx.storage.get('settings').selectionButton, false)
  await act(async () => host.querySelector('[data-diple-setting="selection-button"] input').click())
  assert.equal(h.ctx.storage.get('settings').selectionButton, true)
  const quiet = host.querySelector('[data-diple-setting="marks-quiet"] input')
  assert.equal(quiet.checked, false)
  await act(async () => quiet.click())
  assert.equal(h.ctx.storage.get('settings').marksQuiet, true)
  const keep = host.querySelector('[data-diple-setting="marks-keep-sent"] input')
  assert.equal(keep.checked, true)
  await act(async () => keep.click())
  assert.equal(h.ctx.storage.get('settings').marksKeepSent, false)
  const master = host.querySelector('[data-diple-setting="enabled"] input')
  await act(async () => master.click())
  assert.equal(h.ctx.storage.get('settings').enabled, false)
  assert.equal(host.querySelector('[data-diple-setting="marks-quiet"] input').disabled, true)
  await click(host.querySelector('[data-diple-reset]'))
  assert.deepEqual(h.ctx.storage.get('settings'), { enabled: true, language: 'zh', selectionButton: true, marksQuiet: false, marksKeepSent: true })
  await click(host.querySelector('[data-diple-open-keybinds]'))
  assert.deepEqual(sdk.navigations, ['/settings?tab=keybinds'])
})

// -- reload ----------------------------------------------------------------------------------
test('reload mid-send: an expanded batch is committed on load; a never-registered one is restored', async () => {
  const backend = fakeBackend()
  const h = fresh({ backend })
  const view = await mount(h)
  await add(h, view, 'a1')
  await click(view.q('[data-diple-send]'))
  const b = batchIdOf(h)
  backend.expand(b)
  const saved = [...h.store.entries()]
  // a new renderer with the same storage
  const h2 = fresh({ backend, storage: saved })
  await act(async () => tick(10))
  const v2 = await mount(h2)
  assert.equal(v2.q('[data-diple-id]'), null, 'committed')
  assert.ok(v2.q(`[data-diple-receipt="${b}"]`))
  // lost before registration
  const backend3 = fakeBackend()
  const h3 = fresh({ backend: backend3, storage: saved })
  await act(async () => tick(10))
  const v3 = await mount(h3)
  assert.equal(v3.qa('[data-diple-id]').length, 1, 'restored')
  assert.equal(v3.q('[data-diple-send]').disabled, false)
})

// -- fix-a (GPT code review R1) ----------------------------------------------------------------
test('R1 XE-09: the preview shows the composer text the send would carry', async () => {
  const h = fresh()
  const view = await mount(h)
  await add(h, view, 'a1', '意见甲')
  sdk.drafts.set('stored-1', '请比较这两种方案')
  await click(view.q('[data-diple-preview-open]'))
  const dlg = view.q('[data-diple-preview]')
  assert.ok(dlg, 'preview dialog open')
  assert.match(dlg.textContent, /请比较这两种方案\s*—— 附 1 条标注 ——/)
  await act(async () => document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  // the palette command does the same
  sdk.drafts.set('stored-1', '命令面板里的正文')
  await act(async () => {
    h.find('palette', (c) => c.data.id === 'diple.preview').data.run()
    await tick(5)
  })
  assert.match(view.q('[data-diple-preview]').textContent, /命令面板里的正文/)
  assert.equal(h.backend.puts().length, 0, 'preview registers nothing')
})

test('R1 XE-16: in split view each composer shows the receipt of its own session', async () => {
  const storage = [
    ['last.stored-1', JSON.stringify({ batchId: 'bone1111', count: 1, delivered: true })],
    ['last.stored-2', JSON.stringify({ batchId: 'btwo2222', count: 2, delivered: true })]
  ]
  const h = fresh({ storage })
  const under = h.find('composer.underside')
  const mountIn = async (attrs) => {
    const surface = document.createElement('div')
    surface.setAttribute('data-test-mount', '')
    surface.setAttribute('data-chat-surface', '')
    for (const [k, v] of Object.entries(attrs)) surface.setAttribute(k, v)
    document.body.appendChild(surface)
    const root = createRoot(surface)
    await act(async () => root.render(createElement(() => under.render())))
    await act(async () => tick(5))
    return surface
  }
  const primary = await mountIn({ 'data-composer-target': 'main', 'data-session-anchor': 'workspace' }) // hash: #/stored-1
  const tile = await mountIn({ 'data-composer-target': 'tile:stored-2', 'data-session-anchor': 'session-tile:stored-2' })
  const shown = () => [primary, tile].map((el) => el.querySelector('[data-diple-receipt]')?.getAttribute('data-diple-receipt') ?? null)
  assert.deepEqual(shown(), ['bone1111', 'btwo2222'])
  await act(async () => {
    sdk.state.focusedStoredSessionId.set('stored-2')
    await tick(5)
  })
  assert.deepEqual(shown(), ['bone1111', 'btwo2222'], 'moving the focus does not move the receipts')
})

test('W3 hand-off sendNow into a busy session: queued behind the answer, receipt says queued (XR-09)', async () => {
  const h = fresh()
  await act(async () => sdk.state.busy.set(true))
  await h.fire('plugin.diple-docs.handoff', handoff({ handoffId: 'h-busy1', sendNow: true }), '')
  assert.equal(sdk.submits.length, 0, 'nothing is submitted while the answer is still running')
  const receipt = h.backend.events.find((e) => e.path === '/events/handoff-receipt')
  assert.deepEqual(receipt.body, { handoffId: 'h-busy1', accepted: ['r1', 'r2'], queued: true })
})

// -- R2 XE-01: a batch whose delivery cannot be confirmed: the user decides ------------------
test('R2 XE-01: after a reload, an expanded batch the history cannot confirm offers "put back" under the composer', async () => {
  const backend = fakeBackend()
  const id = 'bunconfirmed1'
  const item = { id: 'it1', origin: { sessionId: 'stored-1', role: 'assistant', ordinal: 1 }, text: '缓存要先更新数据库', comment: '为什么' }
  backend.batches.set(id, { batchId: id, sessionId: 'stored-1', status: 'expanded', items: [item], full: 'x', createdAt: 1, expandedAt: 1 })
  const storage = [
    [`confirm.${id}`, JSON.stringify({ key: 'stored-1', batchId: id, at: 1000 })],
    ['confirm.index', JSON.stringify([id])],
    [`batch.${id}`, JSON.stringify({ batchId: id, sessionKey: 'stored-1', items: [item], at: 1000 })],
    ['batches.index', JSON.stringify([id])]
  ]
  const h = fresh({ backend, storage }) // the stub gateway has no history: unknown
  const view = await mount(h)
  await act(async () => tick(20))
  const row = view.q(`[data-diple-receipt="${id}"]`)
  assert.ok(row, 'the batch is shown as pending, not dropped')
  assert.match(row.textContent, /是否送达无法确认/)
  assert.doesNotMatch(row.textContent, /已附/)
  await click(view.q('[data-diple-unconfirmed-put-back]'))
  assert.equal(view.qa('[data-diple-id]').length, 1, 'the annotation is back in the pending list')
  assert.equal(view.q('[data-diple-receipt]'), null)
  assert.equal(JSON.parse(h.store.get('confirm.index')).length, 0)
})
