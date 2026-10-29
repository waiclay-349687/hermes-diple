// V3-D3 guard: no focus in the document page or desktop-kit may scroll the page.
// The document pane is the scroll container and the list is sticky in it: a
// focus() without { preventScroll: true } on a card, the list or an editor that
// is not placed yet scrolls the pane to the element's static place — the top of
// the document (V3-D3 #1: the root cause of "标注 jumps to the top").
// The check reads the syntax tree (acorn + acorn-jsx), not the text, so spacing,
// optional chaining, computed keys and aliases do not get past it (R11 XR11-08).
// A focus that must scroll goes in ALLOWED with the reason (none today).
// Computed loads reviewed: see the override in publish/public-export-manifest.json.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as acorn from 'acorn'
import acornJsx from 'acorn-jsx'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
// desktop-kit and every plugin in this tree, the chat one too (R11-K: a menu's focus
// back to its trigger scrolled the thread). Read from the tree, so the file means the
// same in a checkout without the docs plugin.
const DIRS = [
  'packages/desktop-kit/src',
  ...fs
    .readdirSync(path.join(ROOT, 'plugins'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(ROOT, 'plugins', e.name, 'desktop/src')))
    .map((e) => path.posix.join('plugins', e.name, 'desktop/src'))
]
// 'file:line' → why this one passes (reviewed by hand, R11-K): none moves DOM focus
// without preventScroll. Each plugin keeps its own list in desktop/focus-allow.json,
// so the list travels with the plugin and this shared file names no plugin.
// A list that is not JSON, or holds a key or reason it should not, fails the guard
// (R11-L, K-01): it never silently turns the guard off.
const ALLOW_KEY = /^src\/[^:]+:\d+$/
/**
 * The entries of one focus-allow.json: { allowed: Map('src/…:line' → reason), errors }.
 * Keys are paths inside the plugin's desktop/ (no '..', not absolute) with a line; each
 * once, each with a reason.
 */
export function readAllowList(raw, file = 'focus-allow.json') {
  const errors = []
  const allowed = new Map()
  let doc
  try {
    doc = JSON.parse(raw)
  } catch (e) {
    return { allowed, errors: [`${file}: not JSON (${e.message})`] }
  }
  const list = doc?.allowed
  if (!list || typeof list !== 'object' || Array.isArray(list)) return { allowed, errors: [`${file}: "allowed" must be an object of 'src/<path>:<line>' → reason`] }
  for (const [k, why] of Object.entries(list)) {
    if (!ALLOW_KEY.test(k) || k.split(/[/:]/).includes('..') || k.includes('\\') || k.includes('//')) errors.push(`${file}: ${JSON.stringify(k)}: a key is src/<path inside desktop/>:<line> (no '..', not absolute)`)
    else if (typeof why !== 'string' || !why.trim()) errors.push(`${file}: ${k}: no reason`)
    else allowed.set(k, why)
  }
  // JSON.parse keeps the last of two equal keys: count them in the text
  const once = new Set()
  for (const m of raw.matchAll(/"((?:[^"\\]|\\.)*)"\s*:/g)) {
    const k = JSON.parse(`"${m[1]}"`)
    if (!(k in list)) continue
    if (once.has(k)) errors.push(`${file}: ${k}: listed twice`)
    once.add(k)
  }
  return { allowed: errors.length ? new Map() : allowed, errors }
}
const ALLOWED = new Map()
const ALLOW_ERRORS = []
for (const dir of DIRS) {
  if (!dir.startsWith('plugins/')) continue
  const desktop = path.posix.dirname(dir)
  const file = path.join(ROOT, desktop, 'focus-allow.json')
  if (!fs.existsSync(file)) continue // a plugin without a list allows nothing
  const { allowed, errors } = readAllowList(fs.readFileSync(file, 'utf8'), `${desktop}/focus-allow.json`)
  ALLOW_ERRORS.push(...errors)
  for (const [key, why] of allowed) ALLOWED.set(`${desktop}/${key}`, why)
}

const Parser = acorn.Parser.extend(acornJsx())
const parse = (src) => Parser.parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true, allowAwaitOutsideFunction: true, locations: true })

