// L4 (D1): the runtime entry of the shared core exposes what the plugins run,
// nothing a test alone needs. The reference models stay in their own module,
// whole, for the shared cases and the JS↔Python differential test.
import test from 'node:test'
import assert from 'node:assert/strict'

import * as core from '../src/index.js'
import * as protocol from '../src/handoff-protocol.js'

test('core runtime entry: the namespaces, and the hand-off protocol\'s runtime interface only', () => {
  assert.deepEqual(Object.keys(core).sort(), ['Anchor', 'CopyText', 'Envelope', 'Handoff', 'MarkLook', 'Markers', 'PassageLook', 'PendingList', 'SendRequest', 'SendSize'])
  assert.deepEqual(Object.keys(core.Handoff).sort(), ['CAP_PARTIAL', 'itemOutcomes', 'readReceipt', 'receiverInit', 'receiverStep', 'senderInit', 'senderStep'])
  assert.ok(Object.isFrozen(core.Handoff))
  for (const [k, v] of Object.entries(core.Handoff)) assert.equal(v, protocol[k], `${k} is the protocol module's own`)
})

test('the reference models and constants are still there for the differential tests', () => {
  for (const k of ['ledgerStep', 'settledFromBatch', 'settledForHandoff', 'settledForPeer', 'fallbackAfter']) assert.equal(typeof protocol[k], 'function', k)
  assert.equal(protocol.LEASE_MS, 30_000)
  assert.equal(protocol.FRESH_MS, 15_000)
  assert.equal(protocol.INFER_AFTER_MS, 60_000)
  assert.equal(protocol.UNKNOWN_AFTER_MS, 600_000)
})
