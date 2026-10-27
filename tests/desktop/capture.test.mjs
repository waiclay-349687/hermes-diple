// Capture (W2a): stories 1–26 and 2b, driven through register(ctx) with the SDK stub.
import test from 'node:test'
import assert from 'node:assert/strict'

import { saveOpenEditor, setupDom, loadPlugin, makeCtx, fakeDipleBackend, tick } from './harness.mjs'

const MAIN = 's-main'
const TILE = 's-tile'
const T1 = '1792855351.5'
const T2 = '1792855353.25'
const T3 = '1792855360.75'
const T4 = '1792855362.125'

const html = `<!doctype html><html><head></head><body>
<nav id="sidebar"><p id="side">侧栏里的文字</p></nav>
<div data-chat-surface="" data-composer-target="main" data-session-anchor="workspace" id="main">
  <div data-slot="aui_thread-viewport" id="vp-main"><div data-slot="aui_thread-content" id="tc-main">
    <div data-slot="aui_user-message-root" data-role="user" data-message-id="${T1}-0-user"><button><div><span data-slot="aui_user-message-text"><span data-slot="aui_user-inline-text" id="u1">我想问缓存的问题
第二行补充</span></span></div></button></div>
    <div data-slot="aui_assistant-message-root" data-role="assistant" data-message-id="${T2}-1-assistant"><div data-slot="aui_assistant-message-content" id="c1">
      <div data-slot="aui_thinking-disclosure"><p id="think">我先想一想这个问题</p></div>
      <h2 id="h">缓存策略</h2>
      <p id="a1">先更新<span data-streamdown="strong">数据库</span>，再删除缓存。</p>
      <div data-slot="tool-block"><pre id="tool">$ ls -la</pre></div>
      <ul id="ul"><li>第一点</li><li>第二点<ol><li>嵌套</li></ol></li></ul>
      <div data-slot="code-card"><button aria-label="copy"><svg></svg></button><div data-slot="code-card-body"><pre><div><pre class="shiki"><code id="code"><span class="line">def f(x):</span>
<span class="line">    return x + 1</span></code></pre></div></pre></div></div>
      <div class="aui-md-table"><table id="tbl"><thead><tr><th>列A<span data-md-col-handle="true"></span></th><th>列B</th></tr></thead><tbody><tr><td>1</td><td>2|3</td></tr></tbody></table></div>
    </div></div>
    <div data-slot="aui_user-message-root" data-role="user" data-message-id="${T3}-2-user"><span data-slot="aui_user-message-text"><span data-slot="aui_user-inline-text" id="u2">第二个问题</span></span></div>
    <div data-slot="aui_assistant-message-root" data-role="assistant" data-message-id="${T4}-3-assistant"><div data-slot="aui_assistant-message-content"><p id="a2">第二条回复的内容在这里。</p><p id="a2b">还有第三行。</p><p id="a2c">以及第四行。</p></div></div>
  </div></div>
  <div data-slot="composer-rich-input" contenteditable="true" id="composer">正在输入的草稿</div>
  <div id="top-main"></div>
</div>
<div data-chat-surface="" data-composer-target="tile:${TILE}" data-session-anchor="session-tile:${TILE}" id="tile">
  <div data-slot="aui_thread-viewport"><div data-slot="aui_thread-content" id="tc-tile">
    <div data-slot="aui_assistant-message-root" data-role="assistant" data-message-id="1792855400.5-1-assistant"><div data-slot="aui_assistant-message-content"><p id="t1">分屏里另一个会话的回答。</p></div></div>
  </div></div>
  <div id="top-tile"></div>
</div>
</body></html>`

const w = setupDom(html)
w.location.hash = `#/${MAIN}`
const scrolled = []
w.Element.prototype.scrollIntoView = function () {
  scrolled.push(this)
}
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const plugin = await loadPlugin('diple')
const sdk = globalThis.__sdk
const PRISTINE = document.body.innerHTML

const HISTORY = {
  [MAIN]: [
    { role: 'user', row_id: 11, timestamp: Number(T1), text: '我想问缓存的问题\n第二行补充' },
    {
      role: 'assistant',
      row_id: 12,
      timestamp: Number(T2),
      text: '## 缓存策略\n\n先更新**数据库**，再删除缓存。\n\n- 第一点\n- 第二点\n  1. 嵌套\n\n```python\ndef f(x):\n    return x + 1\n```\n\n| 列A | 列B |\n|---|---|\n| 1 | 2\\|3 |'
    },
    { role: 'user', row_id: 13, timestamp: Number(T3), text: '第二个问题' },
    { role: 'assistant', row_id: 14, timestamp: Number(T4), text: '第二条回复的内容在这里。\n\n还有第三行。\n\n以及第四行。' }
  ],
  [TILE]: [{ role: 'assistant', row_id: 21, timestamp: 1792855400.5, text: '分屏里另一个会话的回答。' }]
}

