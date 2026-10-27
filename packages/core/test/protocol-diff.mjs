// Differential test, JS half (R5): generated inputs for every shared decision
// function of the hand-off protocol, with the JS reference's output. The
// Python twins are run on the very same inputs by
// tests/python/test_protocol_diff.py, which asserts identical output.
//
//   node packages/core/test/protocol-diff.mjs <seed> <perFunction>  → JSON on stdout
//   { settle: [{ batch, accepted, out }], peer: [{ settled, caps, out }],
//     items: [{ settled, itemIds, out }], ledger: [{ steps: [{ at, req, status, res }] }] }
//
// Inputs deliberately include malformed values (non-string ids, non-integer
// revisions, missing / null fields, long and astral reasons): the twins must
// agree on those too.
import { ledgerStep, settledFromBatch, settledForHandoff, settledForPeer, itemOutcomes } from '../src/handoff-protocol.js'

const seed = Number(process.argv[2] ?? 1) >>> 0
const N = Number(process.argv[3] ?? 1000)

// mulberry32
let st = seed || 1
const rnd = () => {
  st = (st + 0x6d2b79f5) >>> 0
  let t = st
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = (xs) => xs[Math.floor(rnd() * xs.length)]
const chance = (p) => rnd() < p
const many = (max, f) => Array.from({ length: Math.floor(rnd() * (max + 1)) }, f)
const ABSENT = Symbol('absent')
const obj = (pairs) => Object.fromEntries(pairs.filter(([, v]) => v !== ABSENT))

const IDS = ['r1', 'r2', 'r3', 'r4', 'réf-5', '要点6']
const itemId = () => (chance(0.9) ? pick(IDS) : pick([7, null, true, '', ABSENT]))
const revision = () => (chance(0.75) ? pick([1, 2, 3]) : pick([1.5, null, '2', true, 0, -1, ABSENT]))
const reason = () => pick(['turn-error', 'cancelled', '', 'x'.repeat(130), '😀'.repeat(120), 'a😀b'.repeat(40), 42, null, ABSENT])

const entry = () =>
  chance(0.1)
    ? pick([null, 'junk', 3, [], { text: 'no origin' }])
    : chance(0.25)
      ? { origin: { sessionId: 's1', role: 'assistant', rowId: Math.floor(rnd() * 100) }, text: 'manual' }
      : { origin: obj([['plugin', 'diple-docs'], ['itemId', itemId()], ['revision', revision()]]), text: 't' }

const batch = () => {
  if (chance(0.03)) return pick([null, [], 'b1'])
  return obj([
    ['batchId', chance(0.9) ? 'b1' : pick(['', 7, null, ABSENT])],
    ['outcome', pick(['delivered', 'failed', 'failed', null, ABSENT, 'other'])],
    ['status', pick(['answered', 'expanded', 'registered', 'failed', ABSENT])],
    ['outcomeReason', reason()],
    ['items', chance(0.8) ? many(5, entry) : pick([null, ABSENT, 'x'])]
  ])
}
const acceptedOne = () =>
  chance(0.3) ? (chance(0.9) ? pick(IDS) : pick([5, null])) : chance(0.1) ? pick([null, 'x', [], { revision: 1 }]) : obj([['itemId', itemId()], ['revision', revision()]])
const accepted = () => (chance(0.1) ? pick([null, ABSENT, 'r1', {}]) : many(4, acceptedOne))

const settledLike = () => {
  if (chance(0.5)) {
    const s = settledForHandoff(batch(), 'h1', accepted())
    if (s) return s
  }
  return obj([
    ['handoffId', 'h1'],
    ['batchId', pick(['b1', ABSENT])],
    ['delivered', pick([true, false, 'yes', ABSENT])],
    ['reason', reason()],
    ['items', chance(0.6) ? many(4, () => (chance(0.1) ? pick(['r1', null, 3]) : obj([['itemId', itemId()], ['delivered', pick([true, false, 1, ABSENT])], ['reason', reason()]]))) : pick([null, ABSENT, {}])]
  ])
}
const caps = () => pick([['partial'], ['partial', 'x'], ['x'], [], null, 'partial', ABSENT, [1, 'partial']])

const strip = (x) => JSON.parse(JSON.stringify(x === undefined ? null : x))

const out = { seed, settle: [], peer: [], items: [], ledger: [], batches: [] }
for (let i = 0; i < N; i++) {
  const b = batch()
  out.batches.push({ batch: strip(b), out: strip(settledFromBatch(b)) })
  const a = accepted()
  out.settle.push({ batch: strip(b), accepted: a === ABSENT ? null : strip(a), out: strip(settledForHandoff(strip(b), 'h1', a === ABSENT ? null : strip(a))) })
  const s = strip(settledLike())
  const c = caps()
  out.peer.push({ settled: s, caps: c === ABSENT ? null : strip(c), out: strip(settledForPeer(s, c === ABSENT ? null : strip(c))) })
  const ids = chance(0.05) ? pick([null, 'r1']) : many(4, () => (chance(0.9) ? pick(IDS) : pick([3, null])))
  out.items.push({ settled: s, itemIds: strip(ids), out: strip(itemOutcomes(s, strip(ids))) })
}

// Ledger: random request sequences against one hand-off. Times are whole seconds, so
// the lease boundary (exactly LEASE_MS) is compared exactly on both sides.
for (let i = 0; i < N; i++) {
  let rec = null
  let at = 0
  const steps = []
  for (const _ of many(8, () => 0)) {
    at += pick([0, 1, 5, 15, 29, 30, 31, 45]) * 1000
    const owner = pick(['A', 'B', 'C'])
    const generation = pick([0, 1, 2, 3])
    const op = pick(['claim', 'claim', 'advance', 'advance', 'receipt', 'settle'])
    const req =
      op === 'claim'
        ? obj([['op', op], ['owner', owner], ['batchId', pick(['batch1', 'batch2', ABSENT])]])
        : op === 'advance'
          ? obj([['op', op], ['owner', owner], ['generation', generation], ['stage', pick(['claimed', 'added', 'sending'])], ['accepted', pick([['r1'], ['r1', 'r2'], [], ABSENT])]])
          : op === 'receipt'
            ? { op, owner, generation, receipt: { handoffId: 'h-1234', accepted: pick([['r1'], []]), ...(chance(0.5) ? { batchId: 'batch1' } : {}) } }
            : { op, settled: { handoffId: 'h-1234', batchId: pick(['batch1', 'batch2']), delivered: chance(0.5) } }
    const r = ledgerStep(rec, req, at)
    rec = r.rec
    steps.push({ at, req, status: r.status, res: strip(r.res) })
  }
  out.ledger.push({ steps })
}

process.stdout.write(JSON.stringify(out))
