// Text helpers of the composer strip and the drawer (no React).
//
//   originLabel(origin, listKey, t, titleOf?) → "第 2 条回复" / "「标题」· 第 2 条回复" / "a.md 第 3 行"
//   chipText(text, max?) → the opening of an annotation as plain words (no
//       Markdown markers, one line), cut at `max` code points with "…"

export function originLabel(origin, listKey, t, titleOf = () => null) {
  if (!origin) return ''
  if (origin.path) return t('capture.originFile', origin.path, origin.line ?? 0)
  const n = origin.roleOrdinal ?? origin.ordinal ?? 0
  const approx = !origin.verified || origin.approx
  const base =
    origin.role === 'user'
      ? t(approx ? 'capture.originUserApprox' : 'capture.originUser', n)
      : t(approx ? 'capture.originAssistantApprox' : 'capture.originAssistant', n)
  if (origin.sessionId && listKey && origin.sessionId !== listKey) {
    const title = (titleOf(origin.sessionId) || '').replace(/\s+/g, ' ').trim()
    return t('capture.originOtherSession', title ? (title.length > 18 ? `${title.slice(0, 17)}…` : title) : t('capture.otherSession'), base)
  }
  return base
}

export const CHIP_CHARS = 14

export function chipText(text, max = CHIP_CHARS) {
  const flat = String(text ?? '')
    .split('\n')
    .filter((l) => !/^\s*(```|~~~)/.test(l) && !/^\s*\|?\s*:?-{3,}/.test(l))
    .map((l) => l.replace(/^\s*(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/, ''))
    .join(' ')
    .replace(/\*\*|__|`|~~/g, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const cs = Array.from(flat)
  return cs.length > max ? cs.slice(0, max).join('').trimEnd() + '…' : flat
}
