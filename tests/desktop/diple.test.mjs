// Diple desktop half, driven only through register(ctx) with the SDK stub.
import test from 'node:test'
import assert from 'node:assert/strict'

import { saveOpenEditor, setupDom, loadPlugin, makeCtx, fakeDipleBackend, tick } from './harness.mjs'

const html = `<!doctype html><html><head></head><body>
<div id="thread">
  <div data-slot="aui_user-message-root" data-role="user" data-message-id="41"><p>第一个问题</p></div>
  <div data-slot="aui_assistant-message-root" data-role="assistant"><p id="a1">缓存要先更新数据库，再删除缓存。</p></div>
  <div data-slot="aui_user-message-root" data-role="user" data-message-id="43"><p>第二个问题</p></div>
  <div data-slot="aui_assistant-message-root" data-role="assistant"><p id="a2">第二条回复的内容在这里。</p></div>
</div>
<div id="composer-top"></div>
</body></html>`

const w = setupDom(html)
const { act, createElement } = await import('react').then((React) => ({ act: React.act, createElement: React.createElement }))
const { createRoot } = await import('react-dom/client')
const plugin = await loadPlugin('diple')
const sdk = globalThis.__sdk

function select(id, from, to) {
  const node = document.getElementById(id).firstChild
  const range = document.createRange()
  range.setStart(node, from)
  range.setEnd(node, to)
  const sel = document.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
}

function fresh() {
  sdk.submits.length = 0
  sdk.notifications.length = 0
  sdk.submitResult = true
  sdk.state.focusedStoredSessionId.set('stored-1')
  const backend = fakeDipleBackend()
  const h = makeCtx({ rest: backend.rest })
  h.registerI18n('diple')
  h.deps = plugin.register(h.ctx)
  return { h, backend }
}

async function mount(h, contribution) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => root.render(createElement(() => contribution.render())))
  return { el, root, unmount: () => act(async () => root.unmount()).then(() => el.remove()) }
}

test('register contributes the list, the ⌘⇧E keybind, a palette command and the ann directive', () => {
  const { h } = fresh()
  assert.ok(h.find('composer.top'))
  assert.deepEqual(h.find('keybinds').data.defaults, ['mod+shift+e'])
  assert.equal(h.find('keybinds').data.id, 'diple.add')
  assert.equal(h.find('palette').data.id, 'diple.add')
  assert.equal(h.find('transcript.directives').data.name, 'ann')
})

const editorBox = () => document.querySelector('[data-diple-editor] textarea')

test('⌘⇧E on an assistant reply adds a card and focuses the comment box of the editor beside the text (V2)', async () => {
  const { h } = fresh()
  const view = await mount(h, h.find('composer.top'))
  select('a1', 0, 6)
  await act(async () => h.find('keybinds').data.run())
  // V2.1 #2: not on the strip until the editor saved it once
  assert.equal(view.el.querySelector('[data-diple-id]'), null)
  assert.equal(document.activeElement, editorBox())
  assert.equal(document.getSelection().isCollapsed, true)
  await act(async () => editorBox().dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  const card = view.el.querySelector('[data-diple-id]')
  assert.ok(card, 'chip rendered')
  // V2-C: the strip's chip shows the opening; its hover preview the origin.
  assert.match(card.textContent, /缓存要先更新/)
  await view.unmount()
})

test('nothing selected → a notice, no card', async () => {
  const { h } = fresh()
  document.getSelection().removeAllRanges()
  await act(async () => h.find('keybinds').data.run())
  assert.equal(sdk.notifications.at(-1).title, '没有选中文字')
  assert.equal(h.store.size, 0)
})

test('IME composition Enter does not finish the comment; plain Enter does', { skip: 'V2: comment editing moved from the card to the editor beside the original (V2-T capture/editor)' }, async () => {
  const { h } = fresh()
  const view = await mount(h, h.find('composer.top'))
  select('a2', 0, 5)
  await act(async () => h.find('keybinds').data.run())
  const ta = editorBox()
  ta.value = '拼音'
  await act(async () => ta.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true })))
  assert.equal(document.activeElement, ta, 'still editing during composition')
  assert.ok(!JSON.stringify([...h.store.values()]).includes('拼音'))
  await act(async () => ta.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  assert.ok(JSON.stringify([...h.store.values()]).includes('拼音'), 'saved on Enter')
  await view.unmount()
})

