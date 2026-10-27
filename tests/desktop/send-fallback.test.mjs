// W3 — Diple's send group installed WITHOUT capture: the `locate` service is
// absent, so a marker click must take send's own fallback (scroll the message
// by id, else by role ordinal + opening) and own the notice itself.
import test from 'node:test'
import assert from 'node:assert/strict'

import { setupDom, loadEntry, makeCtx, tick } from './harness.mjs'

const html = `<!doctype html><html><head></head><body>
<div id="thread">
  <div data-slot="aui_user-message-root" data-role="user" data-message-id="100-0-user"><p id="u1">第一个问题是关于缓存的</p></div>
  <div data-slot="aui_assistant-message-root" data-role="assistant" data-message-id="101-1-assistant"><p id="a1">缓存要先更新数据库，再删除缓存。</p></div>
</div>
</body></html>`

const w = setupDom(html)
const scrolled = []
w.Element.prototype.scrollIntoView = function () {
  scrolled.push(this)
}
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const plugin = await loadEntry('diple', 'tests/desktop/fixtures/diple-send-only.js')
const sdk = globalThis.__sdk

function fresh(batch) {
  sdk.notifications.length = 0
  sdk.locale.set('zh')
  const rest = async (p) => {
    if (p === `/batches/${batch.batchId}`) return batch
    if (p.startsWith('/batches?')) return { batches: [] }
    return {}
  }
  const h = makeCtx({ rest })
  h.registerI18n('diple')
  plugin.register(h.ctx)
  return h
}

async function renderMarker(h, attrs) {
  const ann = h.find('transcript.directives')?.data
  assert.ok(ann, 'the ann directive is registered')
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => {
    root.render(ann.render({ attrs, source: `::ann{b="${attrs.b}" n="${attrs.n}"}`, streaming: false }))
    await tick(10)
  })
  return el
}

const click = async (el) => {
  assert.ok(el, 'element to click exists')
  await act(async () => {
    el.click()
    await tick(10)
  })
}

test('no capture installed: marker click scrolls the message by id, no notice', async () => {
  const h = fresh({
    batchId: 'bfb1',
    sessionId: 'stored-1',
    status: 'answered',
    items: [{ id: 'x', origin: { sessionId: 'stored-1', role: 'assistant', roleOrdinal: 1, messageId: '101-1-assistant' }, text: '缓存要先更新数据库，再删除缓存。', comment: '为什么' }]
  })
  const el = await renderMarker(h, { b: 'bfb1', n: '1' })
  const btn = el.querySelector('[data-diple-ann]')
  assert.equal(btn.textContent, '↩ 批注 ①')
  scrolled.length = 0
  await click(btn)
  assert.equal(scrolled.length, 1)
  assert.equal(scrolled[0].getAttribute('data-message-id'), '101-1-assistant')
  assert.equal(sdk.notifications.length, 0)
  h.dispose()
})

test('no capture installed: message not on screen → send shows its own "not loaded" notice once', async () => {
  const h = fresh({
    batchId: 'bfb2',
    sessionId: 'stored-1',
    status: 'answered',
    items: [{ id: 'y', origin: { sessionId: 'stored-1', role: 'assistant', roleOrdinal: 5, messageId: '999-9-assistant' }, text: '早就翻过去的一段话', comment: '意见' }]
  })
  const el = await renderMarker(h, { b: 'bfb2', n: '1' })
  scrolled.length = 0
  await click(el.querySelector('[data-diple-ann]'))
  assert.equal(scrolled.length, 0)
  assert.equal(sdk.notifications.length, 1)
  assert.equal(sdk.notifications[0].title, '原文所在的消息还没加载，请向上翻动对话后再试')
  h.dispose()
})