function walk(node, visit, parent = null) {
  if (!node || typeof node.type !== 'string') return
  visit(node, parent)
  for (const key of Object.keys(node)) {
    if (key === 'loc') continue
    const v = node[key]
    if (Array.isArray(v)) for (const c of v) walk(c, visit, node)
    else if (v && typeof v.type === 'string') walk(v, visit, node)
  }
}
const literal = (n) => (n?.type === 'Literal' ? n.value : n?.type === 'TemplateLiteral' && n.expressions.length === 0 ? n.quasis[0].value.cooked : undefined)
/** The name of a property key: `a.b`, `a['b']`, `{ b: … }`, `{ 'b': … }`; undefined when computed. */
const keyName = (key, computed) => (!computed && key.type === 'Identifier' ? key.name : literal(key))
const isFocusMember = (n) => n?.type === 'MemberExpression' && keyName(n.property, n.computed) === 'focus'
const unwrap = (n) => (n?.type === 'ChainExpression' ? n.expression : n)

/**
 * Whether focus options leave the page where it is: an object literal whose LAST
 * preventScroll is the literal true and comes after every spread and computed key
 * (one after it, or without it, may turn it off).
 */
export function preventsScroll(arg) {
  if (arg?.type !== 'ObjectExpression') return false
  let last = -1
  let lastUnknown = -1
  let value
  arg.properties.forEach((p, i) => {
    if (p.type === 'SpreadElement') lastUnknown = i
    else if (keyName(p.key, p.computed) === 'preventScroll') {
      last = i
      value = p.value
    } else if (p.computed && keyName(p.key, p.computed) === undefined) lastUnknown = i // [k]: v may be preventScroll
  })
  return last > lastUnknown && value?.type === 'Literal' && value.value === true
}

/**
 * Every focus in a source file that may scroll: { line, kind, text }.
 * kind: 'call' (a focus call without { preventScroll: true }), 'alias' (focus read
 * without being called on the spot: bound, stored, passed, destructured),
 * 'computed' (a call whose computed key might be focus),
 * 'autoFocus' (JSX attribute or createElement prop, unless literally false).
 */
export function focusProblems(src) {
  const lines = src.split('\n')
  const out = []
  const add = (n, kind) => out.push({ line: n.loc.start.line, kind, text: lines[n.loc.start.line - 1].trim() })
  // a read of .focus whose value is only compared or tested (opts.focus !== false,
  // typeof el.focus, if (opts.focus)) cannot call it; any other read may store it
  const VALUE_ONLY = new Set(['BinaryExpression', 'UnaryExpression', 'IfStatement', 'ConditionalExpression', 'WhileStatement', 'TemplateLiteral'])
  const valueOnly = (node, parent) => VALUE_ONLY.has(parent?.type) && !(parent.type === 'ConditionalExpression' && parent.test !== node)
  walk(parse(src), (n, parent) => {
    if (n.type === 'CallExpression') {
      const c = unwrap(n.callee)
      // No constant folding or guessing bindings: el[key]() may call focus,
      // even when a variable happens to be initialized to 'blur' today.
      if (c?.type === 'MemberExpression' && c.computed && keyName(c.property, true) === undefined) {
        add(n, 'computed')
        return
      }
      if (isFocusMember(c)) {
        if (!preventsScroll(n.arguments[0])) add(n, 'call')
        return
      }
    }
    // el.focus / el?.focus not called on the spot (the chain node is what the parent sees)
    const member = isFocusMember(n) && !(parent?.type === 'ChainExpression') ? n : n.type === 'ChainExpression' && isFocusMember(n.expression) ? n : null
    if (member) {
      const callee = parent?.type === 'CallExpression' && parent.callee === member
      if (!callee && !valueOnly(member, parent)) add(member, 'alias')
      return
    }
    // const { focus } = el  /  ({ focus: f } = el); an options-bag parameter ({ focus = true } = {}) is not one
    const destructured = (parent?.type === 'VariableDeclarator' && parent.id === n) || (parent?.type === 'AssignmentExpression' && parent.left === n)
    if (n.type === 'ObjectPattern' && destructured) for (const p of n.properties) if (p.type === 'Property' && keyName(p.key, p.computed) === 'focus') add(p, 'alias')
    if (n.type === 'JSXAttribute' && /^autofocus$/i.test(n.name.name ?? '')) {
      const v = n.value?.type === 'JSXExpressionContainer' ? n.value.expression : n.value
      if (!(v?.type === 'Literal' && v.value === false)) add(n, 'autoFocus')
    }
    if (n.type === 'Property' && parent?.type === 'ObjectExpression' && /^autofocus$/i.test(keyName(n.key, n.computed) ?? '')) {
      if (!(n.value.type === 'Literal' && n.value.value === false)) add(n, 'autoFocus')
    }
  })
  return out
}