test('thin chain: select → comment → send → full registered, display submitted, list cleared → ↩ 批注 ①', async () => {
  const { h, backend } = fresh()
  const view = await mount(h, h.find('composer.top'))
  select('a1', 0, 16)
  await act(async () => h.find('keybinds').data.run())
  const ta = editorBox()
  ta.value = '为什么不是先删缓存？'
  await act(async () => ta.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  await act(async () => view.el.querySelector('[data-diple-send]').click())
  await act(async () => tick(10))
  const put = backend.calls.find((c) => c.method === 'PUT')
  assert.ok(put, 'batch registered')
  const batchId = put.path.split('/')[2]
  assert.match(put.body.full, /缓存要先更新数据库，再删除缓存。/)
  assert.match(put.body.full, /用户的意见: 为什么不是先删缓存？/)
  assert.equal(sdk.submits.length, 1)
  assert.equal(sdk.submits[0].sessionId, 'stored-1')
  assert.ok(sdk.submits[0].text.endsWith(`@diple:${batchId}`))
  assert.ok(view.el.querySelector('[data-diple-id]'), 'still listed until delivery is confirmed')
  backend.expand(batchId)
  await act(async () => h.emit('plugin.diple.batch.sent', { v: 1, batchId }))
  await act(async () => tick(10))
  assert.equal(view.el.querySelector('[data-diple-id]'), null, 'list cleared after expansion')
  await view.unmount()

  const ann = h.find('transcript.directives').data
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => root.render(ann.render({ attrs: { b: batchId, n: '1' }, source: '', streaming: false })))
  assert.equal(el.textContent, '↩ 批注 ①')
  assert.match(el.querySelector('button').title, /为什么不是先删缓存？/)
  await act(async () => root.render(ann.render({ attrs: { b: 'zzzz9999', n: '1' }, source: '', streaming: false })))
  await act(async () => tick(5))
  assert.equal(el.textContent, '', 'unknown batch renders nothing')
  await act(async () => root.unmount())
})

test('submit refused → list kept, unlocked, reason shown, batch marked failed', async () => {
  const { h, backend } = fresh()
  sdk.submitResult = false
  const view = await mount(h, h.find('composer.top'))
  select('a2', 0, 5)
  await act(async () => h.find('keybinds').data.run())
  await act(async () => (saveOpenEditor(), tick(5))) // V2.1 #2: saved once → on the strip
  await act(async () => view.el.querySelector('[data-diple-send]').click())
  await act(async () => tick(10))
  assert.ok(view.el.querySelector('[data-diple-id]'))
  assert.equal(view.el.querySelector('[data-diple-send]').disabled, false)
  assert.equal(sdk.notifications.at(-1).message, '找不到可以发送的输入框')
  assert.equal([...backend.batches.values()][0].status, 'failed')
  await view.unmount()
})

test('lists are per session and persist in plugin storage', async () => {
  const { h } = fresh()
  select('a1', 0, 4)
  await act(async () => h.find('keybinds').data.run())
  sdk.state.focusedStoredSessionId.set('stored-2')
  select('a2', 0, 4)
  await act(async () => h.find('keybinds').data.run())
  assert.equal(h.ctx.storage.get('list.stored-1').items.length, 1)
  assert.equal(h.ctx.storage.get('list.stored-2').items.length, 1)
  // a second plugin instance (app restart) reads them back
  const again = makeCtx()
  again.store.set('list.stored-1', JSON.stringify(h.ctx.storage.get('list.stored-1')))
  plugin.register(again.ctx)
  sdk.state.focusedStoredSessionId.set('stored-1')
  const view = await mount(again, again.find('composer.top'))
  assert.equal(view.el.querySelectorAll('[data-diple-id]').length, 1)
  await view.unmount()
})

test('pinned language overrides the app language', async () => {
  const { h } = fresh()
  h.ctx.storage.set('settings', { enabled: true, language: 'en' })
  const h2 = makeCtx()
  h2.ctx.storage.set('settings', { enabled: true, language: 'en' })
  plugin.register(h2.ctx)
  document.getSelection().removeAllRanges()
  await act(async () => h2.find('keybinds').data.run())
  assert.equal(sdk.notifications.at(-1).title, 'No text selected')
})

test('master switch off: keybind refuses, list hidden', async () => {
  const h = makeCtx()
  h.ctx.storage.set('settings', { enabled: false, language: 'auto' })
  plugin.register(h.ctx)
  select('a1', 0, 4)
  await act(async () => h.find('keybinds').data.run())
  assert.equal(sdk.notifications.at(-1).title, '圈批插件已停用')
  assert.equal(h.ctx.storage.get('list.stored-1', null), null)
})

test('no focused session: the list renders nothing and does not loop (React #185 regression)', async () => {
  const h = makeCtx()
  plugin.register(h.ctx)
  sdk.state.focusedStoredSessionId.set(null)
  const view = await mount(h, h.find('composer.top'))
  assert.equal(view.el.innerHTML, '')
  await act(async () => sdk.state.focusedStoredSessionId.set('stored-1'))
  await view.unmount()
})

