// P2 (D1 §2 P2 "所有历史 regression ID 保留映射") and XR10-01: every review
// finding that has a test keeps it through the refactors. regression-ids.json
// maps each id to the test files that hold its test (see regression-gate.mjs).
// A refactor may move a test — then it moves the map entry too — never drop
// the last one for an id. The private tree checks every id and every file; the
// public tree skips only the ids marked privateOnly.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { ROOT } from './harness.mjs'
import { regressionGate } from './regression-gate.mjs'

const SPEC = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/desktop/regression-ids.json'), 'utf8'))
// the export script never ships: its presence is what makes this the private tree
const EXPORT_SCRIPT = path.join(ROOT, 'scripts/export-public.mjs')
const TREE = fs.existsSync(EXPORT_SCRIPT) ? 'private' : 'public'
const real = { exists: (f) => fs.existsSync(path.join(ROOT, f)), read: (f) => fs.readFileSync(path.join(ROOT, f), 'utf8') }
const ids = Object.keys(SPEC.ids)

test(`every regression id of the reviews still has its tests (${TREE} tree)`, () => {
  assert.ok(ids.length > 60)
  assert.deepEqual(regressionGate(SPEC, { tree: TREE, ...real }), [])
})

test('XR10-01 negative: deleting the last mapped test of ANY id fails the gate, in either tree', () => {
  for (const tree of ['private', 'public']) {
    for (const id of ids) {
      if (tree === 'public' && SPEC.privateOnly.includes(id)) continue
      const scope = SPEC.ids[id].filter((f) => tree === 'private' || !SPEC.privateFiles.includes(f))
      // delete the id's mapped files one after another; after the last one the gate must still be failing
      const gone = new Set()
      for (const f of scope) {
        gone.add(f)
        const problems = regressionGate(SPEC, { tree, exists: (x) => !gone.has(x), read: (x) => `test('x', () => {}) // ${SPEC.ids[id].includes(x) ? id : ''}` })
        assert.ok(problems.some((p) => p.startsWith(`${id}: `)), `${tree} ${id} without ${[...gone]}`)
      }
    }
  }
})

test('XR10-01 negative: a mapped file that no longer names the id, or holds no test, fails', () => {
  const read = (f) => real.read(f)
  const [id] = ids.filter((i) => !SPEC.privateOnly.includes(i))
  const f = SPEC.ids[id][0]
  const strip = (x) => (x === f ? read(x).replaceAll(id, 'GONE') : read(x))
  assert.ok(regressionGate(SPEC, { tree: 'private', exists: real.exists, read: strip }).includes(`${id}: ${f} no longer names it`))
  const one = ids.find((i) => !SPEC.privateOnly.includes(i) && SPEC.ids[i].length === 1)
  const g = SPEC.ids[one][0]
  const noTest = (x) => (x === g ? `// ${one}\n` : read(x))
  assert.ok(regressionGate(SPEC, { tree: 'public', exists: real.exists, read: noTest }).includes(`${one}: no mapped file that names it defines a test`))
})

test('XR10-01 negative: privateOnly is explicit — an id with a public file cannot hide behind it', () => {
  const id = 'XV9-01'
  const spec = { ...SPEC, privateOnly: [...SPEC.privateOnly, id] }
  assert.ok(regressionGate(spec, { tree: 'private', ...real }).some((p) => p.startsWith(`${id}: privateOnly says true`)))
})

test('private tree: privateFiles are exactly the mapped files the export leaves out', { skip: TREE === 'public' }, async () => {
  const { EXCLUDED_TESTS } = await import(pathToFileURL(EXPORT_SCRIPT).href)
  const mapped = [...new Set(Object.values(SPEC.ids).flat())].sort()
  assert.deepEqual([...SPEC.privateFiles].sort(), mapped.filter((f) => EXCLUDED_TESTS.includes(f)))
})

test('private tree: every finding id the code reviews name is in the map (XV-05 was missed once)', { skip: TREE === 'public' }, () => {
  const dir = path.join(ROOT, 'docs/research')
  const named = new Set()
  for (const f of fs.readdirSync(dir)) {
    if (!/^代码审查-.*\.md$/.test(f)) continue
    for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/\b(X[A-Z]+\d*-\d+)\b/g)) named.add(m[1])
  }
  assert.ok(named.size > 40)
  assert.deepEqual([...named].filter((id) => !SPEC.ids[id]).sort(), [])
})
