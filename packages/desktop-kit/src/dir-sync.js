// Text direction for the plugin's own UI. The host mirrors the APP locale onto
// <html dir>; a pinned plugin language (say Arabic in an English app, or the
// reverse) needs its own `dir`. This keeps `dir` on every plugin root matching
// selector in step with the effective plugin locale — roots added later
// included (MutationObserver), so modules need no per-root wiring.

export function installDirSync({ doc = globalThis.document, selector, dir, subscribe }) {
  if (!doc?.body || typeof selector !== 'string') return () => {}
  const apply = (root) => {
    const d = dir()
    const set = (el) => el.getAttribute?.('dir') !== d && el.setAttribute('dir', d)
    if (root.matches?.(selector)) set(root)
    root.querySelectorAll?.(selector).forEach(set)
  }
  apply(doc.body)
  const Obs = doc.defaultView?.MutationObserver ?? globalThis.MutationObserver
  const obs = Obs
    ? new Obs((records) => {
        for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1) apply(n)
      })
    : null
  obs?.observe(doc.body, { childList: true, subtree: true })
  const offs = subscribe.map((s) => s?.(() => apply(doc.body))).filter((f) => typeof f === 'function')
  return () => {
    obs?.disconnect()
    offs.forEach((f) => f())
  }
}
