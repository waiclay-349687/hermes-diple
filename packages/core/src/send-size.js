// How big a batch is against the model context (XR10-02). Pure: no DOM, no
// host, no storage. The send flow refuses / warns by it and the strip's footer
// shows it; both import it from here, so the footer never reaches into the
// protocol implementation for a display rule.
//
//   SendSize.level(tokens, max) → { tokens, max, pct, level }
//       level: 'unknown' (no or non-positive max) | 'ok' | 'soft' (> 25%) | 'hard' (> 50%)
//       Host limits: 25% warn, 50% refuse.

export const SOFT_LIMIT = 0.25
export const HARD_LIMIT = 0.5

export function level(tokens, max) {
  if (!max || !(max > 0)) return { tokens, max: null, pct: null, level: 'unknown' }
  const pct = Math.round((tokens / max) * 100)
  const lv = tokens > max * HARD_LIMIT ? 'hard' : tokens > max * SOFT_LIMIT ? 'soft' : 'ok'
  return { tokens, max, pct, level: lv }
}
