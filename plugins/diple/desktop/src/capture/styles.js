// capture/ CSS: pending list, cards (until C's strip replaces them), and V2-T:
// transcript marks, pins, selection toolbar, editor, preview, way back.
// Theme variables and host radius tokens only (design §2.1–2.2, §2.9); class
// prefix `diple-`. Mark looks come from @diple/core MarkLook (the same in Diple
// Docs); the warning colour is --ui-yellow (the host has no --ui-warning).

import { MarkLook, PassageLook } from '@diple/core'

export const CAPTURE_CSS = `
.diple-list{display:flex;flex-direction:column;gap:6px;padding:6px 8px 8px;margin:0 0 4px;border:1px solid var(--ui-stroke-secondary);border-radius:10px;background:var(--ui-bg-elevated,var(--ui-bg-secondary));color:var(--ui-text-primary);font-size:12.5px;line-height:1.45;max-height:46vh;min-height:0}
.diple-list-items{display:flex;flex-direction:column;gap:6px;overflow:auto;overscroll-behavior:contain;min-height:0;flex:1 1 auto;margin:0 -2px;padding:0 2px}
.diple-list[data-collapsed]{padding:3px 8px}
.diple-list button{font:inherit}
.diple-list-head{display:flex;align-items:center;gap:6px;color:var(--ui-text-secondary);min-height:22px;white-space:nowrap}
.diple-list-summary{background:none;border:0;padding:0;color:inherit;cursor:default;text-align:start;min-width:0;overflow:hidden;text-overflow:ellipsis}
.diple-list[data-collapsed] .diple-list-summary{cursor:pointer}
.diple-spacer{flex:1}
.diple-icon{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:5px;border:0;background:none;color:var(--ui-text-tertiary);cursor:pointer;font-size:14px;line-height:1;padding:0}
.diple-icon:hover{background:var(--ui-control-hover-background,var(--ui-row-hover-background));color:var(--ui-text-primary)}
.diple-link{background:none;border:0;padding:0;color:var(--ui-accent);cursor:pointer;font-size:12px;align-self:flex-start;white-space:nowrap;flex-shrink:0}
.diple-link:hover{text-decoration:underline}
.diple-list :focus-visible{outline:2px solid var(--ui-accent);outline-offset:1px}
.diple-card{display:flex;flex-direction:column;gap:4px;padding:6px 8px;border-radius:8px;border:1px solid transparent;background:var(--ui-chat-surface-background,var(--ui-bg-editor))}
.diple-card[data-expanded]{border-color:color-mix(in srgb,var(--ui-accent) 55%,transparent)}
.diple-card-head{display:flex;gap:6px;align-items:center;color:var(--ui-text-secondary);min-width:0}
.diple-card-n{font-weight:600;color:var(--ui-accent);min-width:1em}
.diple-card-origin{background:none;border:0;padding:0;color:var(--ui-text-secondary);cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;max-width:60%}
.diple-card-origin:hover{color:var(--ui-accent)}
.diple-badge{font-size:11px;padding:0 6px;border-radius:999px;border:1px solid var(--ui-stroke-tertiary,var(--ui-stroke-secondary));color:var(--ui-text-tertiary);white-space:nowrap}
.diple-badge-comment{color:var(--ui-accent);border-color:color-mix(in srgb,var(--ui-accent) 40%,transparent)}
.diple-badge-changed{color:var(--ui-yellow);border-color:color-mix(in srgb,var(--ui-yellow) 50%,transparent)}
.diple-card-text{white-space:pre-wrap;word-break:break-word;color:var(--ui-text-primary);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.diple-card-text[data-full]{display:block;-webkit-line-clamp:unset;max-height:14em;overflow:auto}
.diple-card[data-changed] .diple-card-text{color:var(--ui-text-secondary)}
.diple-card-hint{font-size:11.5px;color:var(--ui-text-tertiary)}
.diple-card-comment{resize:none;min-height:1.7em;max-height:160px;font:inherit;color:inherit;background:var(--ui-bg-input,transparent);border:1px solid var(--ui-stroke-secondary);border-radius:6px;padding:3px 6px;outline:none}
.diple-card-comment:focus{border-color:var(--ui-accent)}
.diple-card-comment::placeholder{color:var(--ui-text-quaternary,var(--ui-text-tertiary))}
.diple-card[data-locked] .diple-card-comment{opacity:.7}
.diple-undo{display:flex;gap:10px;align-items:center;color:var(--ui-text-secondary);font-size:12px;padding:2px 2px 0}
/* ── V2-T: marks (P7: ::highlight() paints text-decoration) ── */
::highlight(diple-mark){${MarkLook.fill('pending')}}
::highlight(diple-mark-line){${MarkLook.line('pending')}}
::highlight(diple-sent){${MarkLook.fill('sent')}}
::highlight(diple-sent-line){${MarkLook.line('sent')}}
::highlight(diple-answered){${MarkLook.fill('answered')}}
::highlight(diple-answered-line){${MarkLook.line('answered')}}
::highlight(diple-active){${MarkLook.fill('active')}}

/* ── shared overlay chrome ── */
.diple-layer{position:fixed;inset:0;pointer-events:none;z-index:30;contain:strict}
.diple-pop{position:fixed;z-index:45;box-sizing:border-box;background:var(--ui-bg-elevated);color:var(--ui-text-primary);border:1px solid var(--stroke-nous);box-shadow:var(--shadow-nous);border-radius:var(--radius-lg);font:12px/1.5 var(--dt-font-sans,system-ui,sans-serif)}
.diple-pop[data-enter]{animation:diple-pop-in .12s ease-out both}
.diple-pop[data-shake]{animation:diple-shake .26s ease-out}
.diple-pop[hidden]{display:none}
@keyframes diple-pop-in{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:none}}
@keyframes diple-shake{20%{transform:translateX(-3px)}45%{transform:translateX(3px)}70%{transform:translateX(-2px)}100%{transform:none}}
@keyframes diple-rise-in{from{opacity:0;transform:translate(-50%,calc(-100% + 4px))}to{opacity:1;transform:translate(-50%,-100%)}}
.diple-spacer{flex:1}
.diple-tbtn{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 4px;border:0;border-radius:0;background:none;color:var(--ui-text-tertiary);font:inherit;font-size:11.5px;cursor:pointer;white-space:nowrap}
.diple-tbtn:hover:not(:disabled){color:var(--ui-text-primary)}
.diple-tbtn:disabled{opacity:.45;cursor:default}
.diple-tbtn.diple-danger:hover{color:var(--ui-red)}
.diple-tbtn .codicon{font-size:12px}
.diple-ibtn{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:0;border-radius:4px;background:none;color:var(--ui-text-tertiary);cursor:pointer}
.diple-ibtn:hover{background:var(--ui-control-hover-background);color:var(--ui-text-primary)}
.diple-ibtn .codicon{font-size:12px}
.diple-nb{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 3px;box-sizing:border-box;border-radius:var(--radius-sm);font:600 10px/1 var(--dt-font-mono,ui-monospace,monospace);color:var(--ui-accent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--ui-accent) 45%,transparent);flex:none}
.diple-nb[data-kind=comment]{background:var(--ui-accent);color:var(--ui-bg-editor,var(--ui-bg-elevated));box-shadow:none}
.diple-md{min-width:0;overflow-wrap:anywhere}
.diple-md-link{color:var(--ui-accent);text-decoration:underline;text-decoration-color:color-mix(in srgb,var(--ui-accent) 40%,transparent)}
.diple-md p,.diple-md ul,.diple-md ol,.diple-md pre,.diple-md blockquote,.diple-md h1,.diple-md h2,.diple-md h3,.diple-md h4{margin:0}
.diple-md>*+*,.diple-md>div>*+*{margin-top:4px}
.diple-md h1,.diple-md h2,.diple-md h3,.diple-md h4{font-size:inherit;font-weight:600}
.diple-md-plain{white-space:pre-wrap}
.diple-md pre{font-size:11px;max-height:6em;overflow:hidden}

/* ── selection toolbar (design §2.3) ── */
.diple-toolbar{position:fixed;z-index:46;display:flex;padding:2px;gap:1px;background:color-mix(in srgb,var(--ui-bg-elevated) 96%,transparent);border:1px solid var(--ui-stroke-secondary);box-shadow:var(--shadow-md);border-radius:var(--radius-lg);backdrop-filter:blur(12px) saturate(1.08);-webkit-backdrop-filter:blur(12px) saturate(1.08);opacity:0;transform:scale(.96);transform-origin:0 0;pointer-events:none;visibility:hidden;user-select:none;-webkit-user-select:none}
.diple-toolbar[data-side=top]{transform-origin:0 100%}
.diple-toolbar[data-dir=rtl]{transform-origin:100% 0}
.diple-toolbar[data-dir=rtl][data-side=top]{transform-origin:100% 100%}
.diple-toolbar[data-shown]{opacity:1;transform:none;pointer-events:auto;visibility:visible;transition:opacity .12s ease-out,transform .12s ease-out}
.diple-toolbar-btn{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 6px 0 8px;border:0;border-radius:var(--radius-md);background:none;color:var(--ui-text-secondary);font:500 12px/1 var(--dt-font-sans,system-ui,sans-serif);cursor:pointer}
.diple-toolbar-btn:hover{background:var(--ui-control-active-background);color:var(--ui-text-primary)}
.diple-toolbar-glyph{width:10px;height:10px;border-radius:var(--radius-sm);background:color-mix(in srgb,var(--ui-accent) 22%,transparent);box-shadow:inset 0 -2px 0 var(--ui-accent)}

/* ── pins (design §2.5, states §2.2) ── */
.diple-pin-probe{position:absolute;left:0;top:0;width:0;height:1px;visibility:hidden}
.diple-pin-clip{position:absolute;left:0;top:0;width:0;height:0}
.diple-pin-clip[data-clipped]{overflow:hidden}
.diple-pin-group{position:absolute;left:0;top:0;width:0;height:0;will-change:transform}
.diple-pin{position:absolute;left:0;top:0;width:auto;min-width:16px;height:16px;padding:0 3px;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:1px;border:0;border-radius:var(--radius-sm);font:600 10px/1 var(--dt-font-mono,ui-monospace,monospace);cursor:pointer;pointer-events:auto;user-select:none;-webkit-user-select:none;background:var(--ui-accent);color:var(--ui-bg-editor,var(--ui-bg-elevated));box-shadow:0 0 0 1px color-mix(in srgb,var(--ui-bg-editor,var(--ui-bg-elevated)) 80%,transparent);transition:box-shadow .12s ease-out,opacity .12s ease-out}
.diple-pin::before{content:'';position:absolute;inset:-2px}
.diple-pin[hidden]{display:none}
.diple-pin[data-state=highlight]{background:color-mix(in srgb,var(--ui-accent) 14%,var(--ui-bg-editor,var(--ui-bg-elevated)));color:var(--ui-accent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--ui-accent) 50%,transparent)}
.diple-pin[data-sent]{background:var(--ui-bg-editor,var(--ui-bg-elevated));color:var(--ui-text-tertiary);box-shadow:inset 0 0 0 1px var(--ui-stroke-primary,var(--ui-stroke-secondary))}
.diple-pin[data-state=answered]{color:var(--ui-green);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--ui-green) 50%,transparent)}
.diple-pin-tick{font-size:9px;margin-left:1px}
.diple-pin-dot{position:absolute;top:-2px;right:-2px;width:6px;height:6px;border-radius:50%;background:var(--ui-yellow);box-shadow:0 0 0 1.5px var(--ui-bg-editor,var(--ui-bg-elevated))}
.diple-pin[data-active]{box-shadow:0 0 0 2px color-mix(in srgb,var(--ui-accent) 32%,transparent)}
.diple-pin[data-sent][data-active]{box-shadow:inset 0 0 0 1px var(--ui-accent),0 0 0 2px color-mix(in srgb,var(--ui-accent) 20%,transparent)}
.diple-pin:focus-visible{outline:2px solid var(--ui-accent);outline-offset:1px}

/* ── editor beside the text (design §2.4) ── */
.diple-editor{width:320px;max-width:calc(100vw - 16px);box-sizing:border-box;padding:10px;display:flex;flex-direction:column;gap:8px;transform-origin:0 0}
.diple-editor[data-side=top]{transform-origin:0 100%}
.diple-editor[data-dir=rtl]{transform-origin:100% 0}
.diple-editor[data-dir=rtl][data-side=top]{transform-origin:100% 100%}
.diple-editor-head{display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--ui-text-tertiary);margin:-2px -4px -2px 0}
.diple-editor-quote{font-size:12px;line-height:1.55;color:var(--ui-text-secondary)}
.diple-field{display:block;box-sizing:border-box;width:100%;min-height:56px;max-height:180px;resize:none;margin:0;padding:6px 8px;font:13px/1.5 var(--dt-font-sans,system-ui,sans-serif);color:var(--ui-text-primary);background:color-mix(in srgb,var(--dt-card,transparent) var(--dt-input-bg,0%),transparent);border:1px solid color-mix(in srgb,var(--dt-composer-ring,var(--ui-base)) calc(var(--dt-input-border,7%) * 2),transparent);border-radius:var(--radius-md);box-shadow:var(--dt-input-inset,none);outline:none;transition:border-color .2s ease-out,box-shadow .2s ease-out}
.diple-field:hover{border-color:color-mix(in srgb,var(--dt-composer-ring,var(--ui-base)) calc(var(--dt-input-border,7%) * 3),transparent)}
.diple-field:focus{border-color:var(--ui-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--ui-accent) 16%,transparent)}
.diple-field::placeholder{color:var(--ui-text-quaternary,var(--ui-text-tertiary))}
.diple-editor-foot{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0;margin:0 0 -2px -2px}
.diple-editor-actions{display:inline-flex;flex-wrap:nowrap;align-items:center;gap:6px;margin-inline-start:auto;max-width:100%}
.diple-pbtn,.diple-sbtn{display:inline-flex;align-items:center;height:24px;padding:0 10px;border-radius:var(--radius-md);font:500 12px/1 var(--dt-font-sans,system-ui,sans-serif);white-space:nowrap;cursor:pointer;flex:none}
.diple-pbtn{border:0;background:var(--ui-accent);color:var(--ui-bg-editor,var(--ui-bg-elevated))}
.diple-pbtn:hover{background:color-mix(in srgb,var(--ui-accent) 88%,var(--ui-text-primary))}
.diple-sbtn{border:1px solid var(--ui-stroke-secondary);background:transparent;color:var(--ui-text-secondary)}
.diple-sbtn:hover{background:var(--ui-control-hover-background);color:var(--ui-text-primary)}
.diple-pbtn:focus-visible,.diple-sbtn:focus-visible,.diple-ibtn:focus-visible{outline:2px solid var(--ui-accent);outline-offset:1px}
.diple-ibtn:disabled{opacity:.45;cursor:default}
.diple-ibtn:disabled:hover{background:none;color:var(--ui-text-tertiary)}
.diple-tipped{position:relative}
.diple-tipped:is(:hover,:focus-visible)::after{content:attr(data-diple-tip);position:absolute;bottom:calc(100% + 6px);inset-inline-start:0;z-index:1;width:max-content;max-width:240px;padding:4px 7px;border-radius:var(--radius-sm);background:var(--ui-bg-elevated);color:var(--ui-text-primary);box-shadow:var(--shadow-md);border:1px solid var(--ui-stroke-secondary);font:400 11.5px/1.4 var(--dt-font-sans,system-ui,sans-serif);white-space:normal;text-align:start;pointer-events:none}

/* ── hover preview + mini toolbar ── */
.diple-preview{width:300px;max-width:calc(100vw - 16px);box-sizing:border-box;padding:8px 10px 4px;display:flex;flex-direction:column;gap:6px;transform-origin:0 100%}
.diple-preview-head{display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--ui-text-tertiary)}
.diple-preview-body{line-height:1.6;color:var(--ui-text-primary)}
.diple-preview-empty{color:var(--ui-text-quaternary,var(--ui-text-tertiary))}
.diple-preview-tools{display:flex;align-items:center;gap:2px;margin:0 -6px;padding:3px 2px 0;border-top:1px solid var(--ui-stroke-tertiary,var(--ui-stroke-secondary))}
.diple-preview-note{margin-inline-start:auto;padding-inline-end:4px;font-size:11px;color:var(--ui-text-quaternary,var(--ui-text-tertiary))}

/* ── back to the composer ── */
.diple-return{position:fixed;z-index:35;transform:translate(-50%,-100%);display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border:1px solid var(--ui-stroke-secondary);border-radius:var(--radius-md);background:color-mix(in srgb,var(--ui-bg-elevated) 96%,transparent);box-shadow:var(--shadow-md);color:var(--ui-text-secondary);font:12px/1 var(--dt-font-sans,system-ui,sans-serif);cursor:pointer;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
.diple-return[hidden]{display:none}
.diple-return[data-enter]{animation:diple-rise-in .16s ease-out both}
.diple-return:hover{color:var(--ui-text-primary)}


/* ── a quoted passage in a fixed-width box (V2.1 #4, core PassageLook) ── */
${PassageLook.css('.diple-editor-quote', { maxHeight: '7.75em' })}
${PassageLook.css('.diple-preview-body', { maxHeight: '9.6em' })}
@media (prefers-reduced-motion: reduce){.diple-pop[data-enter],.diple-pop[data-shake],.diple-return[data-enter]{animation:none}.diple-toolbar[data-shown],.diple-pin,.diple-field{transition:none}}
`
