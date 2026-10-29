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

// XR11d-04: every run is checked and printed; two limits —
//   cold: the FIRST run (cold start, first computation) < 2 s (twice the warm limit);
//   warm: the fastest of the 3 runs < 1 s (unchanged: load only adds time, so the
//         best run filters scheduling noise; the cold limit catches a slow first run).
const RUNS = 3
const COLD_MS = 2000
const WARM_MS = 1000

test('XR2-02: 100 anchors among 1000 identical copies in a 4.9 MB document relocate in well under a second', () => {
  const anchors = Array.from({ length: 100 }, (_, i) => {
    const at = 7 + i * BIG_BLOCK.length + 34
    return makeAnchor(BIG_OLD, at, at + 4)
  })
  const samples = []
  for (let run = 0; run < RUNS; run++) {
    const t0 = performance.now()
    const P = prepare(BIG_NEW)
    const prior = [prepare(BIG_OLD)]
    const found = locateMany(P, anchors, { prior })
    for (const f of found) makeAnchor(P, f.start, f.end)
    samples.push(performance.now() - t0)
    assert.ok(found.every((f, i) => f.start === 7 + i * BIG_BLOCK.length + 34), `run ${run + 1}: every copy carried to its own place`)
  }
  const shown = samples.map((ms) => Math.round(ms)).join(' / ')
  console.log(`perf anchor locateMany: ${shown} ms (cold first, then warm)`)
  assert.ok(samples[0] < COLD_MS, `cold: first run ${Math.round(samples[0])} ms ≥ ${COLD_MS} ms (all runs: ${shown} ms)`)
  assert.ok(Math.min(...samples) < WARM_MS, `warm: best of ${RUNS} ${Math.round(Math.min(...samples))} ms ≥ ${WARM_MS} ms (all runs: ${shown} ms)`)
})
