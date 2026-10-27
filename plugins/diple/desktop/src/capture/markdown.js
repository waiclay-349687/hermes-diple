/*! Portions adapted from quote-ask (https://github.com/freefate258/quote-ask), MIT License, Copyright (c) 2026 freefate258 */
// Selection → Markdown. Adapted from quote-ask (freefate258/quote-ask,
// desktop/plugin.js, MIT — see capture/THIRD_PARTY_NOTICES.md). Changes from the
// original: no 4000-char cut (Envelope trims long text), table header
// separators and escaped pipes, headings and block quotes, host chrome
// (buttons, icons, column handles) skipped, pre-line text (user bubbles)
// keeps its newlines, and a selection that sits wholly inside a code block
// is still fenced.
//
//   rangeToMarkdown(range) → string (trimmed; '' when nothing quotable)

const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'DD', 'DETAILS', 'DIV', 'DL', 'DT', 'FIGCAPTION', 'FIGURE',
  'FOOTER', 'FORM', 'HEADER', 'LI', 'MAIN', 'NAV', 'P', 'SECTION', 'SUMMARY'
])

// Host chrome inside messages that is not message text.
const SKIP_SELECTOR = [
  'button',
  'svg',
  'style',
  'script',
  '[aria-hidden="true"]',
  '[data-md-col-handle]',
  '[data-slot="tool-block"]',
  '[data-slot="aui_thinking-disclosure"]',
  '[data-slot="aui_reasoning-text"]',
  '[data-slot="aui_turn-activity"]',
  '[data-slot="aui_msg-actions"]',
  '[data-diple-ui]'
].join(',')

// Elements whose text keeps its line breaks (user bubbles are white-space: pre-line).
const PRE_LINE_SELECTOR = '[data-slot="aui_user-inline-text"],[data-slot="aui_directive-text"],.whitespace-pre-line,.whitespace-pre-wrap'

const tagOf = (node) => (node.tagName || '').toUpperCase()

