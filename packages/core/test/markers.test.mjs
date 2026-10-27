import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'

import { parse, reconcile, markerFor, parseNumbers } from '../src/markers.js'

const batch = {
  batchId: 'b7k2m9',
  items: [
    { comment: '这里不对' }, // 1 comment
    { comment: '' }, // 2 highlight
    { comment: '为什么？' } // 3 comment
  ]
}

test('markerFor writes the format the rules ask for', () => {
  assert.equal(markerFor('b7k2m9', [1, 3]), '::ann{b="b7k2m9" n="1,3"}')
  assert.equal(markerFor('b7k2m9', 2), '::ann{b="b7k2m9" n="2"}')
})

test('parseNumbers is lenient about separators and drops garbage', () => {
  assert.deepEqual(parseNumbers('1,3'), [1, 3])
  assert.deepEqual(parseNumbers('1， 3、3'), [1, 3])
  assert.deepEqual(parseNumbers('x, 0, -2, 4'), [4])
  assert.deepEqual(parseNumbers(undefined), [])
})

const cases = [
  ['own paragraph', '::ann{b="b7k2m9" n="1"}\n\n回应一', [{ b: 'b7k2m9', ns: [1], at: 0 }]],
  ['mid paragraph (host renders it too)', '先说结论 ::ann{b="b7k2m9" n="3"} 然后', [{ b: 'b7k2m9', ns: [3], at: 5 }]],
  ['single quotes and upper-case keys', "::ann{B='b7k2m9' N='1,3'}", [{ b: 'b7k2m9', ns: [1, 3], at: 0 }]],
  ['inside fenced code is ignored', '```\n::ann{b="b7k2m9" n="1"}\n```', []],
  ['inside tilde fence is ignored', '~~~md\n::ann{b="b7k2m9" n="1"}\n~~~', []],
  ['inside inline code is ignored', 'write `::ann{b="b7k2m9" n="1"}` like this', []],
  ['indented code is ignored', 'para\n\n    ::ann{b="b7k2m9" n="1"}\n', []],
  ['not at a word start', 'std::ann{b="b7k2m9" n="1"}', []],
  ['other directive name', '::annotate{b="b7k2m9" n="1"}', []],
  ['missing b', '::ann{n="1"}', []],
  ['missing n', '::ann{b="b7k2m9"}', []],
  ['unclosed brace', '::ann{b="b7k2m9" n="1"', []],
  [
    'two markers',
    '::ann{b="b7k2m9" n="1"}\n\na\n\n::ann{b="b7k2m9" n="3"}\n\nb',
    [
      { b: 'b7k2m9', ns: [1], at: 0 },
      { b: 'b7k2m9', ns: [3], at: 28 }
    ]
  ]
]

for (const [name, text, expected] of cases) {
  test(`parse: ${name}`, () => assert.deepEqual(parse(text), expected))
}

test('reconcile: everything answered', () => {
  const r = reconcile('::ann{b="b7k2m9" n="1,3"}\n\n都回应了', batch)
  assert.deepEqual([...r.answered].sort(), [1, 3])
  assert.deepEqual(r.missing, [])
  assert.equal(r.noMarkers, false)
})

test('reconcile: one missing', () => {
  const r = reconcile('::ann{b="b7k2m9" n="3"}\n\n只回应了三', batch)
  assert.deepEqual([...r.answered], [3])
  assert.deepEqual(r.missing, [1])
  assert.equal(r.noMarkers, false)
})

test('reconcile: no markers at all', () => {
  const r = reconcile('一个标记都没有', batch)
  assert.deepEqual(r.missing, [1, 3])
  assert.equal(r.noMarkers, true)
})

