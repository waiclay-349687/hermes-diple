// Styles of the composer strip, its chip preview and the session drawer
// (design §2.9). Host tokens only: radii --radius-sm / --radius-md (icon
// buttons 4px), overlays shadow-nous + --stroke-nous, hairlines
// --ui-stroke-tertiary, accent --ui-accent, missing --ui-yellow. Motion is
// quick (100–160ms), hover paints instantly and only the return eases, and
// prefers-reduced-motion turns every movement off.

import { PassageLook } from '@diple/core'
import { SEND_MENU_CSS } from '@diple/desktop-kit'

export const STRIP_CSS = `
.diple-strip{display:flex;flex-direction:column;gap:4px;padding:2px 0 6px;margin:0 0 2px;border-bottom:1px solid var(--ui-stroke-tertiary,var(--ui-stroke-secondary));color:var(--ui-text-primary);font-size:12px;line-height:1.4;min-width:0}
.diple-strip button{font:inherit}
.diple-chips{position:relative;display:flex;flex-wrap:wrap;align-items:center;gap:4px;min-width:0}
.diple-chips:not([data-all]){flex-wrap:nowrap;overflow:hidden}
.diple-chip-wrap{position:relative;display:inline-flex;align-items:center;min-width:0;flex:0 1 auto;animation:diple-chip-in 140ms ease-out}
.diple-chip{display:inline-flex;align-items:center;gap:5px;min-width:0;max-width:15em;height:20px;padding:0 7px 0 2px;border:1px solid var(--ui-stroke-tertiary,var(--ui-stroke-secondary));border-radius:var(--radius-md,2px);background:transparent;color:var(--ui-text-secondary);cursor:pointer;white-space:nowrap;transition:background-color 120ms ease-out,border-color 120ms ease-out,color 120ms ease-out}
.diple-chip:hover,.diple-chip:focus-visible{background:var(--chrome-action-hover,var(--ui-bg-tertiary));border-color:var(--ui-stroke-secondary);color:var(--ui-text-primary);transition:none;outline:none}
.diple-chip:focus-visible{border-color:var(--ui-accent)}
.diple-chip[data-lit]{background:color-mix(in srgb,var(--ui-accent) 10%,transparent);border-color:color-mix(in srgb,var(--ui-accent) 45%,transparent);color:var(--ui-text-primary)}
.diple-chip[data-active]{border-color:var(--ui-accent);color:var(--ui-text-primary);box-shadow:0 0 0 1px color-mix(in srgb,var(--ui-accent) 22%,transparent)}
.diple-chip[data-changed] .diple-chip-text{text-decoration:line-through;text-decoration-color:color-mix(in srgb,var(--ui-yellow) 70%,transparent)}
.diple-chip[data-locked]{opacity:.6}
.diple-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.diple-chip-text{overflow:hidden;text-overflow:ellipsis;min-width:0}
.diple-chip-n{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;min-width:14px;height:14px;padding:0 3px;box-sizing:border-box;border-radius:var(--radius-sm,2px);font-size:10px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1;color:var(--ui-accent);border:1px solid color-mix(in srgb,var(--ui-accent) 55%,transparent);background:transparent}
.diple-chip-n[data-kind="comment"]{background:var(--dt-primary-solid,var(--ui-accent));border-color:var(--dt-primary-solid,var(--ui-accent));color:var(--dt-primary-solid-foreground,var(--primary-foreground,#fff))}
.diple-chip-n[data-status="sent"]{background:transparent;color:var(--ui-text-tertiary);border-color:var(--ui-stroke-secondary)}
.diple-chip-n[data-status="answered"]{background:color-mix(in srgb,var(--ui-green) 12%,transparent);color:var(--ui-green);border-color:color-mix(in srgb,var(--ui-green) 50%,transparent)}
.diple-chip-n[data-status="answered"]::after{content:"✓";margin-left:2px;font-size:9px}
.diple-chip-n[data-status="missing"]{position:relative;background:transparent;color:var(--ui-text-secondary);border-color:var(--ui-stroke-secondary)}
.diple-chip-n[data-status="missing"]::after{content:"";position:absolute;top:-3px;right:-3px;width:5px;height:5px;border-radius:50%;background:var(--ui-yellow)}
.diple-chip-more{padding:0 7px;color:var(--ui-text-tertiary);font-variant-numeric:tabular-nums;flex-shrink:0}
.diple-chip-remove{position:absolute;top:-5px;right:-5px;display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;padding:0;border:1px solid var(--ui-stroke-secondary);border-radius:4px;background:var(--ui-bg-elevated,var(--ui-bg-secondary));color:var(--ui-text-tertiary);font-size:10px;line-height:1;cursor:pointer;opacity:0;pointer-events:none;transition:opacity 100ms ease-out}
.diple-chip-wrap:hover .diple-chip-remove,.diple-chip-wrap:focus-within .diple-chip-remove{opacity:1;pointer-events:auto;transition:none}
.diple-chip-remove:hover{color:var(--ui-text-primary)}
.diple-chip-preview{position:fixed;z-index:60;width:340px;max-width:calc(100vw - 12px);display:flex;flex-direction:column;gap:6px;padding:8px 10px;box-sizing:border-box;border:1px solid var(--stroke-nous,var(--ui-stroke-secondary));border-radius:var(--radius-md,2px);background:var(--ui-bg-elevated,var(--ui-bg-secondary));box-shadow:var(--shadow-nous,0 4px 16px rgba(0,0,0,.12));color:var(--ui-text-primary);font-size:12px;line-height:1.5;pointer-events:none;animation:diple-pop 120ms ease-out}
.diple-preview-head{display:flex;align-items:center;gap:6px;color:var(--ui-text-tertiary);font-size:11px}
.diple-preview-kind{color:var(--ui-text-secondary)}
.diple-preview-origin{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.diple-preview-changed{color:var(--ui-yellow)}
.diple-preview-text,.diple-preview-comment{position:relative}
.diple-preview-text{color:var(--ui-text-secondary)}
.diple-preview-comment{max-height:6.5em;padding-top:6px;border-top:1px solid var(--ui-stroke-tertiary,var(--ui-stroke-secondary))}
.diple-preview-text :is(p,ul,ol,pre,blockquote,h1,h2,h3,h4,h5,h6),.diple-preview-comment :is(p,ul,ol,pre,blockquote,h1,h2,h3,h4,h5,h6){margin:0 0 .35em;font-size:inherit;line-height:inherit}
.diple-preview-foot{color:var(--ui-text-quaternary,var(--ui-text-tertiary));font-size:10.5px}
.diple-strip .diple-list-footer{padding:0;min-height:22px}
.diple-strip .diple-footer-left{display:flex;flex-wrap:wrap;align-items:center;column-gap:8px;row-gap:2px}
.diple-strip-summary{color:var(--ui-text-tertiary);font-size:11.5px;font-variant-numeric:tabular-nums;white-space:nowrap}
.diple-strip-fit{display:flex;flex-wrap:wrap;flex:1 1 0;min-width:0;height:17px;overflow:hidden}
.diple-strip-fit::before{content:"";width:0;height:17px}
.diple-strip .diple-list-footer{gap:6px}
.diple-strip .diple-footer-actions{flex-wrap:wrap;justify-content:flex-end;row-gap:2px;min-width:0;flex-shrink:1}
.diple-strip-hint{color:var(--ui-text-secondary);font-size:11.5px;animation:diple-fade 120ms ease-out}
.diple-strip .diple-undo{padding:0;font-size:11.5px}
.diple-link{background:none;border:0;padding:0;color:var(--ui-accent);cursor:pointer;font-size:12px;white-space:nowrap}
.diple-link:hover{text-decoration:underline}
.diple-drawer{position:fixed;z-index:60;right:12px;bottom:120px;width:380px;max-width:calc(100vw - 16px);max-height:min(70vh,560px);display:flex;flex-direction:column;box-sizing:border-box;border:1px solid var(--stroke-nous,var(--ui-stroke-secondary));border-radius:var(--radius-md,2px);background:var(--ui-bg-elevated,var(--ui-bg-secondary));box-shadow:var(--shadow-nous,0 6px 24px rgba(0,0,0,.14));color:var(--ui-text-primary);font-size:12px;line-height:1.45;outline:none;animation:diple-drawer-in 160ms ease-out}
.diple-drawer-head{display:flex;align-items:center;gap:6px;padding:8px 10px 6px}
.diple-drawer-title{font-weight:600}
.diple-drawer-count{color:var(--ui-text-tertiary);font-variant-numeric:tabular-nums}
.diple-spacer{flex:1}
.diple-drawer-action{border:0;background:none;padding:2px 6px;color:var(--ui-text-secondary);cursor:pointer;font-size:11.5px;transition:color 100ms ease-out,background-color 100ms ease-out}
.diple-drawer-action:hover:not(:disabled){color:var(--ui-text-primary);background:var(--chrome-action-hover,var(--ui-bg-tertiary));transition:none}
.diple-drawer-action:disabled{opacity:.45;cursor:default}
.diple-drawer-close{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:0;border-radius:4px;background:none;color:var(--ui-text-tertiary);font-size:14px;line-height:1;cursor:pointer}
.diple-drawer-close:hover{background:var(--chrome-action-hover,var(--ui-bg-tertiary));color:var(--ui-text-primary)}
.diple-drawer-filters{display:flex;flex-wrap:wrap;gap:2px;padding:0 8px 6px;border-bottom:1px solid var(--ui-stroke-tertiary,var(--ui-stroke-secondary))}
.diple-drawer-filter{display:inline-flex;align-items:center;gap:4px;padding:1px 7px;border:0;border-radius:var(--radius-sm,2px);background:transparent;color:var(--ui-text-tertiary);font-size:11.5px;cursor:pointer;transition:background-color 100ms ease-out,color 100ms ease-out}
.diple-drawer-filter:hover:not(:disabled){color:var(--ui-text-primary);transition:none}
.diple-drawer-filter[aria-pressed="true"]{background:var(--ui-bg-quaternary,var(--ui-bg-tertiary));color:var(--ui-text-primary)}
.diple-drawer-filter:disabled{opacity:.4;cursor:default}
.diple-drawer-filter-n{font-variant-numeric:tabular-nums;color:var(--ui-text-quaternary,var(--ui-text-tertiary))}
.diple-drawer-list{overflow:auto;overscroll-behavior:contain;padding:4px 0 6px}
.diple-drawer-empty{padding:16px 12px;color:var(--ui-text-tertiary);text-align:center}
.diple-drawer-section+.diple-drawer-section{margin-top:4px}
.diple-drawer-section-title{padding:6px 12px 2px;color:var(--ui-text-tertiary);font-size:11px;letter-spacing:.02em}
.diple-drawer-row{display:flex;align-items:flex-start;gap:8px;width:100%;padding:5px 12px;border:0;background:transparent;color:inherit;text-align:start;cursor:pointer;transition:background-color 100ms ease-out}
.diple-drawer-row:hover:not(:disabled),.diple-drawer-row:focus-visible{background:var(--chrome-action-hover,var(--ui-bg-tertiary));transition:none;outline:none}
.diple-drawer-row:disabled{cursor:default}
.diple-drawer-row .diple-chip-n{margin-top:2px}
.diple-drawer-row-body{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1}
.diple-drawer-row-text{color:var(--ui-text-primary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.diple-drawer-row-comment{color:var(--ui-text-secondary);overflow:hidden;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.diple-drawer-row-origin{color:var(--ui-text-quaternary,var(--ui-text-tertiary));font-size:11px}
.diple-drawer-section[data-diple-section="missing"] .diple-drawer-section-title{color:var(--ui-yellow)}
@keyframes diple-pop{from{opacity:0;transform:translateY(2px) scale(.98)}to{opacity:1;transform:none}}
@keyframes diple-drawer-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@keyframes diple-chip-in{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:none}}
@keyframes diple-fade{from{opacity:0}to{opacity:1}}
${PassageLook.css('.diple-preview-text', { maxHeight: '9.5em' })}
${PassageLook.css('.diple-preview-comment', { maxHeight: '6.5em' })}
/* the send split button and its menu (V2.1 #8; the menu is desktop-kit's) */
.diple-send-split{position:relative;display:inline-flex;align-items:stretch;gap:1px;flex:none}
.diple-send-split>.diple-btn:first-child,.diple-send-split>button:first-child{white-space:nowrap}
.diple-send-more{display:inline-flex;align-items:center;justify-content:center;width:20px;padding:0;border:0;border-radius:0;background:var(--ui-accent);color:var(--ui-bg-primary,var(--background));cursor:pointer}
.diple-send-more:hover{background:color-mix(in srgb,var(--ui-accent) 88%,var(--ui-text-primary))}
.diple-send-more:focus-visible{outline:2px solid var(--ui-accent);outline-offset:1px}
.diple-send-more .codicon{font-size:12px}
${SEND_MENU_CSS}
@media (prefers-reduced-motion: reduce){
  .diple-chip-wrap,.diple-chip-preview,.diple-drawer,.diple-strip-hint{animation:none}
  .diple-chip,.diple-chip-remove,.diple-drawer-row,.diple-drawer-filter,.diple-drawer-action,.diple-btn{transition:none}
}
`