function fenceLanguage(pre) {
  const holders = [pre, ...pre.querySelectorAll('code, pre'), pre.closest?.('[data-language]')].filter(Boolean)
  for (const el of holders) {
    const lang = el.getAttribute?.('data-language')
    if (lang) return lang
    const m = String(el.className || '').match(/(?:language|lang)-([\w+#.-]+)/)
    if (m) return m[1]
  }
  return ''
}

function fence(code, lang = '') {
  // Only the newline that ends the last line goes; blank lines the code ends
  // with are part of it (R2 XE-11).
  const body = code.replace(/\n$/, '')
  if (!body.trim()) return ''
  // longer than any backtick run inside, so the content cannot close it
  let longest = 2
  for (const m of body.matchAll(/`+/g)) longest = Math.max(longest, m[0].length)
  const ticks = '`'.repeat(longest + 1)
  return `\n\n${ticks}${lang}\n${body}\n${ticks}\n\n`
}

function cellText(cell, ctx) {
  return walkChildren(cell, ctx).replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|')
}

function tableToMarkdown(table, ctx) {
  const rows = [...table.querySelectorAll('tr')].filter((tr) => tr.closest('table') === table)
  if (!rows.length) return ''
  const lines = []
  rows.forEach((tr, i) => {
    const cells = [...tr.children].filter((c) => /^T[HD]$/.test(tagOf(c)))
    lines.push(`| ${cells.map((c) => cellText(c, ctx)).join(' | ')} |`)
    const isHeader = i === 0 && (tr.closest('thead') || cells.every((c) => tagOf(c) === 'TH'))
    if (i === 0) lines.push(`| ${cells.map(() => '---').join(' | ')} |`)
    else if (isHeader) lines.push('')
  })
  return `\n\n${lines.join('\n')}\n\n`
}

function listToMarkdown(list, ctx, depth) {
  const pad = '  '.repeat(depth)
  const ordered = tagOf(list) === 'OL'
  const start = Number(list.getAttribute('start')) || 1
  return [...list.children]
    .filter((c) => tagOf(c) === 'LI')
    .map((item, i) => {
      const nested = [...item.children].filter((c) => tagOf(c) === 'UL' || tagOf(c) === 'OL')
      const lead = [...item.childNodes]
        .filter((c) => !nested.includes(c))
        .map((c) => walk(c, ctx, depth))
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
      const head = pad + (ordered ? `${start + i}. ` : '- ') + lead
      return [head, ...nested.map((n) => listToMarkdown(n, ctx, depth + 1))].join('\n')
    })
    .join('\n')
}

function walkChildren(node, ctx, depth = 0) {
  return [...node.childNodes].map((c) => walk(c, ctx, depth)).join('')
}

function walk(node, ctx, depth = 0) {
  if (node.nodeType === 3) {
    const v = node.nodeValue || ''
    return ctx.pre ? v.replace(/[ \t]+/g, ' ') : v.replace(/\s+/g, ' ')
  }
  if (node.nodeType !== 1 && node.nodeType !== 11) return ''
  if (node.nodeType === 1 && node.matches?.(SKIP_SELECTOR)) return ''
  const sd = node.nodeType === 1 ? node.getAttribute?.('data-streamdown') : null
  const tag = sd === 'strong' ? 'STRONG' : sd === 'inline-code' ? 'CODE' : tagOf(node)
  const inner = (c = ctx) => walkChildren(node, c, depth)
  if (node.nodeType === 1 && !ctx.pre && node.matches?.(PRE_LINE_SELECTOR)) return inner({ ...ctx, pre: true })
  switch (tag) {
    case 'BR':
      return '\n'
    case 'HR':
      return '\n\n---\n\n'
    case 'PRE': {
      if (ctx.code) return node.textContent || ''
      return fence(node.textContent || '', fenceLanguage(node))
    }
    case 'CODE':
      if (ctx.code) return node.textContent || ''
      return /\n/.test(node.textContent || '') ? fence(node.textContent || '') : `\`${(node.textContent || '').replace(/\s+/g, ' ')}\``
    case 'STRONG':
    case 'B':
      return wrapInline('**', inner())
    case 'EM':
    case 'I':
      return wrapInline('*', inner())
    case 'DEL':
    case 'S':
      return wrapInline('~~', inner())
    case 'IMG': {
      const src = node.getAttribute('src') || ''
      return /^https?:/i.test(src) ? `![${node.getAttribute('alt') || ''}](${src})` : node.getAttribute('alt') || ''
    }
    case 'A': {
      const href = node.getAttribute('href') || ''
      const label = inner()
      return /^https?:\/\//i.test(href) && label.trim() ? `[${label.trim()}](${href})` : label
    }
    case 'H1':
    case 'H2':
    case 'H3':
    case 'H4':
    case 'H5':
    case 'H6':
      return `\n\n${'#'.repeat(Number(tag[1]))} ${inner().replace(/\s+/g, ' ').trim()}\n\n`
    case 'BLOCKQUOTE': {
      const body = tidy(inner())
      return body ? `\n\n${body.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n')}\n\n` : ''
    }
    case 'UL':
    case 'OL':
      return `\n\n${listToMarkdown(node, ctx, depth)}\n\n`
    case 'TABLE':
      return tableToMarkdown(node, ctx)
    case 'TR': // a row cloned without its table (partial selection inside one table)
      return `| ${[...node.children].map((c) => cellText(c, ctx)).join(' | ')} |\n`
    case 'TD':
    case 'TH':
      return inner()
    default: {
      // shiki code cards: <div data-slot="code-card"> … <pre> — handled by PRE.
      if (node.nodeType === 1 && node.getAttribute?.('data-slot') === 'code-card') {
        const pre = node.querySelector('pre')
        return pre ? fence(pre.textContent || '', fenceLanguage(node)) : ''
      }
      return BLOCK_TAGS.has(tag) ? `\n${inner()}\n` : inner()
    }
  }
}

function wrapInline(mark, text) {
  const m = text.match(/^(\s*)([\s\S]*?)(\s*)$/)
  return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : text
}

// Prose is tidied; code is verbatim (R1 XE-11): inside a fence no trailing
// space is dropped, no blank line collapsed, no NBSP replaced.
function tidy(text) {
  const out = []
  let fenceTicks = null
  let blanks = 0
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    if (fenceTicks) {
      out.push(raw)
      if (new RegExp(`^\\s*${fenceTicks}\\s*$`).test(raw)) {
        out[out.length - 1] = raw.trim()
        fenceTicks = null
      }
      continue
    }
    const open = /^\s*(`{3,})/.exec(raw)
    if (open) {
      fenceTicks = open[1]
      blanks = 0
      out.push(raw.trim())
      continue
    }
    // Prose: drop stray leading spaces left by collapsed whitespace, but keep
    // the indentation of nested list items.
    const line = raw.replace(/\u00a0/g, ' ')
    const clean = (/^ {2,}([-*] |\d+\. )/.test(line) ? line : line.replace(/^[ \t]+/, '')).replace(/[ \t]+$/, '')
    if (!clean) {
      if (++blanks > 1) continue // at most one blank line between prose blocks
    } else blanks = 0
    out.push(clean)
  }
  while (out.length && !out[0]) out.shift()
  while (out.length && !out[out.length - 1]) out.pop()
  return out.join('\n')
}

/** The nearest element ancestor of a range end. */
function elementOf(node) {
  return node?.nodeType === 1 ? node : node?.parentElement ?? null
}

/** Serialize a DOM Range of message content to Markdown. */
export function rangeToMarkdown(range) {
  const common = elementOf(range.commonAncestorContainer)
  const inPre = common?.closest?.('pre')
  const pre = Boolean(common?.closest?.(PRE_LINE_SELECTOR))
  const fragment = range.cloneContents()
  if (inPre) {
    // Wholly inside one code block: the fragment has no <pre>; fence it here.
    const code = fragment.textContent || ''
    if (!code.trim()) return ''
    if (!code.includes('\n')) return `\`${code.trim()}\``
    return tidy(fence(code, fenceLanguage(inPre.closest('[data-slot="code-card"]') ?? inPre)))
  }
  return tidy(walk(fragment, { pre, code: false }))
}

export { SKIP_SELECTOR }
