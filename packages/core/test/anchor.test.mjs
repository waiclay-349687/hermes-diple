import test from 'node:test'
import assert from 'node:assert/strict'

import { makeAnchor, locate, prepare, locateMany, fingerprint } from '../src/anchor.js'

const doc = ['# 计划', '', '第一步：准备数据。', '第二步：训练模型。', '第三步：评估模型。', ''].join('\n')

function anchorOf(text, doc_ = doc) {
  const start = doc_.indexOf(text)
  return makeAnchor(doc_, start, start + text.length)
}

test('makeAnchor records text, context and 1-based line', () => {
  const a = anchorOf('训练模型')
  assert.equal(a.text, '训练模型')
  assert.equal(a.line, 4)
  assert.ok(a.before.endsWith('第二步：'))
  assert.ok(a.after.startsWith('。\n第三步'))
})

test('locate finds the same text after lines were inserted above', () => {
  const a = anchorOf('训练模型')
  const changed = doc.replace('# 计划\n', '# 计划\n\n新增一段说明。\n')
  const r = locate(changed, a)
  assert.equal(changed.slice(r.start, r.end), '训练模型')
})

test('locate reports missing when the text is gone', () => {
  assert.deepEqual(locate(doc.replace('训练模型', '微调模型'), anchorOf('训练模型')), { changed: true, reason: 'missing' })
})

test('repeated text is disambiguated by its context', () => {
  const a = anchorOf('评估模型')
  const changed = doc + '附录：评估模型的细节。\n'
  const r = locate(changed, a)
  assert.equal(r.start, changed.indexOf('第三步：评估模型') + 4)
})

// A line whose 32 characters of context on each side are the same in every copy.
const UNIT = 'L'.repeat(34) + '同样的待办' + 'R'.repeat(34) + '\n'
const nth = (doc, n) => {
  let i = -1
  for (let k = 0; k <= n; k++) i = doc.indexOf('同样的待办', i + 1)
  return i
}

test('identical contexts: the line decides only in the very document the anchor was taken in', () => {
  const three = UNIT.repeat(3)
  const second = nth(three, 1)
  const a = makeAnchor(three, second, second + 5)
  assert.equal(a.line, 2)
  assert.deepEqual(locate(three, a), { start: second, end: second + 5 }, 'unchanged document: line 2 picks the second copy')
  // once the document changed, the old line number proves nothing
  assert.deepEqual(locate('\n' + three, a), { changed: true, reason: 'ambiguous' })
  assert.deepEqual(locate(three + UNIT, a), { changed: true, reason: 'ambiguous' })
})

test('repeats without enough matching context are ambiguous', () => {
  const a = anchorOf('模型')
  // "模型" occurs three times in doc; anchor of the first one.
  const changed = '完全不同的开头 模型 和 模型 和 模型'
  assert.deepEqual(locate(changed, a), { changed: true, reason: 'ambiguous' })
})

test('empty range throws', () => {
  assert.throws(() => makeAnchor(doc, 3, 3))
})

// XR-05: an identical block inserted next to ours must not silently take the annotation.
test('XR-05: inserting an identical block before the annotation is ambiguous, not a guess by line', () => {
  const block = 'X'.repeat(32) + 'word' + 'Y'.repeat(32)
  const old = block + '\n' + block
  const a = makeAnchor(old, 32, 36)
  assert.equal(a.line, 1)
  const inserted = block + '\n' + old
  assert.deepEqual(locate(inserted, a), { changed: true, reason: 'ambiguous' })
  // even with the old version at hand: prefix-first and suffix-first explanations disagree
  assert.deepEqual(locate(inserted, a, { prior: [old] }), { changed: true, reason: 'ambiguous' })
})