function textNodeIn(id, needle) {
  const el = document.getElementById(id)
  const walker = document.createTreeWalker(el, 4)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const i = n.data.indexOf(needle)
    if (i >= 0) return [n, i]
  }
  throw new Error(`no "${needle}" in #${id}`)
}

/** Select from `a` (in #idA) to the end of `b` (in #idB). */
function select(idA, a, idB = idA, b = a) {
  const [n1, i1] = textNodeIn(idA, a)
  const [n2, i2] = textNodeIn(idB, b)
  const r = document.createRange()
  r.setStart(n1, i1)
  r.setEnd(n2, i2 + b.length)
  const sel = document.getSelection()
  sel.removeAllRanges()
  sel.addRange(r)
  return r
}

async function fresh({ focused = MAIN, settings } = {}) {
  document.body.innerHTML = PRISTINE
  w.location.hash = `#/${MAIN}`
  scrolled.length = 0
  sdk.submits.length = 0
  sdk.notifications.length = 0
  sdk.focusCalls = []
  sdk.requests = []
  sdk.opened = []
  sdk.openSession = undefined
  sdk.sessions = [{ id: TILE, title: '分屏会话' }, { id: MAIN, title: '主会话' }]
  sdk.request = async (method, params) => {
    if (method !== 'session.history') throw new Error('unexpected ' + method)
    const rows = HISTORY[params.session_id]
    if (!rows) throw new Error('no session')
    return { messages: rows }
  }
  sdk.state.focusedStoredSessionId.set(focused)
  const backend = fakeDipleBackend()
  const h = makeCtx({ rest: backend.rest })
  if (settings) h.ctx.storage.set('settings', settings)
  h.registerI18n('diple')
  plugin.register(h.ctx)
  const roots = []
  const mount = async (containerId = 'top-main') => {
    const root = createRoot(document.getElementById(containerId))
    roots.push(root)
    await act(async () => root.render(createElement(() => h.find('composer.top').render())))
    await act(async () => tick(0))
  }
  const cleanup = async () => {
    for (const r of roots) await act(async () => r.unmount())
    h.dispose()
  }
  return { h, backend, mount, cleanup }
}

const run = async (h, area = 'keybinds', { save = true } = {}) => {
  await act(async () => h.find(area).data.run())
  await act(async () => tick(5))
  // V2.1 #2: the strip shows an annotation once its editor saved it
  if (save && (area === 'keybinds' || area === 'palette')) await act(async () => (saveOpenEditor(), tick(5)))
}
const cardsIn = (id = 'top-main') => [...document.querySelectorAll(`#${id} [data-diple-id]`)]
// V2-C: the card list became the composer strip (send/strip). An annotation's
// origin and text now show in its chip's hover preview; clicking the chip goes
// to the original; comment editing moved beside the original (V2-T editor).
const previewOf = async (card) => {
  await act(async () => card.querySelector('[data-diple-chip]').dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true })))
  return card.closest('[data-diple-list]').querySelector(`[data-diple-chip-preview="${card.getAttribute('data-diple-id')}"]`)
}
const originOf = async (card) => (await previewOf(card)).querySelector('.diple-preview-origin').textContent
const textOf = async (card) => (await previewOf(card)).querySelector('.diple-preview-text').textContent
const goToOrigin = (card) => act(async () => card.querySelector('[data-diple-chip]').click())
const V2_EDITOR = 'V2: comment editing moved from the card to the editor beside the original (V2-T capture/editor); covered by v2t tests'
const itemsOf = (h, key = MAIN) => h.ctx.storage.get(`list.${key}`, { items: [] }).items
const lastNotice = () => sdk.notifications.at(-1)?.title
const key = (el, k, extra = {}) => act(async () => el.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra })))

test('story 1: ⌘⇧E on an AI reply adds a verified card with its reply number', async () => {
  const { h, mount, cleanup } = await fresh()
  await mount()
  select('a1', '先更新', 'a1', '删除缓存。')
  await run(h)
  const [card] = cardsIn()
  assert.ok(card)
  assert.equal(await originOf(card), '第 1 条回复')
  // shown as Markdown (design §2.8); the item keeps the source
  assert.equal((await previewOf(card)).querySelector('.diple-preview-text strong')?.textContent, '数据库')
  assert.equal(itemsOf(h)[0].text, '先更新**数据库**，再删除缓存。')
  const [item] = itemsOf(h)
  assert.equal(item.origin.rowId, 12)
  assert.equal(item.origin.verified, true)
  assert.equal(item.origin.sessionId, MAIN)
  await cleanup()
})

