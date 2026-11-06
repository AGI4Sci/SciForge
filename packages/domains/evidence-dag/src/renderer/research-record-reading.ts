/** Presentation-only reading controls; never change UI/native or image zoom. */
export const RESEARCH_READING_SIZES = [14, 16, 18, 20, 24, 28, 32] as const
export const RESEARCH_READING_DEFAULT = 16
const key = 'sciforge.research-record.reading-size'
export function readResearchReadingSize(): number {
  try {
    const value = Number(globalThis.localStorage?.getItem(key))
    if (RESEARCH_READING_SIZES.some(size => size === value)) return value
  } catch { /* Reading does not require browser storage. */ }
  return RESEARCH_READING_DEFAULT
}
export function saveResearchReadingSize(value: number): number {
  const size = RESEARCH_READING_SIZES.some(size => size === value) ? value : RESEARCH_READING_DEFAULT
  try { globalThis.localStorage?.setItem(key, String(size)) } catch { /* Keep an in-memory preference. */ }
  return size
}
export const researchRecordReadingStyles = `
.sf-research-reading { container: research-reading / inline-size; font-size: var(--record-reading-size, 16px); line-height: 1.6; }
.sf-research-reading .record-text { font-size: var(--record-reading-size, 16px); line-height: 1.6; }
.sf-research-reading .record-title { font-size: calc(var(--record-reading-size, 16px) * 1.125); line-height: 1.45; }
.sf-research-reading .record-caption { font-size: calc(var(--record-reading-size, 16px) * .8125); line-height: 1.55; }
.sf-research-reading .record-code { font-size: calc(var(--record-reading-size, 16px) * .875); line-height: 1.6; tab-size: 4; }
.sf-research-reading button, .sf-research-reading summary { overflow-wrap: anywhere; }
.sf-research-reading .record-index { min-width: 1.75em; white-space: nowrap; }
.sf-research-reading .record-step-header { flex-wrap: wrap; }
.sf-research-reading .record-step-title { flex-basis: 45%; }
.sf-research-reading .record-reading-controls { font-size: 13px; line-height: 1.4; }
.sf-research-reading .record-reading-controls button { min-width: 28px; min-height: 28px; }
.sf-research-reading .record-panel-header { max-height: 45%; overflow-y: auto; }
.sf-research-reading .record-view-tabs button { font-size: 13px; line-height: 1.5; min-height: 32px; }
@container research-reading (max-width: 480px) {
 .sf-research-reading .record-scroll { padding-inline: 12px; }
 .sf-research-reading .record-children { margin-left: 10px; }
 .sf-research-reading .record-chapter { padding-left: 10px; }
 .sf-research-reading .record-synthesis-indent { margin-left: 10px; }
 .sf-research-reading .record-description { -webkit-line-clamp: 3; }
}

.sf-research-reading { --record-check:#99524b; --record-check-line:#bd8e87; --record-check-soft:#99524b08; --record-active:#4d6b7b; --record-done:#4e6c58; }
[data-theme='dark'] .sf-research-reading { --record-check:#e0aaa2; --record-check-line:#8f6862; --record-check-soft:#e0aaa20b; --record-active:#aac4d3; --record-done:#a8c7b0; }
.sf-research-reading .record-operation-icon { display:inline-block; flex-shrink:0; vertical-align:-2px; margin-right:6px; color:var(--ds-text-muted); }
.sf-research-reading .record-status { display:inline-flex; max-width:100%; align-items:center; gap:4px; margin-left:8px; padding:2px 6px; border-radius:5px; font-size:calc(var(--record-reading-size,16px) * .75); font-weight:500; line-height:1.5; vertical-align:middle; color:var(--ds-text-muted); }
.sf-research-reading .record-source-status[data-record-tone='check'], .sf-research-reading .record-status[data-record-tone='check'], .sf-research-reading .record-check-text { color:var(--record-check); }
.sf-research-reading .record-source-status[data-record-tone='active'], .sf-research-reading .record-status[data-record-tone='active'] { color:var(--record-active); background:color-mix(in srgb,var(--record-active) 8%,transparent); }
.sf-research-reading .record-source-status[data-record-tone='done'], .sf-research-reading .record-status[data-record-tone='done'] { color:var(--record-done); background:color-mix(in srgb,var(--record-done) 8%,transparent); }
.sf-research-reading .record-node-head { border:1px solid transparent; border-radius:9px; padding:6px; }
.sf-research-reading .record-node-head[data-record-tone='check'] { border-color:var(--record-check-line); background:var(--record-check-soft); }
.sf-research-reading .record-node-head[data-record-tone='active'] { border-left-color:var(--record-active); }
.sf-research-reading [data-narrative-layer='capability'] > .record-node-head { background:var(--ds-surface-subtle); }
.sf-research-reading [data-narrative-layer='behavior'] > .record-node-head { border-left:2px solid var(--ds-border); border-radius:0 7px 7px 0; }
.sf-research-reading .record-review-item, .sf-research-reading .record-state-entry { padding:10px 12px; border:1px solid var(--ds-border); border-radius:9px; }
.sf-research-reading .record-review-item[data-record-tone='check'], .sf-research-reading .record-state-entry[data-record-tone='check'] { border-color:var(--record-check-line); background:var(--record-check-soft); }
.sf-research-reading .record-state-entry[data-record-tone='neutral'] { border-color:transparent; border-left-color:var(--ds-border); border-radius:0; padding-block:4px; }
.sf-research-reading .record-review-tab[data-record-tone='check'][aria-pressed='true'] { color:var(--record-check); background:var(--record-check-soft); box-shadow:inset 0 -2px var(--record-check-line); }

.sf-research-reading .record-body { position:relative; display:flex; flex:1; min-height:0; min-width:0; }
.sf-research-reading .record-inspector { flex:0 0 44%; border-left:1px solid var(--ds-border); min-height:0; }
.sf-research-reading .record-inspector-tabs { display:flex; gap:4px; border-bottom:1px solid var(--ds-border); padding-bottom:8px; }
.sf-research-reading .record-inspector-tabs button { font-size:13px; padding:5px 9px; border-radius:6px; }
.sf-research-reading .record-inspector-tabs button[aria-pressed='true'] { background:var(--ds-hover); font-weight:600; }
.sf-research-reading .record-compact-caption { display:flex; flex-wrap:wrap; justify-content:space-between; gap:8px; font-size:12px; color:var(--ds-text-muted); margin:10px 0; }
.sf-research-reading .record-position-strip { display:flex; gap:3px; height:18px; margin-bottom:12px; }
.sf-research-reading .record-position-strip button { min-width:0; flex:1; border-radius:3px; background:var(--record-active); opacity:.45; }
.sf-research-reading .record-position-strip button[data-tone='check'] { background:var(--record-check); opacity:.85; }
.sf-research-reading .record-position-strip button[aria-pressed='true'] { opacity:1; outline:2px solid var(--ds-text-primary); outline-offset:2px; }
.sf-research-reading .record-compact-row { display:flex; min-width:0; border-bottom:1px solid var(--ds-border); }
.sf-research-reading .record-compact-row:hover, .sf-research-reading .record-compact-row[data-selected='true'] { background:var(--ds-hover); }
.sf-research-reading .record-compact-open { display:flex; flex:1; align-items:center; gap:10px; padding:11px 6px; min-width:0; text-align:left; font-size:var(--record-reading-size); }
.sf-research-reading .record-compact-kind { display:inline-flex; align-items:center; flex:0 0 64px; font-size:12px; color:var(--ds-text-muted); }
.sf-research-reading .record-compact-copy { display:flex; min-width:0; flex:1; gap:10px; align-items:baseline; }
.sf-research-reading .record-compact-title { max-width:65%; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-weight:500; }
.sf-research-reading .record-compact-summary { flex:1; min-width:0; color:var(--ds-text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-size:calc(var(--record-reading-size) * .875); }
.sf-research-reading .record-compact-alert { flex:0 1 auto; max-width:38%; font-size:12px; color:var(--record-check); }
.sf-research-reading .record-compact-status { flex-shrink:0; font-size:12px; color:var(--ds-text-muted); }
.sf-research-reading .record-compact-enter { flex:0 0 28px; display:grid; place-items:center; }
.sf-research-reading .record-image-preview { display:block; width:100%; padding:8px; border:1px solid var(--ds-border); border-radius:8px; }
.sf-research-reading .record-image-preview img { display:block; width:100%; max-height:340px; object-fit:contain; }
@container research-reading (max-width: 800px) {
 .sf-research-reading .record-inspector { position:absolute; inset:0; z-index:10; border-left:0; }
 .sf-research-reading .record-compact-copy { display:block; }
 .sf-research-reading .record-compact-title { display:block; max-width:100%; }
 .sf-research-reading .record-compact-summary { display:block; }
 .sf-research-reading .record-compact-kind { flex-basis:48px; }
}

/* Subtle hierarchy: selected row, exceptional state, then secondary explanation. */
.sf-research-reading .record-compact-row { border-left:2px solid transparent; border-radius:5px; }
.sf-research-reading .record-compact-row[data-selected='true'] { border-left-color:var(--record-active); background:color-mix(in srgb,var(--record-active) 9%,transparent); }
.sf-research-reading .record-compact-row[data-tone='check']:not([data-selected='true']) { border-left-color:var(--record-check-line); }
.sf-research-reading .record-compact-open { padding-inline:9px; }
.sf-research-reading .record-compact-title { min-width:0; }
.sf-research-reading .record-compact-status { opacity:.7; }
.sf-research-reading .record-compact-alert { line-height:1.5; }
.sf-research-reading .record-compact-enter:focus-visible, .sf-research-reading .record-compact-open:focus-visible, .sf-research-reading .record-inspector-tabs button:focus-visible { outline:2px solid var(--record-active); outline-offset:-2px; border-radius:5px; }
.sf-research-reading .record-inspector-tabs button[aria-pressed='true'] { box-shadow:inset 0 -2px var(--record-active); }
.sf-research-reading .record-position-strip { height:12px; }
.sf-research-reading .record-position-strip button[aria-pressed='true'] { outline-color:var(--record-active); }
.sf-research-reading .record-search input { min-height:32px; padding-inline:8px; }
.sf-research-reading .record-search details { font-size:12px; }
.sf-research-reading .record-detail-error { display:grid; gap:10px; padding:12px; border:1px solid var(--record-check-line); border-radius:8px; }
.sf-research-reading .record-detail-error button { justify-self:start; }
@container research-reading (max-width:480px) {
 .sf-research-reading .record-compact-open { flex-wrap:wrap; gap:5px 8px; }
 .sf-research-reading .record-compact-copy { flex-basis:calc(100% - 64px); }
 .sf-research-reading .record-compact-alert { max-width:100%; margin-left:56px; }
 .sf-research-reading .record-compact-status { display:none; }
}
`
