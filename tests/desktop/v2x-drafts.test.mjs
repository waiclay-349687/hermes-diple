// V2-X (R8 XV-01/02/03/06): words typed in the editor beside the text are
// never dropped silently, and ⌘⏎ sends the list of the item being edited.
// Every entry that closes, replaces or sends goes through the editor's save
// first. Driven through register(ctx) with the V2-C rig (real capture + send).
import test from 'node:test'
import assert from 'node:assert/strict'

import { fresh, seed, mount, click, cleanupAll, sdk, w, tick, act, createElement } from './v2c-rig.mjs'
import { loadModule } from './harness.mjs'

const rect = { top: 200, bottom: 220, left: 100, right: 220, width: 120, height: 20 }
w.Range.prototype.getBoundingClientRect = () => rect
w.Range.prototype.getClientRects = () => [rect]
w.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} })

const HISTORY = { messages: [{ role: 'assistant', row_id: 11, timestamp: 101, text: '缓存要先更新数据库，再删除缓存。\n\n并发写的时候可以延迟双删。' }] }
const box = () => document.querySelector('[data-diple-editor-input]')
const editorId = () => document.querySelector('[data-diple-editor]')?.getAttribute('data-item-id') ?? null
const items = (h, k = 'stored-1') => h.deps.lists.get(k).items
const pinOf = (id) => document.querySelector(`[data-diple-pin][data-item-id="${id}"]`)

async function capture(h, id = 'a1') {
  sdk.request = async (method) => (method === 'session.history' ? HISTORY : { sessions: [] })
  const r = document.createRange()
  r.selectNodeContents(document.getElementById(id))
  document.getSelection().removeAllRanges()
  document.getSelection().addRange(r)
  await act(async () => {
    await h.find('keybinds', (c) => c.data.id === 'diple.add').data.run()
    await tick(10)
  })
  assert.ok(box(), 'editor open')
  return editorId() ?? items(h).at(-1).id // the list is in document order: the open one
}
const type = (text) =>
  act(async () => {
    box().value = text
    box().dispatchEvent(new w.Event('input', { bubbles: true }))
  })
const key = (k, extra = {}) =>
  act(async () => {
    box().dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }))
    await tick(30)
  })
const settle = () => act(async () => tick(260))
const pin = async (id) => {
  await settle()
  await click(pinOf(id))
}
const sendKey = (h) =>
  act(async () => {
    h.find('keybinds', (c) => c.data.id === 'diple.send').data.run()
    await tick(40)
  })
const batches = (h) => [...h.backend.batches.values()]

test.afterEach(cleanupAll)

test('XV-01 the same pin again keeps what is typed (no reset to the saved words)', async () => {
  const h = fresh()
  await mount(h)
  const id = await capture(h)
  await type('保存过的意见')
  await key('Enter')
  await pin(id)
  await type('不能丢的新意见')
  await pin(id)
  assert.equal(box().value, '不能丢的新意见')
  assert.equal(editorId(), id)
  await key('Enter')
  assert.equal(items(h)[0].comment, '不能丢的新意见')
  assert.equal(items(h).length, 1)
})

test('XV-01 the preview\'s edit on another annotation saves the open draft first (the open one has no preview)', async () => {
  const h = fresh()
  await mount(h)
  const a = await capture(h, 'a1')
  await key('Enter')
  const b = await capture(h, 'a2')
  await key('Enter')
  await pin(a)
  await type('第一条还没保存')
  await settle()
  await act(async () => pinOf(b).dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true })))
  await act(async () => tick(200))
  const edit = document.querySelector('[data-diple-hovercard]:not([hidden]) [data-diple-action="edit"]')
  assert.ok(edit, 'the hover card offers edit')
  await click(edit)
  assert.equal(items(h).find((x) => x.id === a).comment, '第一条还没保存')
  assert.equal(editorId(), b)
})

test('XV-01 another pin: the open draft is saved first', async () => {
  const h = fresh()
  await mount(h)
  const a = await capture(h, 'a1')
  await key('Enter')
  const b = await capture(h, 'a2')
  await key('Enter')
  await pin(a)
  await type('第一条的新意见')
  await pin(b)
  assert.equal(items(h).find((x) => x.id === a).comment, '第一条的新意见')
  assert.equal(editorId(), b)
})