test('story 2: the ⌘K palette command does the same', async () => {
  const { h, mount, cleanup } = await fresh()
  await mount()
  select('a2', '第二条回复')
  await run(h, 'palette')
  assert.equal(cardsIn().length, 1)
  assert.match(h.find('palette').data.label, /加入待发/)
  await cleanup()
})

test('story 3: my own message can be annotated, keeping its line break', async () => {
  const { h, mount, cleanup } = await fresh()
  await mount()
  select('u1', '我想问', 'u1', '第二行补充')
  await run(h)
  const [item] = itemsOf(h)
  assert.equal(item.text, '我想问缓存的问题\n第二行补充')
  assert.equal(item.origin.role, 'user')
  assert.equal(item.origin.rowId, 11)
  assert.equal(await originOf(cardsIn()[0]), '我的第 1 条消息')
  await cleanup()
})

test('story 4: code blocks, lists, headings and tables keep their Markdown', async () => {
  const { h, mount, cleanup } = await fresh()
  await mount()
  select('h', '缓存策略', 'tbl', '2|3')
  await run(h)
  const [item] = itemsOf(h)
  assert.equal(
    item.text,
    '## 缓存策略\n\n先更新**数据库**，再删除缓存。\n\n- 第一点\n- 第二点\n  1. 嵌套\n\n```\ndef f(x):\n    return x + 1\n```\n\n| 列A | 列B |\n| --- | --- |\n| 1 | 2\\|3 |'
  )
  assert.ok(!item.text.includes('ls -la'), 'tool output inside the range is left out')
  assert.ok(!item.text.includes('想一想'), 'thinking is left out')
  assert.equal(item.origin.verified, true, 'verified despite Markdown syntax')
  await cleanup()
})

test('story 4: a selection wholly inside a code block is fenced', async () => {
  const { h, mount, cleanup } = await fresh()
  await mount()
  select('code', 'def f', 'code', 'x + 1')
  await run(h)
  assert.equal(itemsOf(h)[0].text, '```\ndef f(x):\n    return x + 1\n```')
  await cleanup()
})

test('story 5: a selection across two messages becomes two annotations with their own origins', async () => {
  const { h, mount, cleanup } = await fresh()
  await mount()
  select('a1', '再删除缓存', 'u2', '第二个问题')
  await run(h)
  const items = itemsOf(h)
  assert.equal(items.length, 2)
  assert.equal(items[0].origin.role, 'assistant')
  assert.equal(items[0].origin.rowId, 12)
  assert.equal(items[1].origin.role, 'user')
  assert.equal(items[1].origin.rowId, 13)
  assert.match(items[0].text, /再删除缓存/)
  assert.equal(items[1].text, '第二个问题')
  assert.equal(lastNotice(), '已加入 2 条标注')
  await cleanup()
})

test('story 6: unsupported places and empty selections explain why', async () => {
  const { h, cleanup } = await fresh()
  const cases = [
    [() => select('tool', 'ls -la'), '工具输出暂不支持标注'],
    [() => select('think', '想一想'), '思考过程暂不支持标注'],
    [() => select('composer', '草稿'), '输入框里的文字不能标注'],
    [() => select('side', '侧栏'), '只能标注对话里的消息'],
    [() => document.getSelection().removeAllRanges(), '没有选中文字']
  ]
  for (const [pick, message] of cases) {
    pick()
    await run(h)
    assert.equal(lastNotice(), message)
  }
  assert.equal(itemsOf(h).length, 0)
  await cleanup()
})

