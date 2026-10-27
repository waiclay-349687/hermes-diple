// Anchor: remembers where a piece of text sat in a document, and finds it
// again after the document changed.
//
// Interface:
//   makeAnchor(doc, start, end)              → { text, before, after, line, sig }
//   locate(doc, anchor, { prior } = {})      → { start, end } | { changed: true, reason }
//   locateMany(doc, anchors, { prior } = {}) → one locate() result per anchor, same order
//   prepare(doc)                             → a prepared document (opaque; reuse it)
//   fingerprint(doc)                         → string (what `sig` holds)
//
// `doc` (and every entry of `prior`) may be a string or a prepared document.
// A prepared document is one version's work done once — line index,
// fingerprint, where each text occurs, how it aligns with another version —
// and shared by every anchor located in it (XR2-02). Strings work as before;
// the caller that locates many anchors, or the same version again, should
// prepare once and pass the prepared value around. Nothing is cached by the
// document string itself: equal-length multi-MB strings make string-keyed maps
// compare whole documents on every lookup.
//
// reason: 'missing'   — the text is gone;
//         'ambiguous' — it occurs more than once and nothing proves which copy
//                       is ours. We would rather say "the original changed"
//                       than attach the annotation to the wrong place.
//
// When several copies carry the full recorded context, the old line number is
// only trusted while the document is the very one the anchor was taken in
// (`sig`). After an edit the caller may pass earlier versions of the document
// (`prior`); if one of them is the anchor's version, the old position is
// carried through the edit, but only when both minimal explanations of the
// edit (shared prefix first, shared suffix first) land on the same copy.
// An identical block inserted next to ours is not provably one or the other,
// so it stays ambiguous (XR-05).
//
// Work is bounded (XR-08): no argument spreading over hit lists, one line
// index per prepared document, and more than MAX_HITS occurrences is ambiguous.

export const CONTEXT_CHARS = 32
export const MAX_HITS = 20000
const HIT_MEMO_TEXT = 1024 // texts up to this length have their occurrences remembered per version
const HIT_MEMO_SIZE = 512

function commonSuffix(a, b, limit = Math.min(a.length, b.length)) {
  let n = 0
  while (n < limit && a.charCodeAt(a.length - 1 - n) === b.charCodeAt(b.length - 1 - n)) n++
  return n
}

function commonPrefix(a, b, limit = Math.min(a.length, b.length)) {
  let n = 0
  while (n < limit && a.charCodeAt(n) === b.charCodeAt(n)) n++
  return n
}

function hash(d) {
  let a = 0x811c9dc5
  let b = 0x9747b28c ^ d.length
  for (let i = 0; i < d.length; i++) {
    const c = d.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193)
    b = Math.imul(b ^ c, 0x5bd1e995)
    b ^= b >>> 15
  }
  return `${d.length.toString(36)}.${(a >>> 0).toString(36)}.${(b >>> 0).toString(36)}`
}

class Prepared {
  constructor(doc) {
    this.doc = doc
    this._sig = null
    this._lines = null
    this._hits = new Map()
    this._pairs = new WeakMap()
  }

  /** A 64-bit content fingerprint (two 32-bit hashes + length). Not cryptographic. */
  get sig() {
    if (this._sig === null) this._sig = hash(this.doc)
    return this._sig
  }

  lineAt(offset) {
    if (!this._lines) {
      const starts = [0]
      const d = this.doc
      for (let i = d.indexOf('\n'); i !== -1; i = d.indexOf('\n', i + 1)) starts.push(i + 1)
      this._lines = starts
    }
    const starts = this._lines
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= offset) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }

  /** Offsets of every occurrence of `text`; null past MAX_HITS. */
  hits(text) {
    const memo = text.length <= HIT_MEMO_TEXT
    if (memo && this._hits.has(text)) return this._hits.get(text)
    const d = this.doc
    let out = []
    for (let i = d.indexOf(text); i !== -1; i = d.indexOf(text, i + 1)) {
      if (out.length >= MAX_HITS) {
        out = null
        break
      }
      out.push(i)
    }
    if (memo) {
      if (this._hits.size >= HIT_MEMO_SIZE) this._hits.delete(this._hits.keys().next().value)
      this._hits.set(text, out)
    }
    return out
  }

  /** Shared prefix / suffix lengths with another version (computed once per pair). */
  align(other) {
    let r = this._pairs.get(other)
    if (!r) {
      r = { pre: commonPrefix(this.doc, other.doc), suf: commonSuffix(this.doc, other.doc) }
      this._pairs.set(other, r)
      other._pairs.set(this, r)
    }
    return r
  }
}

// One slot: the plain-string calls of a single caller (e.g. locate(text, a) in
// a loop over the same text) share one preparation. `===` on the same string
// object is a pointer check; a different string costs one comparison per call.
let lastPrepared = null

export function prepare(doc) {
  if (doc instanceof Prepared) return doc
  if (typeof doc !== 'string') throw new TypeError('prepare: doc must be a string')
  if (lastPrepared && lastPrepared.doc === doc) return lastPrepared
  lastPrepared = new Prepared(doc)
  return lastPrepared
}

const isDoc = (doc) => typeof doc === 'string' || doc instanceof Prepared

