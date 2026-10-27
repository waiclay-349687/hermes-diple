// How a quoted passage (rendered Markdown) sits in a small fixed-width box:
// the editor's original, the pin and chip previews, a Diple Docs card (V2.1 #4).
// One rule set for both plugins, as CSS text, like mark-look.js.
//
//   PassageLook.css(selector, { maxHeight })  → CSS text
//
// - long words and URLs break (overflow-wrap:anywhere), so the box never widens;
// - code blocks and tables scroll sideways inside the box;
// - past maxHeight the passage scrolls inside the box (no clipping mask);
// - images never exceed the box.
// The selector may be a list ("a, b"); every rule is scoped to each part.

const scope = (sel, inner) =>
  sel
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (inner ? `${s} ${inner}` : s))
    .join(',')

export function css(selector, { maxHeight = '9.6em' } = {}) {
  const at = (inner) => scope(selector, inner)
  return [
    `${at('')}{min-width:0;max-width:100%;box-sizing:border-box;overflow-wrap:anywhere;word-break:normal;max-height:${maxHeight};overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;-webkit-mask-image:none;mask-image:none}`,
    `${at('pre')}{max-width:100%;max-height:none;overflow-x:auto;overflow-y:hidden;white-space:pre}`,
    `${at('pre code')}{white-space:pre;overflow-wrap:normal;word-break:normal}`,
    `${at(':not(pre)>code')}{overflow-wrap:anywhere;word-break:break-all;white-space:pre-wrap}`,
    `${at('table')}{display:block;max-width:100%;overflow-x:auto;border-collapse:collapse}`,
    `${at('img')}{max-width:100%;height:auto}`,
    `${at(':is(ul,ol)')}{padding-inline-start:1.3em}`
  ].join('\n')
}