test('stories 7–9 (V2): focus lands in the editor beside the text; ⏎ saves, ⇧⏎ and IME ⏎ do not; Esc drops an edit; both return to the composer', async () => {
  const { h, mount, cleanup } = await fresh()
  await mount()
  select('a2', '第二条回复')
  await run(h, 'keybinds', { save: false })
  const ta = document.querySelector('[data-diple-editor] textarea')
  assert.equal(document.activeElement, ta, 'story 7')
  ta.value = '拼音'
  await key(ta, 'Enter', { keyCode: 229 })
  await key(ta, 'Enter', { isComposing: true })
  assert.deepEqual(sdk.focusCalls, [], 'story 9: composition Enter does nothing')
  await key(ta, 'Enter', { shiftKey: true })
  assert.deepEqual(sdk.focusCalls, [], 'story 8: Shift+Enter is a newline')
  await key(ta, 'Enter')
  assert.deepEqual(sdk.focusCalls, [MAIN], 'story 8: Enter returns to the composer')
  assert.equal(itemsOf(h)[0].comment, '拼音')
  assert.equal(document.querySelector('[data-diple-editor]'), null)
  // the same passage again opens that annotation
  select('a2', '第二条回复')
  await run(h, 'keybinds', { save: false })
  const ta2 = document.querySelector('[data-diple-editor] textarea')
  assert.equal(ta2.value, '拼音')
  ta2.value = '拼音改'
  await key(ta2, 'Escape')
  assert.deepEqual(sdk.focusCalls, [MAIN, MAIN], 'story 8: Esc returns too')
  assert.equal(itemsOf(h)[0].comment, '拼音', 'V2: Esc drops this edit')
  await cleanup()
})

test('story 10: annotation after annotation without commenting adds, never replaces', async () => {
  const { h, mount, cleanup } = await fresh()
  await mount()
  select('a2', '第二条回复')
  await run(h)
  select('a1', '先更新')
  await run(h)
  assert.equal(itemsOf(h).length, 2)
  await cleanup()
})

test('story 11: click a card to edit; comments save on blur and while typing', { skip: V2_EDITOR }, async () => {
  const { h, mount, cleanup } = await fresh()
  await mount()
  select('a2', '第二条回复')
  await run(h)
  const card = cardsIn()[0]
  await act(async () => card.querySelector('.diple-card-text').dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true })))
  assert.ok(cardsIn()[0].hasAttribute('data-expanded'))
  const ta = cardsIn()[0].querySelector('textarea')
  ta.value = '边打边存'
  await act(async () => ta.dispatchEvent(new w.Event('input', { bubbles: true })))
  await act(async () => tick(450))
  assert.equal(itemsOf(h)[0].comment, '边打边存')
  ta.value = '失焦保存'
  await act(async () => ta.dispatchEvent(new w.FocusEvent('focusout', { bubbles: true })))
  assert.equal(itemsOf(h)[0].comment, '失焦保存')
  await cleanup()
})

test('story 13: × removes a card and Undo brings it back within 5 s', async () => {
  const { h, mount, cleanup } = await fresh()
  await mount()
  select('a2', '第二条回复')
  await run(h)
  await act(async () => cardsIn()[0].querySelector('.diple-card-remove').click())
  assert.equal(cardsIn().length, 0)
  const undo = document.querySelector('#top-main .diple-undo')
  assert.match(undo.textContent, /已删除 1 条标注/)
  await act(async () => undo.querySelector('button').click())
  assert.equal(cardsIn().length, 1)
  assert.equal(document.querySelector('#top-main .diple-undo'), null)
  await cleanup()
})

test('story 14: Clear all empties the list and can be undone', async () => {
  const { h, mount, cleanup } = await fresh()
  await mount()
  select('a2', '第二条回复')
  await run(h)
  select('a1', '先更新')
  await run(h)
  await act(async () => document.querySelector('#top-main .diple-clear').click())
  assert.equal(cardsIn().length, 0)
  assert.match(document.querySelector('#top-main .diple-undo').textContent, /已清空 2 条标注/)
  await act(async () => document.querySelector('#top-main .diple-undo button').click())
  assert.equal(cardsIn().length, 2)
  await cleanup()
})

test('story 15: cards follow transcript order, not the order they were added', async () => {
  const { h, mount, cleanup } = await fresh()
  await mount()
  for (const [id, s] of [['a2c', '以及第四行'], ['u1', '我想问'], ['a1', '先更新']]) {
    select(id, s)
    await run(h)
  }
  assert.deepEqual(
    itemsOf(h).map((it) => it.text),
    ['我想问', '先更新', '以及第四行']
  )
  assert.deepEqual(
    cardsIn().map((c) => c.querySelector('.diple-chip-n').textContent),
    ['1', '2', '3']
  )
  await cleanup()
})

test('story 16: adding the same passage again jumps to the existing card', async () => {
  const { h, mount, cleanup } = await fresh()
  await mount()
  select('a2', '第二条回复')
  await run(h, 'keybinds', { save: false })
  document.getElementById('composer').focus()
  select('a2', '第二条回复')
  await run(h, 'keybinds', { save: false })
  assert.equal(itemsOf(h).length, 1)
  assert.equal(lastNotice(), '这段已经在待发列表里了')
  assert.equal(document.activeElement, document.querySelector('[data-diple-editor] textarea'), 'V2: its editor opens beside the text')
  assert.equal(document.querySelector('[data-diple-editor]').getAttribute('data-mode'), 'edit')
  await cleanup()
})

