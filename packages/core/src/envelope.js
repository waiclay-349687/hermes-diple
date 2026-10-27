// Envelope: turns a batch of annotations into the two texts of one send.
//
// Interface:
//   compose({ body, items, batchId, lang?, sessionId? }) → { display, full, stats }
//
//   sessionId — the session the batch is sent into: an annotation from any other
//             session is labelled with that session (title, or a short id).
//
//   display — what the chat bubble shows: the body, a divider, one short line
//             per annotation (number, origin, opening ~40 chars), its comment on
//             the next line, and `@diple:<batchId>` as the last line. The
//             host expands that reference into `full` (ADR 0006). Copied text
//             (openings, comments, titles) is made inert: an `@kind:` in it
//             gets a WORD JOINER after the `@`, so the host never expands it.
//   full    — what the AI receives: every annotation's number, kind
//             (comment = has the user's comment, highlight = none), origin,
//             speaker, text and comment, plus the response rules. A single
//             text over 4000 characters keeps its first and last 1500.
//   stats   — { chars, tokens } of `full`, tokens estimated like the host does,
//             so the sender can warn before the host's 25% soft limit.
//
// Grouping (V2, design §2.10a): with GROUP_THRESHOLD or more comments spread
// over two or more messages (files, for Diple Docs origins), the rules end
// with the comments grouped by message and a line on how to work them. Only
// advice: numbers, item sections, the display and the markers are unchanged.
//
// Items are PendingList items: { id, origin, text, comment }. Origins are
// either chat origins { sessionId, sessionTitle?, role, roleOrdinal?,
// ordinal, rowId?, verified } or file origins { path, line }.

import { markerFor } from './markers.js'

