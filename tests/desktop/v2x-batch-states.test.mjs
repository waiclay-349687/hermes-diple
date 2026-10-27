// V2-X (R8 XV-04): the transcript marks and the drawer derive a sent
// annotation's state through one function. Table-driven over every terminal
// state the backend can report; then both consumers fed the same rows agree.
import test from 'node:test'
import assert from 'node:assert/strict'

import { itemState, wentOut } from '../../plugins/diple/desktop/src/shared/batch-states.js'
import { createSentMarks } from '../../plugins/diple/desktop/src/capture/mark-states.js'
import { createBatchCatalog } from '../../plugins/diple/desktop/src/shared/batch-catalog.js'
import { loadModule } from './harness.mjs'

const { buildRecords } = await loadModule('diple', 'plugins/diple/desktop/src/send/drawer/records.js')

const C = { id: 'c', comment: '为什么？', text: 'x', origin: { sessionId: 's1' } }
const H = { id: 'h', comment: '', text: 'y', origin: { sessionId: 's1' } }
const ans = { answered: [1], missing: [2], noMarkers: false }

// [label, batch fields, comment item #1, comment item #2, highlight #1]
const TABLE = [
  ['registered (in flight, still in the list)', { status: 'registered' }, null, null, null],
  ['failed (put back)', { status: 'failed' }, null, null, null],
  ['failed + outcome failed', { status: 'failed', outcome: 'failed' }, null, null, null],
  ['expanded, final failed before /failed arrived (R8 XV-04)', { status: 'expanded', outcome: 'failed', outcomeReason: 'not-persisted' }, null, null, null],
  ['expanded, put back quietly', { status: 'expanded', outcome: 'failed', outcomeReason: 'put-back' }, null, null, null],
  ['expanded, cancelled', { status: 'expanded', outcome: 'failed', outcomeReason: 'cancelled' }, null, null, null],
  ['expanded, unknown outcome', { status: 'expanded', outcome: 'not-delivered' }, null, null, null],
  ['answered but final failed', { status: 'answered', outcome: 'failed', answer: ans }, null, null, null],
  ['registered with a stray delivered outcome', { status: 'registered', outcome: 'delivered' }, null, null, null],
  ['expanded, no outcome yet', { status: 'expanded' }, 'sent', 'sent', 'sent'],
  ['expanded, delivered', { status: 'expanded', outcome: 'delivered' }, 'sent', 'sent', 'sent'],
  ['answered, delivered', { status: 'answered', outcome: 'delivered', answer: ans }, 'answered', 'missing', 'sent'],
  ['answered, outcome not fixed yet', { status: 'answered', answer: ans }, 'answered', 'missing', 'sent'],
  ['answered without any markers', { status: 'answered', answer: { answered: [], missing: [], noMarkers: true } }, 'missing', 'missing', 'sent']
]

for (const [label, b, c1, c2, h1] of TABLE) {
  test(`itemState: ${label}`, () => {
    const batch = { batchId: 'b1', sessionId: 's1', ...b }
    assert.equal(wentOut(batch), c1 !== null)
    assert.equal(itemState(batch, C, 1), c1)
    assert.equal(itemState(batch, C, 2), c2)
    assert.equal(itemState(batch, H, 1), h1)
  })
}

test('marks and drawer agree on every row of the table', async () => {
  for (const [label, b] of TABLE) {
    const batch = { batchId: 'b1', sessionId: 's1', createdAt: 1, items: [C, { ...C, id: 'c2' }, H], ...b }
    const store = new Map([['batches.index', ['b1']], ['batch.b1', { batchId: 'b1', sessionKey: 's1', items: batch.items }]])
    const api = { listBatches: async () => ({ batches: [batch] }) }
    const marks = createSentMarks({ batches: createBatchCatalog({ storage: { get: (k, d) => store.get(k) ?? d }, api }), api })
    await marks.refresh('s1')
    const fromMarks = marks.forKey('s1').map((m) => [m.id, m.state])
    const fromDrawer = buildRecords({ batches: [batch] }).map((r) => [r.itemId, r.status])
    assert.deepEqual(fromMarks, fromDrawer, label)
    marks.dispose()
  }
})
