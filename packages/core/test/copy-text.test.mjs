// V2.1 #7: what 「复制」 puts on the clipboard — one formatter for the pin card
// and the drawer's 「复制为 Markdown」.
import test from 'node:test'
import assert from 'node:assert/strict'

import { CopyText } from '../src/index.js'

test('a highlight copies the original only, as it is', () => {
  assert.deepEqual(CopyText.forCard({ text: '原文 **加粗**', comment: '' }), { text: '原文 **加粗**', withComment: false })
  assert.deepEqual(CopyText.forCard({ text: '原文', comment: '  \n ' }), { text: '原文', withComment: false }, 'blank words = a highlight')
})

test('a comment copies Markdown: the original as a quote, a blank line, the words', () => {
  assert.deepEqual(CopyText.forCard({ text: '原文', comment: '意见' }), { text: '> 原文\n\n意见', withComment: true })
})

test('every line of a multi-line original is quoted; blank lines stay in the quote', () => {
  assert.equal(CopyText.block({ text: '第一行\n第二行\n\n第四行', comment: '多行\n意见' }), '> 第一行\n> 第二行\n>\n> 第四行\n\n多行\n意见')
})

test('an original that already has > or a code fence stays intact inside the quote', () => {
  assert.equal(CopyText.block({ text: '> 引用\n```js\nconst a = 1\n```', comment: '看这里' }), '> > 引用\n> ```js\n> const a = 1\n> ```\n\n看这里')
})

test('block() with no words is just the quote (the drawer lists highlights too)', () => {
  assert.equal(CopyText.block({ text: 'a\nb', comment: '' }), '> a\n> b')
})
