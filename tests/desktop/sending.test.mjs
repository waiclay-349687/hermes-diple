// L3 (D1 §5.4 option C, ADR 0009): the send module's role interfaces.
// The UI's: createSending → request / preview / get / subscribe / resolve.
// The host's: bindSending → events, hand-offs, middleware, resume, reconnect.
// The protocol behaviour itself is pinned by contracts.test.mjs (now driven
// through these interfaces) and the R1–R6 suites; this file pins the shape.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { setupDom, loadEntry, ROOT } from './harness.mjs'
import { fixture, flush } from './flow-fixture.mjs'

setupDom('<!doctype html><html><body></body></html>')
const M = await loadEntry('diple', 'tests/desktop/fixtures/diple-modules.js')

function module(opts) {
  const f = fixture(M, opts)
  const events = {}
  const ctx = { onDispose: () => {}, onEvent: (t, fn) => ((events[t] ??= new Set()).add(fn), () => events[t].delete(fn)) }
  const sending = M.createSending(f.deps, f.env, { receiver: { sleep: async () => {}, now: f.now } })
  const host = M.bindSending(ctx, sending, { live: { watchFocus: () => () => {} }, session: { currentKey: () => 's1' } })
  const emit = (type, e) => Promise.all([...(events[type] ?? [])].map((fn) => fn(e)))
  return { f, sending, host, emit, events }
}

test('the UI interface is exactly five entries, frozen; the host seam is not on it', () => {
  const { sending } = module()
  assert.deepEqual(Object.keys(sending).sort(), ['get', 'preview', 'request', 'resolve', 'subscribe'])
  assert.ok(Object.isFrozen(sending))
  for (const k of ['start', 'settle', 'flushOutbox', 'handleEvent', 'middleware', 'queue', 'notices', 'pendingConfirm']) assert.equal(sending[k], undefined, k)
  assert.throws(() => M.bindSending({ onDispose() {}, onEvent: () => () => {} }, { request() {} }, { live: { watchFocus: () => () => {} }, session: {} }), /not a sending module/)
})

test('get: an empty, frozen view for no key; the same object until a part changes; subscribe tells each change', async () => {
  const { f, sending, emit } = module()
  assert.deepEqual(sending.get(null), { queued: null, status: null, receipt: null, notices: [] })
  assert.ok(Object.isFrozen(sending.get(null)) && Object.isFrozen(sending.get('s1').notices))
  const v0 = sending.get('s1')
  assert.equal(sending.get('s1'), v0, 'stable snapshot')
  let told = 0
  const off = sending.subscribe('s1', () => told++)
  f.add()
  const r = await sending.request('s1', { bodySource: 'explicit' })
  assert.equal(r.ok, true)
  const v1 = sending.get('s1')
  assert.notEqual(v1, v0)
  assert.deepEqual(v1.status, { batchId: r.batchId, phase: 'sending' })
  assert.ok(told >= 1)
  Object.assign(f.bs.get(r.batchId), { status: 'expanded' })
  await emit('plugin.diple.batch.sent', { type: 'plugin.diple.batch.sent', payload: { batchId: r.batchId, sessionId: 's1' } })
  await emit('message.complete', { type: 'message.complete', session_id: 's1', payload: { status: 'complete', text: '回答', persisted_turn: { user_row_id: 7 } } })
  await flush()
  assert.deepEqual(sending.get('s1').receipt, { batchId: r.batchId, count: 1, delivered: true })
  const before = told
  off()
  await sending.resolve('s1', { type: 'clear-receipt' })
  assert.equal(told, before, 'unsubscribed')
  assert.equal(sending.get('s1').receipt, null)
  assert.deepEqual(sending.subscribe(null, () => {})(), undefined, 'no key: a no-op off')
})

test('request: draft takes the composer text and clears it; explicit carries the body and leaves the composer alone', async () => {
  const a = module()
  a.f.env.drafts.set('s1', '我的正文')
  a.f.add()
  await a.sending.request('s1', { bodySource: 'draft' })
  await flush()
  assert.match(a.f.submits[0].text, /^我的正文/)
  assert.equal(a.f.env.drafts.get('s1'), '')
  const b = module()
  b.f.env.drafts.set('s1', '我的正文')
  b.f.add()
  await b.sending.request('s1', { bodySource: 'explicit', body: '另写的' })
  await flush()
  assert.match(b.f.submits[0].text, /^另写的/)
  assert.equal(b.f.env.drafts.get('s1'), '我的正文')
})