test('story 17: origin and the opening on the chip, the full text in its preview', async () => {
  const { h, mount, cleanup } = await fresh()
  await mount()
  select('a2', '第二条回复', 'a2c', '以及第四行。')
  await run(h)
  const card = cardsIn()[0]
  // V2: the chip shows the opening; the hover preview shows all of it (no "expand")
  assert.match(card.querySelector('.diple-chip-text').textContent, /^第二条回复的内容在这里/)
  assert.equal(await originOf(card), '第 2 条回复')
  const text = await textOf(card)
  assert.match(text, /第二条回复的内容在这里。/)
  assert.match(text, /以及第四行/)
  await cleanup()
})

test('story 18: the list folds into one summary line, and stays folded', { skip: 'V2: no fold; the strip is one row of chips that folds into “+N” (v2c-strip.test.mjs)' }, async () => {
  const { h, mount, cleanup } = await fresh()
  await mount()
  select('a2', '第二条回复')
  await run(h)
  const ta = cardsIn()[0].querySelector('textarea')
  ta.value = '一条批注'
  await act(async () => ta.dispatchEvent(new w.FocusEvent('focusout', { bubbles: true })))
  select('a1', '先更新')
  await run(h)
  await act(async () => document.querySelector('#top-main .diple-list-toggle').click())
  const list = document.querySelector('#top-main [data-diple-list]')
  assert.ok(list.hasAttribute('data-collapsed'))
  assert.equal(cardsIn().length, 0)
  assert.equal(list.querySelector('.diple-list-summary').textContent, '2 条标注，其中 1 条批注')
  assert.equal(h.ctx.storage.get('ui.collapsed'), true)
  await cleanup()
})

test('story 19: each session has its own list; switching sessions switches lists', async () => {
  const { h, mount, cleanup } = await fresh()
  await mount()
  select('a2', '第二条回复')
  await run(h)
  await act(async () => {
    w.location.hash = '#/s-other'
    w.dispatchEvent(new w.HashChangeEvent('hashchange'))
    sdk.state.focusedStoredSessionId.set('s-other')
  })
  assert.equal(cardsIn().length, 0)
  await act(async () => {
    w.location.hash = `#/${MAIN}`
    w.dispatchEvent(new w.HashChangeEvent('hashchange'))
    sdk.state.focusedStoredSessionId.set(MAIN)
  })
  assert.equal(cardsIn().length, 1)
  assert.equal(itemsOf(h).length, 1, 'persisted under list.<session>')
  await cleanup()
})

test('story 20: split view — each composer shows its own session; annotations go to the last focused one', async () => {
  const { h, mount, cleanup } = await fresh({ focused: TILE })
  await mount('top-main')
  await mount('top-tile')
  select('a2', '第二条回复')
  await run(h)
  assert.equal(cardsIn('top-main').length, 0, 'main composer does not show the tile list')
  assert.equal(cardsIn('top-tile').length, 1)
  const [item] = itemsOf(h, TILE)
  assert.equal(item.origin.sessionId, MAIN)
  await act(async () => tick(10))
  assert.equal(await originOf(cardsIn('top-tile')[0]), '「主会话」· 第 2 条回复', 'origin names the other session')
  await cleanup()
})

test('story 21: text from a reply still streaming is captured and bound to its row on message.complete', async () => {
  const { h, mount, cleanup } = await fresh()
  // the host pairs the focused chat with the runtime it streams on (R5 XE5-01: a
  // completion of an unknown runtime is only ruled out when the capture's is known)
  sdk.state.focusedSessionId.set('runtime-main')
  const msg = document.querySelector(`[data-message-id="${T4}-3-assistant"]`)
  msg.setAttribute('data-message-id', 'assistant-stream-1792855361-0')
  // not persisted yet: the history has no row for the streaming reply
  const full = sdk.request
  sdk.request = async (m, p) => ({ messages: (await full(m, p)).messages.filter((r) => r.row_id !== 14) })
  await mount()
  select('a2', '第二条回复')
  await run(h)
  let [item] = itemsOf(h)
  assert.equal(item.origin.pending, true)
  assert.equal(await originOf(cardsIn()[0]), '约第 2 条回复')
  sdk.request = full
  // another session's turn does not touch it (R2 XE-02: only its own session's turn may)
  await act(async () => h.emit('message.complete', { session_id: 'runtime-of-another-session', persisted_turn: { user_row_id: 11, final_assistant_row_id: 12, row_ids: [11, 12] } }))
  await act(async () => tick(10))
  assert.equal(itemsOf(h)[0].origin.pending, true, 'still pending after an unrelated turn')
  await act(async () => h.emit('message.complete', { persisted_turn: { user_row_id: 13, final_assistant_row_id: 14, row_ids: [13, 14] } }))
  await act(async () => tick(10))
  ;[item] = itemsOf(h)
  assert.equal(item.origin.pending, undefined)
  assert.equal(item.origin.rowId, 14)
  assert.equal(item.origin.messageTs, String(Number(T4)))
  assert.equal(await originOf(cardsIn()[0]), '第 2 条回复')
  sdk.state.focusedSessionId.set(null)
  await cleanup()
})

