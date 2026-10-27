// XR2-02 timing case, split out of anchor.test.mjs so it runs alone.
//
// `npm test` runs the *.test.mjs files in parallel processes; on a busy run this
// case took 1.1–1.4 s for ~0.1 s of work, purely from CPU contention. The
// *.perf.mjs files run afterwards with --test-concurrency=1 (package.json), so
// the wall-clock limit measures the code, not the other test files.
import test from 'node:test'
import assert from 'node:assert/strict'

import { makeAnchor, prepare, locateMany } from '../src/anchor.js'

// XR2-02: one prepared context per document version, shared by every anchor.
const BIG_BLOCK = 'X'.repeat(34) + 'word' + 'Y'.repeat(34) + '\n' + 'z'.repeat(4826) + '\n'
const BIG_OLD = '# HEAD\n' + BIG_BLOCK.repeat(1000) + '# FOOT OLD\n' // 4.9 MB, 1000 full-context copies
const BIG_NEW = BIG_OLD.replace('FOOT OLD', 'FOOT NEW') // same length: a Map keyed by the string would collide

test('XR2-02: 100 anchors among 1000 identical copies in a 4.9 MB document relocate in well under a second', () => {
  const anchors = Array.from({ length: 100 }, (_, i) => {
    const at = 7 + i * BIG_BLOCK.length + 34
    return makeAnchor(BIG_OLD, at, at + 4)
  })
  const t0 = performance.now()
  const P = prepare(BIG_NEW)
  const prior = [prepare(BIG_OLD)]
  const found = locateMany(P, anchors, { prior })
  for (const f of found) makeAnchor(P, f.start, f.end)
  const ms = performance.now() - t0
  assert.ok(found.every((f, i) => f.start === 7 + i * BIG_BLOCK.length + 34), 'every copy carried to its own place')
  assert.ok(ms < 1000, `took ${Math.round(ms)} ms`)
})