test('XV-01 a chip click (locate) saves the open draft first', async () => {
  const h = fresh()
  const view = await mount(h)
  const a = await capture(h, 'a1')
  await key('Enter')
  await capture(h, 'a2')
  await type('还没按保存')
  const b = items(h).at(-1).id
  await click(view.q(`[data-diple-chip="${a}"]`))
  await act(async () => tick(400))
  assert.equal(items(h).find((x) => x.id === b).comment, '还没按保存')
})

test('XV-02 every send entry saves the draft first: keybind/palette ⌘⇧↩, the strip button, ⌘↩ in the strip, the main send button', async () => {
  const entries = {
    keybind: async (h) => sendKey(h),
    palette: async (h) =>
      act(async () => {
        h.find('palette', (c) => c.data.id === 'diple.send').data.run()
        await tick(40)
      }),
    button: async (h, view) => click(view.q('[data-diple-send]')),
    stripChord: async (h, view) =>
      act(async () => {
        view.q('[data-diple-list]').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }))
        await tick(40)
      })
  }
  for (const [name, run] of Object.entries(entries)) {
    const h = fresh()
    const view = await mount(h)
    // V2.1 #2: a never-saved one is not on the strip; one saved annotation makes
    // the strip (and its send button) appear, the new draft stays off it
    await capture(h, 'a2')
    await key('Enter')
    const draft = await capture(h)
    await type(`${name} 的意见`)
    assert.equal(view.q(`[data-diple-chip="${draft}"]`), null, `${name}: the draft is not on the strip`)
    await run(h, view)
    const b = batches(h)[0]
    assert.ok(b, `${name}: a batch`)
    assert.deepEqual(b.items.map((x) => x.comment).sort(), ['', `${name} 的意见`], `${name}: saved first, then sent with the rest`)
    await cleanupAll()
  }
  // the host's main send button (composer middleware)
  const h = fresh()
  await mount(h)
  await capture(h)
  await type('主输入框发送')
  const mw = h.find('composer.middleware')
  await act(async () => {
    await mw.data.handler({ text: '正文', sessionId: 'stored-1' })
    await tick(20)
  })
  assert.equal(items(h)[0]?.comment ?? batches(h)[0]?.items[0].comment, '主输入框发送')
})

test('V2.1 #2: a new annotation stays off the strip and its count until the editor saves it once; Esc drops it unseen', async () => {
  const h = fresh()
  const view = await mount(h)
  const draft = await capture(h)
  await type('还没保存')
  await act(async () => tick(50))
  assert.equal(view.q('[data-diple-list]'), null, 'only a draft: no strip at all')
  await settle()
  assert.ok(pinOf(draft), 'the original keeps its temporary mark (pin)')
  await key('Enter')
  await act(async () => tick(50))
  assert.ok(view.q(`[data-diple-chip="${draft}"]`), 'saved once → on the strip')
  const saved = draft
  const next = await capture(h, 'a2')
  await act(async () => tick(50))
  assert.equal(view.q(`[data-diple-chip="${next}"]`), null, 'the next new one is off the strip')
  assert.match(view.q('.diple-strip-summary').textContent, /^1 /, 'the count is unchanged')
  await key('Escape')
  await act(async () => tick(50))
  assert.deepEqual(items(h).map((x) => x.id), [saved], 'Esc drops it')
  await settle()
  assert.equal(pinOf(next), null, 'and its mark')
})

test('V2.1 #2: the global send (⌘⇧↩) with only a draft saves it first and sends it', async () => {
  const h = fresh()
  const view = await mount(h)
  await capture(h)
  await type('只有草稿')
  assert.equal(view.q('[data-diple-list]'), null)
  await sendKey(h)
  const b = batches(h)[0]
  assert.ok(b, 'sent')
  assert.equal(b.items[0].comment, '只有草稿')
})