test('request failure words are the flow\'s, unchanged', async () => {
  const { f, sending } = module()
  assert.deepEqual(await sending.request('s1'), { ok: false, reason: 'empty' })
  assert.deepEqual(await sending.request(null), { ok: false, reason: 'no-session' })
  f.deps.settings.get = () => ({ enabled: false })
  f.add()
  assert.deepEqual(await sending.request('s1'), { ok: false, reason: 'disabled' })
})

test('preview: what the send would carry, or null for an empty list', () => {
  const { f, sending } = module()
  assert.equal(sending.preview('s1'), null)
  f.add()
  const p = sending.preview('s1', '正文')
  assert.match(p.display, /^正文\n\n—— 附 1 条标注 ——/)
  assert.equal(p.size.level, 'unknown')
})

test('resolve: each action says whether it did something; an unknown one is { ok: false }', async () => {
  const { f, sending } = module({ busy: true })
  assert.deepEqual(await sending.resolve('s1', { type: 'cancel-queue' }), { ok: false })
  f.add()
  const q = await sending.request('s1')
  assert.deepEqual(q, { ok: true, queued: true })
  assert.ok(sending.get('s1').queued)
  assert.deepEqual(await sending.resolve('s1', { type: 'cancel-queue' }), { ok: true })
  assert.equal(sending.get('s1').queued, null)
  assert.deepEqual(await sending.resolve('s1', { type: 'put-back-confirmation', batchId: 'nope' }), { ok: false })
  assert.deepEqual(await sending.resolve('s1', { type: 'keep-confirmation', batchId: 'nope' }), { ok: false })
  assert.deepEqual(await sending.resolve('s1', { type: 'dismiss-notice', batchId: 'nope' }), { ok: false })
  assert.deepEqual(await sending.resolve('s1', { type: 'put-back-notice', batchId: 'nope', numbers: [1] }), { ok: false, count: 0 })
  assert.deepEqual(await sending.resolve('s1', { type: 'clear-receipt' }), { ok: false })
  assert.deepEqual(await sending.resolve('s1', { type: 'settle', batchId: 'x' }), { ok: false }, 'no forging a final word')
  assert.deepEqual(await sending.resolve('s1'), { ok: false })
})

test('bindSending: the host events reach the module; the middleware is the host\'s, not the UI\'s', async () => {
  const { f, host, events } = module()
  assert.deepEqual(Object.keys(events).sort(), ['error', 'message.complete', 'message.start', 'plugin.diple-docs.handoff', 'plugin.diple.batch.sent'])
  assert.deepEqual(Object.keys(host).sort(), ['middleware', 'resume'])
  f.add()
  const d = await host.middleware({ text: '正文' })
  assert.match(d.text, /@diple:batch\d+$/)
})

test('only the send module touches the protocol implementation: UI and wiring files import neither send-flow\'s flow nor the receiver', () => {
  const dir = path.join(ROOT, 'plugins/diple/desktop/src')
  const offenders = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(js|jsx)$/.test(e.name)) {
        const rel = path.relative(dir, p)
        if (['send/sending.js', 'send/send-flow.js', 'send/handoff.js'].includes(rel)) continue
        const code = fs.readFileSync(p, 'utf8')
        if (/createSendFlow|createHandoffReceiver|from '\.\/handoff\.js'|\bflow\.(start|settle|flushOutbox|handleEvent|queue|notices|pendingConfirm|receipt|status)\b/.test(code)) offenders.push(rel)
      }
    }
  }
  walk(dir)
  assert.deepEqual(offenders, [])
})

test('no UI file imports send-flow.js: only the send module does (XR10-02)', () => {
  const dir = path.join(ROOT, 'plugins/diple/desktop/src')
  const offenders = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(js|jsx)$/.test(e.name)) {
        const rel = path.relative(dir, p)
        if (rel === 'send/sending.js' || rel === 'send/send-flow.js') continue
        if (/from ['"][^'"]*send-flow(\.js)?['"]/.test(fs.readFileSync(p, 'utf8'))) offenders.push(rel)
      }
    }
  }
  walk(dir)
  assert.deepEqual(offenders, [])
})
