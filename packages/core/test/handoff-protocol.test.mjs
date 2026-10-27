// ADR 0007: the hand-off protocol's three state machines, through their
// interfaces only. Table-driven cases + exhaustive orderings of the events
// that can be delayed, lost or repeated.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { ledgerStep, receiverInit, receiverStep, senderInit, senderStep, settledFromBatch, settledForHandoff, settledForPeer, itemOutcomes, LEASE_MS, LOST } from '../src/handoff-protocol.js'

// -- ledger: the same cases run against the Python store (tests/python/test_handoff_protocol.py) ----
const cases = JSON.parse(fs.readFileSync(new URL('./handoff-ledger.cases.json', import.meta.url), 'utf8'))

const subset = (actual, expected, path = '') => {
  for (const [k, v] of Object.entries(expected)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) subset(actual?.[k], v, `${path}.${k}`)
    else assert.deepEqual(actual?.[k], v, `${path}.${k}`)
  }
}

for (const c of cases) {
  test(`ledger: ${c.name}`, () => {
    let rec = null
    for (const [i, s] of c.steps.entries()) {
      const r = ledgerStep(rec, s.req, s.at)
      rec = r.rec
      assert.equal(r.status, s.status, `step ${i}`)
      subset(r.res, s.res, `step ${i}`)
    }
  })
}

test('settledFromBatch: an outcome or an answer is final; anything else is not yet', () => {
  assert.deepEqual(settledFromBatch({ batchId: 'b1', outcome: 'failed', outcomeReason: 'turn-error' }), { batchId: 'b1', delivered: false, reason: 'turn-error' })
  assert.deepEqual(settledFromBatch({ batchId: 'b1', outcome: 'delivered' }), { batchId: 'b1', delivered: true })
  assert.deepEqual(settledFromBatch({ batchId: 'b1', status: 'answered' }), { batchId: 'b1', delivered: true })
  assert.equal(settledFromBatch({ batchId: 'b1', status: 'failed' }), null, 'failed status alone may still be retried')
  assert.equal(settledFromBatch({ batchId: 'b1', status: 'expanded' }), null)
})

// -- one hand-off's word from its batch: the same cases run against the Python store (R4 XE4-02) ----
const settleCases = JSON.parse(fs.readFileSync(new URL('./handoff-settle.cases.json', import.meta.url), 'utf8'))
for (const c of settleCases) {
  test(`settledForHandoff: ${c.name}`, () => {
    assert.deepEqual(settledForHandoff(c.batch, 'h1', c.accepted), c.expect)
  })
}

// -- receiver: a small world (ledger + list + host) the machine runs against -----------------------
const REMOTE = new Set(['claim', 'advance', 'receipt', 'replay'])

