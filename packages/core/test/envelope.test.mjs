import test from 'node:test'
import assert from 'node:assert/strict'

import { compose, clipText, estimateTokens } from '../src/envelope.js'
import * as Envelope from '../src/envelope.js'
import { reconcile } from '../src/markers.js'

const aiOrigin = (n, extra = {}) => ({ sessionId: 's1', role: 'assistant', ordinal: n * 2, roleOrdinal: n, rowId: 100 + n, verified: true, ...extra })
const userOrigin = (n) => ({ sessionId: 's1', role: 'user', ordinal: n * 2 - 1, roleOrdinal: n, rowId: 50 + n, verified: true })

const items = [
  { id: 'a', origin: aiOrigin(12), text: '缓存失效的时候，先删除缓存再更新数据库会出现脏读，所以推荐先更新数据库再删除缓存，并配合延迟双删。', comment: '这里为什么要双删？' },
  { id: 'b', origin: userOrigin(3), text: '我们的 QPS 大约是 2000', comment: '' }
]

test('display: body, divider, one line per annotation, comment line, reference last', () => {
  const { display } = compose({ body: '看看这两处', items, batchId: 'b7k2m9' })
  assert.equal(
    display,
    [
      '看看这两处',
      '',
      '—— 附 2 条标注 ——',
      '① 第 12 条回复：「缓存失效的时候，先删除缓存再更新数据库会出现脏读，所以推荐先更新数据库再删除缓存……」',
      '   意见：这里为什么要双删？',
      '② 我的第 3 条消息：「我们的 QPS 大约是 2000」',
      '@diple:b7k2m9'
    ].join('\n')
  )
})

test('display with an empty body starts at the divider', () => {
  const { display } = compose({ body: '  ', items: items.slice(1), batchId: 'b7k2m9' })
  assert.ok(display.startsWith('—— 附 1 条标注 ——\n'))
})

test('display marks an unverified origin as approximate', () => {
  const { display } = compose({ items: [{ ...items[0], origin: aiOrigin(4, { verified: false, rowId: undefined }) }], batchId: 'b7k2m9' })
  assert.match(display, /① 约第 4 条回复：/)
})