// Earlier versions passed as plain strings by a caller looping over anchors: a few
// recent ones are kept. Lookup is `===` on the string (the same string object is a
// pointer check), never a Map keyed by document content.
const PRIOR_SLOTS = 4
const priorSlots = []
function preparePrior(p) {
  if (p instanceof Prepared) return p
  const hit = priorSlots.find((x) => x.doc === p)
  if (hit) return hit
  const fresh = new Prepared(p)
  priorSlots.unshift(fresh)
  if (priorSlots.length > PRIOR_SLOTS) priorSlots.pop()
  return fresh
}

export function fingerprint(doc) {
  if (!isDoc(doc)) return ''
  return prepare(doc).sig
}

export function makeAnchor(doc, start, end) {
  if (!isDoc(doc)) throw new TypeError('makeAnchor: doc must be a string')
  const P = prepare(doc)
  const d = P.doc
  const s = Math.max(0, Math.min(start, end))
  const e = Math.min(d.length, Math.max(start, end))
  if (e <= s) throw new RangeError('makeAnchor: empty range')
  return {
    text: d.slice(s, e),
    before: d.slice(Math.max(0, s - CONTEXT_CHARS), s),
    after: d.slice(e, e + CONTEXT_CHARS),
    line: P.lineAt(s),
    sig: P.sig
  }
}

/** Every occurrence of the text with how much recorded context matches; null past MAX_HITS. */
function candidates(P, anchor) {
  const hits = P.hits(anchor.text)
  if (hits === null) return null
  const d = P.doc
  const before = anchor.before ?? ''
  const after = anchor.after ?? ''
  const len = anchor.text.length
  const out = []
  for (const i of hits) {
    const b = commonSuffix(d.slice(Math.max(0, i - before.length), i), before)
    const a = commonPrefix(d.slice(i + len, i + len + after.length), after)
    out.push({ i, score: b + a, full: b === before.length && a === after.length })
  }
  return out
}

/** The single full-context copy on the recorded line (valid only in the anchor's own version). */
function onRecordedLine(P, full, anchor) {
  let found = null
  for (const s of full) {
    if (P.lineAt(s.i) !== anchor.line) continue
    if (found !== null) return null
    found = s.i
  }
  return found
}

/** Carry [start, end) from version `from` to `to` iff both minimal edit explanations agree. */
function carry(from, to, start, end) {
  const fl = from.doc.length
  const tl = to.doc.length
  const min = Math.min(fl, tl)
  const { pre, suf } = from.align(to)
  const map = (p, s) => {
    if (end <= p) return start
    if (start >= fl - s) return start + (tl - fl)
    return null // inside the edited stretch
  }
  const p1 = Math.min(pre, min)
  const x = map(p1, Math.min(suf, min - p1))
  const s2 = Math.min(suf, min)
  const y = map(Math.min(pre, min - s2), s2)
  return x !== null && x === y ? x : null
}

function locateIn(P, anchor, versions) {
  if (!anchor?.text || typeof anchor.text !== 'string') return { changed: true, reason: 'missing' }
  const scored = candidates(P, anchor)
  if (scored === null) return { changed: true, reason: 'ambiguous' }
  if (scored.length === 0) return { changed: true, reason: 'missing' }
  const range = (i) => ({ start: i, end: i + anchor.text.length })
  if (scored.length === 1) return range(scored[0].i)

  const full = scored.filter((s) => s.full)
  if (full.length === 1) return range(full[0].i)
  if (full.length > 1) {
    if (anchor.sig && anchor.sig === P.sig) {
      const i = onRecordedLine(P, full, anchor)
      return i === null ? { changed: true, reason: 'ambiguous' } : range(i)
    }
    const old = anchor.sig ? versions().find((v) => v !== P && v.sig === anchor.sig) : undefined
    if (old !== undefined) {
      const was = onRecordedLine(old, (candidates(old, anchor) ?? []).filter((s) => s.full), anchor)
      const now = was === null ? null : carry(old, P, was, was + anchor.text.length)
      if (now !== null && full.some((s) => s.i === now)) return range(now)
    }
    return { changed: true, reason: 'ambiguous' }
  }

  let best = -1
  let top = 0
  let at = -1
  for (const s of scored) {
    if (s.score > best) [best, top, at] = [s.score, 1, s.i]
    else if (s.score === best) top++
  }
  const context = (anchor.before ?? '').length + (anchor.after ?? '').length
  // Only trust partial context when it is substantial and unique.
  if (best >= Math.min(8, context) && best > 0 && top === 1) return range(at)
  return { changed: true, reason: 'ambiguous' }
}

/** Earlier versions, prepared lazily and only once per call. */
function priorVersions(prior) {
  let list = null
  return () => {
    if (list === null) {
      const raw = Array.isArray(prior) ? prior : prior == null ? [] : [prior]
      // own small cache: preparing N priors must not evict the current document's slot
      list = raw.filter(isDoc).map(preparePrior)
    }
    return list
  }
}

export function locate(doc, anchor, { prior = [] } = {}) {
  if (!isDoc(doc) || !anchor?.text) return { changed: true, reason: 'missing' }
  return locateIn(prepare(doc), anchor, priorVersions(prior))
}

export function locateMany(doc, anchors, { prior = [] } = {}) {
  const list = Array.isArray(anchors) ? anchors : []
  if (!isDoc(doc)) return list.map(() => ({ changed: true, reason: 'missing' }))
  const P = prepare(doc)
  const versions = priorVersions(prior)
  return list.map((a) => {
    try {
      return locateIn(P, a, versions)
    } catch {
      return { changed: true, reason: 'ambiguous' } // one odd anchor never takes the batch down
    }
  })
}
