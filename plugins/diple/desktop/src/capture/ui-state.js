// View state of the pending lists that is not list data (not persisted with
// the items). One small store; snapshots are stable objects so
// useSyncExternalStore never loops (React #185).
//
//   ui.get()                         → { focus, expanded, undo, changed, drafts, collapsed }
//   ui.subscribe(fn)                 → unsubscribe
//   ui.focusCard(key, id)            ask the card to take keyboard focus (once)
//   ui.consumeFocus(id)              the card took it
//   ui.expand(key, id) / ui.collapseCard()
//   ui.setUndo(key, kind, until, count) / ui.clearUndo()
//   ui.markChanged(id, bool)
//   ui.markDraft(id, bool)           V2.1 #2: a new annotation whose editor has not
//                                    saved it yet — kept off the strip and its count
//   ui.setCollapsed(bool)            whole list folded to one summary line (persisted)
//   ui.use()                         React hook → snapshot

import { useSyncExternalStore } from 'react'

export function createUiState(storage) {
  let snap = Object.freeze({
    focus: null,
    expanded: null,
    undo: null,
    changed: Object.freeze({}),
    drafts: Object.freeze({}),
    collapsed: Boolean(storage?.get?.('ui.collapsed', false))
  })
  const listeners = new Set()
  const set = (patch) => {
    const next = { ...snap, ...patch }
    if (Object.keys(patch).every((k) => next[k] === snap[k])) return
    snap = Object.freeze(next)
    for (const fn of [...listeners]) fn()
  }
  const subscribe = (fn) => {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }
  return {
    get: () => snap,
    subscribe,
    focusCard: (key, id) => set({ focus: { key, id, n: (snap.focus?.n ?? 0) + 1 } }),
    consumeFocus: (id) => snap.focus?.id === id && set({ focus: null }),
    expand: (key, id) => set({ expanded: key && id ? { key, id } : null }),
    collapseCard: () => set({ expanded: null }),
    expandedIn: (key) => (snap.expanded?.key === key ? snap.expanded.id : null),
    setUndo: (key, kind, until, count = 1) => set({ undo: { key, kind, until, count } }),
    clearUndo: () => set({ undo: null }),
    markChanged(id, value) {
      if (Boolean(snap.changed[id]) === Boolean(value)) return
      const changed = { ...snap.changed }
      if (value) changed[id] = true
      else delete changed[id]
      set({ changed: Object.freeze(changed) })
    },
    markDraft(id, value) {
      if (!id || Boolean(snap.drafts[id]) === Boolean(value)) return
      const drafts = { ...snap.drafts }
      if (value) drafts[id] = true
      else delete drafts[id]
      set({ drafts: Object.freeze(drafts) })
    },
    setCollapsed(value) {
      storage?.set?.('ui.collapsed', Boolean(value))
      set({ collapsed: Boolean(value) })
    },
    use() {
      return useSyncExternalStore(subscribe, () => snap)
    }
  }
}