export const MAX_TEXT_CHARS = 4000
export const KEEP_HEAD_CHARS = 1500
export const KEEP_TAIL_CHARS = 1500
export const DISPLAY_SNIPPET_CHARS = 40
export const REFERENCE_PREFIX = 'diple'
// Below this a flat list is easier to read than groups (host pack.ts GROUP_THRESHOLD).
export const GROUP_THRESHOLD = 4
// A batch id as the desktop half generates it: "b" + 26 lowercase base32
// characters. The backend provider expands only this shape (B-1), so the
// front end treats only this shape as a live reference too.
export const BATCH_ID_SOURCE = 'b[a-z2-7]{26}'
const BATCH_ID_RE = new RegExp(`^${BATCH_ID_SOURCE}$`)
const BATCH_REFERENCE_RE = new RegExp(`(?<![\\w/])@${REFERENCE_PREFIX}:(${BATCH_ID_SOURCE})(?![A-Za-z0-9_-])`)
export const isBatchId = (id) => typeof id === 'string' && BATCH_ID_RE.test(id)
/** The batch id of the first live `@<prefix>:<batchId>` in text, or null (a bare mention of the prefix is not one). */
export function batchReferenceIn(text) {
  const m = typeof text === 'string' ? BATCH_REFERENCE_RE.exec(text) : null
  return m ? m[1] : null
}
// Mirrors agent/model_metadata.py estimate_tokens_rough (the estimate the
// host's @-reference limits use): CJK/Hangul/Kana code points count one token
// each; everything else ceil(UTF-8 bytes / 4).
const CHARS_PER_TOKEN = 4
const CJK_DENSE_RE = /[\u1100-\u11ff\u2e80-\u9fff\ua960-\ua97f\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/g

export function estimateTokens(text) {
  if (!text) return 0
  const stripped = text.replace(CJK_DENSE_RE, '')
  const dense = text.length - stripped.length
  return dense + Math.floor((new TextEncoder().encode(stripped).length + 3) / CHARS_PER_TOKEN)
}

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'

const LABELS = {
  zh: {
    divider: (n) => `—— 附 ${n} 条标注 ——`,
    reply: (n, approx) => `${approx ? '约' : ''}第 ${n} 条回复`,
    mine: (n, approx) => `${approx ? '约' : ''}我的第 ${n} 条消息`,
    otherSession: (title) => `会话「${title}」`,
    file: (path, line) => `${path}${line ? ` 第 ${line} 行` : ''}`,
    colon: '：',
    quoteOpen: '「',
    quoteClose: '」',
    ellipsis: '……',
    commentPrefix: '意见：',
    fullHeader: (b, n, k, q) => `[标注批次 ${b}] 用户随这条消息附上 ${n} 条标注：${k} 条批注，${q} 条划线。`,
    comment: '批注',
    highlight: '划线',
    speakerAssistant: '你（AI）说的',
    speakerUser: '用户说的',
    speakerFile: '文件内容',
    originLine: '出处',
    sessionWord: '会话',
    rowWord: '消息行号',
    unverified: '（位置为估计）',
    textLabel: '原文',
    commentLabel: '用户的意见',
    truncated: (omitted, where) =>
      `…（中间省略 ${omitted} 字；全文见${where}）…`,
    rulesTitle: '## 回应规则',
    rules: (b, comments) => [
      comments.length
        ? `- 批注（${comments.map(circled).join('')}）带着用户的意见，要逐条回应；划线只是背景材料，不要为划线单独写回应。`
        : '- 这批都是划线，只是背景材料，不需要逐条回应，也不要写回应标记。',
      ...(comments.length
        ? [
            `- 每回应一条批注，就在那段回应的正前方单独写一行回应标记，例如 ${markerFor(b, comments[0])}${comments.length > 1 ? `；一段同时回应几条批注时写在一起，例如 ${markerFor(b, comments.slice(0, 2))}` : ''}。`,
            '- 回应标记必须单独成段（前后各空一行），只照抄上面的格式，不要放进代码块、引用块或列表，也不要加其他文字。',
            `- 批次号 b 固定是 "${b}"；n 只能写批注的编号：${comments.join('、')}。`,
            '- 每条批注都要回应；确实无法回应的，也要写标记并说明原因。'
          ]
        : [])
    ],
    groupSep: '；',
    groups: (total, count, list) => [
      `- 这 ${total} 条批注按所在消息分成 ${count} 组：${list}。`,
      `- 按组处理：当作 ${count} 件事来做，而不是 ${total} 件；同一组的批注合并成一次修改。需要分派给子任务时整组分派，不要拆开同一组，也不要按主题（比如措辞类、格式类）重新分组，那样几处修改会撞在同一段内容上。如果实际内容和这个分组对不上，可以自行调整。回应标记仍按上面的规则逐条写（一段回应几条时写在一起）。`
    ],
    groupItem: (i, label, nums) => `组 ${i} · ${label}：${nums}`
  },
  en: {
    divider: (n) => `—— ${n} annotation${n === 1 ? '' : 's'} attached ——`,
    reply: (n, approx) => `${approx ? '~' : ''}reply #${n}`,
    mine: (n, approx) => `${approx ? '~' : ''}my message #${n}`,
    otherSession: (title) => `session "${title}"`,
    file: (path, line) => `${path}${line ? `:${line}` : ''}`,
    colon: ': ',
    quoteOpen: '"',
    quoteClose: '"',
    ellipsis: '…',
    commentPrefix: 'Comment: ',
    fullHeader: (b, n, k, q) =>
      `[Annotation batch ${b}] The user attached ${n} annotation${n === 1 ? '' : 's'} to this message: ${k} comment${k === 1 ? '' : 's'}, ${q} highlight${q === 1 ? '' : 's'}.`,
    comment: 'Comment',
    highlight: 'Highlight',
    speakerAssistant: 'said by you (the AI)',
    speakerUser: 'said by the user',
    speakerFile: 'file content',
    originLine: 'Origin',
    sessionWord: 'session',
    rowWord: 'message row',
    unverified: ' (position estimated)',
    textLabel: 'Text',
    commentLabel: "User's comment",
    truncated: (omitted, where) => `… (${omitted} characters omitted; full text in ${where}) …`,
    rulesTitle: '## Response rules',
    rules: (b, comments) => [
      comments.length
        ? `- Comments (${comments.map(circled).join('')}) carry the user's remarks: answer each one. Highlights are background material only and need no answer of their own.`
        : '- Highlights only: this batch is background material. Do not answer it point by point and do not write response markers.',
      ...(comments.length
        ? [
            `- Right before the paragraph that answers a comment, write a response marker on its own line, e.g. ${markerFor(b, comments[0])}${comments.length > 1 ? `; when one paragraph answers several, combine them, e.g. ${markerFor(b, comments.slice(0, 2))}` : ''}.`,
            '- The marker must be its own paragraph (blank line before and after). Copy the format exactly; never put it in a code block, quote or list, and add no other text to it.',
            `- The batch id b is always "${b}"; n may only use comment numbers: ${comments.join(', ')}.`,
            '- Answer every comment; if one cannot be answered, still write its marker and say why.'
          ]
        : [])
    ],
    groupSep: '; ',
    groups: (total, count, list) => [
      `- These ${total} comments fall into ${count} groups by message: ${list}.`,
      `- Work them as ${count} pieces of work, not ${total}. Fold comments in the same group into one change. If you delegate, delegate whole groups — never split one group, and never regroup by theme (all the wording ones, all the formatting ones): those cut across the same text and the changes collide. Regroup if the content disagrees with this split. Still write a response marker for every comment, as above (combined when one paragraph answers several).`
    ],
    groupItem: (i, label, nums) => `group ${i} · ${label}: ${nums}`
  }
}

// Groups of the comments by the message (or file) they come from, in order
// of first appearance. Adapted from hermes-agent
// apps/desktop/src/lib/preview-annotate/pack.ts (batchGuidance, MIT): the
// threshold and the advice (work groups as units; never split one; never
// regroup by theme) are the host's; grouping is by message, not DOM subtree.
function groupKey(origin) {
  if (!origin) return 'none'
  if (origin.path) return `file:${origin.path}`
  const where = origin.rowId != null ? `row:${origin.rowId}` : `${origin.role}:${origin.roleOrdinal ?? origin.ordinal ?? 0}`
  return `${origin.sessionId ?? ''}|${where}`
}

function groupLines(items, comments, L, labelOf) {
  if (comments.length < GROUP_THRESHOLD) return []
  const groups = new Map()
  for (const n of comments) {
    const origin = items[n - 1].origin
    const k = groupKey(origin)
    if (!groups.has(k)) groups.set(k, { label: labelOf(origin), numbers: [] })
    groups.get(k).numbers.push(n)
  }
  if (groups.size < 2) return []
  const list = [...groups.values()].map((g, i) => L.groupItem(i + 1, g.label, g.numbers.map(circled).join(''))).join(L.groupSep)
  return L.groups(comments.length, groups.size, list)
}

export function circled(n) {
  return n >= 1 && n <= CIRCLED.length ? CIRCLED[n - 1] : `(${n})`
}

function chars(s) {
  return Array.from(s ?? '')
}

function isComment(item) {
  return typeof item?.comment === 'string' && item.comment.trim() !== ''
}

const SHORT_ID_CHARS = 8
const shortId = (id) => (chars(id).length > SHORT_ID_CHARS ? chars(id).slice(0, SHORT_ID_CHARS).join('') + '…' : id)

function originLabel(origin, L, { withSession } = {}) {
  if (!origin) return ''
  if (origin.path) return L.file(origin.path, origin.line)
  const n = origin.roleOrdinal ?? origin.ordinal ?? 0
  const approx = origin.verified === false
  const base = origin.role === 'user' ? L.mine(n, approx) : L.reply(n, approx)
  if (withSession && origin.sessionId) return `${L.otherSession(origin.sessionTitle || shortId(origin.sessionId))} · ${base}`
  return base
}

// The host scans the whole submitted text for `@kind:value` references
// (agent/context_references.py: `(?<![\w/])@…`). A WORD JOINER after the `@`
// keeps copied text readable but never a reference (R1 XE-13).
const WORD_JOINER = '\u2060'
const inert = (s) => String(s ?? '').replace(/(?<![\w/])@(?=[A-Za-z])/g, '@' + WORD_JOINER)

function snippet(text, L) {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim()
  const cs = chars(flat)
  return cs.length > DISPLAY_SNIPPET_CHARS ? cs.slice(0, DISPLAY_SNIPPET_CHARS).join('') + L.ellipsis : flat
}

/** Head/tail truncation of one annotation's text (exported for previews). */
export function clipText(text, where, lang = 'zh') {
  const L = LABELS[lang] ?? LABELS.zh
  const cs = chars(text)
  if (cs.length <= MAX_TEXT_CHARS) return { text: text ?? '', clipped: false }
  const omitted = cs.length - KEEP_HEAD_CHARS - KEEP_TAIL_CHARS
  return {
    text: `${cs.slice(0, KEEP_HEAD_CHARS).join('')}\n${L.truncated(omitted, where)}\n${cs.slice(-KEEP_TAIL_CHARS).join('')}`,
    clipped: true
  }
}

function speaker(origin, L) {
  if (origin?.path) return L.speakerFile
  return origin?.role === 'user' ? L.speakerUser : L.speakerAssistant
}

function fullOrigin(origin, L) {
  if (!origin) return ''
  if (origin.path) return L.file(origin.path, origin.line)
  const parts = [originLabel(origin, L)]
  const session = origin.sessionTitle ? `${origin.sessionTitle} (${origin.sessionId ?? ''})` : origin.sessionId
  if (session) parts.push(`${L.sessionWord} ${session}`)
  if (origin.rowId != null) parts.push(`${L.rowWord} ${origin.rowId}`)
  return parts.join(' · ') + (origin.verified === false ? L.unverified : '')
}

function fenceFor(text) {
  let longest = 2
  for (const m of (text ?? '').matchAll(/`+/g)) longest = Math.max(longest, m[0].length)
  return '`'.repeat(longest + 1)
}

/** Compose the display and full texts of one send. */
export function compose({ body = '', items = [], batchId, lang = 'zh', sessionId = null }) {
  if (!batchId || !/^[A-Za-z0-9_-]{4,64}$/.test(batchId)) throw new Error('compose: invalid batchId')
  const L = LABELS[lang] ?? LABELS.zh
  const trimmedBody = (body ?? '').trim()
  const sessions = new Set(items.map((it) => it.origin?.sessionId).filter(Boolean))
  const multiSession = sessions.size > 1
  // Name the source session of every annotation not from the target session; with
  // no target known, of every annotation in a batch that mixes sessions.
  const fromElsewhere = (origin) => Boolean(origin?.sessionId) && (sessionId ? origin.sessionId !== sessionId : multiSession)
  const comments = []
  items.forEach((it, i) => isComment(it) && comments.push(i + 1))

  // display
  const dLines = []
  if (trimmedBody) dLines.push(trimmedBody, '')
  dLines.push(L.divider(items.length))
  items.forEach((it, i) => {
    const label = originLabel(it.origin, L, { withSession: fromElsewhere(it.origin) })
    dLines.push(inert(`${circled(i + 1)} ${label}${L.colon}${L.quoteOpen}${snippet(it.text, L)}${L.quoteClose}`))
    if (isComment(it)) dLines.push(inert(`   ${L.commentPrefix}${it.comment.trim().replace(/\n+/g, ' ')}`))
  })
  dLines.push(`@${REFERENCE_PREFIX}:${batchId}`)
  const display = dLines.join('\n')

  // full
  const fLines = [L.fullHeader(batchId, items.length, comments.length, items.length - comments.length), '']
  items.forEach((it, i) => {
    const n = i + 1
    const kind = isComment(it) ? L.comment : L.highlight
    const where = fullOrigin(it.origin, L)
    const { text } = clipText(it.text ?? '', where, lang)
    const fence = fenceFor(text)
    fLines.push(`### ${circled(n)} ${kind} ${n} · ${speaker(it.origin, L)}`)
    fLines.push(`${L.originLine}: ${where}`)
    fLines.push(`${L.textLabel}:`)
    fLines.push(`${fence}text`, text, fence)
    if (isComment(it)) fLines.push(`${L.commentLabel}: ${it.comment.trim()}`)
    fLines.push('')
  })
  fLines.push(L.rulesTitle, ...L.rules(batchId, comments))
  fLines.push(...groupLines(items, comments, L, (o) => inert(o?.path ? o.path : originLabel(o, L, { withSession: fromElsewhere(o) }))))
  const full = fLines.join('\n')

  return { display, full, stats: { chars: chars(full).length, tokens: estimateTokens(full) } }
}
