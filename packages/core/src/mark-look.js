// The look of a mark on the original text, shared by both plugins so the same
// state reads the same in a chat and in a document (V2 design §2.1–2.2, §11).
// Pure data → CSS declarations for ::highlight() rules. ::highlight() paints
// background-color and text-decoration (style, colour, thickness) in the
// host's Chromium; it ignores text-underline-offset (V2-T P7).
//
//   MarkLook.fill(state) → 'background-color:…' | ''
//   MarkLook.line(state) → 'text-decoration:…'  | ''
//
//   pending   waiting to be sent      fill 14%; a 批注 adds a solid 2px line (a 划线 has none)
//   sent      handed to the AI        fill 7%;  a 批注's line turns dashed
//   answered  the reply addressed it  the sent look in the answer hue (--ui-green), solid line
//   resolved  done (documents)        no fill, faint dotted 1px line
//   changed   原文已变 (overlay)       wavy warning line
//   active    being edited / hovered  deeper fill, keeps the status line underneath
//             (V2.1: also how the way back marks the place — nothing flashes on arrival)
//
// Colours are host theme variables only. The host has no --ui-warning token:
// the warning colour is --ui-yellow (checked in the sandbox, light and dark).
// Chat pins (✓, the missing dot, hollow when sent) are drawn by the chat
// plugin; documents have no pins.

export const ACCENT = 'var(--ui-accent)'
export const ANSWER = 'var(--ui-green)'
export const WARN = 'var(--ui-yellow)'
const FAINT = 'var(--ui-text-quaternary)'

const LOOK = {
  pending: { fill: [ACCENT, 14], line: ['solid', 2, ACCENT, 72] },
  sent: { fill: [ACCENT, 7], line: ['dashed', 2, ACCENT, 55] },
  answered: { fill: [ANSWER, 8], line: ['solid', 2, ANSWER, 72] },
  resolved: { fill: null, line: ['dotted', 1, FAINT, 100] },
  changed: { fill: null, line: ['wavy', 1.5, WARN, 100] },
  active: { fill: [ACCENT, 26], line: null }
}

export const STATES = Object.freeze(Object.keys(LOOK))

const mix = (c, pct) => (pct >= 100 ? c : `color-mix(in srgb,${c} ${pct}%,transparent)`)

export function fill(state) {
  const f = LOOK[state]?.fill
  return f ? `background-color:${mix(f[0], f[1])}` : ''
}

export function line(state) {
  const l = LOOK[state]?.line
  return l ? `text-decoration:underline ${l[0]} ${l[1]}px ${mix(l[2], l[3])}` : ''
}