test('XV-02 a refused save (the list is locked) keeps the draft open and sends nothing', async () => {
  const h = fresh()
  await mount(h)
  const id = await capture(h)
  await key('Enter')
  await pin(id)
  await type('锁定时写的意见')
  await act(async () => h.deps.lists.dispatch('stored-1', { type: 'beginSend', batchId: 'block0001' }))
  const before = sdk.submits.length
  const r = await act(async () => {
    await key('Enter')
  })
  void r
  assert.equal(box()?.value, '锁定时写的意见', 'still in the editor')
  assert.equal(sdk.submits.length, before)
  assert.match(sdk.notifications.at(-1)?.title ?? '', /发送|锁|正在/)
})

test('XV-01 a session switch, a page hide and the plugin unloading write the draft into the list', async () => {
  let h = fresh()
  await mount(h)
  await capture(h)
  await type('切会话前写的')
  await act(async () => sdk.state.focusedStoredSessionId.set('stored-2'))
  assert.equal(items(h)[0].comment, '切会话前写的')
  await cleanupAll()
  h = fresh()
  await mount(h)
  await capture(h)
  await type('关窗前写的')
  await act(async () => w.dispatchEvent(new w.Event('pagehide')))
  assert.equal(items(h)[0].comment, '关窗前写的')
  await type('卸载前写的')
  h.dispose()
  assert.equal(h.ctx.storage.get('list.stored-1').items[0].comment, '卸载前写的')
})

// R9 XV9-01: a save that leaves the editor open (session switch) moves the
// editor's baseline on. The value in the list when it closes or goes out is
// the last one typed — also when that is the value it was opened with.
for (const initial of ['原意见', '']) {
  for (const via of ['Enter', 'send']) {
    test(`XV9-01 ${JSON.stringify(initial)} → kept on a switch: 中间意见 → back to ${JSON.stringify(initial)} (${via}): the last words go out`, async () => {
      const h = fresh()
      await mount(h)
      const id = await capture(h)
      if (initial) {
        await type(initial)
        await key('Enter')
        await pin(id)
      }
      await type('中间意见')
      await act(async () => sdk.state.focusedStoredSessionId.set('stored-2'))
      assert.equal(items(h)[0].comment, '中间意见', 'the switch wrote the draft')
      await act(async () => sdk.state.focusedStoredSessionId.set('stored-1'))
      await type(initial)
      if (via === 'Enter') {
        await key('Enter')
        assert.equal(items(h)[0].comment, initial, 'the list holds the last words')
      }
      await sendKey(h)
      assert.equal(batches(h)[0]?.items[0].comment, initial)
    })
  }
}

test('XV9-01 a comment changed elsewhere while the editor is open is still not overwritten by untouched words', async () => {
  const h = fresh()
  await mount(h)
  const id = await capture(h)
  await type('原意见')
  await key('Enter')
  await pin(id)
  // the strip (or another window) edits it meanwhile; the editor's words are unchanged
  await act(async () => h.deps.lists.dispatch('stored-1', { type: 'editComment', id, comment: '别处改的' }))
  await act(async () => sdk.state.focusedStoredSessionId.set('stored-2'))
  assert.equal(items(h)[0].comment, '别处改的')
  await act(async () => sdk.state.focusedStoredSessionId.set('stored-1'))
  await key('Enter')
  assert.equal(items(h)[0].comment, '别处改的')
})

// R9 XV9-02, the same class checked in the chat plugin: every send entry
// saves the editor synchronously, and the list lock (beginSend) is taken
// synchronously too, so a second intent during the awaits before it (busy
// probe, composer draft) finds the list locked or empty — never a 2nd batch.
test('XV9-02 class (chat): two send intents while the composer draft is slow to read → one batch, one submit', async () => {
  const h = fresh()
  const view = await mount(h)
  await capture(h, 'a2') // saved once: the strip and its send button are up (V2.1 #2)
  await key('Enter')
  await capture(h)
  await type('只发一次')
  const drafts = sdk.drafts
  let release
  const gate = new Promise((r) => (release = r))
  let reads = 0
  sdk.drafts = { get: (k) => (reads++, gate.then(() => drafts.get(k))), set: (k, v) => drafts.set(k, v) }
  try {
    await act(async () => {
      h.find('keybinds', (c) => c.data.id === 'diple.send').data.run()
      view.q('[data-diple-send]')?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }))
      h.find('palette', (c) => c.data.id === 'diple.send').data.run()
      await tick(10)
    })
    await act(async () => (release(), tick(60)))
  } finally {
    sdk.drafts = drafts
  }
  assert.equal(reads, 3, 'all three intents were inside the window')
  assert.equal(batches(h).length, 1, 'one batch')
  assert.equal(sdk.submits.length, 1, 'one submit')
  assert.ok(batches(h)[0].items.some((x) => x.comment === '只发一次'))
  assert.equal(sdk.notifications.filter((n) => /还在发送/.test(n.message ?? '')).length, 2, 'the others are told')
})

