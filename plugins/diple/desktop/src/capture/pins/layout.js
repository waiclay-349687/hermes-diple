// Where the numbered pins go (pure). V2.1 #5, after Codex: a pin rides the
// top-right corner of its passage — its centre on the rightmost line end
// (x) and half a pin above the passage's top edge (y). A multi-line passage
// gets it at the top right of the block, a few words at the end of those
// words. Pins that would overlap step sideways (to the right), in one pass
// over the pins sorted by position: no re-measuring, no pairwise search.
// A pin outside its thread viewport, past the column's right edge or under
// the composer is hidden.
//
//   cornerOf(rects)                      → { x, top } | null   rects: the passage's line boxes
//   layoutPins(marks, { size, gap })     → [{ id, left, top, placed, visible }]
//       marks: [{ id, corner, clip, avoid?, sent? }] — one viewport's pins, client px at measure time
//       placed: it has a place (a corner, inside the column); visible: placed and on screen now
//   visibleAt(box, { size, clip, avoid, dx, dy }) → boolean
//       the same rule after the viewport scrolled by (dx, dy) since the measure — arithmetic only

export const PIN_SIZE = 16 // the drawn square; the hit area is 20 px (CSS ::before)
const GAP = 2

export function cornerOf(rects) {
  let x = -Infinity
  let top = Infinity
  for (const r of rects ?? []) {
    if (!r || !(r.width || r.height)) continue
    if (r.right > x) x = r.right
    if (r.top < top) top = r.top
  }
  return Number.isFinite(x) && Number.isFinite(top) ? { x, top } : null
}

export function visibleAt(box, { size = PIN_SIZE, clip = null, avoid = [], dx = 0, dy = 0 } = {}) {
  const left = box.left - dx
  const top = box.top - dy
  const cy = top + size / 2
  if (clip && (cy < clip.top || cy > clip.bottom || left < clip.left || left + size > clip.right)) return false
  for (const a of avoid ?? []) if (top + size > a.top && top < a.bottom && left + size > a.left && left < a.right) return false
  return true
}

export function layoutPins(marks, { size = PIN_SIZE, gap = GAP } = {}) {
  const out = new Map()
  const boxes = []
  for (const m of marks) {
    if (!m.corner) out.set(m.id, { id: m.id, left: 0, top: 0, placed: false, visible: false })
    else boxes.push({ m, left: Math.round(m.corner.x - size / 2), top: Math.round(m.corner.top - size) })
  }
  // One pass in reading order (pending before sent on the same spot): a pin
  // that would overlap the last one placed on its row, or a row next to it,
  // moves just right of it.
  boxes.sort((a, b) => a.top - b.top || Number(Boolean(a.m.sent)) - Number(Boolean(b.m.sent)) || a.left - b.left)
  const lastInRow = new Map() // row → the rightmost box placed there
  const row = (top) => Math.floor(top / size)
  for (const b of boxes) {
    const k = row(b.top)
    for (const r of [k - 1, k + 1, k]) {
      const p = lastInRow.get(r)
      if (!p || Math.abs(p.top - b.top) >= size || b.left >= p.left + size + gap) continue
      // on its own row the run of placed pins is to the left of p: go after it;
      // a pin on the next row only moves when it really overlaps p
      if (r === k || b.left + size + gap > p.left) b.left = p.left + size + gap
    }
    const clip = b.m.clip
    const placed = !clip || (b.left >= clip.left && b.left + size <= clip.right)
    if (placed && !(lastInRow.get(k)?.left > b.left)) lastInRow.set(k, b)
    out.set(b.m.id, { id: b.m.id, left: b.left, top: b.top, placed, visible: placed && visibleAt(b, { size, clip, avoid: b.m.avoid }) })
  }
  return marks.map((m) => out.get(m.id))
}
