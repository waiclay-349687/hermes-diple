// Session titles for labels and the cross-session confirm (best effort, cached).
//
//   const titles = createTitles(host)
//   titles.titleOf(id) → string | null   (sync; loads in the background)
//   titles.load()      → Promise          (resolves once the list was read)
//   titles.subscribe(fn) / titles.version()

export function createTitles(getHost) {
  const map = new Map()
  const listeners = new Set()
  let version = 0
  let loading = null
  const load = () => {
    if (loading) return loading
    const h = getHost() ?? {}
    const profile = h.state?.profile?.get?.() || h.state?.focusedSessionProfile?.get?.() || 'default'
    loading = Promise.resolve()
      .then(() => h.listPersistedSessions?.(null, { profile, limit: 300 }))
      .then((res) => {
        for (const s of res?.sessions ?? []) if (s?.id) map.set(s.id, s.title || s.preview || null)
        version++
        for (const fn of [...listeners]) fn()
      })
      .catch(() => {})
      .finally(() => setTimeout(() => (loading = null), 30_000)?.unref?.())
    return loading
  }
  return {
    titleOf(id) {
      if (!id) return null
      if (!map.has(id)) {
        map.set(id, null)
        void load()
      }
      return map.get(id)
    },
    async titleNow(id) {
      if (!map.get(id)) {
        map.delete(id)
        loading = null
        await load()
      }
      return map.get(id) ?? null
    },
    load,
    subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    version: () => version
  }
}