test('XV-01 the way back to the composer saves the draft', async () => {
  const h = fresh()
  await mount(h)
  const id = await capture(h)
  await key('Enter')
  await act(async () => {
    await h.deps.uiBus.locate(id)
  })
  await act(async () => tick(300))
  assert.equal(editorId(), id)
  await type('回去之前写的')
  const back = document.querySelector('[data-diple-return]:not([hidden])')
  assert.ok(back)
  await click(back)
  assert.equal(items(h)[0].comment, '回去之前写的')
})

test('XV-03 ⌘⏎ on an annotation of a background session sends that session\'s list (after asking, naming it), never the focused one', async () => {
  const h = fresh()
  await mount(h)
  const a = await capture(h)
  await key('Enter')
  const origin = items(h)[0].origin
  await seed(h, 'stored-2', [{ id: 'background-item', origin, text: items(h)[0].text, comment: '后台会话的意见' }])
  await pin('background-item')
  assert.equal(editorId(), 'background-item')
  await type('后台会话的新意见')
  await key('Enter', { metaKey: true })
  await act(async () => tick(20))
  const ask = document.querySelector('[data-diple-confirm-target]')
  assert.ok(ask, 'asks before sending into another session')
  assert.match(ask.closest('[role="dialog"], [data-diple-dialog]')?.textContent ?? document.body.textContent, /迁移 nanostores/)
  assert.equal(sdk.submits.length, 0)
  assert.equal(items(h, 'stored-2')[0].comment, '后台会话的新意见')
  // confirm: only stored-2 goes, once
  const ok = document.querySelector('[data-diple-confirm-target] ~ * button, [data-diple-confirm-ok]') ?? [...document.querySelectorAll('button')].find((b) => /发送|确认/.test(b.textContent) && b.closest('[data-diple-confirm-target]'))
  assert.ok(ok, 'a confirm button')
  {
    await click(ok)
    await act(async () => tick(40))
    assert.deepEqual(batches(h).map((b) => b.sessionId), ['stored-2'])
    assert.deepEqual(batches(h)[0].items.map((x) => x.id), ['background-item'])
    assert.ok(items(h).some((x) => x.id === a), 'the focused list is untouched')
  }
})

test('XV-03 the bus carries the key fixed at the key press', async () => {
  const h = fresh()
  await mount(h)
  const seen = []
  h.deps.uiBus.onSendNow((req) => seen.push(req))
  h.deps.uiBus.sendNow({ key: 'stored-2' })
  h.deps.uiBus.sendNow()
  assert.deepEqual(seen, [{ key: 'stored-2' }, {}])
})

test('XV-06 the static Markdown copy keeps a link drawn as a button as plain text', async () => {
  const { createMarkdownMirror } = await loadModule('diple', 'plugins/diple/desktop/src/capture/editor/markdown-mirror.js')
  const md = createMarkdownMirror({ doc: document })
  const target = document.createElement('div')
  document.body.append(target)
  const host = document.createElement('div')
  document.body.append(host)
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(host)
  let off
  await act(async () => {
    off = md.render(target, 'see [normal](https://example.com/)')
    root.render(createElement(md.Mirror))
    await tick(30)
  })
  // what the fallback renderer draws for a link: a button
  const src = host.querySelector('[data-diple-md-source]')
  assert.ok(src, 'the hidden source is mounted')
  {
    await act(async () => {
      src.innerHTML = '<p>see <button data-streamdown="link">normal</button><button aria-label="copy"></button></p>'
      await tick(30)
    })
    assert.match(target.textContent, /normal/)
    assert.equal(target.querySelectorAll('button').length, 0)
    assert.ok(target.querySelector('.diple-md-link'))
  }
  off()
  await act(async () => root.unmount())
  md.dispose()
})
