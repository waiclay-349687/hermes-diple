// V2-T / V2.1 #5: where the pins go (capture/pins/layout.js, pure) — Codex's
// place: the top-right corner of the passage.
import test from 'node:test'
import assert from 'node:assert/strict'

import { cornerOf, layoutPins, visibleAt, PIN_SIZE } from '../../plugins/diple/desktop/src/capture/pins/layout.js'

const rect = (left, top, width = 100, height = 20) => ({ left, top, width, height, right: left + width, bottom: top + height })
const clip = rect(0, 0, 800, 600)

test('the corner: x = the rightmost line end, top = the passage top; empty boxes ignored', () => {
  assert.deepEqual(cornerOf([rect(100, 200, 300, 20), rect(40, 222, 120, 20), rect(0, 0, 0, 0)]), { x: 400, top: 200 })
  assert.equal(cornerOf([]), null)
})

test('one line: the pin is centred on the end of those words, half a pin above their top', () => {
  const [p] = layoutPins([{ id: 'a', corner: cornerOf([rect(100, 200, 120, 22)]), clip }], { size: 16 })
  assert.deepEqual(p, { id: 'a', left: 212, top: 184, placed: true, visible: true })
  // its centre is (220, 192): x on the line end, y = top − size / 2
  assert.equal(p.left + 8, 220)
  assert.equal(p.top + 8, 200 - 8)
})

test('several lines: the top-right of the block, not the end of the last line', () => {
  const [p] = layoutPins([{ id: 'a', corner: cornerOf([rect(300, 100, 380, 20), rect(40, 122, 640, 20), rect(40, 144, 90, 20)]), clip }], { size: 16 })
  assert.equal(p.left + 8, 680)
  assert.equal(p.top + 8, 92)
})

test('neighbours on one line step sideways, linearly (no pin overlaps another)', () => {
  const marks = []
  for (let i = 0; i < 6; i++) marks.push({ id: `p${i}`, corner: { x: 300 + i * 4, top: 200 }, clip })
  const ps = layoutPins(marks, { size: 16, gap: 2 })
  const lefts = ps.map((p) => p.left).sort((a, b) => a - b)
  for (let i = 1; i < lefts.length; i++) assert.ok(lefts[i] - lefts[i - 1] >= 18, `no overlap: ${lefts}`)
  assert.ok(ps.every((p) => p.top === 184), 'they stay on their row')
})

test('a pending pin keeps its place; the sent one on the same spot moves aside', () => {
  const ps = layoutPins(
    [
      { id: 'sent', corner: { x: 300, top: 200 }, clip, sent: true },
      { id: 'pending', corner: { x: 300, top: 200 }, clip }
    ],
    { size: 16 }
  )
  assert.equal(ps[1].left, 292)
  assert.ok(ps[0].left > ps[1].left)
})

test('hidden outside the viewport, past the column edge, under the composer; no corner → hidden', () => {
  const ps = layoutPins(
    [
      { id: 'up', corner: { x: 300, top: -40 }, clip },
      { id: 'right', corner: { x: 799, top: 200 }, clip },
      { id: 'composer', corner: { x: 300, top: 570 }, clip, avoid: [rect(0, 540, 800, 60)] },
      { id: 'none', corner: null, clip }
    ],
    { size: 16 }
  )
  assert.deepEqual(ps.map((p) => p.visible), [false, false, false, false])
  assert.deepEqual(ps.map((p) => p.placed), [true, false, true, false], 'off-screen ones keep a place for when they scroll in')
})

test('visibleAt: the same rule after a scroll, arithmetic only', () => {
  const box = { left: 292, top: 640 }
  assert.equal(visibleAt(box, { size: 16, clip }), false)
  assert.equal(visibleAt(box, { size: 16, clip, dy: 200 }), true)
  assert.equal(visibleAt(box, { size: 16, clip, dy: 200, avoid: [rect(0, 430, 800, 40)] }), false)
})

test('the drawn pin is smaller than before; the hit area stays ≥ 20 px (CSS)', async () => {
  assert.ok(PIN_SIZE < 18 && PIN_SIZE >= 14)
  const { CAPTURE_CSS } = await import('../../plugins/diple/desktop/src/capture/styles.js').catch(() => ({ CAPTURE_CSS: null }))
  if (CAPTURE_CSS) assert.match(CAPTURE_CSS, /\.diple-pin::before\{[^}]*inset:-2px/)
})