function world() {
  return { rec: null, now: 0, starts: [], batches: {}, finals: [], notes: [], windows: {} }
}
function addWindow(w, name, payloads, { sendNow = true } = {}) {
  w.windows[name] = { name, state: receiverInit(), pending: null, inbox: payloads.map(() => ({ sendNow })), results: [] }
}
/** Run a step's effects: local ones at once, the remote one becomes `pending`. */
function apply(w, win, r) {
  win.state = r.state
  if (r.result) win.results.push(r.result)
  for (const eff of r.effects) {
    if (REMOTE.has(eff.type)) {
      win.pending = { eff, applied: false }
      continue
    }
    if (eff.type === 'final') w.finals.push({ by: win.name, ...eff })
    else if (eff.type === 'notify') w.notes.push(eff)
    else if (eff.type === 'add') {
      // the one unfenced side effect: only the current holder may add (a lease younger than FRESH_MS)
      assert.equal(w.rec?.owner, win.name, `${win.name} added the items without holding the claim`)
      return apply(w, win, receiverStep(win.state, { type: 'added', accepted: ['r1'], now: w.now }))
    }
    else if (eff.type === 'inspect') return apply(w, win, receiverStep(win.state, { type: 'inspected', batch: w.batches[eff.batchId] ?? null }))
    else if (eff.type === 'start') {
      const b = w.batches[eff.batchId]
      let res
      if (b && b.status !== 'registered') res = { ok: false, reason: 'register-failed', batchId: eff.batchId }
      else {
        w.starts.push({ by: win.name, batchId: eff.batchId })
        w.batches[eff.batchId] = { batchId: eff.batchId, status: 'expanded' }
        res = { ok: true, batchId: eff.batchId }
      }
      return apply(w, win, receiverStep(win.state, { type: 'started', r: res }))
    }
  }
}
function remote(w, win) {
  const { eff } = win.pending
  if (eff.type === 'claim') return ledgerStep(w.rec, { op: 'claim', owner: eff.owner, batchId: eff.batchId }, w.now)
  if (eff.type === 'advance') return ledgerStep(w.rec, { op: 'advance', owner: eff.owner, generation: eff.generation, stage: eff.stage, accepted: eff.accepted }, w.now)
  if (eff.type === 'receipt') return ledgerStep(w.rec, { op: 'receipt', owner: eff.owner, generation: eff.generation, receipt: eff.receipt }, w.now)
  return { rec: w.rec, status: 200, res: { receipt: w.rec?.receipt ?? null } }
}
function answer(win, r, now, dropped) {
  const t = win.pending.eff.type
  if (t === 'claim') return { type: 'claimed', res: dropped || r.status !== 200 ? null : r.res, now }
  if (t === 'advance') return { type: 'advanced', status: dropped ? 'error' : r.status === 409 ? 'lost' : 'ok', now }
  if (t === 'receipt') return { type: 'receipted', status: dropped ? 'error' : r.status === 409 ? 'lost' : 'ok' }
  return { type: 'replayed' }
}
/** The moves possible from here. */
function moves(w, budget) {
  const out = []
  for (const win of Object.values(w.windows)) {
    if (win.pending && !win.pending.applied) out.push({ kind: 'apply', win: win.name })
    else if (win.pending?.applied) {
      out.push({ kind: 'respond', win: win.name })
      if (budget.drops > 0) out.push({ kind: 'drop', win: win.name })
    } else if (win.inbox.length) out.push({ kind: 'deliver', win: win.name })
  }
  if (out.length && budget.jumps > 0) out.push({ kind: 'jump' })
  return out
}
function play(w, m, budget) {
  const next = structuredClone(w)
  const b = { ...budget }
  if (m.kind === 'jump') {
    next.now += LEASE_MS + 1000
    b.jumps--
    return [next, b]
  }
  const win = next.windows[m.win]
  if (m.kind === 'deliver') {
    const p = win.inbox.shift()
    apply(next, win, receiverStep(win.state, { type: 'payload', handoffId: 'h-1234', key: 's1', sendNow: p.sendNow, owner: win.name, batchId: 'b' + win.name + '0001', now: next.now }))
  } else if (m.kind === 'apply') {
    const r = remote(next, win)
    next.rec = r.rec
    win.pending = { ...win.pending, applied: true, r }
  } else {
    const ev = answer(win, win.pending.r, next.now, m.kind === 'drop')
    if (m.kind === 'drop') b.drops--
    win.pending = null
    apply(next, win, receiverStep(win.state, ev))
  }
  return [next, b]
}
/** Every schedule from here; returns how many, checking the invariants on the way. */
function explore(w, budget, seen = new Map()) {
  assert.ok(w.starts.length <= 1, `submitted twice: ${JSON.stringify(w.starts)}`)
  const key = JSON.stringify([w, budget])
  if (seen.has(key)) return seen.get(key)
  const ms = moves(w, budget)
  let n = 0
  if (!ms.some((m) => m.kind !== 'jump')) {
    // at rest: whatever receipt the ledger holds names the one batch that went out (or none)
    const rb = w.rec?.receipt?.batchId
    if (rb) assert.deepEqual(w.starts.map((s) => s.batchId), [rb])
    else if (w.rec?.receipt) assert.deepEqual(w.starts, [], 'a receipt without a batch: nothing went out')
    if (w.starts.length) assert.equal(w.starts[0].batchId, w.rec.batchId, 'the batch id fixed at the claim')
    n = 1
  } else {
    for (const m of ms) {
      const [next, b] = play(w, m, budget)
      n += explore(next, b, seen)
    }
  }
  seen.set(key, n)
  return n
}

test('receiver: a happy run claims, adds, records "sending", submits once and stores its receipt', () => {
  const w = world()
  addWindow(w, 'A', [1])
  let budget = { jumps: 0, drops: 0 }
  for (;;) {
    const m = moves(w, budget)[0]
    if (!m) break
    const [next, b] = play(w, m, budget)
    Object.assign(w, next)
    budget = b
  }
  assert.deepEqual(w.starts, [{ by: 'A', batchId: 'bA0001' }])
  assert.deepEqual(w.rec.receipt, { handoffId: 'h-1234', accepted: ['r1'], batchId: 'bA0001' })
  assert.deepEqual(w.windows.A.results.at(-1), { handled: true, accepted: ['r1'], batchId: 'bA0001' })
})

test('receiver: R3 XE2-03 — a claim answer delayed past the lease is fenced before anything is added', () => {
  // A's claim reached the backend at t=0; its answer arrives after B took over and sent.
  let s = receiverStep(receiverInit(), { type: 'payload', handoffId: 'h-1234', key: 's1', sendNow: true, owner: 'A', batchId: 'bA0001', now: 0 })
  assert.equal(s.effects[0].type, 'claim')
  s = receiverStep(s.state, { type: 'claimed', res: { claimed: true, owner: 'A', generation: 1, batchId: 'bA0001' }, now: 31_001 })
  assert.deepEqual(s.effects.map((e) => e.type), ['advance'], 'check the lease, do not add yet')
  s = receiverStep(s.state, { type: 'advanced', status: 'lost', now: 31_002 })
  assert.deepEqual(s.effects, [])
  assert.deepEqual(s.result, { handled: false, reason: LOST })
})

