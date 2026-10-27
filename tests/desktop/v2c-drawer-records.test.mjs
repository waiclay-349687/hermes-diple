// V2-C drawer data: the session's annotations in four states, from the
// pending list and the stored batch records (no new backend query needed).
import test from 'node:test'
import assert from 'node:assert/strict'

import { loadModule } from './harness.mjs'

// records.js imports @diple/core (CopyText): load it through the build's aliases
const { buildRecords, countByStatus, toMarkdown } = await loadModule('diple', 'plugins/diple/desktop/src/send/drawer/records.js')

const o = (n) => ({ sessionId: 's1', role: 'assistant', roleOrdinal: n, ordinal: n * 2, rowId: 10 + n, verified: true })
const it = (id, n, comment = '', text = `原文 ${id}`) => ({ id, origin: o(n), text, comment })

const batches = [
  // newest first, as GET /batches returns them
  { batchId: 'b3', status: 'registered', createdAt: 30, items: [it('r1', 5)] }, // in flight: still in the list
  { batchId: 'b2', status: 'answered', createdAt: 20, answer: { answered: [1], missing: [3], noMarkers: false }, items: [it('x1', 3, '为什么？'), it('x2', 3), it('x3', 4, '数据呢？')] },
  { batchId: 'b1', status: 'expanded', createdAt: 10, items: [it('y1', 1, '展开讲讲'), it('y2', 2)] },
  { batchId: 'b0', status: 'failed', createdAt: 5, items: [it('z1', 1, '失败的那批')] }, // put back: not a record
  { batchId: 'b9', status: 'expanded', outcome: 'not-delivered', createdAt: 4, items: [it('w1', 1)] } // final: not delivered
]

test('four states: pending from the list; sent, answered and missing from the batch records', () => {
  const recs = buildRecords({ items: [it('p1', 6, '待发的批注'), it('p2', 7)], batches })
  const view = recs.map((r) => [r.status, r.itemId, r.n, r.batchId])
  assert.deepEqual(view, [
    ['pending', 'p1', 1, null],
    ['pending', 'p2', 2, null],
    ['sent', 'y1', 1, 'b1'],
    ['sent', 'y2', 2, 'b1'],
    ['answered', 'x1', 1, 'b2'],
    ['sent', 'x2', 2, 'b2'],
    ['missing', 'x3', 3, 'b2']
  ])
  assert.deepEqual(countByStatus(recs), { all: 7, pending: 2, sent: 3, answered: 1, missing: 1 })
})

test('a reply without any markers leaves every comment of its batch missing', () => {
  const recs = buildRecords({ items: [], batches: [{ batchId: 'b5', status: 'answered', createdAt: 1, answer: { answered: [], missing: [], noMarkers: true }, items: [it('a', 1, '一'), it('b', 1)] }] })
  assert.deepEqual(recs.map((r) => r.status), ['missing', 'sent'])
})

test('copy as Markdown: sections per state, origin, quoted text, comment (the pin card\'s block, V2.1 #7)', () => {
  const recs = buildRecords({ items: [it('p1', 6, '待发的批注', '第一行\n**第二行**')], batches: batches.slice(1, 2) })
  const t = (k, ...a) =>
    ({
      'send.drawer.mdTitle': `本会话标注（${a[0]}）`,
      'send.drawer.status.pending': '待发',
      'send.drawer.status.sent': '已发送',
      'send.drawer.status.answered': '已回应',
      'send.drawer.status.missing': '漏答'
    })[k] ?? k
  const md = toMarkdown(recs, { t, originLabel: (origin) => `第 ${origin.roleOrdinal} 条回复` })
  assert.equal(
    md,
    [
      '# 本会话标注（4）',
      '',
      '## 待发',
      '',
      '1. 第 6 条回复',
      '',
      '   > 第一行',
      '   > **第二行**',
      '',
      '   待发的批注',
      '',
      '## 已发送',
      '',
      '2. 第 3 条回复',
      '',
      '   > 原文 x2',
      '',
      '## 已回应',
      '',
      '1. 第 3 条回复',
      '',
      '   > 原文 x1',
      '',
      '   为什么？',
      '',
      '## 漏答',
      '',
      '3. 第 4 条回复',
      '',
      '   > 原文 x3',
      '',
      '   数据呢？',
      ''
    ].join('\n')
  )
})