test('XR-05: an unrelated edit is carried through when the old version is known', () => {
  const old = '# 计划\n\n' + UNIT.repeat(2) + '\n中间的说明。\n\n' + UNIT.repeat(2)
  const third = nth(old, 2)
  const a = makeAnchor(old, third, third + 5)
  const edited = old.replace('中间的说明。', '中间的说明，改写得更长了一些。')
  const want = nth(edited, 2)
  assert.deepEqual(locate(edited, a, { prior: [old] }), { start: want, end: want + 5 })
  // a prior version that is not the anchor's proves nothing; nor does no prior at all
  assert.deepEqual(locate(edited, a, { prior: ['something else'] }), { changed: true, reason: 'ambiguous' })
  assert.deepEqual(locate(edited, a), { changed: true, reason: 'ambiguous' })
  // an edit inside a copy's own line removes that copy; the remaining ones are still told apart
  const touched = old.replace(UNIT + '\n中间', 'L'.repeat(34) + '改掉了' + 'R'.repeat(34) + '\n\n中间')
  assert.deepEqual(locate(touched, a, { prior: [old] }), { start: nth(touched, 1), end: nth(touched, 1) + 5 })
})

test('XR-05: anchors saved before sig existed never use the line to break a full-context tie', () => {
  const three = UNIT.repeat(3)
  const { sig, ...legacy } = makeAnchor(three, nth(three, 1), nth(three, 1) + 5)
  assert.ok(sig)
  assert.deepEqual(locate(three, legacy), { changed: true, reason: 'ambiguous' })
})

// XR-08: bounded work on highly repetitive documents.
test('XR-08: 200 000 repeated characters do not overflow the stack', () => {
  const t0 = Date.now()
  const r = locate('a'.repeat(200000), { text: 'a', before: 'bbbbbbbb', after: 'cccccccc', line: 1 })
  assert.deepEqual(r, { changed: true, reason: 'ambiguous' })
  assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0} ms`)
})

test('XR-08: many full-context copies resolve in linear time (one line index per document)', () => {
  const doc = 'x\n'.repeat(15000)
  const a = makeAnchor(doc, 2 * 9000, 2 * 9000 + 1)
  const t0 = Date.now()
  assert.deepEqual(locate(doc, { ...a, before: '', after: '' }), { start: 18000, end: 18001 })
  assert.ok(Date.now() - t0 < 1000, `took ${Date.now() - t0} ms`)
})

test('XR-08: partial-context scoring still picks the unique best copy among many', () => {
  const doc = 'zz '.repeat(15000) + 'before-ctx zz after-ctx ' + 'zz '.repeat(10)
  const r = locate(doc, { text: 'zz', before: 'before-ctx ', after: ' after-CTX', line: 1 })
  assert.equal(r.start, doc.indexOf('before-ctx zz') + 11)
})

// XR2-02: one prepared context per document version, shared by every anchor.
// (The 4.9 MB timing case lives in anchor.perf.mjs: it runs serially, see package.json.)
test('XR2-02: prepare / locateMany give the same answers as locate and makeAnchor on plain strings', () => {
  const old = '# 计划\n\n' + UNIT.repeat(2) + '\n中间的说明。\n\n' + UNIT.repeat(2)
  const edited = old.replace('中间的说明。', '中间的说明，改写得更长了一些。')
  const anchors = [0, 1, 2, 3].map((n) => makeAnchor(old, nth(old, n), nth(old, n) + 5))
  const P = prepare(edited)
  const prior = [prepare(old)]
  assert.equal(prepare(P), P, 'preparing a prepared document is a no-op')
  assert.equal(fingerprint(P), fingerprint(edited))
  const one = anchors.map((a) => locate(edited, a, { prior: [old] }))
  assert.deepEqual(locateMany(edited, anchors, { prior: [old] }), one)
  assert.deepEqual(locateMany(P, anchors, { prior }), one)
  assert.deepEqual(anchors.map((a) => locate(P, a, { prior })), one)
  const r = one[2]
  assert.deepEqual(makeAnchor(P, r.start, r.end), makeAnchor(edited, r.start, r.end))
})