test('receiver: a rebroadcast to the window that finished asks the backend to replay receipt AND settled (XR3-02)', () => {
  const steps = [
    { type: 'payload', handoffId: 'h-1234', key: 's1', sendNow: true, owner: 'A', batchId: 'bA0001', now: 0 },
    { type: 'claimed', res: { claimed: true, owner: 'A', generation: 1, batchId: 'bA0001' }, now: 1 },
    { type: 'added', accepted: ['r1'], now: 2 },
    { type: 'advanced', status: 'ok', now: 2 },
    { type: 'advanced', status: 'ok', now: 3 },
    { type: 'started', r: { ok: true, batchId: 'bA0001' } },
    { type: 'receipted', status: 'ok' }
  ]
  let s = receiverInit()
  for (const e of steps) s = receiverStep(s, e).state
  const again = receiverStep(s, { type: 'payload', handoffId: 'h-1234', key: 's1', sendNow: true, owner: 'A', batchId: 'bA0002', now: 9 })
  assert.deepEqual(again.effects, [{ type: 'replay' }])
})

test('receiver: a receipt the backend did not take is sent again on the next broadcast (same holder)', () => {
  let s = receiverInit()
  for (const e of [
    { type: 'payload', handoffId: 'h-1234', key: 's1', sendNow: false, owner: 'A', batchId: 'bA0001', now: 0 },
    { type: 'claimed', res: { claimed: true, owner: 'A', generation: 1, batchId: 'bA0001' }, now: 1 },
    { type: 'added', accepted: ['r1'], now: 2 },
    { type: 'advanced', status: 'ok', now: 2 },
    { type: 'receipted', status: 'error' }
  ]) s = receiverStep(s, e).state
  const again = receiverStep(s, { type: 'payload', handoffId: 'h-1234', key: 's1', sendNow: false, owner: 'A', batchId: 'x', now: 5 })
  assert.deepEqual(again.effects, [{ type: 'receipt', receipt: { handoffId: 'h-1234', accepted: ['r1'] }, owner: 'A', generation: 1 }])
})

test('receiver: a start that fails settles the hand-off as not delivered, then says what was received', () => {
  let s = receiverInit()
  for (const e of [
    { type: 'payload', handoffId: 'h-1234', key: 's1', sendNow: true, owner: 'A', batchId: 'bA0001', now: 0 },
    { type: 'claimed', res: { claimed: true, owner: 'A', generation: 1, batchId: 'bA0001' }, now: 1 },
    { type: 'added', accepted: ['r1'], now: 2 },
    { type: 'advanced', status: 'ok', now: 2 },
    { type: 'advanced', status: 'ok', now: 3 }
  ]) s = receiverStep(s, e).state
  const refused = receiverStep(s, { type: 'started', r: { ok: false, reason: 'submit-refused', batchId: 'bA0001' } })
  assert.deepEqual(refused.effects, [{ type: 'start', batchId: 'bA0001', reveal: true }], 'reveal the session and try once more, same batch id')
  const failed = receiverStep(refused.state, { type: 'started', r: { ok: false, reason: 'too-large', batchId: 'bA0001' } })
  assert.deepEqual(failed.effects.map((e) => e.type), ['notify', 'final', 'receipt'])
  assert.deepEqual(failed.effects[1], { type: 'final', batchId: 'bA0001', delivered: false, reason: 'too-large' })
})

test('receiver permutations: two windows, delayed / lost answers, lease expiry, rebroadcasts — never two submits', () => {
  let total = 0
  for (const [aPayloads, bPayloads, jumps, drops] of [
    [1, 1, 1, 0],
    [1, 2, 1, 0],
    [2, 2, 1, 0],
    [1, 2, 1, 1],
    [1, 2, 2, 0],
    [2, 1, 2, 1]
  ]) {
    const w = world()
    addWindow(w, 'A', Array(aPayloads).fill(1))
    addWindow(w, 'B', Array(bPayloads).fill(1))
    total += explore(w, { jumps, drops })
  }
  console.log(`# receiver interleavings explored: ${total}`)
  assert.ok(total > 10_000, `explored ${total}`)
})

