import test from 'node:test'
import assert from 'node:assert/strict'

import { PassageLook } from '../src/index.js'

test('V2.1 #4: a passage box breaks long words, scrolls code and tables sideways, scrolls past its max height', () => {
  const css = PassageLook.css('.q', { maxHeight: '8em' })
  assert.match(css, /^\.q\{[^}]*overflow-wrap:anywhere/m)
  assert.match(css, /^\.q\{[^}]*max-height:8em;[^}]*overflow-y:auto/m)
  assert.match(css, /^\.q\{[^}]*mask-image:none/m, 'no clipping mask')
  assert.match(css, /^\.q pre\{[^}]*overflow-x:auto/m)
  assert.match(css, /^\.q table\{[^}]*display:block;max-width:100%;overflow-x:auto/m)
  assert.match(css, /^\.q :not\(pre\)>code\{[^}]*overflow-wrap:anywhere/m)
})

test('a selector list scopes every rule to each part', () => {
  const css = PassageLook.css('.a, .b')
  assert.match(css, /^\.a pre,\.b pre\{/m)
  assert.match(css, /^\.a,\.b\{/m)
})
