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
.lme[data-fill] .lme-split { gap: 0; align-items: stretch; min-height: 0; }
.lme[data-fill] .lme-left { position: static; min-height: 0; grid-template-rows: minmax(0, 1fr) auto; padding: 10px 0 10px 10px; }
.lme[data-fill] .lme-code { min-height: 0; }
.lme[data-fill] .lme-code .cm-editor { height: 100%; }
.lme[data-fill] .lme-preview { min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 12px 16px 24px; }
.lme[data-fill] .lme-preview[hidden] { display: none; }
/* a canvas: the diagram fills what the bar leaves, the code floats over its left, the panel stands on its right */
.lme[data-canvas] > .lme-split { position: relative; display: block; overflow: hidden; }
.lme[data-canvas] .lme-preview { position: absolute; inset: 0; padding: 0; overflow: hidden; }
.lme[data-canvas] .lme-preview > .lm { --lm-pad: 0; --lm-root-bg: transparent; position: absolute; inset: 0; }
.lme[data-canvas] .lme-preview > .lme-empty { margin: 72px 24px 0 calc(var(--lme-card) + 3 * var(--lme-gap)); }
.lme-canvas { position: absolute; inset: 0; }
.lme-canvas > .lm-wrap { position: absolute; inset: 0; }
.lme-canvas .lm-board { height: 100%; border: 0; border-radius: 0; background-color: var(--lm-bg); background-image: radial-gradient(color-mix(in srgb, var(--lm-muted) 30%, transparent) 1px, transparent 1.3px); background-size: 22px 22px; }
.lme-over { position: absolute; z-index: 2; left: var(--lme-l); right: var(--lme-r); display: flex; justify-content: center; padding: 0 12px; pointer-events: none; }
.lme-over > * { pointer-events: auto; max-width: min(760px, 100%); }
.lme-over-top { top: 12px; }
.lme-over-bottom { bottom: 60px; }
/* the legend and the zoom along the bottom edge, the story just above them: Fit leaves room for all three. The legend
   keeps to one line, clipped where the canvas is narrow */
