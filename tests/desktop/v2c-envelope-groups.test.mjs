// V2-C (design §2.10a): with 4+ comments over 2+ messages, `full` tells the AI
// how the comments group by message and how to work them (adapted from the
// host's preview-annotate/pack.ts). Numbers, item sections and markers stay.
import test from 'node:test'
import assert from 'node:assert/strict'

import { compose } from '../../packages/core/src/envelope.js'
import { reconcile } from '../../packages/core/src/markers.js'

const ai = (n) => ({ sessionId: 's1', role: 'assistant', ordinal: n * 2, roleOrdinal: n, rowId: 100 + n, verified: true })
const me = (n) => ({ sessionId: 's1', role: 'user', ordinal: n * 2 - 1, roleOrdinal: n, rowId: 50 + n, verified: true })
const item = (id, origin, comment = '') => ({ id, origin, text: `原文 ${id}`, comment })
const B = 'bgroups1'

const four = [
  item('a', ai(2), '为什么？'),
  item('b', ai(2), '举个例子'),
  item('c', me(3)),
  item('d', ai(4), '数据呢？'),
  item('e', ai(4), '改成表格')
]

test('4 comments over 2 messages: the rules group them by message and say how to work them', () => {
  const { full } = compose({ items: four, batchId: B })
  assert.match(full, /- 这 4 条批注按所在消息分成 2 组：组 1 · 第 2 条回复：①②；组 2 · 第 4 条回复：④⑤。/)
  assert.match(full, /当作 2 件事来做，而不是 4 件；同一组的批注合并成一次修改/)
  assert.match(full, /不要拆开同一组，也不要按主题/)
  // the highlight (③) is background and belongs to no group
  assert.ok(!/组 \d · 我的第 3 条消息/.test(full))
})

test('the grouping never changes numbering, item sections, the display or the markers', () => {
  const grouped = compose({ items: four, batchId: B })
  const flat = compose({ items: four.slice(0, 4), batchId: B }) // 3 comments: no grouping
  assert.ok(!flat.full.includes('分成'), 'below the threshold the rules stay flat')
  // every item section is the same text it was without the guidance
  for (const n of ['①', '②', '③', '④']) {
    const section = (f) => f.slice(f.indexOf(`### ${n}`), f.indexOf('\n\n', f.indexOf(`### ${n}`)))
    assert.equal(section(grouped.full), section(flat.full))
  }
  assert.ok(!grouped.display.includes('分成'), 'the bubble does not carry the guidance')
  const r = reconcile('::ann{b="bgroups1" n="1,2"}\n\n合并回答\n\n::ann{b="bgroups1" n="4,5"}\n\n另一组', { batchId: B, items: four })
  assert.deepEqual([...r.answered].sort(), [1, 2, 4, 5])
  assert.deepEqual(r.missing, [])
})

test('4 comments on one message: no grouping (one group is not a split)', () => {
  const one = [item('a', ai(2), '一'), item('b', ai(2), '二'), item('c', ai(2), '三'), item('d', ai(2), '四')]
  assert.ok(!compose({ items: one, batchId: B }).full.includes('分成'))
})

test('English wording, and file origins (Diple Docs) group by file', () => {
  const file = (p, line) => ({ path: p, line })
  const items = [
    item('a', file('docs/a.md', 3), 'x'),
    item('b', file('docs/a.md', 9), 'y'),
    item('c', file('docs/b.md', 1), 'z'),
    item('d', ai(1), 'w')
  ]
  const { full } = compose({ items, batchId: B, lang: 'en' })
  assert.match(full, /- These 4 comments fall into 3 groups by message: group 1 · docs\/a\.md: ①②; group 2 · docs\/b\.md: ③; group 3 · reply #1: ④\./)
  assert.match(full, /Work them as 3 pieces of work, not 4\. Fold comments in the same group into one change\./)
})

test('comments from another session are grouped apart from the same reply number here', () => {
  const other = { ...ai(2), sessionId: 's2', sessionTitle: '旧会话' }
  const items = [item('a', ai(2), '一'), item('b', other, '二'), item('c', ai(2), '三'), item('d', other, '四')]
  const { full } = compose({ items, batchId: B, sessionId: 's1' })
  assert.match(full, /组 1 · 第 2 条回复：①③；组 2 · 会话「旧会话」 · 第 2 条回复：②④。/)
})
