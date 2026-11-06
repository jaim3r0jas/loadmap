/** The editor's layout. It sits inside `.lm`, so it takes loadmap's theme tokens; the preview nests its own `.lm`. */
export const EDITOR_CSS = `
.lme { grid-template-rows: auto minmax(0, 1fr); }
.lme-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.lme-grow { flex: 1; }
.lme-status { font: 500 .8rem var(--lm-font); color: var(--lm-drop); }
.lme-status[data-ok="true"] { color: var(--lm-ok); }
.lme-note { font-size: .8rem; color: var(--lm-muted); }
.lme-embed { position: relative; }
.lme-embed > summary { list-style: none; }
.lme-embed > summary::-webkit-details-marker { display: none; }
.lme-split { display: grid; grid-template-columns: minmax(320px, 2fr) minmax(0, 3fr); gap: 14px; align-items: start; min-width: 0; }
@container (max-width: 980px) { .lme-split { grid-template-columns: minmax(0, 1fr); } }
.lme-left { display: grid; gap: 8px; min-width: 0; position: sticky; top: 8px; }
.lme-left[hidden] { display: none; }
/* the reader keeps the inspector beside the diagram down to a docs column; below that it is a sheet */
.lme-split[data-layout="reader"] { grid-template-columns: minmax(0, 1fr) minmax(220px, 260px); }
@container (max-width: 720px) { .lme-split[data-layout="reader"] { grid-template-columns: minmax(0, 1fr); } }
@container (max-width: 980px) { .lme-left { position: static; } }
.lme-code { background: var(--lm-surface); border: 1px solid var(--lm-line); border-radius: 8px; overflow: hidden; min-width: 0; }
.lme-code .cm-editor { height: min(78vh, 900px); font: 13px/1.5 var(--lm-mono); color: var(--lm-fg); background: var(--lm-surface); }
@container (max-width: 980px) { .lme-code .cm-editor { height: 55vh; } }
.lme-code .cm-editor.cm-focused { outline: 2px solid var(--lm-accent); outline-offset: -2px; }
.lme-code .cm-scroller { font-family: var(--lm-mono); }
.lme-code .cm-gutters { background: var(--lm-bg); color: var(--lm-muted); border-right: 1px solid var(--lm-line); }
.lme-code .cm-activeLine { background: color-mix(in srgb, var(--lm-accent-soft) 45%, transparent); }
.lme-code .cm-activeLineGutter { background: var(--lm-accent-soft); }
.lme-code .cm-cursor { border-left-color: var(--lm-fg); }
.lme-code .cm-selectionBackground, .lme-code .cm-focused .cm-selectionBackground { background: var(--lm-accent-soft) !important; }
.lme-code .cm-tooltip { background: var(--lm-surface); color: var(--lm-fg); border: 1px solid var(--lm-line); border-radius: 6px; font-family: var(--lm-font); }
.lme-code .cm-tooltip-autocomplete ul li[aria-selected] { background: var(--lm-accent); color: var(--lm-surface); }
.lme-code .cm-completionInfo { max-width: 340px; white-space: pre-wrap; font-size: .78rem; }
.lme-code .cm-diagnostic { font-family: var(--lm-font); font-size: .8rem; }
.lme-code .cm-diagnostic-error { border-left-color: var(--lm-drop); }
.lme-code .cm-diagnostic-warning { border-left-color: var(--lm-warn); }
.lme-code .cm-lintRange-error { background-image: none; text-decoration: wavy underline var(--lm-drop); text-underline-offset: 3px; }
.lme-code .cm-lintRange-warning { background-image: none; text-decoration: wavy underline var(--lm-warn); text-underline-offset: 3px; }
.lme-problems { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; max-height: 22vh; overflow: auto; }
.lme-problems button { all: unset; display: block; cursor: pointer; font-size: .8rem; padding: 4px 8px; border-left: 3px solid var(--lm-drop); background: var(--lm-surface); border-radius: 0 4px 4px 0; }
.lme-problems li[data-severity="warning"] button { border-left-color: var(--lm-warn); }
.lme-problems button:focus-visible { outline: 2px solid var(--lm-accent); }
.lme-problems small { display: block; color: var(--lm-muted); }
.lme-at { font-family: var(--lm-mono); color: var(--lm-muted); }
.lme-preview { min-width: 0; position: relative; }
.lme-preview > .lm { --lm-pad: 0; }
.lme-preview[data-stale] > .lm { opacity: .55; }
.lme-stale { margin: 0 0 8px; font-size: .8rem; color: var(--lm-warn); }
.lme-inspector { position: sticky; z-index: 3; top: 8px; max-height: calc(100vh - 16px); overflow: auto; display: grid; gap: 10px; align-content: start; background: var(--lm-surface); border: 1px solid var(--lm-line); border-radius: 8px; padding: 10px 12px; font-size: .84rem; min-width: 0; }
/* on a narrow page the inspector sits at the bottom of the screen, over the long page above it */
@container (max-width: 720px) { .lme-inspector { top: auto; bottom: 0; max-height: 50vh; box-shadow: 0 -6px 18px rgb(0 0 0 / .12); } }
.lme-inspector:focus { outline: none; }
.lme-inspector:focus-visible { outline: 2px solid var(--lm-accent); outline-offset: 2px; }
.lme-inspector h3 { margin: 0; font: 600 1rem var(--lm-font); text-transform: none; letter-spacing: 0; color: var(--lm-fg); }
.lme-tabs { display: flex; gap: 6px; }
.lme-tabs [aria-selected="true"] { background: var(--lm-accent); color: var(--lm-surface); border-color: var(--lm-accent); }
.lme-hint { margin: 0; color: var(--lm-muted); }
.lme-hint[data-kind="blocked"] { color: var(--lm-drop); }
.lme-section { border: 0; border-top: 1px solid var(--lm-line); margin: 0; padding: 8px 0 0; display: grid; gap: 8px; min-width: 0; }
.lme-section > legend { padding: 0 6px 0 0; font-weight: 600; color: var(--lm-muted); font-size: .76rem; text-transform: uppercase; letter-spacing: .03em; }
.lme-section details { display: grid; gap: 8px; }
.lme-section summary { cursor: pointer; color: var(--lm-muted); font-size: .8rem; }
.lme-section details[open] > summary { margin-bottom: 8px; }
.lme-field { display: grid; gap: 3px; min-width: 0; border: 0; margin: 0; padding: 0; }
.lme-field > legend { padding: 0; margin-bottom: 3px; }
.lme-field > label, .lme-field > legend { font-weight: 500; }
.lme-field[data-kind="boolean"] { grid-template-columns: auto 1fr; align-items: center; }
.lme-field[data-kind="boolean"] > label { order: 2; }
.lme-inspector input[type="text"], .lme-inspector select { min-width: 0; font: 400 .84rem var(--lm-font); color: var(--lm-fg); background: var(--lm-bg); border: 1px solid var(--lm-line); border-radius: 5px; padding: 4px 7px; }
.lme-inspector input[type="checkbox"] { accent-color: var(--lm-accent); margin: 0; }
.lme-inspector input:disabled { opacity: .6; }
.lme-capacity { gap: 6px; }
.lme-row { display: grid; grid-template-columns: 72px minmax(0, 1fr) auto; gap: 6px; align-items: center; }
.lme-row > :last-child:nth-child(2) { grid-column: 2 / 4; }
.lme-formula { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; min-width: 0; }
.lme-formula code { font: 12px/1.4 var(--lm-mono); color: var(--lm-muted); white-space: pre-wrap; overflow-wrap: anywhere; }
.lme-formula input[type="text"] { width: auto; font-family: var(--lm-mono); }
.lme-field small { color: var(--lm-muted); font-size: .74rem; }
.lme-field .lme-error { color: var(--lm-drop); }
/* fill: the editor is the whole of its container; each side scrolls on its own */
.lme[data-fill] { --lm-pad: 0; height: 100%; gap: 0; grid-template-rows: auto minmax(0, 1fr); }
.lme[data-fill][data-narrow]:not(:has(> .lme-split[data-layout="reader"])) { grid-template-rows: auto auto minmax(0, 1fr); }
.lme[data-fill][data-dragging] { user-select: none; cursor: col-resize; }
.lme[data-fill] > .lme-bar { padding: 6px 10px; gap: 6px; background: var(--lm-surface); border-bottom: 1px solid var(--lm-line); }
.lme[data-fill] > .lme-bar select { max-width: 12rem; }
.lme[data-fill] .lme-split { gap: 0; align-items: stretch; min-height: 0; grid-template-columns: var(--lme-share, 40%) 9px minmax(0, 1fr); }
.lme[data-fill] .lme-left { position: static; min-height: 0; grid-template-rows: minmax(0, 1fr) auto; padding: 10px 0 10px 10px; }
.lme[data-fill] .lme-code { min-height: 0; }
.lme[data-fill] .lme-code .cm-editor { height: 100%; }
.lme[data-fill] .lme-preview { min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 12px 16px 24px; }
.lme[data-fill] .lme-preview[hidden] { display: none; }
.lme-divider { position: relative; cursor: col-resize; touch-action: none; }
.lme-divider::before { content: ""; position: absolute; top: 0; bottom: 0; left: 4px; width: 1px; background: var(--lm-line); }
.lme-divider::after { content: ""; position: absolute; top: 50%; left: 3px; width: 3px; height: 32px; margin-top: -16px; border-radius: 2px; background: var(--lm-muted); opacity: .45; }
.lme-divider:hover::before, .lme-divider:focus-visible::before, .lme[data-dragging] .lme-divider::before { left: 3px; width: 3px; background: var(--lm-accent); }
.lme-divider:focus-visible { outline: none; }
.lme[data-fill] .lme-split[data-layout="reader"] { grid-template-columns: minmax(0, 1fr) minmax(240px, 280px); }
.lme[data-fill] .lme-inspector { position: static; max-height: none; border-width: 0 0 0 1px; border-radius: 0; box-shadow: none; }
.lme[data-fill][data-narrow] .lme-split { grid-template-columns: minmax(0, 1fr); }
.lme[data-fill][data-narrow] .lme-left { padding: 8px; }
.lme[data-fill][data-narrow] .lme-split[data-layout="reader"] { grid-template-rows: minmax(0, 1fr) auto; }
.lme[data-fill][data-narrow] .lme-inspector { max-height: 45dvh; border-width: 1px 0 0; box-shadow: 0 -6px 18px rgb(0 0 0 / .12); }
.lme-panes { display: flex; gap: 6px; padding: 6px 10px; background: var(--lm-surface); border-bottom: 1px solid var(--lm-line); }
.lme-panes > button { flex: 1; }
.lme-panes [aria-selected="true"] { background: var(--lm-accent); color: var(--lm-surface); border-color: var(--lm-accent); }
.lme-more { position: relative; }
.lme-more > summary { list-style: none; }
.lme-more > summary::-webkit-details-marker { display: none; }
.lme-menu { position: absolute; z-index: 10; right: 0; top: calc(100% + 4px); display: grid; gap: 6px; min-width: 210px; padding: 8px; background: var(--lm-surface); border: 1px solid var(--lm-line); border-radius: 8px; box-shadow: 0 10px 30px rgb(0 0 0 / .18); }
.lme-menu > * { width: 100%; text-align: left; }
.lme-empty { margin: 0; padding: 40px 16px; text-align: center; color: var(--lm-muted); border: 1px dashed var(--lm-line); border-radius: 8px; }
`

export function injectEditorStyles(doc: Document = document): void {
  if (doc.getElementById('loadmap-editor-css')) return
  const el = doc.createElement('style')
  el.id = 'loadmap-editor-css'
  el.textContent = EDITOR_CSS
  doc.head.appendChild(el)
}
