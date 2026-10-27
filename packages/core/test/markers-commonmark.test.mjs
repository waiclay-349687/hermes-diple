// R2 XE2-02: markers vs the CommonMark block structure, checked against a
// real CommonMark parser (markdown-it-py in the Hermes venv) when available.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { parse, reconcile } from '../src/markers.js'

const M = '::ann{b="oldbatch" n="1"}'
const b = { batchId: 'oldbatch', items: [{ comment: '请回答' }] }

// [name, text, markers the host renders as directives (outside code)]
const corpus = [
  ['quote fence closed by the quote ending', `> \`\`\`\n> code\n\n${M}\n\n这是实际回应。`, 1],
  ['list fence closed by the item ending', `- \`\`\`\n  code\n\n${M}\n\n这是实际回应。`, 1],
  ['quote fence closed by a line without >', `> \`\`\`\n> code\n${M}`, 1],
  ['list fence closed by an unindented line', `- \`\`\`\n  code\n${M}`, 1],
  ['nested list in quote', `> - \`\`\`\n>   code\n\n${M}`, 1],
  ['inner quote ends, outer continues', `> > \`\`\`\n> > x\n> ${M}`, 1],
  ['marker inside a quoted fence', `> \`\`\`\n> code\n> ${M}`, 0],
  ['marker inside a list fence, one after it', `1. \`\`\`\n   x\n   ${M}\n   \`\`\`\n\n${M}`, 1],
  ['blank line inside a list fence', `- \`\`\`\n  a\n\n  ${M}\n  \`\`\``, 0],
  ['unclosed top-level fence swallows the rest', `\`\`\`\ncode\n\n${M}`, 0],
  ['tilde fence in quote, longer closer', `> ~~~\n> ${M}\n> ~~~~\n\n${M}`, 1],
  ['indented code in quote', `>     ${M}`, 0],
  ['indented code in a list item', `- a\n\n      ${M}`, 0],
  ['paragraph in a list item (2-space content)', `- a\n\n    ${M}`, 1],
  ['5 spaces after the marker: item is code', `-     ${M}`, 0],
  ['lazy continuation in a quote', `> para\n${M}`, 1],
  ['lazy continuation in a list item', `- item\n${M}`, 1],
  ['sibling items', `- \`\`\`\n  x\n- ${M} b`, 1],
  ['top-level indented code', `para\n\n    ${M}`, 0],
  ['indented line continuing a paragraph', `para\n    ${M}`, 1],
  ['after a heading, indented code', `# 标题\n    ${M}`, 0],
  ['inline code', `write \`${M}\` like this`, 0],
  ['plain', `${M}\n\n回应`, 1],
  ['paragraph after a list', `- a\n\n${M}`, 1],
  ['quote then fence at top level', `> q\n\n\`\`\`\n${M}\n\`\`\`\n\n${M}`, 1],
  ['ordered item with 4-space content', `10. \`\`\`\n    x\n\n${M}`, 1]
]

test('XE2-02: a fence inside a block quote or list item ends with its container', () => {
  for (const [name, text, n] of corpus) {
    assert.equal(parse(text).length, n, name)
  }
  // the reviewer's two cases, through reconcile
  for (const text of [corpus[0][1], corpus[1][1]]) {
    const r = reconcile(text, b)
    assert.deepEqual([...r.answered], [1], text)
    assert.equal(r.noMarkers, false)
  }
})

// Differential check: a real CommonMark parser decides which markers sit in
// code. Uses markdown-it-py from the Hermes venv when it is there.
const venvPython = path.join(process.env.HERMES_AGENT_ROOT ?? path.join(os.homedir(), '.hermes/hermes-agent'), 'venv/bin/python')
const PY = String.raw`
import json, re, sys
from markdown_it import MarkdownIt
md = MarkdownIt('commonmark')
RE = re.compile(r'(?<!\S)::ann\{')
out = []
for text in json.load(sys.stdin):
    n = 0
    for tok in md.parse(text):
        if tok.type != 'inline':
            continue
        # text outside code spans, joined across soft breaks
        buf = ''
        for ch in tok.children or []:
            if ch.type == 'text':
                buf += ch.content
            elif ch.type in ('softbreak', 'hardbreak'):
                buf += '\n'
            else:
                buf += ' '
        n += len(RE.findall(buf))
    out.append(n)
print(json.dumps(out))
`
const hasMarkdownIt = fs.existsSync(venvPython) && spawnSync(venvPython, ['-c', 'import markdown_it'], { encoding: 'utf8' }).status === 0

test('XE2-02: agrees with a CommonMark parser (markdown-it-py) on the corpus', { skip: !hasMarkdownIt && 'markdown-it-py not available' }, () => {
  const r = spawnSync(venvPython, ['-c', PY], { input: JSON.stringify(corpus.map((c) => c[1])), encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const expected = JSON.parse(r.stdout)
  corpus.forEach(([name, text, n], i) => {
    assert.equal(n, expected[i], `corpus expectation vs CommonMark: ${name}`)
    assert.equal(parse(text).length, expected[i], `parse vs CommonMark: ${name}`)
  })
})
