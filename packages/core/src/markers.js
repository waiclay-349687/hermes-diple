// Markers: the response markers an AI writes in front of a paragraph that
// answers a comment — `::ann{b="<batchId>" n="1,3"}` (ADR 0002).
//
// Interface:
//   markerFor(batchId, ns)            → the exact text the AI is told to write
//   parse(answerText)                 → [{ b, ns, at }]
//   reconcile(answerText, batch)      → { answered: Set<n>, missing: [n], noMarkers }
//
// Recognition mirrors the host's transcript directive scanner
// (apps/desktop/src/lib/transcript-directives.ts): a directive is recognised
// wherever it starts a word, also mid-paragraph, but never inside code. Keeping
// the two in step means a marker the UI paints is always one reconcile counts.

export const MARKER_NAME = 'ann'

const DIRECTIVE_BODY_MAX = 2048
// Same shape as the host's SEGMENT_RE, narrowed to our name.
const MARKER_RE = new RegExp(String.raw`(?<=^|\s)::ann(?:\{([^{}]{0,${DIRECTIVE_BODY_MAX}})\})?`, 'g')
// Host ATTR_RE: key="value" pairs, single quotes accepted, keys case-insensitive.
const ATTR_RE = /([a-z][\w-]{0,63})=(?:"([^"]*)"|'([^']*)')/gi

/** The marker line for batch `batchId` answering comment numbers `ns`. */
export function markerFor(batchId, ns) {
  const list = (Array.isArray(ns) ? ns : [ns]).join(',')
  return `::${MARKER_NAME}{b="${batchId}" n="${list}"}`
}

/** Parse the `n` attribute: "1,3", "1, 3", "1，3" → [1, 3]. Garbage → []. */
export function parseNumbers(value) {
  if (typeof value !== 'string') return []
  const out = []
  for (const part of value.split(/[\s,，、]+/)) {
    if (!/^\d{1,4}$/.test(part)) continue
    const n = Number(part)
    if (n > 0 && !out.includes(n)) out.push(n)
  }
  return out
}

function parseAttrs(body) {
  const attrs = {}
  for (const m of (body ?? '').matchAll(ATTR_RE)) attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? ''
  return attrs
}

// Replace code (fenced blocks, indented blocks, inline spans) with spaces of
// the same length so offsets stay valid and nothing inside code matches.
// Code inside containers counts too (R1 XE-12): block quotes and list items.
//
// Block structure follows CommonMark line by line (R2 XE2-02): a stack of
// open containers (quote / list item with its content column) is matched on
// every line; a container the line does not continue is closed — and so is
// any code block opened inside it (a fence in `> ```` ends with the quote).
// Lazy paragraph continuation keeps the containers open. Not covered: HTML
// blocks, link reference definitions, setext headings, tabs past column 4.
const QUOTE_RE = /^ {0,3}> ?/
const ITEM_RE = /^( {0,3})([-*+]|\d{1,9}[.)])( +|$)/
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/
const HEADING_RE = /^ {0,3}#{1,6}(\s|$)/
const THEMATIC_RE = /^ {0,3}([-*_])( *\1){2,} *$/

/** Does this (container-stripped) line start a block, so it cannot be a lazy line? */
const startsBlock = (s) => QUOTE_RE.test(s) || FENCE_RE.test(s) || HEADING_RE.test(s) || THEMATIC_RE.test(s) || (ITEM_RE.test(s) && s.trim().length > 1)

