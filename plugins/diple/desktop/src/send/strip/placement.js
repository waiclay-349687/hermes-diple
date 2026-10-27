// Fixed layers inside the composer (chip preview, drawer). The composer
// surface clips its overflow, so they are position:fixed; but a transformed
// or filtered ancestor turns "fixed" into "relative to that ancestor". This
// hook places the element at viewport coordinates anyway: it applies them,
// measures where the element really landed, and corrects by the difference —
// before paint (useLayoutEffect), so nothing jumps.
//
//   useViewportPlacement(ref, place, deps)
//     place() → { left?, right?, bottom?, maxHeight? } in viewport px, or null

import { useLayoutEffect } from 'react'

export function useViewportPlacement(ref, place, deps) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const apply = () => {
      const want = place()
      if (!want) return
      const st = el.style
      st.left = want.left != null ? `${want.left}px` : ''
      st.right = want.right != null ? `${want.right}px` : ''
      st.bottom = want.bottom != null ? `${want.bottom}px` : ''
      st.top = ''
      if (want.maxHeight != null) st.maxHeight = `${want.maxHeight}px`
      const r = el.getBoundingClientRect?.()
      if (!r || (!r.width && !r.height)) return // no layout (jsdom)
      const vw = window.innerWidth
      const vh = window.innerHeight
      if (want.left != null) st.left = `${want.left - (r.left - want.left)}px`
      if (want.right != null) st.right = `${want.right - (vw - r.right - want.right)}px`
      if (want.bottom != null) st.bottom = `${want.bottom - (vh - r.bottom - want.bottom)}px`
    }
    apply()
    window.addEventListener('resize', apply)
    return () => window.removeEventListener('resize', apply)
  }, deps)
}
