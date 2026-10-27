// What 「复制」 puts on the clipboard (V2.1 #7). Pure; one formatter for the pin
// card and the drawer's 「复制为 Markdown」, so the two never drift.
//
//   CopyText.block({ text, comment })   → '> line\n> line' + ('\n\n' + words when there are words)
//   CopyText.forCard({ text, comment }) → { text, withComment }
//   CopyText.forAgent({ title, entries: [{ label, text, comment }] }) → one Markdown prompt
//       (复制给 AI, V2.1 #8): '# title', then per entry '## ① label' and its block()
//       a highlight (no words): the original only, unquoted — what you would select;
//       a comment: block(), the annotation as a whole.
//
// Every line of the original is quoted ('>' alone for a blank line), so a
// '>' or a code fence in it stays inside the quote.

export function quote(text) {
  return String(text ?? '')
    .split('\n')
    .map((l) => (l.trim() ? `> ${l}` : '>'))
    .join('\n')
}

export function block({ text, comment }) {
  const words = String(comment ?? '').trim()
  return words ? `${quote(text)}\n\n${words}` : quote(text)
}

export function forCard({ text, comment }) {
  const words = String(comment ?? '').trim()
  return words ? { text: block({ text, comment: words }), withComment: true } : { text: String(text ?? ''), withComment: false }
}

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'
const circled = (n) => (n >= 1 && n <= 20 ? CIRCLED[n - 1] : `(${n})`)

export function forAgent({ title, entries = [] }) {
  const lines = [`# ${title}`, '']
  entries.forEach((e, i) => {
    lines.push(`## ${circled(i + 1)} ${e.label ?? ''}`.trimEnd(), '', block(e), '')
  })
  return lines.join('\n')
}
