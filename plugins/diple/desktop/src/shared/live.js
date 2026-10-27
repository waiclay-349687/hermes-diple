// Reactive reads of the host's per-session state, tolerant of older hosts.
// Shared by capture/ (is the message being captured still streaming?) and
// send/ (send now or after the answer?).
//
//   const live = createLive()
//   live.isBusy(storedId)      → true | false | null   null = unknown (R2 XE-10)
//   live.probeBusy(storedId)   → Promise<true | false | null>  asks the gateway
//       (session.active_list) when the local state cannot tell, then isBusy
//   live.storedIdFor(runtimeId) → stored id | null
//   live.refreshPairs()        → Promise<boolean>  re-reads the gateway's live session
//       list (session.active_list) and learns its runtime ↔ stored pairs; false when
//       the gateway did not answer with a list (old gateway, error)
//   live.currentRuntime(storedId) → the runtime id that session runs on NOW (the
//       focused pair, or the one runtime of it the host reports mid-turn), else null
//   live.runtimesFor(storedId) → Set of runtime ids known for it
//   live.contextMax(storedId)  → focused session's context size, else null
//   live.useBusy / useContextMax / watchFocus / dispose
//
// The host keys busyBySession by RUNTIME id (sdk/index.ts) while the plugin
// keys everything by STORED id. Pairs are learned whenever both focus atoms
// are set, and from the gateway's live session list (`id` = runtime id,
// `session_key` = stored id, `status` working|waiting|starting|idle —
// tui_gateway/session_registry.py `_session_live_item`). A stored id with no
// live gateway session has no turn running. Nothing known → null, never
// "idle": callers treat unknown as busy.

import { host } from '@hermes/plugin-sdk'
import { useSyncExternalStore } from 'react'

const SNAPSHOT_TTL_MS = 3000
const BUSY_STATUSES = new Set(['working', 'waiting', 'starting'])

export function createLive({ now = () => Date.now() } = {}) {
  const st = host.state
  const stored = () => st.focusedStoredSessionId?.get?.() ?? null
  const runtime = () => st.focusedSessionId?.get?.() ?? null
  const seen = new Map() // runtime id → stored id
  let snapshot = null // { at, rows } from session.active_list
  const learn = () => {
    const r = runtime()
    const s = stored()
    if (r && s) seen.set(r, s)
  }
  learn()
  const runtimesFor = (key) => {
    const out = new Set([key])
    if (key === stored() && runtime()) out.add(runtime())
    for (const [r, s] of seen) if (s === key) out.add(r)
    return out
  }
  const fromSnapshot = (key) => {
    if (!snapshot || now() - snapshot.at > SNAPSHOT_TTL_MS) return null
    const rows = snapshot.rows.filter((r) => r?.session_key === key || r?.id === key)
    return rows.some((r) => BUSY_STATUSES.has(r.status))
  }
  const isBusy = (key) => {
    if (!key) return false
    learn()
    const by = st.busyBySession?.get?.() ?? {}
    const ids = runtimesFor(key)
    for (const id of ids) if (by[id]) return true
    if (key === stored()) return Boolean(st.busy?.get?.())
    // the host tracks one of its runtimes and says it is not mid-turn
    for (const id of ids) if (Object.prototype.hasOwnProperty.call(by, id)) return false
    return fromSnapshot(key)
  }
  const refreshPairs = async () => {
    try {
      const r = await host.request?.('session.active_list', {})
      if (!Array.isArray(r?.sessions)) return false
      snapshot = { at: now(), rows: r.sessions }
      for (const row of r.sessions) if (row?.id && row?.session_key) seen.set(String(row.id), String(row.session_key))
      return true
    } catch {
      return false // gateway unavailable: stays unknown
    }
  }
  const probeBusy = async (key) => {
    const known = isBusy(key)
    if (known !== null) return known
    await refreshPairs()
    return isBusy(key)
  }
  const currentRuntime = (key) => {
    if (!key) return null
    learn()
    if (key === stored() && runtime()) return runtime()
    const by = st.busyBySession?.get?.() ?? {}
    const busy = [...runtimesFor(key)].filter((r) => r !== key && by[r])
    return busy.length === 1 ? busy[0] : null
  }
  const listenAll = (atoms) => (cb) => {
    const offs = atoms.filter((a) => a?.listen).map((a) => a.listen(() => cb()))
    return () => offs.forEach((off) => off())
  }
  const busySub = listenAll([st.busy, st.busyBySession, st.focusedStoredSessionId, st.focusedSessionId])
  const usageSub = listenAll([st.focusedUsage, st.focusedStoredSessionId])
  // The host only reports the FOCUSED session's usage: another session's
  // context size is unknown (no pre-check) rather than borrowed (XE-10).
  const contextMax = (key) => {
    if (key != null && key !== stored()) return null
    const u = st.focusedUsage?.get?.()
    return typeof u?.context_max === 'number' && u.context_max > 0 ? u.context_max : null
  }
  // keep learning runtime ↔ stored pairs as the focus moves — after the host
  // has set both atoms (between the two writes the pair is mixed)
  const offLearn = listenAll([st.focusedStoredSessionId, st.focusedSessionId])(() => queueMicrotask(learn))
  return {
    isBusy,
    probeBusy,
    refreshPairs,
    currentRuntime,
    contextMax,
    runtimesFor: (key) => (learn(), runtimesFor(key)),
    storedIdFor: (rid) => {
      learn()
      return seen.get(rid) ?? (rid === runtime() ? stored() : null)
    },
    useBusy: (key) => useSyncExternalStore(busySub, () => isBusy(key) === true),
    useContextMax: (key) => useSyncExternalStore(usageSub, () => contextMax(key)),
    watchFocus: (fn) => listenAll([st.focusedStoredSessionId, st.focusedSessionId])(() => queueMicrotask(() => (learn(), fn()))),
    dispose: offLearn
  }
}
