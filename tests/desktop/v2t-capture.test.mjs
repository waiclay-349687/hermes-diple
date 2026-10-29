// V2-T: the transcript side — editor beside the text, numbered pins, mark
// styles and states, the hover preview, uiBus.locate / hover / editor / sendNow.
// Driven through register(ctx) (capture group alone, deps exposed) on jsdom,
// with CSS.highlights, Range geometry and the thread viewport stubbed.
import test from 'node:test'
import assert from 'node:assert/strict'

import { setupDom, loadEntry, makeCtx, fakeDipleBackend, tick } from './harness.mjs'

const MAIN = 's-main'
const OTHER = 's-other'
const T1 = '1792855351.5'
const T2 = '1792855353.25'
const T3 = '1792855360.75'
const T4 = '1792855362.125'

const html = `<!doctype html><html><head></head><body>
<nav id="sidebar"><p id="side">侧栏里的文字</p></nav>
<div data-chat-surface="" data-composer-target="main" data-session-anchor="workspace" id="main">
  <div data-slot="aui_thread-viewport" id="vp-main"><div data-slot="aui_thread-content" id="tc-main">
    <div data-slot="aui_user-message-root" data-role="user" data-message-id="${T1}-0-user"><span data-slot="aui_user-message-text"><span data-slot="aui_user-inline-text" id="u1">我想问缓存的问题</span></span></div>
    <div data-slot="aui_assistant-message-root" data-role="assistant" data-message-id="${T2}-1-assistant" id="m2"><div data-slot="aui_assistant-message-content" id="c1">
      <p id="a1">先更新<span data-streamdown="strong">数据库</span>，再删除缓存。</p>
    </div></div>
    <div data-slot="aui_user-message-root" data-role="user" data-message-id="${T3}-2-user"><span data-slot="aui_user-message-text"><span data-slot="aui_user-inline-text" id="u2">第二个问题</span></span></div>
    <div data-slot="aui_assistant-message-root" data-role="assistant" data-message-id="${T4}-3-assistant" id="m4"><div data-slot="aui_assistant-message-content"><p id="a2">第二条回复的内容在这里。</p><p id="a2b">还有第三行。</p></div></div>
  </div></div>
  <div data-slot="composer-rich-input" contenteditable="true" id="composer">草稿</div>
  <div id="top-main"></div>
</div>
</body></html>`

const w = setupDom(html)
w.location.hash = `#/${MAIN}`

// ── stubs: Highlight API, geometry, motion preference, clipboard ────────────
class FakeHighlight extends Set {
  constructor(...ranges) {
    super(ranges)
    this.priority = 0
  }
}
w.Highlight = FakeHighlight
if (!w.CSS) w.CSS = {}
// Counts the redraws (every paint draws or clears diple-mark), so a test can wait
// for "a redraw after the backend answered" instead of a fixed sleep.
let paints = 0
class CountingRegistry extends Map {
  set(k, v) {
    if (k === 'diple-mark') paints++
    return super.set(k, v)
  }
  delete(k) {
    if (k === 'diple-mark') paints++
    return super.delete(k)
  }
}
w.CSS.highlights = new CountingRegistry()
const highlightTexts = (name) => [...(w.CSS.highlights.get(name) ?? [])].map((r) => r.toString())

const geometry = new Map() // text → rect
const rect = (top, left = 100, width = 120, height = 20) => ({ top, left, width, height, right: left + width, bottom: top + height, x: left, y: top })
const rectOf = (range) => geometry.get(range.toString()) ?? rect(300)
w.Range.prototype.getBoundingClientRect = function () {
  return rectOf(this)
}
w.Range.prototype.getClientRects = function () {
  return [rectOf(this)]
}
let reduced = false
w.matchMedia = (q) => ({ matches: reduced && /reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {} })
const copied = []
Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async (t) => copied.push(t) }, configurable: true })
const scrolls = []
const vp = () => document.getElementById('vp-main')

const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const plugin = await loadEntry('diple', 'tests/desktop/fixtures/v2t-capture.js')
const sdk = globalThis.__sdk
const PRISTINE = document.body.innerHTML

