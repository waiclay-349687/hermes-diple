// V2.1 #5: the pin layer's cost model (capture/pins/index.js), on jsdom with
// a stand-in highlighter. Scrolling reads no layout (one scrollTop per
// viewport) and writes one transform per viewport; measuring happens only on
// a change of size, content, fonts or the set of pins, coalesced into one frame.
import test from 'node:test'
import assert from 'node:assert/strict'

import { setupDom } from './harness.mjs'
import { createPins } from '../../plugins/diple/desktop/src/capture/pins/index.js'

const w = setupDom('<!doctype html><html><body><div id="vp"><div id="content"><p id="p1">一二三四五</p><p id="p2">六七八九十</p></div></div></body></html>')

const frames = []
w.requestAnimationFrame = (fn) => (frames.push(fn), frames.length)
const flush = () => {
  for (let i = 0; i < 5 && frames.length; i++) frames.splice(0).forEach((f) => f(0))
}

const rect = (left, top, width = 100, height = 20) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top })
let reads = 0
const geo = new Map([
  ['p1', rect(100, 200, 120, 20)],
  ['p2', rect(100, 300, 160, 20)]
])
const idOf = (r) => (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement).id
w.Range.prototype.getClientRects = function () {
  reads++
  return [geo.get(idOf(this))]
}
w.Range.prototype.getBoundingClientRect = function () {
  reads++
  return geo.get(idOf(this))
}
const vp = document.getElementById('vp')
vp.getBoundingClientRect = () => (reads++, rect(0, 0, 800, 600))
let scrollTop = 0
Object.defineProperty(vp, 'scrollTop', { get: () => scrollTop, configurable: true })
Object.defineProperty(vp, 'scrollLeft', { get: () => 0, configurable: true })

function highlighterWith(ids) {
  const listeners = new Set()
  const entries = ids.map((id, i) => {
    const r = document.createRange()
    r.selectNodeContents(document.getElementById(id))
    return { id, n: i + 1, state: 'comment', sent: false, range: r }
  })
  return {
    entries: () => entries,
    entry: (id) => entries.find((e) => e.id === id),
    onChange: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    change: () => listeners.forEach((f) => f())
  }
}

function make(ids = ['p1', 'p2']) {
  const hl = highlighterWith(ids)
  const clipFor = () => vp.getBoundingClientRect()
  clipFor.viewport = () => vp
  const pins = createPins({ doc: document, highlighter: hl, clipFor })
  hl.change()
  flush()
  return { hl, pins }
}

test('pins sit on the top-right corner, through translate3d (never left / top)', () => {
  const { pins } = make()
  const b = pins.element('p1')
  assert.ok(b)
  assert.match(b.style.transform, /^translate3d\(212px, 184px, 0px\)$/)
  assert.equal(b.style.left, '')
  assert.equal(b.style.top, '')
  pins.dispose()
})

test('scrolling: no layout read, one transform on the viewport\'s group per frame; pins keep theirs', () => {
  const { pins } = make()
  const b = pins.element('p1')
  const before = b.style.transform
  const group = b.parentElement
  reads = 0
  for (let i = 1; i <= 5; i++) {
    scrollTop = i * 10
    vp.dispatchEvent(new w.Event('scroll'))
  }
  flush()
  assert.equal(reads, 0, 'no getClientRects / getBoundingClientRect while scrolling')
  assert.equal(b.style.transform, before, 'the pin itself is not touched')
  assert.match(group.style.transform, /^translate3d\(0px, -50px, 0px\)$/, 'one move of the group, the last scroll position')
  pins.dispose()
})

test('a pin that scrolls out of the viewport hides, and comes back, without measuring', () => {
  const { pins } = make()
  const b = pins.element('p2')
  reads = 0
  scrollTop = 400 // p2 centre at 292 − 400 < 0
  vp.dispatchEvent(new w.Event('scroll'))
  flush()
  assert.equal(b.hidden, true)
  scrollTop = 0
  vp.dispatchEvent(new w.Event('scroll'))
  flush()
  assert.equal(b.hidden, false)
  assert.equal(reads, 0)
  pins.dispose()
})

test('re-measure on resize / content change / pin changes, coalesced into one frame', () => {
  const { hl, pins } = make()
  reads = 0
  w.dispatchEvent(new w.Event('resize'))
  w.dispatchEvent(new w.Event('resize'))
  hl.change()
  pins.schedule()
  assert.equal(reads, 0, 'nothing measured synchronously')
  flush()
  // one measure: one rect read per pin + one viewport rect
  assert.equal(reads, 3)
  // after the measure, the group is back at zero and the pins carry the new spot
  geo.set('p1', rect(100, 150, 120, 20))
  scrollTop = 0
  w.dispatchEvent(new w.Event('resize'))
  flush()
  assert.match(pins.element('p1').style.transform, /translate3d\(212px, 134px/)
  pins.dispose()
})