function files(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...files(p))
    else if (/\.(m?js|jsx)$/.test(e.name)) out.push(p)
  }
  return out
}

const kinds = (src) => focusProblems(src).map((p) => p.kind)

test('focusProblems: every way to focus without { preventScroll: true } is caught (R11 XR11-08)', () => {
  for (const [src, want] of [
    ['el.focus()', ['call']],
    ['el.focus?.()', ['call']],
    ['el?.focus()', ['call']],
    ['el.focus ()', ['call']],
    ['el.focus\n  ()', ['call']],
    ["el['focus']()", ['call']],
    ['el[`focus`]()', ['call']],
    ["el?.['focus']?.()", ['call']],
    ['el.focus({})', ['call']],
    ['el.focus(opts)', ['call']],
    ['el.focus({ preventScroll: false })', ['call']],
    ['el.focus({ preventScroll: 1 })', ['call']],
    ['el.focus({ preventScroll: !0 })', ['call']],
    ['el.focus({ preventScroll: yes })', ['call']],
    ['el.focus({ preventScroll: true, preventScroll: false })', ['call']],
    ['el.focus({ preventScroll: true, ...options })', ['call']],
    ['el.focus({ ...options })', ['call']],
    ['el.focus({ preventScroll: true, [key]: v })', ['call']],
    ['const f = el.focus.bind(el); f()', ['alias']],
    ['const f = el.focus; f.call(el)', ['alias']],
    ['el.focus.call(el, { preventScroll: true })', ['alias']],
    ['const { focus } = el; focus()', ['alias']],
    ["const { ['focus']: f } = el", ['alias']],
    ['run(el.focus)', ['alias']],
    ['const f = el?.focus', ['alias']],
    ['const f = ok && el.focus', ['alias']],
    ['const x = <Input autoFocus />', ['autoFocus']],
    ['const x = <input autofocus="" />', ['autoFocus']],
    ['const x = <Input autoFocus={open} />', ['autoFocus']],
    ["createElement('input', { autoFocus: true })", ['autoFocus']]
  ]) assert.deepEqual(kinds(src), want, src)
})

test('XR11b-08: computed calls fail closed unless the key is a known non-focus constant', () => {
  for (const src of [
    "const prop = 'focus'; el[prop]()",
    'el[prop]?.()',
    'el?.[prop]()',
    'el?.[prop]?.()',
    "el['fo' + 'cus']()",
    'el[`${key}`]()',
    'el[prop]({ preventScroll: true })'
  ]) assert.deepEqual(kinds(src), ['computed'], src)
  for (const src of ["el['blur']()", 'el[`blur`]?.()', 'el[0]()', 'el[null]()']) assert.deepEqual(kinds(src), [], src)
})

test('focusProblems: a focus that keeps the page still passes', () => {
  for (const src of [
    'el.focus({ preventScroll: true })',
    'el.focus?.({ preventScroll: true })',
    'el?.focus({ preventScroll: true })',
    "el['focus']({ 'preventScroll': true })",
    'el.focus({ preventScroll: false, preventScroll: true })',
    'el.focus({ ...options, preventScroll: true })',
    'el.focus({ focusVisible: true, preventScroll: true })',
    '// el.focus()\n/* el.focus() */',
    "const s = 'el.focus()'",
    'const x = <Input autoFocus={false} />',
    'const o = { focus: () => 1 }; class A { focus() {} }',
    'rt.focusCard(key, id, { focus: false })',
    'el.addEventListener("focus", f); el.onfocus = f',
    // an options bag named focus, only read as a value
    'function f(el, { focus = true, smooth = false } = {}) {}',
    'go(el, { focus: opts?.focus !== false })',
    "if (typeof el.focus === 'function') go()",
    'if (opts.focus) go()'
  ]) assert.deepEqual(focusProblems(src), [], src)
})

