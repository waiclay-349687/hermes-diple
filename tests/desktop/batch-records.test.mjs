// P2 → L2 (D1 §3 L2, §7.2): the batch records the send flow keeps for the
// markers, the transcript marks and locate — characterised before they move
// behind one module. What is pinned: the storage layout (`batch.<id>`,
// `batches.index`, 200 kept, oldest dropped first), local before remote,
// remote misses and errors → null, a remote hit remembered, locate searching
// every session's local records first, and the marks only drawing batches the
// backend confirms went out.
//
// `records()` is the one place that knows which module answers: before L2 the
// flow (localBatch / batchRecord) and the marks, since L2 the BatchCatalog.
import test from 'node:test'
import assert from 'node:assert/strict'

import { ROOT, setupDom, loadEntry } from './harness.mjs'
import { fixture, flush } from './flow-fixture.mjs'
import { createSentMarks } from '../../plugins/diple/desktop/src/capture/mark-states.js'
import { createBatchCatalog, MAX_LOCAL_BATCHES } from '../../plugins/diple/desktop/src/shared/batch-catalog.js'

setupDom('<!doctype html><html><body></body></html>')
const M = await loadEntry('diple', 'tests/desktop/fixtures/diple-modules.js')

const memory = (init = {}) => {
  const map = new Map(Object.entries(structuredClone(init)))
  return { map, get: (k, d) => (map.has(k) ? structuredClone(map.get(k)) : d), set: (k, v) => map.set(k, structuredClone(v)), remove: (k) => map.delete(k) }
}
const rec = (batchId, sessionKey = 's1', ids = ['i-' + batchId]) => ({ batchId, sessionKey, items: ids.map((id) => ({ id, origin: { sessionId: sessionKey, rowId: 1 }, text: 't ' + id, comment: 'c ' + id })), at: 1 })

/** The records' readers as the plugin wires them (send/index + capture/index). */
function records({ storage, backend = {} }) {
  const calls = []
  const api = {
    getBatch: async (id) => {
      calls.push(['getBatch', id])
      if (backend.down) throw Object.assign(new Error('down'), { status: 0 })
      const b = backend.batches?.[id]
      if (!b) throw Object.assign(new Error('missing'), { status: 404 })
      return structuredClone(b)
    },
    listBatches: async (q) => {
      calls.push(['listBatches', q.sessionId])
      if (backend.down) throw new Error('down')
      return { batches: Object.values(backend.batches ?? {}).filter((b) => b.sessionId === q.sessionId) }
    }
  }
  // L2: the BatchCatalog is the one reader; the flow, the markers and the marks share it
  const batches = createBatchCatalog({ storage, api })
  const marks = createSentMarks({ batches, api })
  return { calls, peek: (id) => batches.peek(id), read: (id) => batches.read(id), marks }
}

test('batch records: a send writes batch.<id> and appends it to batches.index', async () => {
  const f = fixture(M)
  f.add()
  const r = await f.flow.start('s1')
  assert.deepEqual(f.map.get('batches.index'), [r.batchId])
  const saved = f.map.get(`batch.${r.batchId}`)
  assert.deepEqual(Object.keys(saved).sort(), ['at', 'batchId', 'items', 'sessionKey'])
  assert.deepEqual(saved.items.map((x) => Object.keys(x).sort()), [['comment', 'id', 'origin', 'revision', 'text']])
  assert.equal(f.deps.batches.peek(r.batchId).sessionKey, 's1', 'the flow writes through the catalog')
})

test('batch records: 200 are kept; the 201st drops the oldest first (record and index)', async () => {
  const init = {}
  const index = []
  for (let i = 0; i < 200; i++) {
    init[`batch.b${i}`] = rec(`b${i}`)
    index.push(`b${i}`)
  }
  init['batches.index'] = index
  const storage = memory(init)
  const f = fixture(M, { storage: storage.map })
  f.add()
  const r = await f.flow.start('s1')
  const now = storage.map.get('batches.index')
  assert.equal(MAX_LOCAL_BATCHES, 200)
  assert.equal(now.length, 200)
  assert.equal(now[0], 'b1')
  assert.equal(now.at(-1), r.batchId)
  assert.equal(storage.map.has('batch.b0'), false)
  assert.equal(storage.map.has('batch.b1'), true)
})

test('batch records: a local hit asks no one; a miss asks the backend once and remembers it', async () => {
  const storage = memory({ 'batch.L': rec('L'), 'batches.index': ['L'] })
  const R = records({ storage, backend: { batches: { R: { batchId: 'R', sessionId: 's2', status: 'expanded', items: [{ id: 'x', text: 't', comment: '', origin: {} }] } } } })
  assert.equal(R.peek('L').batchId, 'L')
  assert.equal((await R.read('L')).batchId, 'L')
  assert.deepEqual(R.calls, [])
  assert.equal(R.peek('R'), null, 'peek never goes to the network')
  assert.deepEqual(await R.read('R'), { batchId: 'R', sessionKey: 's2', items: [{ id: 'x', text: 't', comment: '', origin: {} }] })
  assert.deepEqual(R.calls, [['getBatch', 'R']])
  assert.deepEqual(storage.map.get('batches.index'), ['L', 'R'])
  await R.read('R')
  assert.equal(R.calls.length, 1, 'remembered')
})

