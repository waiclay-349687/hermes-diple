// R11-L (A): where the chat plugin's notices land. The host puts errors, warnings and
// notices with an action at top-center (one shown, the rest folded into "+N more"),
// and routine info/success in the bottom-right corner (host store/notifications.ts,
// defaultPlacement). R11-G sent every Diple notice top-center: a routine
// 「已加入 N 条标注」 then folded away the warning 「输入框里的文字不能标注」 (w2a-part1).
// Now only the confirmations of a click in the strip / its send menu / the receipt row
// under the composer go top-center (the bottom-right corner is over 直接发送 there);
// every other notice keeps the host's default.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { act, cleanupAll, click, fresh, mount, origin, sdk, seed, tick } from './v2c-rig.mjs'
import { ROOT } from './harness.mjs'

/** The host's rule (apps/desktop/src/store/notifications.ts): placement ?? defaultPlacement(kind, action). */
const placed = (n) => n.placement ?? (n.kind === 'error' || n.kind === 'warning' || n.action ? 'default' : 'bottom-right')

test.after(cleanupAll)

test('routine info / success keep the host default (bottom-right, not top-center); warnings and errors still show top-center', () => {
  const h = fresh()
  sdk.notifications.length = 0
  h.deps.notify({ kind: 'info', title: '已加入 2 条标注' })
  h.deps.notify({ kind: 'success', title: 'saved' })
  h.deps.notify({ kind: 'warning', title: '输入框里的文字不能标注' })
  h.deps.notify({ kind: 'error', title: 'failed' })
  assert.deepEqual(sdk.notifications.map((n) => n.placement), [undefined, undefined, undefined, undefined], 'no placement passed')
  assert.deepEqual(sdk.notifications.map(placed), ['bottom-right', 'bottom-right', 'default', 'default'])
  // the strip's confirmations: top-center, away from 直接发送
  h.deps.notifyOverStrip({ kind: 'success', title: '已复制' })
  assert.equal(sdk.notifications.at(-1).placement, 'default')
})

test('复制给 AI (the send menu) confirms top-center: the bottom-right toast would cover 直接发送', async () => {
  const h = fresh()
  await seed(h, 'stored-1', [{ id: 'a', origin: origin(1), text: '原文一', comment: '意见一' }])
  const view = await mount(h)
  Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText: async () => {} }, configurable: true })
  sdk.notifications.length = 0
  await click(view.q('[data-diple-send-menu-toggle]'))
  await click(view.q('[data-diple-send-menu] [data-send-item="copy"]'))
  await act(async () => tick(10))
  assert.match(sdk.notifications.at(-1)?.title ?? '', /已复制/)
  assert.equal(placed(sdk.notifications.at(-1)), 'default')
})

test('only the strip / menu / receipt-row confirmations pass a placement (the list, by source)', () => {
  const dir = path.join(ROOT, 'plugins/diple/desktop/src')
  const hits = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name)
      if (e.isDirectory()) walk(f)
      else if (/\.(js|jsx)$/.test(e.name)) {
        const src = fs.readFileSync(f, 'utf8')
        const rel = path.relative(dir, f).split(path.sep).join('/')
        assert.ok(!/placement\s*:/.test(src) || rel === 'index.js', `${rel} passes a placement itself; use deps.notifyOverStrip`)
        for (const m of src.matchAll(/notifyOverStrip\(\{[^}]*title: t\('([^']+)'/g)) hits.push(`${rel} ${m[1]}`)
      }
    }
  }
  walk(dir)
  assert.deepEqual(hits.sort(), ['send/footer.jsx send.copiedForAgent', 'send/footer.jsx send.putBackDone', 'send/footer.jsx send.queueCancelled'])
})