// -- sender ------------------------------------------------------------------------------------
const receiptFor = (outcome, settles) => ({
  v: 1,
  handoffId: 'h-1',
  accepted: ['r1'],
  ...(outcome === 'submitted' ? { batchId: 'b1' } : { queued: true }),
  ...(settles ? { settles: true } : {})
})
const EVENTS = {
  R: (o, settles) => ({ type: 'receipt', receipt: receiptFor(o, settles) }),
  S: () => ({ type: 'sent', batchId: 'b1' }),
  T: (o, settles, truth) => ({ type: 'settled', batchId: 'b1', delivered: truth, ...(truth ? {} : { reason: 'turn-error' }) }),
  A: () => ({ type: 'answered', batchId: 'b1' }),
  F: () => ({ type: 'fallback' })
}
/** What the user is shown, in order. */
function shown(order, outcome, settles, truth) {
  let s = senderInit({ sendNow: true, itemIds: ['r1'] })
  const seen = []
  for (const k of order) {
    const r = senderStep(s, EVENTS[k](outcome, settles, truth))
    s = r.state
    for (const e of r.effects) {
      if (e.type === 'result') seen.push(e.result.outcome)
      if (e.type === 'final') seen.push(e.outcome)
    }
  }
  return seen
}
function* permutations(list) {
  if (list.length <= 1) return yield list
  const used = new Set()
  for (let i = 0; i < list.length; i++) {
    if (used.has(list[i])) continue
    used.add(list[i])
    for (const rest of permutations([...list.slice(0, i), ...list.slice(i + 1)])) yield [list[i], ...rest]
  }
}

test('sender table: what each first event means', () => {
  assert.deepEqual(shown(['R'], 'submitted', true, false), ['submitted'])
  assert.deepEqual(shown(['R', 'T'], 'submitted', true, false), ['submitted', 'returned'])
  assert.deepEqual(shown(['T', 'R'], 'submitted', true, false), ['returned'], 'settled before its receipt: the final word at once')
  assert.deepEqual(shown(['R', 'S', 'F'], 'submitted', true, false), ['submitted', 'unknown'], 'settles:true never infers from batch.sent')
  assert.deepEqual(shown(['R', 'S', 'F'], 'submitted', false, false), ['submitted', 'sent'], 'a legacy receiver: inferred')
  assert.deepEqual(shown(['R', 'S', 'F', 'T'], 'submitted', false, false), ['submitted', 'sent', 'returned'], 'XR3-04: the real failure corrects it')
  assert.deepEqual(shown(['R', 'A'], 'submitted', true, true), ['submitted'], 'settles:true: only settled counts')
  assert.deepEqual(shown(['R', 'T', 'T'], 'submitted', true, false), ['submitted', 'returned'], 'a repeated settled says nothing new')
})

test('sender permutations: receipt / sent / settled / timer delayed, lost or repeated — failure is never shown as sent', () => {
  let n = 0
  const bags = [
    ['R', 'S', 'T', 'F'],
    ['R', 'S', 'T', 'T', 'F'],
    ['R', 'S', 'S', 'T', 'F'],
    ['R', 'R', 'S', 'T', 'F'],
    ['R', 'S', 'T', 'F', 'F'],
    ['R', 'R', 'S', 'S', 'T', 'T', 'F'],
    ['R', 'S', 'F'], // settled lost for good
    ['R', 'T', 'F'] // batch.sent lost
  ]
  for (const settles of [true, false]) {
    for (const outcome of ['submitted', 'queued']) {
      for (const bag of bags) {
        for (const order of permutations(bag)) {
          n++
          const seq = shown(order, outcome, settles, false)
          const last = seq.at(-1)
          if (settles) assert.ok(!seq.includes('sent'), `${order.join('')} ${outcome} settles → ${seq}`)
          if (bag.includes('T')) assert.equal(last, 'returned', `${order.join('')} ${outcome} settles=${settles} → ${seq}`)
          // no settled at all: still waiting (the timer fired before the receipt) or unknown — never a guess with settles:true
          else assert.ok((settles ? ['unknown', outcome] : ['sent', 'unknown', outcome]).includes(last), `${order.join('')} → ${seq}`)
          // delivered truth: never shown as returned
          const ok = shown(order, outcome, settles, true)
          assert.ok(!ok.includes('returned'), `${order.join('')} delivered → ${ok}`)
          if (bag.includes('T')) assert.equal(ok.at(-1), 'sent')
        }
      }
    }
  }
  console.log(`# sender orderings checked: ${n} (×2 truths)`)
  assert.ok(n > 1000)
})

// R5: what a peer may be told, and each item's word — the Python twins run the same file
const peerCases = JSON.parse(fs.readFileSync(new URL('./handoff-peer.cases.json', import.meta.url), 'utf8'))
for (const c of peerCases) {
  test(`${c.fn}: ${c.name}`, () => {
    const got = c.fn === 'settledForPeer' ? settledForPeer(c.settled, c.caps) : itemOutcomes(c.settled, c.itemIds)
    assert.deepEqual(got, c.expect)
  })
}
