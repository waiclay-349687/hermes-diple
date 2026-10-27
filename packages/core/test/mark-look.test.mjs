import test from 'node:test'
import assert from 'node:assert/strict'

import { MarkLook } from '../src/index.js'

test('one look per state: fill and line from theme variables only', () => {
  assert.equal(MarkLook.fill('pending'), 'background-color:color-mix(in srgb,var(--ui-accent) 14%,transparent)')
  assert.equal(MarkLook.line('pending'), 'text-decoration:underline solid 2px color-mix(in srgb,var(--ui-accent) 72%,transparent)')
  assert.equal(MarkLook.fill('sent'), 'background-color:color-mix(in srgb,var(--ui-accent) 7%,transparent)')
  assert.match(MarkLook.line('sent'), /underline dashed 2px/)
  assert.match(MarkLook.fill('answered'), /var\(--ui-green\)/)
  assert.match(MarkLook.line('answered'), /underline solid 2px .*var\(--ui-green\)/)
  assert.match(MarkLook.line('changed'), /underline wavy .*var\(--ui-yellow\)/)
  assert.equal(MarkLook.line('active'), '', 'the current item only deepens the fill')
  for (const s of MarkLook.STATES) {
    const css = MarkLook.fill(s) + MarkLook.line(s)
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(|--ui-warning|amber/i, s)
  }
})

test('the order of strengths: sent < pending < active; no arrival pulse look (V2.1 #1)', () => {
  const pct = (s) => Number(/(\d+)%/.exec(MarkLook.fill(s))[1])
  assert.ok(pct('sent') < pct('pending'))
  assert.ok(pct('pending') < pct('active'))
  assert.equal(MarkLook.STATES.includes('pulse'), false)
  assert.equal(MarkLook.fill('pulse'), '')
})

test('the warning colour is a host token that exists (--ui-yellow; the host has no --ui-warning)', () => {
  assert.equal(MarkLook.WARN, 'var(--ui-yellow)')
})

test('unknown states paint nothing', () => {
  assert.equal(MarkLook.fill('nope'), '')
  assert.equal(MarkLook.line('nope'), '')
})
