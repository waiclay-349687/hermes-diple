// W3 — the same session's pending list open in two windows. ctx.storage is
// shared (localStorage in the host); each window keeps its own cache. A write
// must never overwrite the other window's edits, and the other window repaints
// when the host fires the window `storage` event.
import test from 'node:test'
import assert from 'node:assert/strict'

import { saveOpenEditor, setupDom, loadPlugin, makeCtx, tick } from './harness.mjs'

const html = `<!doctype html><html><head></head><body>
<div data-chat-surface="" data-composer-target="main" data-session-anchor="workspace" id="thread">
  <div data-slot="aui_thread-viewport"><div data-slot="aui_thread-content">
    <div data-slot="aui_assistant-message-root" data-role="assistant" data-message-id="101-1-assistant"><div data-slot="aui_assistant-message-content"><p id="a1">缓存要先更新数据库，再删除缓存。</p><p id="a1b">并发写的时候可以延迟双删。</p><p id="a1c">最后再补一句。</p></div></div>
  </div></div>
</div>
</body></html>`

const w = setupDom(html)
w.location.hash = '#/stored-1'
w.Element.prototype.scrollIntoView = function () {}
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const plugin = await loadPlugin('diple')
const sdk = globalThis.__sdk
const KEY = 'list.stored-1'

/** Two "windows": two plugin instances over ONE storage. */
async function twoWindows() {
  sdk.state.focusedStoredSessionId.set('stored-1')
  const a = makeCtx()
  const b = makeCtx()
  b.ctx.storage = a.ctx.storage
  const views = []
  for (const h of [a, b]) {
    h.registerI18n('diple')
    plugin.register(h.ctx)
    const el = document.createElement('div')
    el.setAttribute('data-test-mount', '')
    document.body.appendChild(el)
    const root = createRoot(el)
    await act(async () => root.render(createElement(() => h.find('composer.top').render())))
    views.push({ el, root, cards: () => [...el.querySelectorAll('[data-diple-id]')] })
  }
  const done = async () => {
    for (const v of views) {
      await act(async () => v.root.unmount())
      v.el.remove()
    }
    a.dispose()
    b.dispose()
  }
  return { a, b, va: views[0], vb: views[1], done }
}

async function add(h, id) {
  const node = document.getElementById(id).firstChild
  const r = document.createRange()
  r.setStart(node, 0)
  r.setEnd(node, node.data.length)
  document.getSelection().removeAllRanges()
  document.getSelection().addRange(r)
  await act(async () => {
    await h.find('keybinds', (c) => c.data.id === 'diple.add').data.run()
    await tick(5)
  })
  await act(async () => (saveOpenEditor(), tick(5))) // V2.1 #2
}

const storageEvent = (key) =>
  act(async () => {
    w.dispatchEvent(new w.StorageEvent('storage', { key }))
    await tick(5)
  })

const stored = (h) => h.ctx.storage.get(KEY, { items: [] }).items.map((it) => it.text)

test('a write in one window keeps the other window’s items (read before write)', async () => {
  const { a, b, done } = await twoWindows()
  await add(a, 'a1') // window A
  await add(b, 'a1b') // window B: its cache was loaded before A wrote, and no event arrived
  assert.deepEqual(stored(a), ['缓存要先更新数据库，再删除缓存。', '并发写的时候可以延迟双删。'], 'both survive')
  await done()
})

test('the window storage event repaints the other window', async () => {
  const { a, b, va, vb, done } = await twoWindows()
  await add(a, 'a1')
  assert.equal(va.cards().length, 1)
  assert.equal(vb.cards().length, 0, 'B has not heard yet')
  await storageEvent('hermes.plugin.diple.list.stored-1')
  assert.equal(vb.cards().length, 1, 'B reloads on the storage event')
  // unrelated keys are ignored; a focus re-checks everything
  await add(a, 'a1b')
  await storageEvent('hermes.plugin.other.list.stored-1')
  assert.equal(vb.cards().length, 1)
  await act(async () => {
    w.dispatchEvent(new w.Event('focus'))
    await tick(5)
  })
  assert.equal(vb.cards().length, 2, 'focus picks up the missed change')
  assert.ok(b)
  await done()
})

test('a remove in one window is not undone by a later write in the other', async () => {
  const { a, b, done } = await twoWindows()
  await add(a, 'a1')
  await add(a, 'a1b')
  await storageEvent('hermes.plugin.diple.list.stored-1')
  const [first, second] = a.ctx.storage.get(KEY).items
  // A removes the first; B (without any event) edits the second's comment
  const rmA = document.querySelectorAll('[data-test-mount]')[0].querySelector(`[data-diple-id="${first.id}"] .diple-card-remove`)
  await act(async () => {
    rmA.click()
    await tick(5)
  })
  const items = () => a.ctx.storage.get(KEY, { items: [] }).items
  assert.deepEqual(items().map((it) => it.id), [second.id])
  assert.equal(document.querySelectorAll('[data-test-mount]')[1].querySelectorAll('[data-diple-id]').length, 2, 'B has not heard of the remove')
  await add(b, 'a1c') // B writes from its stale cache
  assert.deepEqual(items().map((it) => it.text), ['并发写的时候可以延迟双删。', '最后再补一句。'], 'the removed item stays removed')
  assert.equal(document.querySelectorAll('[data-test-mount]')[1].querySelectorAll('[data-diple-id]').length, 2, 'B repaints with the merged list')
  assert.ok(b)
  await done()
})