function blankCode(text) {
  const blank = (s) => s.replace(/[^\n]/g, ' ')
  const lines = text.split('\n')
  const stack = [] // open containers: { quote: true } | { col } (list item content column)
  let fence = null // { ch, len, depth }: open fenced code and the container depth it lives at
  let indented = -1 // depth of an open indented code block, -1 = none
  let para = false // the previous line was paragraph text
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    let rest = line
    // 1. continue the open containers
    let matched = 0
    for (const c of stack) {
      if (c.quote) {
        const m = QUOTE_RE.exec(rest)
        if (!m) break
        rest = rest.slice(m[0].length)
      } else if (rest.trim() === '') {
        rest = ''
      } else {
        if (/^ */.exec(rest)[0].length < c.col) break
        rest = rest.slice(c.col)
      }
      matched++
    }
    if (matched < stack.length) {
      // a paragraph line may continue lazily inside containers it does not mark
      if (para && !fence && indented < 0 && rest.trim() !== '' && !startsBlock(rest)) continue
      stack.length = matched
      if (fence && fence.depth > matched) fence = null
      if (indented > matched) indented = -1
      para = false
    }
    // 2. inside a fenced code block: content or its closing fence
    if (fence) {
      lines[i] = blank(line)
      if (new RegExp(`^ {0,3}${fence.ch}{${fence.len},}\\s*$`).test(rest)) fence = null
      continue
    }
    // 3. new containers
    for (;;) {
      if (!para && indented < 0 && /^( {4}|\t)/.test(rest)) break // indented code, not a marker
      const q = QUOTE_RE.exec(rest)
      if (q) {
        stack.push({ quote: true })
        rest = rest.slice(q[0].length)
        para = false
        indented = -1
        continue
      }
      const item = ITEM_RE.exec(rest)
      if (item && !THEMATIC_RE.test(rest) && !(para && item[3] === '')) {
        const spaces = item[3].length
        // 5+ spaces after the marker (or none): the content starts 1 column on
        const col = item[1].length + item[2].length + (spaces >= 5 || spaces === 0 ? 1 : spaces)
        stack.push({ col })
        rest = rest.slice(Math.min(col, rest.length))
        para = false
        indented = -1
        continue
      }
      break
    }
    // 4. leaf blocks
    const isBlank = rest.trim() === ''
    const open = FENCE_RE.exec(rest)
    if (open) {
      fence = { ch: open[1][0] === '`' ? '`' : '~', len: open[1].length, depth: stack.length }
      lines[i] = blank(line)
      para = false
      indented = -1
      continue
    }
    if (!isBlank && !para && /^( {4}|\t)/.test(rest)) {
      indented = stack.length
      lines[i] = blank(line)
      continue
    }
    if (isBlank) {
      para = false
      continue
    }
    indented = -1
    para = !HEADING_RE.test(rest) && !THEMATIC_RE.test(rest)
  }
  let out = lines.join('\n')
  // Inline code spans: a run of N backticks closes on the next run of exactly N.
  out = out.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (m) => blank(m))
  return out
}

/** Every syntactically valid `::ann` marker in `answerText`, in order. */
export function parse(answerText) {
  if (typeof answerText !== 'string' || !answerText.includes('::')) return []
  const scan = blankCode(answerText)
  const out = []
  MARKER_RE.lastIndex = 0
  for (const m of scan.matchAll(MARKER_RE)) {
    const at = m.index ?? 0
    // A brace the body group refused (unclosed / too long) is not a directive.
    if (m[1] === undefined && scan[at + m[0].length] === '{') continue
    // `::annotate` is a different directive name.
    if (m[1] === undefined && /[a-z0-9-]/.test(scan[at + m[0].length] ?? '')) continue
    const attrs = parseAttrs(m[1])
    const b = typeof attrs.b === 'string' ? attrs.b.trim() : ''
    const ns = parseNumbers(attrs.n)
    if (!b || ns.length === 0) continue
    out.push({ b, ns, at })
  }
  return out
}

/**
 * Check one answer against the batch it should answer.
 * `batch` = { batchId, items } where items are the batch's annotations in sent
 * order (number = index + 1); an item with a non-blank comment is an
 * comment, otherwise a highlight. Markers for another batch, for numbers that
 * do not exist, or for highlights are ignored.
 */
export function reconcile(answerText, batch) {
  const comments = new Set()
  ;(batch?.items ?? []).forEach((item, i) => {
    if (typeof item?.comment === 'string' && item.comment.trim()) comments.add(i + 1)
  })
  const answered = new Set()
  let ownMarkers = 0
  for (const marker of parse(answerText)) {
    if (marker.b !== batch?.batchId) continue
    ownMarkers++
    for (const n of marker.ns) if (comments.has(n)) answered.add(n)
  }
  const missing = [...comments].filter((n) => !answered.has(n)).sort((a, b) => a - b)
  return { answered, missing, noMarkers: ownMarkers === 0 }
}
