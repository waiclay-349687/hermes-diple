// Text offsets inside one element ↔ DOM Ranges. Pure DOM reads.
//
//   textOffset(el, node, offset)        → character offset of a boundary point in el.textContent
//   rangeFromOffsets(el, start, end)    → Range covering el.textContent[start, end), or null
//   findAnchor(el, anchor)              → Range | { changed: true, reason } (core Anchor.locate)

import { Anchor } from '@diple/core'

export function textOffset(el, node, offset) {
  const range = el.ownerDocument.createRange()
  range.selectNodeContents(el)
  try {
    range.setEnd(node, offset)
  } catch {
    return 0
  }
  return range.toString().length
}

export function rangeFromOffsets(el, start, end) {
  const doc = el.ownerDocument
  const walker = doc.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */)
  let pos = 0
  let startNode = null
  let startOff = 0
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const len = n.data.length
    if (!startNode && start < pos + len) {
      startNode = n
      startOff = start - pos
    }
    if (startNode && end <= pos + len) {
      const r = doc.createRange()
      r.setStart(startNode, startOff)
      r.setEnd(n, Math.max(0, end - pos))
      return r
    }
    pos += len
  }
  return null
}

export function findAnchor(el, anchor) {
  if (!el || !anchor?.text) return { changed: true, reason: 'missing' }
  const hit = Anchor.locate(el.textContent ?? '', anchor)
  if (hit.changed) return hit
  return rangeFromOffsets(el, hit.start, hit.end) ?? { changed: true, reason: 'missing' }
}