test('reconcile ignores other batches, highlights, unknown numbers and code', () => {
  const text = [
    '::ann{b="other1" n="1"}',
    '::ann{b="b7k2m9" n="2,9"}',
    '```\n::ann{b="b7k2m9" n="1"}\n```'
  ].join('\n\n')
  const r = reconcile(text, batch)
  assert.deepEqual([...r.answered], [])
  assert.deepEqual(r.missing, [1, 3])
  assert.equal(r.noMarkers, false, 'a marker of this batch was written, even if only for a highlight')
})

test('the same comment answered in several places counts once', () => {
  const r = reconcile('::ann{b="b7k2m9" n="1"}\n\nx\n\n::ann{b="b7k2m9" n="1"}\n\ny', batch)
  assert.deepEqual([...r.answered], [1])
  assert.equal(parse('::ann{b="b7k2m9" n="1"}\n\nx\n\n::ann{b="b7k2m9" n="1"}').length, 2)
})

test('R1 XE-12: markers inside code in block quotes and list items do not count', () => {
  const b = { batchId: 'oldbatch', items: [{ comment: '请回答' }] }
  const code = [
    '>     ::ann{b="oldbatch" n="1"}',
    '> ```\n> ::ann{b="oldbatch" n="1"}\n> ```',
    '>> ~~~\n>> ::ann{b="oldbatch" n="1"}\n>> ~~~',
    '-     ::ann{b="oldbatch" n="1"}',
    '- 列表项\n\n      ::ann{b="oldbatch" n="1"}',
    '1. 第一项\n   ```\n   ::ann{b="oldbatch" n="1"}\n   ```'
  ]
  for (const text of code) {
    const r = reconcile(text, b)
    assert.deepEqual([...r.answered], [], text)
    assert.equal(r.noMarkers, true, text)
  }
  // …but plain paragraphs inside them still do
  for (const text of ['> ::ann{b="oldbatch" n="1"}', '- ::ann{b="oldbatch" n="1"} 回应', '- 列表项\n\n  ::ann{b="oldbatch" n="1"}', '**强调** ::ann{b="oldbatch" n="1"} [链接](x)']) {
    assert.deepEqual([...reconcile(text, b).answered], [1], text)
  }
  // a paragraph after a list is not swallowed as list code
  assert.deepEqual([...reconcile('- a\n\n::ann{b="oldbatch" n="1"}', b).answered], [1])
})

// Cross-check against the host's own directive scanner when its source is
// available: on prose (no code), both must see the same ann directives.
const hostFile = path.join(
  process.env.HERMES_AGENT_ROOT ?? path.join(os.homedir(), '.hermes/hermes-agent'),
  'apps/desktop/src/lib/transcript-directives.ts'
)

test('agrees with the host transcript-directive scanner on prose', { skip: !fs.existsSync(hostFile) && 'host source not found' }, async () => {
  const out = await build({ entryPoints: [hostFile], bundle: true, write: false, format: 'esm', platform: 'node' })
  const url = 'data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64')
  const host = await import(url)
  const samples = [
    '::ann{b="b7k2m9" n="1"}',
    '前文 ::ann{b="b7k2m9" n="1,3"} 后文',
    'std::ann{b="b7k2m9" n="1"}',
    '::annotate{b="x"}',
    "::ann{b='b7k2m9' n='3'}",
    '::ann{b="b7k2m9" n="1"} and ::ann{b="b7k2m9" n="3"}',
    '::ann{b="b7k2m9" n="1"',
    'no directive here'
  ]
  for (const s of samples) {
    const hostAnn = (host.segmentTranscriptDirectives(s) ?? [])
      .filter((seg) => seg.kind === 'directive' && seg.directive.name === 'ann')
      .map((seg) => ({ b: seg.directive.attrs.b, n: seg.directive.attrs.n }))
      .filter((d) => d.b && parseNumbers(d.n).length)
    const ours = parse(s).map((m) => ({ b: m.b, n: m.ns.join(',') }))
    assert.deepEqual(
      ours,
      hostAnn.map((d) => ({ b: d.b, n: parseNumbers(d.n).join(',') })),
      s
    )
  }
})
