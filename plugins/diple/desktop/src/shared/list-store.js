// Per-session pending lists: PendingList state + dispatch, persisted per
// session through ctx.storage. THE shared store interface (W1-owned; W2a and
// W2b read and dispatch, neither changes the shape).
//
//   const lists = createListStore({ storage, now, watch })
//   lists.get(key)                 → PendingList state of that session (never null)
//   lists.dispatch(key, cmd)       → effects  (cmd as in packages/core PendingList)
//   lists.subscribe(fn)            → unsubscribe; fn(key) after every change
//   lists.useList(key)             → React hook: the state, re-rendered on change
//   lists.keys()                   → session keys with a non-empty list
//
// `key` is the STORED session id (host.state.focusedStoredSessionId): it
// survives reloads, unlike runtime ids. A null/empty key is refused
// (dispatch returns [{ type: 'rejected', reason: 'no-session' }]).
// Storage layout: `list.<key>` → PendingList.serialize(state).
//
// Several windows (main window + a session window, or two instance windows)
// share ctx.storage (the host backs it with localStorage and has no change
// notification of its own). So that one window never overwrites another's
// edits with a stale cache (W3):
//   - every dispatch first re-reads `list.<key>`; if it differs from what this
//     window last loaded or wrote, the cache is rebuilt from it and the command
//     is applied on top (a command-level merge: add/remove/edit of one item
//     only touch that item). The local undo trash survives the reload.
//   - `watch(onChange)` (optional, injected by the entry) reports external
//     changes — onChange(key) for one list, onChange(null) for "re-check all";
//     the store reloads and notifies subscribers, so other windows repaint.
// Known limit: two windows writing the same list within the same instant can
// still lose one write (localStorage has no compare-and-set).

import { useSyncExternalStore } from 'react'
import { PendingList } from '@diple/core'

const STORAGE_PREFIX = 'list.'
// One frozen empty state: useSyncExternalStore needs a stable snapshot.
const EMPTY = Object.freeze(PendingList.createState())

export function createListStore({ storage, now = () => Date.now(), watch } = {}) {
  const cache = new Map()
  const seen = new Map() // key → JSON of the stored list this window last loaded or wrote
  const listeners = new Set()
  const notify = (key) => {
    for (const fn of [...listeners]) fn(key)
  }

  const hydrate = (saved, trash = null) => {
    const state = saved ? PendingList.reduce(undefined, { type: 'hydrate', state: saved }).state : PendingList.createState()
    return trash ? { ...state, trash } : state
  }

  const load = (key) => {
    if (!cache.has(key)) {
      const saved = storage.get(STORAGE_PREFIX + key, null)
      seen.set(key, JSON.stringify(saved ?? null))
      cache.set(key, hydrate(saved))
    }
    return cache.get(key)
  }

  /** Pick up another window's write to `list.<key>`. Returns true when the cache changed. */
  const refresh = (key) => {
    if (!cache.has(key)) return false
    const saved = storage.get(STORAGE_PREFIX + key, null)
    const raw = JSON.stringify(saved ?? null)
    if (raw === seen.get(key)) return false
    seen.set(key, raw)
    cache.set(key, hydrate(saved, cache.get(key).trash))
    return true
  }

  // Stable per-key subscribe functions, so React does not resubscribe every render.
  const subscribers = new Map()
  const subscribeFor = (key) => {
    if (!subscribers.has(key)) {
      subscribers.set(key, (cb) => {
        const fn = (changed) => changed === key && cb()
        listeners.add(fn)
        return () => listeners.delete(fn)
      })
    }
    return subscribers.get(key)
  }

  const persist = (key, state) => {
    if (state.items.length || state.sending) {
      const ser = PendingList.serialize(state)
      storage.set(STORAGE_PREFIX + key, ser)
      seen.set(key, JSON.stringify(ser))
    } else {
      storage.remove(STORAGE_PREFIX + key)
      seen.set(key, 'null')
    }
  }

  watch?.((key) => {
    for (const k of key == null ? [...cache.keys()] : [key]) if (refresh(k)) notify(k)
  })

  return {
    get(key) {
      return key ? load(key) : EMPTY
    },
    dispatch(key, cmd) {
      if (!key) return [{ type: 'rejected', reason: 'no-session' }]
      load(key)
      const reloaded = refresh(key) // read before write: never overwrite another window's edit
      const before = cache.get(key)
      const stamped = cmd && cmd.now === undefined ? { ...cmd, now: now() } : cmd
      const { state, effects } = PendingList.reduce(before, stamped)
      if (state !== before) {
        cache.set(key, state)
        persist(key, state)
      }
      if (state !== before || reloaded) notify(key)
      return effects
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    useList(key) {
      return useSyncExternalStore(subscribeFor(key), () => this.get(key))
    },
    keys() {
      return [...cache.entries()].filter(([, s]) => s.items.length).map(([k]) => k)
    }
  }
}