.lme-canvas .lm-wrap[data-canvas] > .lm-bar, .lme-canvas .lm-wrap[data-canvas] .lm-zoom { bottom: 12px; }
.lme-canvas .lm-wrap[data-canvas] > .lm-bar .lm-legend { flex-wrap: nowrap; overflow: hidden; white-space: nowrap; }
.lme-over-note { top: 64px; justify-content: flex-start; }
.lme-over .lm-scenarios, .lme-over .lm-story { margin: 0; padding: 6px 10px; background: var(--lm-surface); border: 1px solid var(--lm-line); border-radius: 10px; box-shadow: 0 6px 20px rgb(0 0 0 / .12); }
.lme-over .lme-stale { margin: 0; padding: 4px 10px; background: var(--lm-surface); border: 1px solid var(--lm-warn); border-radius: 6px; }
.lme[data-canvas] .lme-left { position: absolute; z-index: 3; top: var(--lme-gap); bottom: var(--lme-gap); left: var(--lme-gap); width: var(--lme-card); padding: 0; gap: 0; grid-template-rows: auto minmax(0, 1fr) auto; background: var(--lm-surface); border: 1px solid var(--lm-line); border-radius: 10px; box-shadow: 0 8px 28px rgb(15 30 45 / .16); overflow: hidden; }
.lme-card-head { display: flex; align-items: center; gap: 8px; padding: 6px 8px 6px 12px; border-bottom: 1px solid var(--lm-line); }
.lme-card-head b { font-size: .84rem; }
.lme[data-canvas] .lme-code { border: 0; border-radius: 0; }
.lme[data-canvas] .lme-problems { padding: 6px; border-top: 1px solid var(--lm-line); }
.lme-resize { position: absolute; z-index: 4; top: var(--lme-gap); bottom: var(--lme-gap); left: calc(var(--lme-gap) + var(--lme-card) - 5px); width: 10px; cursor: col-resize; touch-action: none; }
.lme-resize::after { content: ""; position: absolute; top: 50%; left: 3px; width: 4px; height: 40px; margin-top: -20px; border-radius: 2px; background: var(--lm-muted); opacity: .35; }
.lme-resize:hover::after, .lme-resize:focus-visible::after, .lme[data-dragging] .lme-resize::after { background: var(--lm-accent); opacity: 1; }
.lme-resize:focus-visible { outline: none; }
.lme-tab { position: absolute; z-index: 3; top: var(--lme-gap); left: var(--lme-gap); width: var(--lme-tab); padding: 12px 0; display: flex; align-items: center; gap: 8px; writing-mode: vertical-rl; font: 600 .8rem var(--lm-font); color: var(--lm-fg); background: var(--lm-surface); border: 1px solid var(--lm-line); border-radius: 10px; box-shadow: 0 8px 28px rgb(15 30 45 / .16); cursor: pointer; }
.lme-tab[data-errors]::after { content: attr(data-errors); padding: 3px 2px; border-radius: 8px; font-size: .7rem; color: var(--lm-surface); background: var(--lm-drop); }
.lme-tab:focus-visible { outline: 2px solid var(--lm-accent); outline-offset: 2px; }
.lme-panel { position: absolute; z-index: 5; top: 0; right: 0; bottom: 0; width: var(--lme-panel); display: grid; grid-template-rows: auto minmax(0, 1fr); background: var(--lm-surface); border-left: 1px solid var(--lm-line); }
.lme-panel[hidden] { display: none; }
.lme-panel[data-mode="auto"] { top: 8px; right: calc(var(--lme-rail) + 8px); bottom: 8px; max-width: calc(100% - var(--lme-rail) - 24px); border: 1px solid var(--lm-line); border-radius: 10px; box-shadow: -8px 0 30px rgb(0 0 0 / .18); }
.lme-panel:focus { outline: none; }
.lme-panel:focus-visible { outline: 2px solid var(--lm-accent); outline-offset: -2px; }
.lme-panel-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px 8px 14px; border-bottom: 1px solid var(--lm-line); }
.lme-panel-head h2 { flex: 1; margin: 0; font: 600 .92rem var(--lm-font); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lme-panel-body { padding: 4px 14px 16px; overflow: auto; overscroll-behavior: contain; container-type: inline-size; }
.lme-sec { padding: 8px 0; border-top: 1px solid var(--lm-line); }
.lme-panel-body > .lme-sec:first-child, .lme-panel-body > .lme-inspector + .lme-sec { border-top: 0; }
.lme-sec > summary { padding: 4px 0; cursor: pointer; font: 700 .72rem var(--lm-font); letter-spacing: .08em; text-transform: uppercase; color: var(--lm-muted); }
.lme-sec[open] > summary { margin-bottom: 8px; }
.lme-sec > :not(summary) > h3:first-child { display: none; }
.lme[data-fill] .lme-panel .lme-inspector { position: static; max-height: none; padding: 8px 0 12px; border: 0; border-bottom: 1px solid var(--lm-line); border-radius: 0; box-shadow: none; }
.lme-rail { position: absolute; z-index: 4; top: 0; right: 0; bottom: 0; width: var(--lme-rail); display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 14px 0; font: 600 .76rem var(--lm-font); color: var(--lm-fg); background: var(--lm-surface); border: 0; border-left: 1px solid var(--lm-line); cursor: pointer; }
.lme-rail span { writing-mode: vertical-rl; }
.lme-rail i { width: 12px; height: 12px; border-radius: 50%; background: var(--lm-ok); }
.lme-rail[data-tier="warn"] i { background: var(--lm-warn); }
.lme-rail[data-tier="over"] i { background: var(--lm-drop); }
.lme-rail:focus-visible { outline: 2px solid var(--lm-accent); outline-offset: -2px; }
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