test('english labels', () => {
  const { display, full } = compose({ items, batchId: 'b7k2m9', lang: 'en' })
  assert.match(display, /^—— 2 annotations attached ——\n① reply #12: "/)
  assert.match(display, /\n   Comment: 这里为什么要双删？\n/)
  assert.match(full, /## Response rules/)
})

test('full: kind, speaker, origin, text, comment and the rules', () => {
  const { full } = compose({ body: '看看这两处', items, batchId: 'b7k2m9' })
  assert.match(full, /^\[标注批次 b7k2m9\] 用户随这条消息附上 2 条标注：1 条批注，1 条划线。/)
  assert.match(full, /### ① 批注 1 · 你（AI）说的\n出处: 第 12 条回复 · 会话 s1 · 消息行号 112\n原文:\n```text\n缓存失效/)
  assert.match(full, /用户的意见: 这里为什么要双删？/)
  assert.match(full, /### ② 划线 2 · 用户说的/)
  assert.match(full, /::ann\{b="b7k2m9" n="1"\}/)
  assert.match(full, /n 只能写批注的编号：1。/)
  assert.ok(!full.includes('@diple:'), 'full must not re-reference itself')
})

test('full fences text that itself contains code fences', () => {
  const code = '```js\nconst a = 1\n```'
  const { full } = compose({ items: [{ id: 'c', origin: aiOrigin(1), text: code, comment: '' }], batchId: 'b7k2m9' })
  assert.match(full, /````text\n```js\nconst a = 1\n```\n````/)
})

test('the combined-marker example appears only with two or more comments', () => {
  const one = compose({ items, batchId: 'b7k2m9' }).full
  assert.ok(!one.includes('n="1,'))
  const two = compose({ items: [items[0], { ...items[1], comment: '也看看' }], batchId: 'b7k2m9' }).full
  assert.match(two, /::ann\{b="b7k2m9" n="1,2"\}/)
})

test('highlights-only batch: rules say no markers', () => {
  const { full } = compose({ items: [items[1]], batchId: 'b7k2m9' })
  assert.match(full, /都是划线/)
  assert.ok(!full.includes('::ann{'))
})

const lengths = [
  [3999, false],
  [4000, false],
  [4001, true],
  [20000, true]
]
for (const [n, clipped] of lengths) {
  test(`clipText at ${n} characters → clipped=${clipped}`, () => {
    const text = 'a'.repeat(1500) + '中'.repeat(n - 3000) + 'z'.repeat(1500)
    const r = clipText(text, '第 1 条回复')
    assert.equal(r.clipped, clipped)
    if (clipped) {
      assert.ok(r.text.startsWith('a'.repeat(1500) + '\n…（中间省略 '))
      assert.ok(r.text.endsWith('\n' + 'z'.repeat(1500)))
      assert.match(r.text, new RegExp(`中间省略 ${n - 3000} 字；全文见第 1 条回复`))
    } else {
      assert.equal(r.text, text)
    }
  })
}

test('clipText counts code points, not UTF-16 units', () => {
  assert.equal(clipText('😀'.repeat(4000), 'x').clipped, false)
})

test('three 4000-character annotations stay whole', () => {
  const big = [1, 2, 3].map((n) => ({ id: `x${n}`, origin: aiOrigin(n), text: String(n).repeat(4000), comment: `意见${n}` }))
  const { full, stats } = compose({ items: big, batchId: 'b7k2m9' })
  for (const n of [1, 2, 3]) assert.ok(full.includes(String(n).repeat(4000)))
  assert.ok(stats.chars > 12000)
  assert.equal(stats.tokens, estimateTokens(full))
})

test('estimateTokens mirrors the host: CJK one each, rest bytes/4', () => {
  assert.equal(estimateTokens(''), 0)
  assert.equal(estimateTokens('abcd'), 1)
  assert.equal(estimateTokens('abcde'), 2)
  assert.equal(estimateTokens('中文'), 2)
  assert.equal(estimateTokens('中文ab'), 3)
})

test('the marker example in the rules is one reconcile accepts', () => {
  const { full } = compose({ items, batchId: 'b7k2m9' })
  const example = full.match(/::ann\{[^}]+\}/)[0]
  assert.deepEqual([...reconcile(`${example}\n\n回应`, { batchId: 'b7k2m9', items }).answered], [1])
})

test('rejects a batch id the host reference parser would mangle', () => {
  assert.throws(() => compose({ items, batchId: 'bad id' }))
  assert.throws(() => compose({ items, batchId: 'x' }))
})

test('multi-session batches name the other session', () => {
  const other = { ...items[1], id: 'o', origin: { ...userOrigin(1), sessionId: 's2', sessionTitle: '另一个话题' } }
  const { display } = compose({ items: [items[0], other], batchId: 'b7k2m9' })
  assert.match(display, /② 会话「另一个话题」 · 我的第 1 条消息：/)
})

test('R1 XE-08: an annotation from another session says so, even alone and without a title', () => {
  const o = { sessionId: 'other-session', role: 'assistant', ordinal: 1, verified: true }
  let { display } = compose({ batchId: 'abcd1234', sessionId: 's1', items: [{ id: 'x', origin: o, text: 'x', comment: '' }] })
  assert.match(display, /① 会话「other-se…」 · 第 1 条回复：「x」/)
  ;({ display } = compose({ batchId: 'abcd1234', sessionId: 's1', items: [{ id: 'x', origin: { ...o, sessionTitle: '旧话题' }, text: 'x', comment: '' }] }))
  assert.match(display, /① 会话「旧话题」 · 第 1 条回复/)
  // the session it is sent into is never named
  ;({ display } = compose({ batchId: 'abcd1234', sessionId: 'other-session', items: [{ id: 'x', origin: o, text: 'x', comment: '' }, { id: 'y', origin: { ...o, sessionId: 's9' }, text: 'y', comment: '' }] }))
  assert.match(display, /① 第 1 条回复：「x」/)
  assert.match(display, /② 会话「s9」 · 第 1 条回复：「y」/)
  ;({ display } = compose({ batchId: 'abcd1234', sessionId: 's1', lang: 'en', items: [{ id: 'x', origin: o, text: 'x', comment: '' }] }))
  assert.match(display, /① session "other-se…" · reply #1: "x"/)
})

test('R1 XE-13: annotation text and comments in the bubble never become live @-references', () => {
  // the host's reference patterns (agent/context_references.py)
  const refs = (s) => [...s.matchAll(/(?<![\w/])@(?:(?:diff|staged)\b|[a-zA-Z][a-zA-Z0-9_-]*:)/g)].map((m) => m[0])
  const it = { id: 'x', origin: { path: 'a.md', line: 1 }, text: '@file:secret.txt 和 @diff 还有 @diple:oldbatch1', comment: '见 @url:https://x.example 与 (@folder:src)' }
  const { display, full } = compose({ body: '请看 @file:mine.md', batchId: 'abcd1234', items: [it] })
  assert.deepEqual(refs(display), ['@file:', '@diple:'], 'only the typed body and our own reference stay live')
  assert.ok(display.endsWith('@diple:abcd1234'))
  assert.ok(display.includes('file:secret.txt') && display.includes('url:https://x.example'), 'still readable and searchable')
  assert.ok(full.includes('@file:secret.txt'), 'the full text keeps the original')
})

test('file origins (from Diple Docs) show path and line', () => {
  const f = { id: 'f', origin: { path: 'docs/plan.md', line: 12 }, text: '目标', comment: '改一下' }
  const { display, full } = compose({ items: [f], batchId: 'b7k2m9' })
  assert.match(display, /① docs\/plan\.md 第 12 行：「目标」/)
  assert.match(full, /### ① 批注 1 · 文件内容/)
})

test('B-1: only a well-formed batch id is a live reference', () => {
  const id = 'b' + 'q7k2m6' + 'a'.repeat(20)
  assert.ok(Envelope.isBatchId(id))
  for (const bad of ['`', '建议改成', 'b1', 'b7k2m9', 'B' + 'a'.repeat(26), 'b' + 'a'.repeat(25), 'b' + 'a'.repeat(27), 'b' + 'a'.repeat(25) + '1', '']) {
    assert.ok(!Envelope.isBatchId(bad), bad)
    assert.equal(Envelope.batchReferenceIn(`看 @${Envelope.REFERENCE_PREFIX}:${bad} 这里`), null, bad)
  }
  const P = Envelope.REFERENCE_PREFIX
  assert.equal(Envelope.batchReferenceIn(`代码里的 \`@${P}:\` 前缀`), null, 'backticked mention')
  assert.equal(Envelope.batchReferenceIn(`@${P}:建议改成`), null, 'Chinese word')
  assert.equal(Envelope.batchReferenceIn(`正文\n@${P}:${id}`), id, 'well-formed')
  for (const tail of ['。', '，', '.', ',', ')', '」']) assert.equal(Envelope.batchReferenceIn(`@${P}:${id}${tail}`), id, tail)
  assert.equal(Envelope.batchReferenceIn(`@${P}:${id}x`), null, 'too long is not ours')
  assert.equal(Envelope.batchReferenceIn(`mail@${P}:${id}`), null, 'not at a word boundary')
})