test('batch records: remote missing (404), unreachable, or without items → null; nothing remembered', async () => {
  for (const backend of [{ batches: {} }, { down: true }, { batches: { E: { batchId: 'E', sessionId: 's1', status: 'expanded' } } }]) {
    const storage = memory()
    const R = records({ storage, backend })
    assert.equal(await R.read('E'), null)
    assert.equal(storage.map.has('batches.index'), false)
  }
})

test('locate: a sent item is found in any session\'s local records (newest first) before the backend is asked', async () => {
  const storage = memory({ 'batch.A': rec('A', 's1', ['same']), 'batch.B': rec('B', 's2', ['same']), 'batches.index': ['A', 'B'] })
  storage.map.get('batch.B').items[0].text = 'from B'
  const R = records({ storage, backend: { batches: {} } })
  const it = await R.marks.find('same', 's1')
  assert.equal(it.text, 'from B', 'the newest record, even of another session')
  assert.deepEqual(R.calls, [])
  assert.equal(await R.marks.find('nowhere', null), null, 'no key: no backend search')
  assert.equal(await R.marks.find('nowhere', 's1'), null)
  assert.deepEqual(R.calls, [['listBatches', 's1']])
})

test('locate: not local → the backend\'s records of that session; unreachable → null', async () => {
  const storage = memory()
  const R = records({ storage, backend: { batches: { X: { batchId: 'X', sessionId: 's1', status: 'expanded', items: [{ id: 'far', origin: { rowId: 3 }, text: 't' }] } } } })
  assert.deepEqual((await R.marks.find('far', 's1')).origin, { rowId: 3 })
  const down = records({ storage, backend: { down: true } })
  assert.equal(await down.marks.find('far', 's1'), null)
})

test('marks: only batches the backend says went out are drawn; unknown, registered, failed or unreachable draw nothing', async () => {
  const storage = memory({ 'batch.A': rec('A'), 'batch.B': rec('B'), 'batch.C': rec('C'), 'batch.D': rec('D', 's2'), 'batches.index': ['A', 'B', 'C', 'D'] })
  const backend = {
    batches: {
      A: { batchId: 'A', sessionId: 's1', status: 'expanded' },
      B: { batchId: 'B', sessionId: 's1', status: 'registered' },
      C: { batchId: 'C', sessionId: 's1', status: 'expanded', outcome: 'failed' },
      D: { batchId: 'D', sessionId: 's2', status: 'expanded' }
    }
  }
  const R = records({ storage, backend })
  assert.deepEqual(R.marks.forKey('s1'), [], 'nothing before the backend answered')
  await R.marks.refresh('s1')
  assert.deepEqual(R.marks.forKey('s1').map((x) => [x.batchId, x.id, x.n, x.state]), [['A', 'i-A', 1, 'sent']])
  const down = records({ storage, backend: { down: true } })
  await down.marks.refresh('s1')
  assert.deepEqual(down.marks.forKey('s1'), [])
  R.marks.dispose()
  down.marks.dispose()
})

test('reload with only records an older version wrote (no `at`, extra fields): read, drawn and found as before', async () => {
  const old = { batchId: 'O', sessionKey: 's1', items: [{ id: 'o1', origin: { rowId: 2 }, text: 'old', comment: 'c', extra: 1 }], legacy: true }
  const storage = memory({ 'batch.O': old, 'batches.index': ['O'] })
  const R = records({ storage, backend: { batches: { O: { batchId: 'O', sessionId: 's1', status: 'answered', answer: { answered: [1] } } } } })
  assert.deepEqual(R.peek('O'), old)
  assert.deepEqual(await R.read('O'), old)
  await R.marks.refresh('s1')
  assert.deepEqual(R.marks.forKey('s1').map((x) => [x.id, x.state]), [['o1', 'answered']])
  assert.equal((await R.marks.find('o1')).extra, 1)
  R.marks.dispose()
  await flush()
})

test('L2: only the catalog knows the layout — no other production module spells batch.<id> or batches.index', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const src = path.join(ROOT, 'plugins/diple/desktop/src')
  const offenders = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(js|jsx)$/.test(e.name) && !p.endsWith(path.join('shared', 'batch-catalog.js'))) {
        const code = fs.readFileSync(p, 'utf8').replace(/^\s*\/\/.*$/gm, '')
        if (/['"`]batches\.index['"`]|`batch\.\$\{/.test(code)) offenders.push(path.relative(src, p))
      }
    }
  }
  walk(src)
  assert.deepEqual(offenders, [])
})
