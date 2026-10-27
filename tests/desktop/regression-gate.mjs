// The P2 regression-id gate as a pure function (XR10-01), so its negative
// cases run on a mutated tree in memory. regression-ids.json:
//   ids           finding id → every test file that holds its test
//   privateFiles  those files that stay private (export-public EXCLUDED_TESTS)
//   privateOnly   the ids all of whose files are private
//
//   regressionGate(spec, { tree: 'private' | 'public', exists(f), read(f) }) → problems[]
//
// Private tree: every id, every listed file must exist and name the id, and
// at least one of them must define tests (case files / fixtures may be data). Public tree: only the privateOnly ids are skipped, and only the
// privateFiles are allowed to be absent. No fallback to "some file anywhere
// mentions it": the map names the tests, and the tests are checked.

const TEST_RE = /\btest\s*\(|\bit\s*\(|\bdef test_\w*\s*\(/
const names = (text, id) => new RegExp(`(^|[^\\w-])${id.replace(/[-]/g, '\\-')}(?![\\w-])`).test(text)

export function regressionGate(spec, { tree, exists, read }) {
  const problems = []
  const privateFiles = new Set(spec.privateFiles ?? [])
  const privateOnly = new Set(spec.privateOnly ?? [])
  for (const [id, files] of Object.entries(spec.ids ?? {})) {
    const allPrivate = files.length > 0 && files.every((f) => privateFiles.has(f))
    if (allPrivate !== privateOnly.has(id)) problems.push(`${id}: privateOnly says ${privateOnly.has(id)}, its files say ${allPrivate}`)
    if (tree === 'public' && privateOnly.has(id)) continue
    const scope = tree === 'public' ? files.filter((f) => !privateFiles.has(f)) : files
    if (!scope.length) problems.push(`${id}: no test file mapped in the ${tree} tree`)
    let tested = false
    for (const f of scope) {
      if (!exists(f)) problems.push(`${id}: ${f} is gone`)
      else {
        const text = read(f)
        if (!names(text, id)) problems.push(`${id}: ${f} no longer names it`)
        else if (TEST_RE.test(text)) tested = true
      }
    }
    // shared case files and fixtures may carry an id; one file must be a test
    if (scope.length && !tested) problems.push(`${id}: no mapped file that names it defines a test`)
  }
  for (const id of privateOnly) if (!spec.ids?.[id]) problems.push(`${id}: privateOnly but not mapped`)
  return problems
}