test('focus-allow.json: keys src/<path>:<line> inside the plugin, each once with a reason; not JSON or a bad entry fails (K-01)', () => {
  const ok = readAllowList(JSON.stringify({ '//': 'note', allowed: { 'src/a/b.jsx:12': 'why', 'src/c.js:3': 'why too' } }))
  assert.deepEqual(ok.errors, [])
  assert.deepEqual([...ok.allowed.keys()], ['src/a/b.jsx:12', 'src/c.js:3'])
  assert.deepEqual(readAllowList(JSON.stringify({ allowed: {} })).errors, [])
  for (const [raw, want] of [
    ['{ "allowed": { "src/a.js:1": "x", }', /not JSON/],
    ['', /not JSON/],
    ['{}', /"allowed" must be an object/],
    ['{ "allowed": [] }', /"allowed" must be an object/],
    ['{ "allowed": { "src/a.js:1": "x", "src/a.js:1": "y" } }', /listed twice/],
    ['{ "allowed": { "src/a.js:1": "x", "src\\u002fa.js:1": "y" } }', /listed twice/],
    ['{ "allowed": { "src/../../p/desktop/src/a.js:1": "x" } }', /no '\.\.'/],
    ['{ "allowed": { "src/a/../b.js:1": "x" } }', /no '\.\.'/],
    ['{ "allowed": { "/abs/src/a.js:1": "x" } }', /not absolute/],
    ['{ "allowed": { "plugins/p/desktop/src/a.js:1": "x" } }', /a key is src/],
    ['{ "allowed": { "src/a.js": "x" } }', /a key is src/],
    ['{ "allowed": { "src/a.js:1:2": "x" } }', /a key is src/],
    ['{ "allowed": { "src/a.js:x": "x" } }', /a key is src/],
    ['{ "allowed": { "src//a.js:1": "x" } }', /a key is src/],
    ['{ "allowed": { "src/a.js:1": "" } }', /no reason/],
    ['{ "allowed": { "src/a.js:1": 1 } }', /no reason/]
  ]) {
    const r = readAllowList(raw)
    assert.match(r.errors.join('\n'), want, raw)
    assert.equal(r.allowed.size, 0, `${raw}: a list with an error allows nothing`)
  }
  // the lists of this tree
  assert.deepEqual(ALLOW_ERRORS, [])
})

test('every focus in both plugins and desktop-kit passes { preventScroll: true } (or is allowed, with a reason)', () => {
  assert.deepEqual(ALLOW_ERRORS, [], 'a focus-allow.json is broken: the guard cannot run on it')
  const bad = []
  let calls = 0
  for (const dir of DIRS) {
    for (const f of files(path.join(ROOT, dir))) {
      const rel = path.relative(ROOT, f).split(path.sep).join('/')
      const src = fs.readFileSync(f, 'utf8')
      walk(parse(src), (n) => {
        if (n.type === 'CallExpression' && isFocusMember(unwrap(n.callee))) calls++
      })
      for (const p of focusProblems(src)) if (!ALLOWED.has(`${rel}:${p.line}`)) bad.push(`${rel}:${p.line}  [${p.kind}]  ${p.text}`)
    }
  }
  assert.ok(calls >= 2, `scanned ${calls} focus calls`)
  assert.deepEqual(bad, [], `focus that may scroll the page:\n${bad.join('\n')}`)
  // an entry whose line moved is stale: it would hide the next focus put there
  const seen = new Set()
  for (const dir of DIRS) for (const f of files(path.join(ROOT, dir))) for (const p of focusProblems(fs.readFileSync(f, 'utf8'))) seen.add(`${path.relative(ROOT, f).split(path.sep).join('/')}:${p.line}`)
  assert.deepEqual([...ALLOWED.keys()].filter((k) => !seen.has(k)), [], 'stale ALLOWED entries (a line moved, or the file is gone)')
})
