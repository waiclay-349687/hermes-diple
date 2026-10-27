// V2-C — the composer strip: numbered chips instead of cards, a Markdown
// hover preview, and the uiBus links to the original text (design §2.6, §3).
// The test plays the original-text side (V2-T) through the uiBus contract.
import test from 'node:test'
import assert from 'node:assert/strict'

import { act, cleanupAll, click, fresh, hover, mount, origin, scrolled, sdk, seed, tick, w } from './v2c-rig.mjs'
import { saveOpenEditor } from './harness.mjs'

test.afterEach(cleanupAll)

const items = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: `i${i + 1}`,
    origin: origin(i + 1),
    text: i === 0 ? '先更新**数据库**，再删除缓存，并配合延迟双删' : `第 ${i + 1} 段原文`,
    comment: i % 2 === 0 ? `意见 ${i + 1}，要 **加粗**` : ''
  }))

const chips = (view) => view.qa('[data-diple-chip]')

test('3 annotations: three numbered chips, summary, the four actions', async () => {
  const h = fresh()
  await seed(h, 'stored-1', items(3))
  const view = await mount(h)
  const cs = chips(view)
  assert.deepEqual(cs.map((c) => c.querySelector('.diple-chip-n').textContent), ['1', '2', '3'])
  assert.equal(cs[0].querySelector('.diple-chip-text').textContent, '先更新数据库，再删除缓存，并…')
  assert.deepEqual(cs.map((c) => c.getAttribute('data-kind')), ['comment', 'highlight', 'comment'])
  assert.equal(view.q('[data-diple-more]'), null, 'no folding at 3')
  assert.equal(view.q('.diple-strip-summary').textContent, '3 条标注 · 2 条批注')
  assert.ok(view.q('[data-diple-send]'), 'send')
  assert.ok(view.q('[data-diple-preview-open]'), 'preview what the AI will receive')
  assert.ok(view.q('.diple-clear'), 'clear')
  assert.ok(view.q('[data-diple-drawer-open]'), 'this session’s annotations')
})

test('8 annotations: five chips and “+3”; “+3” shows them all', async () => {
  const h = fresh()
  await seed(h, 'stored-1', items(8))
  const view = await mount(h)
  assert.equal(chips(view).length, 5)
  const more = view.q('[data-diple-more]')
  assert.equal(more.textContent, '+3')
  await click(more)
  assert.equal(chips(view).length, 8)
  // short again (a send, a clear): folds back for the next long list
  await click(view.q('.diple-clear'))
  await seed(h, 'stored-1', items(8).map((x) => ({ ...x, id: `${x.id}b`, text: `${x.text} 再来` })))
  assert.equal(chips(view).length, 5)
})

test('hover: a Markdown preview of the text and the comment, no scrolling; uiBus.hover follows', async () => {
  const h = fresh()
  await seed(h, 'stored-1', items(3))
  const view = await mount(h)
  const seen = []
  h.deps.uiBus.onHover((id) => seen.push(id))
  scrolled.length = 0
  await hover(chips(view)[0])
  const pv = view.q('[data-diple-chip-preview]')
  assert.ok(pv, 'preview shown')
  assert.equal(pv.querySelector('.diple-preview-origin').textContent, '第 1 条回复')
  assert.equal(pv.querySelector('.diple-preview-text strong')?.textContent, '数据库', 'the text is rendered as Markdown')
  assert.equal(pv.querySelector('.diple-preview-comment strong')?.textContent, '加粗', 'the comment is rendered as Markdown')
  assert.equal(pv.getAttribute('role'), 'tooltip')
  assert.deepEqual(scrolled, [], 'hovering never scrolls the page')
  await act(async () => chips(view)[0].dispatchEvent(new w.MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })))
  assert.equal(view.q('[data-diple-chip-preview]'), null)
  assert.deepEqual(seen, ['i1', null])
})

test('click: uiBus.locate(itemId, { edit: true }); the strip adds no notice and no way back of its own', async () => {
  const h = fresh()
  await seed(h, 'stored-1', items(2))
  const view = await mount(h)
  const calls = []
  let answer = 'shown'
  h.deps.uiBus.onLocate(async (id, opts) => (calls.push([id, opts]), answer))
  await click(chips(view)[1])
  assert.deepEqual(calls, [['i2', { edit: true }]])
  // the one "← back to the composer" belongs to the locate side (v2t-capture)
  assert.equal(document.querySelector('[data-diple-back]'), null)
  // "missing": the locator has told the user already — nothing more here
  answer = 'missing'
  const before = sdk.notifications.length
  await click(chips(view)[0])
  assert.equal(view.q('[data-diple-hint]'), null)
  assert.equal(sdk.notifications.length, before)
  answer = 'other-session'
  await click(chips(view)[0])
  assert.match(view.q('[data-diple-hint]').textContent, /另一个会话/)
})