test('story 21: a finished reply that still carries a temporary id binds to its row at once', async () => {
  const { h, mount, cleanup } = await fresh()
  document.querySelector(`[data-message-id="${T3}-2-user"]`).setAttribute('data-message-id', 'user-5f0c')
  await mount()
  select('u2', '第二个问题')
  await run(h)
  const [item] = itemsOf(h)
  assert.equal(item.origin.pending, undefined)
  assert.equal(item.origin.rowId, 13)
  assert.equal(await originOf(cardsIn()[0]), '我的第 2 条消息')
  await cleanup()
})

test('story 22: clicking the annotation (its chip) scrolls to the original text', async () => {
  const { h, mount, cleanup } = await fresh()
  await mount()
  select('a1', '再删除缓存')
  await run(h)
  scrolled.length = 0
  await goToOrigin(cardsIn()[0])
  await act(async () => tick(20))
  assert.equal(scrolled.at(-1)?.id, 'a1')
  await cleanup()
})

test('story 23: an unloaded message is loaded through "Show earlier"; failing that, a notice', async () => {
  const { h, mount, cleanup } = await fresh()
  await mount()
  select('u1', '我想问')
  await run(h, 'keybinds', { save: false })
  await key(document.querySelector('[data-diple-editor] textarea'), 'Enter') // V2: save it (a click away would drop a new empty one)
  // Simulate history windowing: the first turn is not rendered, a "Show earlier" button is.
  const tc = document.getElementById('tc-main')
  const hidden = [...tc.children].slice(0, 2)
  hidden.forEach((n) => n.remove())
  const btn = document.createElement('button')
  btn.textContent = 'Show earlier'
  btn.addEventListener('click', () => {
    btn.remove()
    tc.prepend(...hidden)
  })
  tc.prepend(btn)
  // The host answers its reveal event by loading the row's page.
  const vp = document.getElementById('vp-main')
  const onReveal = (e) => {
    assert.equal(e.detail.rowId, 11)
    btn.click()
    e.detail.complete(`${T1}-0-user`)
  }
  vp.addEventListener('hermes:timeline-reveal', onReveal)
  scrolled.length = 0
  await goToOrigin(cardsIn()[0])
  await act(async () => tick(300))
  assert.equal(scrolled.at(-1)?.id, 'u1', 'loaded through the host reveal and shown')
  vp.removeEventListener('hermes:timeline-reveal', onReveal)
  // No reveal listener (older host): fall back to clicking "Show earlier".
  hidden.forEach((n) => n.remove())
  const btn2 = document.createElement('button')
  btn2.textContent = 'Show earlier'
  btn2.addEventListener('click', () => {
    btn2.remove()
    tc.prepend(...hidden)
  })
  tc.prepend(btn2)
  scrolled.length = 0
  await goToOrigin(cardsIn()[0])
  await act(async () => tick(4400))
  assert.equal(scrolled.at(-1)?.id, 'u1', 'loaded via Show earlier and shown')
  // A button that never loads anything: give up with a notice.
  hidden.forEach((n) => n.remove())
  const dead = document.createElement('button')
  dead.textContent = 'Show earlier'
  tc.prepend(dead)
  await goToOrigin(cardsIn()[0])
  await act(async () => tick(7000))
  assert.equal(lastNotice(), '没找到原消息，可能还没加载，请往上翻一翻')
  await cleanup()
})

