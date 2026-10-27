// A plugin's settings as one observable, persisted value (D1 L1). The plugin
// brings its own rules (normalize: defaults and allowed values); this module
// owns reading, persisting and telling subscribers.
//
//   const settings = createSettingsStore(storage, normalize)
//   settings.get()        → the current value (the same object until a set)
//   settings.set(patch)   → normalize({ ...value, ...patch }), persist under
//                           'settings', then call every subscriber with it
//   settings.subscribe(fn) → off
//   settings.use()        → the value, reactive (React)
//
// storage: { get(key, fallback), set(key, value) } — the host's ctx.storage
// returns the fallback for missing or corrupt JSON and does not throw. A storage
// that throws on set: the error reaches the caller after the in-memory value
// moved, and subscribers are not called (no swallowing, no retry).

import { useSyncExternalStore } from 'react'

export function createSettingsStore(storage, normalize) {
  let value = normalize(storage.get('settings', null))
  const listeners = new Set()
  const subscribe = (fn) => {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }
  return {
    get: () => value,
    set(patch) {
      value = normalize({ ...value, ...patch })
      storage.set('settings', value)
      for (const fn of [...listeners]) fn(value)
    },
    subscribe,
    use() {
      return useSyncExternalStore(subscribe, () => value)
    }
  }
}
