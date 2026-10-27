// The T ↔ C seam of Diple V2 (design §3, frozen). One instance per plugin,
// created in index.js and handed to both groups as deps.uiBus.
//
//   const bus = createUiBus()
//
//   bus.locate(itemId, { edit = true } = {})
//       → Promise<'shown' | 'loaded' | 'other-session' | 'missing'>
//       C calls it (a capsule, a drawer row); T implements it: back to the
//       original text, then (edit) the editor beside its pin.
//       No implementation registered, a throw, or any other value → 'missing'.
//   bus.onLocate(handler) → off      T registers (handler(itemId, { edit }));
//                                    the latest registration wins; its off()
//                                    hands locate back to the one before
//   bus.hover(itemId | null)          either side: this item is under the pointer
//   bus.onHover(fn) → off             fn(itemId | null); consecutive repeats dropped
//   bus.editorOpened(itemId) / bus.editorClosed(itemId)     T emits
//   bus.onEditor(fn) → off            fn({ type: 'opened' | 'closed', itemId, open })
//                                    (open: true | false, the same fact as a flag)
//   bus.sendNow({ key }?)             T emits: ⌘⏎ in the editor (after saving, before
//                                    closing). V2-X (R8 XV-03): `key` = the list the
//                                    edited item belongs to, fixed at the key press;
//                                    C sends that list, never the focused one instead
//   bus.onSendNow(fn) → off           C subscribes (fn(req)) and runs the send flow
//
// A listener that throws never stops the others.

const RESULTS = new Set(['shown', 'loaded', 'other-session', 'missing'])

function channel() {
  const fns = new Set()
  return {
    on(fn) {
      fns.add(fn)
      return () => fns.delete(fn)
    },
    emit(...args) {
      for (const fn of [...fns]) {
        try {
          fn(...args)
        } catch (err) {
          console.error('[diple] uiBus listener failed', err)
        }
      }
    }
  }
}

export function createUiBus() {
  const locators = [] // registration order; the last one answers
  const hoverCh = channel()
  const editorCh = channel()
  const sendCh = channel()
  let hovered = null

  return {
    async locate(itemId, { edit = true } = {}) {
      const impl = locators.at(-1)
      if (!impl || itemId == null) return 'missing'
      try {
        const r = await impl(itemId, { edit: Boolean(edit) })
        return RESULTS.has(r) ? r : 'missing'
      } catch (err) {
        console.error('[diple] locate failed', err)
        return 'missing'
      }
    },
    onLocate(handler) {
      locators.push(handler)
      return () => {
        const i = locators.lastIndexOf(handler)
        if (i >= 0) locators.splice(i, 1)
      }
    },
    hover(itemId) {
      const next = itemId ?? null
      if (next === hovered) return
      hovered = next
      hoverCh.emit(next)
    },
    onHover: (fn) => hoverCh.on(fn),
    editorOpened: (itemId) => editorCh.emit({ type: 'opened', itemId, open: true }),
    editorClosed: (itemId) => editorCh.emit({ type: 'closed', itemId, open: false }),
    onEditor: (fn) => editorCh.on(fn),
    sendNow: (req) => sendCh.emit(req && typeof req === 'object' ? { key: req.key ?? null } : {}),
    onSendNow: (fn) => sendCh.on(fn)
  }
}