test('story 24: an annotation from a session that is not on screen opens it beside the current one', async () => {
  const { h, mount, cleanup } = await fresh({ focused: MAIN })
  await mount()
  select('t1', '另一个会话的回答')
  await run(h)
  const tile = document.getElementById('tile')
  const parked = tile.cloneNode(true)
  tile.remove()
  sdk.openSession = async () => {
    setTimeout(() => document.body.appendChild(parked), 50)
  }
  scrolled.length = 0
  await goToOrigin(cardsIn()[0])
  await act(async () => tick(400))
  assert.deepEqual(sdk.opened.map((o) => [o.id, o.opts.intent]), [[TILE, 'tab']])
  assert.equal(scrolled.at(-1)?.id, 't1')
  await cleanup()
})

test('story 25: a deleted or rewritten original marks the card "原文已变" and keeps its content', async () => {
  const { h, mount, cleanup } = await fresh()
  await mount()
  select('a2', '第二条回复')
  await run(h)
  document.getElementById('a2').textContent = '重新生成后的完全不同的内容。'
  await goToOrigin(cardsIn()[0])
  await act(async () => tick(50))
  const card = cardsIn()[0]
  assert.ok(card.hasAttribute('data-changed'))
  assert.match(card.textContent, /原文已变/)
  assert.equal(await textOf(card), '第二条回复')
  // regenerate: the message itself is replaced by a new one (new timestamp)
  const { h: h2, mount: m2, cleanup: c2 } = await fresh()
  await m2()
  select('a2', '第二条回复')
  await run(h2)
  document.querySelector(`[data-message-id="${T4}-3-assistant"]`).setAttribute('data-message-id', '1792855999.5-3-assistant')
  await act(async () => tick(400))
  assert.ok(cardsIn()[0].hasAttribute('data-changed'), 'detected by the highlight pass')
  await c2()
  await cleanup()
})

// ── story 2b: the floating selection button ─────────────────────────────────
// V2: the selection toolbar (capture/selection-toolbar); details in v2t-toolbar.test.mjs
const btn = () => document.querySelector('[data-diple-toolbar]')
const shown = () => btn()?.hasAttribute('data-shown') ?? false
const settle = () => act(async () => tick(360)) // a keyboard selection rests 300 ms
const selChange = () => act(async () => document.dispatchEvent(new w.Event('selectionchange')))

test('story 2b (V2): the toolbar appears on the frame after the mouse is released and adds like ⌘⇧E', async () => {
  const { h, mount, cleanup } = await fresh()
  await mount()
  document.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, button: 0 }))
  select('a2', '第二条回复')
  await selChange()
  await settle()
  assert.equal(shown(), false, 'not while the mouse is still down')
  document.dispatchEvent(new w.MouseEvent('mouseup', { bubbles: true, button: 0 }))
  await act(async () => tick(40))
  assert.equal(shown(), true, 'no settle delay')
  assert.match(btn().textContent, /标注/)
  assert.equal(btn().querySelector('kbd'), null, 'V2.1 #3: no keycap')
  // mousedown on the button keeps the selection (preventDefault)
  const md = new w.MouseEvent('mousedown', { bubbles: true, cancelable: true })
  btn().querySelector('button').dispatchEvent(md)
  assert.equal(md.defaultPrevented, true)
  await act(async () => btn().querySelector('button').click())
  await act(async () => tick(10))
  assert.equal(itemsOf(h).length, 1)
  assert.equal(shown(), false, 'hidden after the click')
  assert.ok(document.querySelector('[data-diple-editor]'), 'the editor opens beside the text')
  await cleanup()
})

test('story 2b: keyboard selection, cross-message selections, and never in unsupported places', async () => {
  const { cleanup } = await fresh()
  select('a1', '再删除缓存', 'u2', '第二个问题')
  await selChange()
  await settle()
  assert.equal(shown(), true, 'cross-message selection')
  for (const [id, s] of [['tool', 'ls'], ['think', '想一想'], ['composer', '草稿'], ['side', '侧栏']]) {
    select(id, s)
    await selChange()
    await settle()
    assert.equal(shown(), false, `not in #${id}`)
  }
  await cleanup()
})

// W3: Diple Docs's document carries data-diple-owner and has its own ⌘⇧E
// and selection button; capture must stay silent there (no "only chat" notice).
function mountReviewDoc() {
  const doc = document.createElement('div')
  doc.className = 'er-doc'
  doc.setAttribute('data-diple-docs-doc', '')
  doc.setAttribute('data-diple-owner', 'diple-docs')
  doc.tabIndex = -1
  doc.innerHTML = '<h1>设计文档</h1><p id="rv">文档页里的一段正文</p>'
  document.body.appendChild(doc)
  return doc
}

