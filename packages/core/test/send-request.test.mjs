// V2.1 #8: scope + target → one send request (pure; both plugins).
import test from 'node:test'
import assert from 'node:assert/strict'

import { SendRequest, CopyText } from '../src/index.js'

const items = [
  { id: 'a', unsent: true },
  { id: 'b', unsent: false },
  { id: 'c', unsent: true }
]

test('scope: this one, or every unsent one in the list (in order); sent ones never go again', () => {
  const one = SendRequest.plan({ scope: { kind: 'item', id: 'c' }, target: { kind: 'session', sessionId: 's2' }, items, focusedSessionId: 's1', explicit: true })
  assert.deepEqual(one.itemIds, ['c'])
  const all = SendRequest.plan({ scope: { kind: 'unsent' }, target: { kind: 'session', sessionId: 's2' }, items, focusedSessionId: 's1', explicit: true })
  assert.deepEqual(all.itemIds, ['a', 'c'])
  const sentOne = SendRequest.plan({ scope: { kind: 'item', id: 'b' }, target: { kind: 'session', sessionId: 's1' }, items, focusedSessionId: 's1', explicit: true })
  assert.deepEqual(sentOne, { ok: false, reason: 'no-items' })
})

test('target: a session sends now into it; 加入待发 goes to the current session\'s list without sending; copy sends nothing', () => {
  const s = SendRequest.plan({ scope: { kind: 'unsent' }, target: { kind: 'session', sessionId: 's2' }, items, focusedSessionId: 's1', explicit: true })
  assert.deepEqual(s, { ok: true, kind: 'send', sessionId: 's2', sendNow: true, itemIds: ['a', 'c'], confirm: false })
  const q = SendRequest.plan({ scope: { kind: 'unsent' }, target: { kind: 'queue' }, items, focusedSessionId: 's1', explicit: true })
  assert.deepEqual(q, { ok: true, kind: 'send', sessionId: 's1', sendNow: false, itemIds: ['a', 'c'], confirm: false })
  const c = SendRequest.plan({ scope: { kind: 'unsent' }, target: { kind: 'copy' }, items, focusedSessionId: null, explicit: true })
  assert.deepEqual(c, { ok: true, kind: 'copy', itemIds: ['a', 'c'] })
})

test('a target picked in the menu is not asked again; an entry with no explicit target (a shortcut) asks when it is not the focused session', () => {
  const picked = SendRequest.plan({ scope: { kind: 'unsent' }, target: { kind: 'session', sessionId: 's2' }, items, focusedSessionId: 's1', explicit: true })
  assert.equal(picked.confirm, false)
  const shortcut = SendRequest.plan({ scope: { kind: 'unsent' }, target: { kind: 'session', sessionId: 's2' }, items, focusedSessionId: 's1', explicit: false })
  assert.equal(shortcut.confirm, true)
  const same = SendRequest.plan({ scope: { kind: 'unsent' }, target: { kind: 'session', sessionId: 's1' }, items, focusedSessionId: 's1', explicit: false })
  assert.equal(same.confirm, false)
})

test('no session to send to → no-session (never a guess)', () => {
  assert.deepEqual(SendRequest.plan({ scope: { kind: 'unsent' }, target: { kind: 'queue' }, items, focusedSessionId: null, explicit: true }), { ok: false, reason: 'no-session' })
  assert.deepEqual(SendRequest.plan({ scope: { kind: 'unsent' }, target: { kind: 'session', sessionId: '' }, items, focusedSessionId: 's1', explicit: true }), { ok: false, reason: 'no-session' })
  assert.deepEqual(SendRequest.plan({ scope: { kind: 'unsent' }, target: { kind: 'new' }, items, focusedSessionId: 's1', explicit: true }), { ok: false, reason: 'unsupported-target' })
})

test('the targets offered: the current session first, then up to 5 recent ones (no repeats), then 加入待发', () => {
  const t = SendRequest.targets({ current: 's1', recent: ['s2', 's1', 's3', 's4', 's5', 's6', 's7', 's2'] })
  assert.deepEqual(t, [
    { kind: 'session', sessionId: 's1', current: true },
    { kind: 'session', sessionId: 's2' },
    { kind: 'session', sessionId: 's3' },
    { kind: 'session', sessionId: 's4' },
    { kind: 'session', sessionId: 's5' },
    { kind: 'session', sessionId: 's6' },
    { kind: 'queue' }
  ])
  assert.deepEqual(SendRequest.targets({ current: null, recent: ['s2'] }), [{ kind: 'session', sessionId: 's2' }])
})

test('复制给 AI: one Markdown prompt, each annotation as the pin card copies it', () => {
  const md = CopyText.forAgent({
    title: '标注（2）',
    entries: [
      { label: 'a.md 第 3 行', text: '原文一', comment: '意见一' },
      { label: 'a.md 第 9 行', text: '原文二\n第二行', comment: '' }
    ]
  })
  assert.equal(md, ['# 标注（2）', '', '## ① a.md 第 3 行', '', '> 原文一', '', '意见一', '', '## ② a.md 第 9 行', '', '> 原文二', '> 第二行', ''].join('\n'))
})
