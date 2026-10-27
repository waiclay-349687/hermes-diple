// XR10-02: the batch size policy is one pure core module — the flow refuses by
// it, the footer shows it, neither owns it.
import test from 'node:test'
import assert from 'node:assert/strict'

import { SendSize } from '../src/index.js'

test('no or non-positive context → unknown, no percentage', () => {
  for (const max of [0, null, undefined, -5, NaN]) assert.deepEqual(SendSize.level(10, max), { tokens: 10, max: null, pct: null, level: 'unknown' })
})

test('25% warns, 50% refuses — strictly above the line', () => {
  assert.equal(SendSize.level(250, 1000).level, 'ok')
  assert.equal(SendSize.level(251, 1000).level, 'soft')
  assert.equal(SendSize.level(500, 1000).level, 'soft')
  assert.equal(SendSize.level(501, 1000).level, 'hard')
  assert.deepEqual(SendSize.level(333, 1000), { tokens: 333, max: 1000, pct: 33, level: 'soft' })
  assert.equal(SendSize.SOFT_LIMIT, 0.25)
  assert.equal(SendSize.HARD_LIMIT, 0.5)
})