test('a real capture: the chip goes back to the original text through the locate side (capture/locate.js)', async () => {
  const h = fresh()
  const view = await mount(h)
  // a real capture (⌘⇧E on a selection), so the origin carries its anchor
  const node = document.getElementById('a1b').firstChild
  const r = document.createRange()
  r.setStart(node, 0)
  r.setEnd(node, node.data.length)
  document.getSelection().removeAllRanges()
  document.getSelection().addRange(r)
  await act(async () => {
    await h.find('keybinds', (c) => c.data.id === 'diple.add').data.run()
    await tick(5)
  })
  assert.equal(chips(view).length, 0, 'V2.1 #2: not on the strip before its editor saved it')
  await act(async () => (saveOpenEditor(), tick(5)))
  assert.equal(chips(view).length, 1)
  scrolled.length = 0
  await click(chips(view)[0])
  await act(async () => tick(30))
  assert.ok(scrolled.length, 'scrolled to the original')
  assert.ok(scrolled.at(-1).closest('[data-message-id="101-1-assistant"]'), 'inside its message')
})

test('editor open / original hovered: the chip shows it', async () => {
  const h = fresh()
  await seed(h, 'stored-1', items(3))
  const view = await mount(h)
  await act(async () => h.deps.uiBus.editorOpened('i2'))
  assert.deepEqual(chips(view).map((c) => c.hasAttribute('data-active')), [false, true, false])
  await act(async () => h.deps.uiBus.editorClosed('i2'))
  assert.ok(!chips(view)[1].hasAttribute('data-active'))
  await act(async () => h.deps.uiBus.hover('i3'))
  assert.deepEqual(chips(view).map((c) => c.hasAttribute('data-lit')), [false, false, true])
  await act(async () => h.deps.uiBus.hover(null))
  assert.ok(!chips(view)[2].hasAttribute('data-lit'))
})

test('a lit chip hidden behind “+N” lights the “+N”', async () => {
  const h = fresh()
  await seed(h, 'stored-1', items(8))
  const view = await mount(h)
  await act(async () => h.deps.uiBus.hover('i7'))
  assert.ok(view.q('[data-diple-more]').hasAttribute('data-lit'))
})

test('× on a chip removes it; undo brings it back; clear all is undoable too', async () => {
  const h = fresh()
  await seed(h, 'stored-1', items(3))
  const view = await mount(h)
  await click(chips(view)[0].parentElement.querySelector('.diple-chip-remove'))
  assert.equal(chips(view).length, 2)
  assert.match(view.q('.diple-undo').textContent, /已删除 1 条标注/)
  await click(view.q('.diple-undo button'))
  assert.equal(chips(view).length, 3)
  await click(view.q('.diple-clear'))
  assert.equal(chips(view).length, 0)
  assert.match(view.q('.diple-undo').textContent, /已清空 3 条标注/)
  await click(view.q('.diple-undo button'))
  assert.equal(chips(view).length, 3)
})

test('uiBus.sendNow (⌘⏎ in the editor) goes out through the one send flow, byte-identical to the button', async () => {
  const out = []
  for (const path of ['button', 'bus']) {
    const h = fresh()
    await seed(h, 'stored-1', items(2))
    const view = await mount(h)
    if (path === 'button') await click(view.q('[data-diple-send]'))
    else
      await act(async () => {
        h.deps.uiBus.sendNow()
        await tick(10)
      })
    assert.equal(sdk.submits.length, 1, `${path}: one submit`)
    const put = h.backend.puts().at(-1)
    const b = put.path.split('/')[2]
    out.push({ display: sdk.submits[0].text.split(b).join('<B>'), full: put.body.full.split(b).join('<B>') })
    await cleanupAll()
  }
  assert.equal(out[1].display, out[0].display)
  assert.equal(out[1].full, out[0].full)
})

test('busy: “send after reply”, the steer hint and the queue keep working in the strip', async () => {
  const h = fresh()
  await seed(h, 'stored-1', items(2))
  sdk.state.busy.set(true)
  const view = await mount(h)
  assert.match(view.q('[data-diple-footer]').textContent, /插话/)
  await click(view.q('[data-diple-send-after]'))
  assert.match(view.q('[data-diple-footer]').textContent, /回答完后自动发送/)
  assert.equal(sdk.submits.length, 0)
  assert.ok(view.q('[data-diple-queue-cancel]'))
})

test('hand-off of focus: the strip is inside the composer of its own session (split view)', async () => {
  const h = fresh()
  await seed(h, 'stored-1', items(2))
  await seed(h, 'stored-2', items(1))
  const main = await mount(h, 'slot-main')
  const tile = await mount(h, 'slot-tile')
  assert.equal(chips(main).length, 2)
  assert.equal(chips(tile).length, 1)
})

test('English: summary and chip preview follow the pinned language', async () => {
  const h = fresh({ settings: { language: 'en' } })
  await seed(h, 'stored-1', items(3))
  const view = await mount(h)
  assert.equal(view.q('.diple-strip-summary').textContent, '3 annotations · 2 comments')
  await hover(chips(view)[1])
  assert.equal(view.q('.diple-preview-origin').textContent, 'Reply #2')
})