const HISTORY = {
  [MAIN]: [
    { role: 'user', row_id: 11, timestamp: Number(T1), text: '我想问缓存的问题' },
    { role: 'assistant', row_id: 12, timestamp: Number(T2), text: '先更新**数据库**，再删除缓存。' },
    { role: 'user', row_id: 13, timestamp: Number(T3), text: '第二个问题' },
    { role: 'assistant', row_id: 14, timestamp: Number(T4), text: '第二条回复的内容在这里。\n\n还有第三行。' }
  ]
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
function select(id, a, b = a) {
  const [n1, i1] = textNodeIn(id, a)
  const [n2, i2] = textNodeIn(id, b)
  const r = document.createRange()
  r.setStart(n1, i1)
  r.setEnd(n2, i2 + b.length)
  const sel = document.getSelection()
  sel.removeAllRanges()
  sel.addRange(r)
  return r
}

let deps = null
let listedAt = null // the paint count when GET /batches? was last answered (sent marks read it)
async function fresh({ settings, backendBatches } = {}) {
  listedAt = null
  document.body.innerHTML = PRISTINE
  w.CSS.highlights.clear()
  geometry.clear()
  reduced = false
  copied.length = 0
  scrolls.length = 0
  vp().getBoundingClientRect = () => rect(0, 0, 800, 600)
  vp().scrollTo = (opts) => scrolls.push(opts)
  Object.defineProperty(vp(), 'scrollTop', { value: 0, writable: true, configurable: true })
  sdk.notifications.length = 0
  sdk.focusCalls = []
  sdk.opened = []
  sdk.request = async (method, params) => {
    if (method !== 'session.history') throw new Error('unexpected ' + method)
    return { messages: HISTORY[params.session_id] ?? [] }
  }
  sdk.state.focusedStoredSessionId.set(MAIN)
  const backend = fakeDipleBackend()
  const rest = async (p, opts = {}) => {
    if (p.startsWith('/batches?')) {
      // runs before the caller's await resumes: any paint counted later follows the answer
      Promise.resolve().then(() => (listedAt = paints))
      return { batches: backendBatches ?? [] }
    }
    return backend.rest(p, opts)
  }
  const h = makeCtx({ rest })
  if (settings) h.ctx.storage.set('settings', { enabled: true, language: 'zh', selectionButton: true, ...settings })
  h.registerI18n('diple')
  plugin.register(h.ctx)
  deps = globalThis.__v2tDeps
  const roots = []
  // every composer.top contribution (the list and the Markdown host)
  const root = createRoot(document.getElementById('top-main'))
  roots.push(root)
  await act(async () => root.render(createElement(() => h.contributions.filter((c) => c.area === 'composer.top').map((c) => createElement(c.render, { key: c.id })))))
  const cleanup = async () => {
    for (const r of roots) await act(async () => r.unmount())
    h.dispose()
  }
  return { h, cleanup }
}

const run = async (h) => {
  await act(async () => h.find('keybinds').data.run())
  await act(async () => tick(5))
}
const settle = () => act(async () => tick(260)) // highlight refresh is debounced
// Wait for a condition instead of a fixed sleep: the debounced refreshes and the
// backend read run on wall time, which a loaded machine stretches (as send.test.mjs).
async function until(cond, what, { within = 15_000, step = 25 } = {}) {
  const end = Date.now() + within
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out after ${within} ms waiting for ${what}`)
    await act(async () => tick(step))
  }
}
const pinIds = () => pins().map((p) => p.getAttribute('data-item-id'))
// the backend's batch statuses arrived and the marks were redrawn after them
const redrawnAfterBackend = () => listedAt !== null && paints > listedAt
const items = (h, key = MAIN) => h.ctx.storage.get(`list.${key}`, { items: [] }).items
const editor = () => document.querySelector('[data-diple-editor]')
const input = () => editor()?.querySelector('textarea')
const pins = () => [...document.querySelectorAll('[data-diple-pin]')].filter((p) => !p.hidden)
const key = (el, k, extra = {}) => act(async () => el.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra })))
async function type(text) {
  input().value = text
  await act(async () => input().dispatchEvent(new w.Event('input', { bubbles: true })))
}
const press = async (el, type, extra = {}) => act(async () => el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...extra })))
// A shake is counted when it starts (MutationObserver: data-shake set where it was
// absent), as tests/desktop/v3d3-draft.test.mjs does: the attribute's presence after
// the fact depends on what else ran meanwhile. shaken(): a new shake since the last ask.
let shakes = 0
let seenShakes = 0
const countShakes = (rs) => {
  for (const r of rs) if (r.oldValue === null && r.target.hasAttribute?.('data-shake')) shakes++
}
const shakeObserver = new w.MutationObserver(countShakes)
shakeObserver.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['data-shake'], attributeOldValue: true })
const shaken = () => {
  countShakes(shakeObserver.takeRecords())
  const s = shakes > seenShakes
  seenShakes = shakes
  return s
}
const clickOutside = async (el = document.getElementById('side')) => {
  await press(el, 'mousedown')
  await press(el, 'mouseup')
  await press(el, 'click')
}

// ── ⌘⇧E / the toolbar open the editor beside the text ──────────────────────
test('⌘⇧E opens the editor beside the passage, keyboard in its comment box; the passage is counted at once', async () => {
  const { h, cleanup } = await fresh()
  select('a2', '第二条回复')
  await run(h)
  assert.ok(editor(), 'editor open')
  assert.equal(editor().getAttribute('data-mode'), 'new')
  assert.equal(document.activeElement, input())
  assert.match(editor().textContent, /第二条回复/, 'summary of the passage')
  assert.equal(items(h).length, 1)
  assert.equal(items(h)[0].comment, '')
  // V3-T: placed below the selection, 4 px under its bottom edge
  const top = parseFloat(editor().style.top)
  assert.equal(editor().getAttribute('data-side'), 'bottom')
  assert.ok(top > 300, `editor top ${top}`)
  await cleanup()
})

test('the toolbar has one button 标注 and it opens the same editor', async () => {
  const { h, cleanup } = await fresh()
  const tb = document.querySelector('[data-diple-toolbar]')
  assert.ok(tb)
  assert.equal(tb.querySelectorAll('button').length, 1)
  assert.match(tb.textContent, /标注/)
  await press(document.getElementById('a2'), 'mousedown')
  select('a2', '第二条回复')
  document.dispatchEvent(new w.Event('selectionchange'))
  await press(document.getElementById('a2'), 'mouseup')
  await act(async () => tick(40))
  assert.ok(tb.hasAttribute('data-shown'))
  await act(async () => tb.querySelector('button').click())
  await act(async () => tick(5))
  assert.ok(editor())
  assert.equal(items(h).length, 1)
  await cleanup()
})

// ── keys ─────────────────────────────────────────────────────────────────────
test('⏎ saves a comment: pin, fill and underline appear; an empty ⏎ saves a highlight (fill only)', async () => {
  const { h, cleanup } = await fresh()
  select('a2', '第二条回复')
  await run(h)
  await type('为什么？')
  await key(input(), 'Enter')
  assert.equal(editor(), null, 'closed')
  assert.equal(items(h)[0].comment, '为什么？')
  await settle()
  assert.deepEqual(pins().map((p) => [p.textContent, p.getAttribute('data-state')]), [['1', 'comment']])
  assert.deepEqual(highlightTexts('diple-mark'), ['第二条回复'])
  assert.deepEqual(highlightTexts('diple-mark-line'), ['第二条回复'])
  select('a1', '再删除缓存')
  await run(h)
  await key(input(), 'Enter')
  await settle()
  assert.equal(items(h).length, 2)
  assert.equal(items(h)[0].comment, '', 'highlight: earlier in the transcript, so #1')
  assert.deepEqual(pins().map((p) => [p.textContent, p.getAttribute('data-state')]).sort(), [['1', 'highlight'], ['2', 'comment']])
  assert.deepEqual(highlightTexts('diple-mark-line'), ['第二条回复'], 'no underline for a highlight')
  assert.equal(highlightTexts('diple-mark').length, 2)
  await cleanup()
})

test('⇧⏎ and an IME ⏎ do not save; Esc on a new annotation discards it', async () => {
  const { h, cleanup } = await fresh()
  select('a2', '第二条回复')
  await run(h)
  await type('pi')
  await key(input(), 'Enter', { isComposing: true })
  await key(input(), 'Enter', { keyCode: 229 })
  await key(input(), 'Enter', { shiftKey: true })
  assert.ok(editor(), 'still open')
  assert.equal(items(h)[0].comment, '')
  await key(input(), 'Escape')
  assert.equal(editor(), null)
  assert.equal(items(h).length, 0, 'discarded')
  await settle()
  assert.equal(pins().length, 0)
  await cleanup()
})

test('Esc on an existing annotation drops this edit only; ⌘⏎ saves and asks the bus to send', async () => {
  const { h, cleanup } = await fresh()
  const sends = []
  deps.uiBus.onSendNow(() => sends.push(items(h)[0]?.comment))
  select('a2', '第二条回复')
  await run(h)
  await type('第一版')
  await key(input(), 'Enter')
  await settle()
  await act(async () => pins()[0].click())
  assert.equal(editor().getAttribute('data-mode'), 'edit')
  assert.equal(input().value, '第一版')
  await type('改了一半')
  await key(input(), 'Escape')
  assert.equal(items(h)[0].comment, '第一版', 'reverted')
  assert.equal(items(h).length, 1, 'not removed')
  await act(async () => pins()[0].click())
  await type('第二版')
  await key(input(), 'Enter', { metaKey: true })
  assert.equal(editor(), null)
  assert.deepEqual(sends, ['第二版'], 'saved before sendNow')
  await cleanup()
})

// ── clicking outside ─────────────────────────────────────────────────────────
test('outside: new + empty is discarded; new + text shakes and keeps the draft; existing autosaves', async () => {
  const { h, cleanup } = await fresh()
  select('a2', '第二条回复')
  await run(h)
  await clickOutside()
  assert.equal(editor(), null)
  assert.equal(items(h).length, 0, 'empty new: gone')
  select('a2', '第二条回复')
  await run(h)
  await type('写了一半')
  shaken()
  await clickOutside()
  assert.ok(editor(), 'kept')
  assert.ok(shaken(), 'shakes')
  assert.equal(input().value, '写了一半')
  assert.equal(document.activeElement, input(), 'focus back in the box')
  await key(input(), 'Enter')
  await settle()
  await act(async () => pins()[0].click())
  await type('点外面就存')
  await clickOutside()
  assert.equal(editor(), null)
  assert.equal(items(h)[0].comment, '点外面就存')
  await cleanup()
})

test('selecting another passage keeps the editor; 用当前选区替换原文 swaps the text and keeps the comment', async () => {
  const { h, cleanup } = await fresh()
  select('a2', '第二条回复')
  await run(h)
  await type('意见')
  shaken() // count from here
  const replace = () => editor().querySelector('[data-diple-editor-replace]')
  assert.equal(replace().disabled, true, 'nothing selected yet')
  const a1 = document.getElementById('a1')
  await press(a1, 'mousedown')
  select('a1', '再删除缓存')
  document.dispatchEvent(new w.Event('selectionchange'))
  await press(a1, 'mouseup')
  await press(a1, 'click')
  await act(async () => tick(5))
  assert.ok(editor(), 'a selection gesture is not a click outside')
  assert.equal(shaken(), false, 'no shake')
  assert.equal(replace().disabled, false)
  await act(async () => replace().click())
  await act(async () => tick(20))
  assert.equal(items(h).length, 1)
  assert.equal(items(h)[0].text, '再删除缓存')
  assert.equal(input().value, '意见', 'draft kept')
  await key(input(), 'Enter')
  assert.equal(items(h)[0].comment, '意见')
  await cleanup()
})

test('V2.1 #4: the editor foot is an icon-only replace on the left and two real buttons on the right; no key hints', async () => {
  const { h, cleanup } = await fresh()
  select('a2', '第二条回复')
  await run(h)
  const foot = editor().querySelector('.diple-editor-foot')
  assert.equal(foot.querySelector('.diple-editor-hints'), null, 'no key-hint row')
  assert.equal(foot.querySelector('kbd'), null)
  const replace = foot.querySelector('[data-diple-editor-replace]')
  assert.equal(replace.textContent.trim(), '', 'replace shows an icon only')
  assert.ok(replace.querySelector('.codicon'))
  assert.match(replace.getAttribute('aria-label'), /用当前选区替换原文/)
  assert.match(replace.getAttribute('data-diple-tip'), /用当前选区替换原文/, 'its full words in a tooltip')
  assert.equal(replace.hasAttribute('title'), false, 'no native title (host DESIGN.md)')
  assert.equal(replace.disabled, true, 'greyed when nothing is selected')
  const save = foot.querySelector('[data-diple-editor-save]')
  const send = foot.querySelector('[data-diple-editor-send]')
  assert.equal(save.textContent, '保存', 'text only, no ↵')
  assert.equal(send.textContent, '保存并发送')
  assert.ok(save.classList.contains('diple-pbtn'), 'save is the primary button')
  assert.equal(save.compareDocumentPosition(send) & w.Node.DOCUMENT_POSITION_PRECEDING, w.Node.DOCUMENT_POSITION_PRECEDING, 'the primary is last')
  await type('按钮保存')
  await act(async () => save.click())
  assert.equal(editor(), null, 'saved and closed')
  assert.equal(items(h)[0].comment, '按钮保存')
  await cleanup()
})

test('V2.1 #4: 保存并发送 saves, then asks the send flow (like ⌘⏎); ⏎ and ⌘⏎ still work', async () => {
  const { h, cleanup } = await fresh()
  const sends = []
  const off = deps.uiBus.onSendNow((x) => sends.push(x))
  select('a2', '第二条回复')
  await run(h)
  await type('按钮发送')
  await act(async () => editor().querySelector('[data-diple-editor-send]').click())
  await act(async () => tick(10))
  assert.equal(items(h)[0].comment, '按钮发送')
  assert.equal(sends.length, 1)
  off()
  await cleanup()
})

test('the same passage again opens that annotation, not a new one', async () => {
  const { h, cleanup } = await fresh()
  select('a2', '第二条回复')
  await run(h)
  await type('原意见')
  await key(input(), 'Enter')
  select('a2', '第二条回复')
  await run(h)
  assert.equal(items(h).length, 1)
  assert.equal(editor().getAttribute('data-mode'), 'edit')
  assert.equal(input().value, '原意见')
  await key(input(), 'Escape')
  assert.equal(items(h).length, 1, 'Esc on an existing one keeps it')
  await cleanup()
})

// ── pins, preview, hover link ────────────────────────────────────────────────
test('pins follow the send order; the editor tells the bus when it opens and closes', async () => {
  const { h, cleanup } = await fresh()
  const seen = []
  deps.uiBus.onEditor((e) => seen.push(`${e.type}:${e.itemId}`))
  select('a2', '第二条回复')
  await run(h)
  await key(input(), 'Enter')
  select('u1', '缓存的问题')
  await run(h)
  await key(input(), 'Enter')
  await settle()
  const [first, second] = items(h)
  assert.equal(first.text, '缓存的问题', 'ordered by position')
  const byId = Object.fromEntries(pins().map((p) => [p.getAttribute('data-item-id'), p.textContent]))
  assert.deepEqual(byId, { [first.id]: '1', [second.id]: '2' })
  await act(async () => document.querySelector(`[data-diple-pin][data-item-id="${second.id}"]`).click())
  assert.equal(editor().getAttribute('data-item-id'), second.id)
  assert.equal(highlightTexts('diple-active').join(), '第二条回复', 'the open one is deepened')
  await key(input(), 'Escape')
  assert.ok(seen.includes(`opened:${second.id}`))
  assert.equal(seen.at(-1), `closed:${second.id}`)
  await cleanup()
})

test('V2.1 #6: the pin card has three buttons — comment: 编辑 / 复制 / 删除; highlight: 写意见 / 复制 / 删除; no toggle', async () => {
  const { h, cleanup } = await fresh()
  select('a2', '第二条回复')
  await run(h)
  await type('**为什么**这样')
  await key(input(), 'Enter')
  await settle()
  const pv = () => document.querySelector('[data-diple-hovercard]:not([hidden])')
  const hoverPin = async () => {
    await act(async () => pins()[0].dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true })))
    await act(async () => tick(200))
  }
  const tools = () => [...pv().querySelectorAll('[data-diple-action]')].map((b) => [b.getAttribute('data-diple-action'), b.textContent])
  await hoverPin()
  assert.ok(pv(), 'preview shown')
  assert.match(pv().textContent, /为什么/)
  assert.deepEqual(tools(), [['edit', '编辑'], ['copy', '复制'], ['remove', '删除']])
  for (const b of pv().querySelectorAll('[data-diple-action]')) {
    assert.notEqual(b.tabIndex, -1, 'reachable by keyboard')
    assert.equal(b.getAttribute('type'), 'button')
  }
  // a comment back to a highlight: clear the words in the editor and save
  await act(async () => pv().querySelector('[data-diple-action="edit"]').click())
  assert.equal(pv(), null, 'an action closes the preview')
  assert.equal(input().value, '**为什么**这样')
  await type('')
  await key(input(), 'Enter')
  assert.equal(items(h)[0].comment, '', 'empty comment = highlight')
  await settle()
  assert.equal(pins()[0].getAttribute('data-state'), 'highlight')
  await hoverPin()
  assert.deepEqual(tools(), [['edit', '写意见'], ['copy', '复制'], ['remove', '删除']])
  // V2.1 #7: a highlight copies the original only
  copied.length = 0
  await act(async () => pv().querySelector('[data-diple-action="copy"]').click())
  await act(async () => tick(5))
  assert.deepEqual(copied, ['第二条回复'])
  assert.equal(sdk.notifications.at(-1)?.title, '已复制原文')
  await hoverPin()
  await act(async () => pv().querySelector('[data-diple-action="edit"]').click())
  assert.ok(editor(), '写意见 opens the editor')
  await type('补一句')
  await key(input(), 'Enter')
  assert.equal(items(h)[0].comment, '补一句')
  await settle()
  // V2.1 #7: a comment copies the annotation as Markdown
  await hoverPin()
  copied.length = 0
  await act(async () => pv().querySelector('[data-diple-action="copy"]').click())
  await act(async () => tick(5))
  assert.deepEqual(copied, ['> 第二条回复\n\n补一句'])
  assert.equal(sdk.notifications.at(-1)?.title, '已复制原文和意见')
  await hoverPin()
  await act(async () => pv().querySelector('[data-diple-action="remove"]').click())
  assert.equal(items(h).length, 0)
  await cleanup()
})

test('hover link: bus.hover deepens the mark; hovering a pin tells the bus', async () => {
  const { h, cleanup } = await fresh()
  const heard = []
  deps.uiBus.onHover((id) => heard.push(id))
  select('a2', '第二条回复')
  await run(h)
  await key(input(), 'Enter')
  await settle()
  const id = items(h)[0].id
  deps.uiBus.hover(id)
  await act(async () => tick(5))
  assert.deepEqual(highlightTexts('diple-active'), ['第二条回复'])
  deps.uiBus.hover(null)
  await act(async () => tick(5))
  assert.deepEqual(highlightTexts('diple-active'), [])
  heard.length = 0
  await act(async () => pins()[0].dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true })))
  assert.deepEqual(heard, [id])
  await cleanup()
})

test('the old "click a highlight to expand its card" is gone', async () => {
  const { h, cleanup } = await fresh()
  select('a2', '第二条回复')
  await run(h)
  await key(input(), 'Enter')
  await settle()
  const [n] = textNodeIn('a2', '第二条回复')
  document.caretRangeFromPoint = () => {
    const r = document.createRange()
    r.setStart(n, 2)
    return r
  }
  const ev = new w.MouseEvent('click', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 })
  await act(async () => document.getElementById('a2').dispatchEvent(ev))
  assert.equal(ev.defaultPrevented, false, 'the host keeps its own click')
  assert.equal(editor(), null)
  delete document.caretRangeFromPoint
  await cleanup()
})

// ── settings: quiet mode ───────────────────────────────────────────────────────
test('quiet mode: only pins; the open annotation still deepens', async () => {
  const { h, cleanup } = await fresh({ settings: { marksQuiet: true } })
  select('a2', '第二条回复')
  await run(h)
  await type('x')
  await key(input(), 'Enter')
  await settle()
  assert.equal(pins().length, 1)
  assert.deepEqual(highlightTexts('diple-mark'), [])
  assert.deepEqual(highlightTexts('diple-mark-line'), [])
  await act(async () => pins()[0].click())
  assert.deepEqual(highlightTexts('diple-active'), ['第二条回复'])
  await cleanup()
})

// ── sent / answered / missing ───────────────────────────────────────────────
function seedSent(h, { comment = '问一下', n = 2 } = {}) {
  const origin = { sessionId: MAIN, role: 'assistant', rowId: 14, messageTs: T4, ordinal: 4, roleOrdinal: 2, anchor: { text: '第二条回复' }, verified: true }
  const origin2 = { ...origin, anchor: { text: '还有第三行' } }
  const items = [
    { id: 'sent-1', origin, text: '第二条回复', comment, revision: 1 },
    { id: 'sent-2', origin: origin2, text: '还有第三行', comment: n === 2 ? '另一条' : '', revision: 1 }
  ]
  h.ctx.storage.set('batch.bsent0001', { batchId: 'bsent0001', sessionKey: MAIN, items, at: 1 })
  h.ctx.storage.set('batches.index', ['bsent0001'])
}

test('sent marks: half fill, dashed line, hollow pins; answered ✓ and missing dot from the batch record', async () => {
  const batches = [{ batchId: 'bsent0001', sessionId: MAIN, status: 'answered', answer: { answered: [1], missing: [2], noMarkers: false } }]
  const { h, cleanup } = await fresh({ backendBatches: batches })
  seedSent(h)
  await act(async () => deps.lists.dispatch(MAIN, { type: 'add', id: 'x', item: { origin: { sessionId: MAIN, role: 'user', rowId: 11, messageTs: T1, ordinal: 1, roleOrdinal: 1, anchor: { text: '我想问' }, verified: true }, text: '我想问' } }))
  await until(() => redrawnAfterBackend() && ['sent-1', 'sent-2', 'x'].every((id) => pinIds().includes(id)), 'the sent, missing and pending pins after the backend answered')
  const states = Object.fromEntries(pins().map((p) => [p.getAttribute('data-item-id'), [p.textContent.replace(/\D/g, ''), p.getAttribute('data-state')]]))
  assert.deepEqual(states['sent-1'], ['1', 'answered'])
  assert.deepEqual(states['sent-2'], ['2', 'missing'])
  assert.deepEqual(states.x, ['1', 'highlight'])
  // missing keeps the sent look (its pin has the dot); answered takes the answer hue (MarkLook, as in Diple Docs)
  assert.deepEqual(highlightTexts('diple-sent'), ['还有第三行'])
  assert.deepEqual(highlightTexts('diple-sent-line'), ['还有第三行'])
  assert.deepEqual(highlightTexts('diple-answered'), ['第二条回复'])
  assert.deepEqual(highlightTexts('diple-answered-line'), ['第二条回复'])
  assert.ok(!highlightTexts('diple-mark').includes('第二条回复'))
  // hover on a sent pin: read-only preview (copy only)
  const sentPin = document.querySelector('[data-diple-pin][data-item-id="sent-1"]')
  await act(async () => sentPin.dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true })))
  await act(async () => tick(200))
  const pv = document.querySelector('[data-diple-hovercard]:not([hidden])')
  assert.deepEqual([...pv.querySelectorAll('[data-diple-action]')].map((b) => b.getAttribute('data-diple-action')), ['copy'])
  await cleanup()
})

test('sent marks: one per passage — the latest send wins, a pending annotation wins over both', async () => {
  const origin = { sessionId: MAIN, role: 'assistant', rowId: 14, messageTs: T4, ordinal: 4, roleOrdinal: 2, anchor: { text: '第二条回复' }, verified: true }
  const batches = [
    { batchId: 'bold0001', sessionId: MAIN, status: 'answered', answer: { answered: [1], missing: [], noMarkers: false } },
    { batchId: 'bnew0002', sessionId: MAIN, status: 'expanded', answer: null }
  ]
  const { h, cleanup } = await fresh({ backendBatches: batches })
  h.ctx.storage.set('batch.bold0001', { batchId: 'bold0001', sessionKey: MAIN, items: [{ id: 'old', origin, text: '第二条回复', comment: '旧', revision: 1 }], at: 1 })
  h.ctx.storage.set('batch.bnew0002', { batchId: 'bnew0002', sessionKey: MAIN, items: [{ id: 'new', origin, text: '第二条回复', comment: '新', revision: 1 }], at: 2 })
  h.ctx.storage.set('batches.index', ['bold0001', 'bnew0002'])
  await act(async () => deps.lists.dispatch(MAIN, { type: 'add', id: 'x', item: { origin: { ...origin, anchor: { text: '还有第三行' } }, text: '还有第三行' } }))
  await until(() => redrawnAfterBackend() && ['new', 'x'].every((id) => pinIds().includes(id)), 'the latest sent pin and the pending one')
  assert.deepEqual(pins().map((p) => [p.getAttribute('data-item-id'), p.getAttribute('data-state')]).sort(), [['new', 'sent'], ['x', 'highlight']])
  await act(async () => deps.lists.dispatch(MAIN, { type: 'add', id: 'y', item: { origin, text: '第二条回复' } }))
  await until(() => pinIds().includes('y'), 'the new pending pin')
  assert.deepEqual(pins().map((p) => p.getAttribute('data-item-id')).sort(), ['x', 'y'])
  await cleanup()
})

test('sent marks: none when the backend says the batch failed or is unreachable, and none with marksKeepSent off', async () => {
  for (const [label, opts] of [
    ['failed', { backendBatches: [{ batchId: 'bsent0001', sessionId: MAIN, status: 'failed', answer: null }] }],
    ['unknown', { backendBatches: [] }],
    ['setting off', { backendBatches: [{ batchId: 'bsent0001', sessionId: MAIN, status: 'expanded', answer: null }], settings: { marksKeepSent: false } }]
  ]) {
    const { h, cleanup } = await fresh(opts)
    seedSent(h)
    await act(async () => deps.lists.dispatch(MAIN, { type: 'add', id: 'x', item: { origin: { sessionId: MAIN, role: 'user', rowId: 11, messageTs: T1, ordinal: 1, roleOrdinal: 1, anchor: { text: '我想问' }, verified: true }, text: '我想问' } }))
    // (with marksKeepSent off the backend is never asked)
    await until(() => (opts.settings?.marksKeepSent === false || redrawnAfterBackend()) && pinIds().includes('x'), `${label}: the pending pin after the backend answered`)
    await settle()
    assert.deepEqual(highlightTexts('diple-sent'), [], label)
    assert.deepEqual(pins().map((p) => p.getAttribute('data-item-id')), ['x'], label)
    await cleanup()
  }
})

// ── uiBus.locate ─────────────────────────────────────────────────────────────
async function oneSaved(h, comment = '意见') {
  select('a2', '第二条回复')
  await run(h)
  await type(comment)
  await key(input(), 'Enter')
  await settle()
  return items(h)[0].id
}

test('locate: already on screen → no scroll, no arrival flash, the editor opens focused with the mark deepened, a way back', async () => {
  const { h, cleanup } = await fresh()
  const id = await oneSaved(h)
  // V2.1 #1: every highlight name drawn during the locate
  const drawn = []
  const set0 = w.CSS.highlights.set.bind(w.CSS.highlights)
  w.CSS.highlights.set = (name, v) => (drawn.push(name), set0(name, v))
  let r
  try {
    await act(async () => {
      r = await deps.uiBus.locate(id)
    })
  } finally {
    w.CSS.highlights.set = set0
  }
  assert.equal(r, 'shown')
  assert.equal(scrolls.length, 0, 'no scroll')
  assert.deepEqual(drawn.filter((n) => /pulse|flash/.test(n)), [], 'no temporary arrival highlight')
  assert.deepEqual(highlightTexts('diple-active'), ['第二条回复'], 'the deepened mark stays while editing')
  await act(async () => tick(1000))
  assert.deepEqual(highlightTexts('diple-active'), ['第二条回复'], 'and does not fade by itself')
  assert.equal(editor().getAttribute('data-item-id'), id)
  assert.equal(document.activeElement, input())
  const back = document.querySelector('[data-diple-return]:not([hidden])')
  assert.ok(back, '← 回到输入框')
  assert.match(back.textContent, /回到输入框/)
  // Esc closes the editor and goes back to the composer
  await key(input(), 'Escape')
  assert.equal(editor(), null)
  assert.deepEqual(sdk.focusCalls.at(-1), MAIN)
  assert.equal(document.querySelector('[data-diple-return]:not([hidden])'), null)
  // the way back goes by itself after 5 s
  await act(async () => {
    await deps.uiBus.locate(id, { edit: false })
  })
  assert.ok(document.querySelector('[data-diple-return]:not([hidden])'))
  await act(async () => tick(5100))
  assert.equal(document.querySelector('[data-diple-return]:not([hidden])'), null)
  await cleanup()
})

test('locate: off screen → a smooth scroll that centres the words; reduced motion jumps; edit:false only shows', async () => {
  const { h, cleanup } = await fresh()
  const id = await oneSaved(h)
  geometry.set('第二条回复', rect(900))
  let r
  await act(async () => {
    r = await deps.uiBus.locate(id, { edit: false })
  })
  assert.equal(r, 'shown')
  assert.equal(scrolls[0].behavior, 'smooth')
  assert.equal(scrolls[0].top, 0 + 910 - 300, 'centred in the thread viewport')
  assert.equal(editor(), null, 'edit:false')
  scrolls.length = 0
  reduced = true
  await act(async () => {
    r = await deps.uiBus.locate(id)
  })
  assert.equal(scrolls[0].behavior, 'auto')
  assert.ok(editor())
  await cleanup()
})

test('locate: an older message not rendered yet → loaded; unknown or changed → missing', async () => {
  const { h, cleanup } = await fresh()
  const id = await oneSaved(h)
  // the message leaves the DOM; "Show earlier" brings it back
  const m4 = document.getElementById('m4')
  const tc = document.getElementById('tc-main')
  m4.remove()
  const btn = document.createElement('button')
  btn.textContent = 'Show earlier'
  btn.onclick = () => {
    btn.remove()
    tc.append(m4)
  }
  tc.prepend(btn)
  let r
  await act(async () => {
    r = await deps.uiBus.locate(id)
  })
  assert.equal(r, 'loaded')
  assert.ok(editor())
  await key(input(), 'Escape')
  await act(async () => {
    r = await deps.uiBus.locate('no-such-item')
  })
  assert.equal(r, 'missing')
  document.getElementById('a2').firstChild.data = '整段被重新生成了。'
  await act(async () => {
    r = await deps.uiBus.locate(id)
  })
  assert.equal(r, 'missing')
  assert.equal(editor(), null)
  await cleanup()
})

// ── locate: one notice, from the locator; sent annotations from the batch records ──
const notices = () => sdk.notifications.map((n) => n.title)

test('locate: "missing" is told once, by the locator, in its own words (the caller adds none)', async () => {
  const { h, cleanup } = await fresh()
  const id = await oneSaved(h)
  document.getElementById('a2').firstChild.data = '整段被重新生成了。'
  sdk.notifications.length = 0
  await act(async () => {
    await deps.uiBus.locate(id)
  })
  assert.deepEqual(notices(), ['原文已变：原消息已删除或重新生成'])
  sdk.notifications.length = 0
  await act(async () => {
    await deps.uiBus.locate('no-such-item')
  })
  assert.deepEqual(notices(), ['没找到原消息，可能还没加载，请往上翻一翻'])
  await cleanup()
})

test('locate: a sent annotation is found through the batch records even with marksKeepSent off (no mark drawn)', async () => {
  const batches = [{ batchId: 'bsent0001', sessionId: MAIN, status: 'answered', answer: { answered: [1], missing: [2], noMarkers: false } }]
  const { h, cleanup } = await fresh({ backendBatches: batches, settings: { marksKeepSent: false } })
  seedSent(h)
  await act(async () => tick(600))
  await settle()
  assert.equal(pins().length, 0, 'nothing drawn')
  geometry.set('还有第三行', rect(900))
  let r
  await act(async () => {
    r = await deps.uiBus.locate('sent-2', { edit: false })
  })
  assert.equal(r, 'shown')
  assert.equal(scrolls[0]?.behavior, 'smooth', 'scrolled to it')
  assert.equal(editor(), null, 'a sent annotation is not edited')
  await cleanup()
})

test('locate: a sent annotation known only to the backend (local record gone), its message not rendered yet → loaded', async () => {
  const origin = { sessionId: MAIN, role: 'assistant', rowId: 14, messageTs: T4, ordinal: 4, roleOrdinal: 2, anchor: { text: '还有第三行' }, verified: true }
  const batches = [{ batchId: 'bold0009', sessionId: MAIN, status: 'expanded', answer: null, items: [{ id: 'far-1', origin, text: '还有第三行', comment: '' }] }]
  const { cleanup } = await fresh({ backendBatches: batches })
  const m4 = document.getElementById('m4')
  const tc = document.getElementById('tc-main')
  m4.remove()
  const btn = document.createElement('button')
  btn.textContent = 'Show earlier'
  btn.onclick = () => {
    btn.remove()
    tc.append(m4)
  }
  tc.prepend(btn)
  let r
  await act(async () => {
    r = await deps.uiBus.locate('far-1', { edit: false })
  })
  assert.equal(r, 'loaded')
  await cleanup()
})

test('XV-05: a sent annotation whose message the history window unloaded is still located — origin from the local batch record, Show earlier, loaded', async () => {
  // R8 XV-05: after sending, the list no longer holds the item and the drawn
  // mark goes away with its message; locate used to answer missing before the
  // locator ran. The backend batch here has no items: the origin can only come
  // from the plugin's own record.
  const batches = [{ batchId: 'bsent0001', sessionId: MAIN, status: 'expanded', answer: null }]
  const { h, cleanup } = await fresh({ backendBatches: batches })
  seedSent(h)
  await act(async () => tick(600))
  await settle()
  geometry.set('还有第三行', rect(900))
  let r
  await act(async () => {
    r = await deps.uiBus.locate('sent-2', { edit: false })
  })
  assert.equal(r, 'shown', 'visible first')
  const m4 = document.getElementById('m4')
  const tc = document.getElementById('tc-main')
  m4.remove()
  await act(async () => tick(600))
  await settle()
  assert.ok(!pins().some((p) => p.getAttribute('data-item-id') === 'sent-2'), 'its mark went with the message')
  let pages = 0
  const btn = document.createElement('button')
  btn.textContent = 'Show earlier'
  btn.onclick = () => {
    pages++
    btn.remove()
    tc.append(m4)
  }
  tc.prepend(btn)
  await act(async () => {
    r = await deps.uiBus.locate('sent-2', { edit: false })
  })
  assert.equal(r, 'loaded')
  assert.equal(pages, 1, 'paged the history once')
  assert.ok(m4.isConnected, 'the original message is back in the DOM')
  assert.equal(editor(), null)
  await cleanup()
})

test('V2-X: pins of a chat that is not in front (another tab, e.g. a Diple Docs page) are hidden, and come back', async () => {
  const { h, cleanup } = await fresh()
  select('a2', '第二条回复')
  await run(h)
  await type('为什么？')
  await key(input(), 'Enter')
  await settle()
  assert.equal(pins().length, 1)
  // the host hides an inactive tab with visibility:hidden on an ancestor
  const surface = document.getElementById('main')
  w.Element.prototype.checkVisibility = function () {
    return !surface.contains(this) || surface.dataset.away !== '1'
  }
  surface.dataset.away = '1'
  await act(async () => tick(600))
  assert.equal(pins().length, 0, 'hidden while another tab is in front')
  surface.dataset.away = '0'
  await act(async () => tick(600))
  assert.equal(pins().length, 1, 'back with its chat')
  delete w.Element.prototype.checkVisibility
  await cleanup()
})