test('W3: ⌘⇧E / palette inside the Diple Docs document is silent and adds nothing', async () => {
  const { h, mount, cleanup } = await fresh()
  await mount()
  const doc = mountReviewDoc()
  select('rv', '一段正文')
  await run(h)
  await run(h, 'palette')
  assert.equal(sdk.notifications.length, 0, 'no notice for a selection in the review document')
  // focus in the document, nothing selected: still silent
  document.getSelection().removeAllRanges()
  doc.focus()
  assert.equal(document.activeElement, doc)
  await run(h)
  assert.equal(sdk.notifications.length, 0, 'no notice while the review document has focus')
  assert.equal(itemsOf(h).length, 0)
  // outside it, the usual refusal still speaks
  doc.blur()
  select('side', '侧栏')
  await run(h)
  assert.equal(lastNotice(), '只能标注对话里的消息')
  await cleanup()
})

test('W3: the floating button never appears over the Diple Docs document', async () => {
  const { mount, cleanup } = await fresh()
  await mount()
  mountReviewDoc()
  select('rv', '一段正文')
  await selChange()
  await settle()
  assert.equal(shown(), false)
  select('a2', '第二条回复')
  await selChange()
  await settle()
  assert.equal(shown(), true, 'chat selections still get it')
  await cleanup()
})

test('story 2b: hides on scroll, Esc, typing, blur; ⌘C keeps it; the switch turns it off', async () => {
  const { h, cleanup } = await fresh()
  const showIt = async () => {
    select('a2', '第二条回复')
    await selChange()
    await settle()
    assert.equal(shown(), true)
  }
  await showIt()
  document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true }))
  assert.equal(shown(), true, '⌘C does not hide it')
  document.getElementById('vp-main').dispatchEvent(new w.Event('scroll', { bubbles: false }))
  assert.equal(shown(), false, 'scroll')
  await showIt()
  document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  assert.equal(shown(), false, 'Esc')
  await showIt()
  document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'a', bubbles: true }))
  assert.equal(shown(), false, 'typing')
  await showIt()
  w.dispatchEvent(new w.Event('blur'))
  assert.equal(shown(), false, 'window blur')
  await showIt()
  document.getSelection().removeAllRanges()
  await selChange()
  assert.equal(shown(), false, 'selection cleared')
  await cleanup()
  // switched off in settings (W2b's toggle writes selectionButton:false)
  const off = await fresh({ settings: { enabled: true, language: 'auto', selectionButton: false } })
  select('a2', '第二条回复')
  await selChange()
  await settle()
  assert.equal(shown(), false)
  await off.cleanup()
  void h
})

test('master switch off: no list, no button, no highlight hit', async () => {
  const { h, mount, cleanup } = await fresh({ settings: { enabled: false, language: 'auto', selectionButton: true } })
  await mount()
  select('a2', '第二条回复')
  await selChange()
  await settle()
  assert.equal(shown(), false)
  await run(h)
  assert.equal(lastNotice(), '圈批插件已停用')
  assert.equal(document.querySelector('#top-main [data-diple-list]'), null)
  await cleanup()
})

test('English UI: labels and notices follow the pinned language', async () => {
  const { h, mount, cleanup } = await fresh({ settings: { enabled: true, language: 'en', selectionButton: true } })
  await mount()
  select('tool', 'ls -la')
  await run(h)
  assert.equal(lastNotice(), 'Tool output cannot be annotated yet')
  select('a2', '第二条回复')
  await run(h)
  const card = cardsIn()[0]
  assert.equal(await originOf(card), 'Reply #2')
  await selChange()
  select('a1', '先更新')
  await selChange()
  await settle()
  assert.match(btn().textContent, /^Annotate/)
  await cleanup()
})

test('locate service is provided for response markers', async () => {
  const { h, mount, cleanup } = await fresh()
  await mount()
  select('a1', '再删除缓存')
  await run(h)
  const origin = itemsOf(h)[0].origin
  // the ann marker uses deps.services.get('locate'); reach it through a marker render
  const batch = { batchId: 'bloc1234', sessionKey: MAIN, items: [{ origin, text: '再删除缓存', comment: '为什么' }] }
  h.ctx.storage.set('batch.bloc1234', batch)
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => root.render(h.find('transcript.directives').data.render({ attrs: { b: 'bloc1234', n: '1' } })))
  scrolled.length = 0
  await act(async () => el.querySelector('button').click())
  await act(async () => tick(20))
  assert.equal(scrolled.at(-1)?.id, 'a1')
  await act(async () => root.unmount())
  await cleanup()
})
