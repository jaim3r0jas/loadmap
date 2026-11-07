/** The editor's layout. It sits inside `.lm`, so it takes loadmap's theme tokens; the preview nests its own `.lm`. */
export const EDITOR_CSS = `
.lme { grid-template-rows: auto minmax(0, 1fr); }
.lme-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.lme-grow { flex: 1; }
.lme-status { font: 500 .8rem var(--lm-font); color: var(--lm-drop); }
.lme-status[data-ok="true"] { color: var(--lm-ok); }
.lme-note { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .8rem; color: var(--lm-muted); }
.lme-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 600 .88rem var(--lm-font); }
/* the bar's controls: one height, one line; quiet ones without a border, Share filled */
.lme-tools { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
:is(.lme-bar, .lme-tools, .lme-share) > .lm-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; box-sizing: border-box; height: 32px; padding: 0 10px; flex: none; text-decoration: none; }
.lme-svg { flex: none; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.lme-chev { width: 12px; height: 12px; margin-right: -3px; color: var(--lm-muted); }
.lm-btn.lme-icon { width: 32px; padding: 0; }
.lm-btn.lme-quiet { color: var(--lm-muted); background: transparent; border-color: transparent; }
.lm-btn.lme-quiet:hover, .lm-btn.lme-quiet[aria-expanded="true"] { color: var(--lm-fg); background: color-mix(in srgb, var(--lm-fg) 8%, transparent); }
.lme .lm-btn[aria-expanded="true"] { background: color-mix(in srgb, var(--lm-fg) 8%, var(--lm-surface)); }
.lme .lm-btn[aria-disabled="true"] { opacity: .45; cursor: default; }
.lme .lm-btn:focus-visible { outline: 2px solid var(--lm-accent); outline-offset: 1px; }
.lm-btn.lme-primary { color: var(--lm-surface); background: var(--lm-accent); border-color: var(--lm-accent); font-weight: 600; }
.lm-btn.lme-primary[aria-expanded="true"] { background: color-mix(in srgb, var(--lm-fg) 25%, var(--lm-accent)); }
.lme-share { display: inline-flex; flex: none; }
.lme-share > .lm-btn:not(:only-of-type):first-child { border-radius: 6px 0 0 6px; }
.lme-share > .lm-btn + .lm-btn { width: 28px; padding: 0; border-radius: 0 6px 6px 0; border-left-color: color-mix(in srgb, var(--lm-surface) 40%, var(--lm-accent)); }
.lme-share .lme-chev { width: 14px; height: 14px; margin: 0; color: inherit; }
.lm-btn.lme-fold { display: none; }
/* an editor in a narrow column: View, New and Export in one menu, the bar one row */
@container (width < 560px) { .lme:not([data-fill]) .lm-btn.lme-wide { display: none; } .lme:not([data-fill]) .lm-btn.lme-fold { display: inline-flex; } }
.lme-sep { flex: none; width: 1px; height: 20px; margin: 0 2px; background: var(--lm-line); }
/* menus and the embed's options: in the top layer, placed under their button */
.lme-menu, .lme-pop { position: fixed; inset: auto; margin: 0; box-sizing: border-box; overflow: auto; overscroll-behavior: contain; color: var(--lm-fg); background: var(--lm-surface); border: 1px solid var(--lm-line); border-radius: 10px; box-shadow: 0 10px 30px rgb(0 0 0 / .18); font: 400 .84rem var(--lm-font); }
.lme-menu { min-width: 200px; max-width: min(340px, calc(100vw - 16px)); padding: 5px; }
.lme-pop { width: min(360px, calc(100vw - 16px)); padding: 12px 14px; }
.lme-menu:popover-open, .lme-pop:popover-open { animation: lme-in .12s ease-out; }
@keyframes lme-in { from { opacity: 0; transform: translateY(-4px); } }
@media (prefers-reduced-motion: reduce) { .lme-menu:popover-open, .lme-pop:popover-open { animation: none; } }
.lme-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-content: center; width: 100%; min-height: 32px; padding: 6px 10px; text-align: left; font: inherit; color: var(--lm-fg); background: none; border: 0; border-radius: 6px; cursor: pointer; }
.lme-item small { grid-column: 1; color: var(--lm-muted); font-size: .76rem; line-height: 1.35; }
.lme-item:hover, .lme-item:focus { background: var(--lm-accent-soft); outline: none; }
.lme-item:focus-visible { outline: 2px solid var(--lm-accent); outline-offset: -2px; }
.lme-item[role="menuitemradio"] { padding-left: 30px; position: relative; }
.lme-item[aria-checked="true"]::before { content: "✓" / ""; position: absolute; left: 11px; top: 6px; color: var(--lm-accent); font-weight: 700; }
.lme-mh { padding: 8px 10px 4px; font: 700 .68rem var(--lm-font); letter-spacing: .07em; text-transform: uppercase; color: var(--lm-muted); }
.lme-menu > [role="group"] + *, .lme-menu > * + [role="group"] { margin-top: 4px; padding-top: 2px; border-top: 1px solid var(--lm-line); }
@media (pointer: coarse) { .lme-item { min-height: 44px; } }
@media (pointer: coarse) {
  :is(.lme-bar, .lme-tools, .lme-share) > .lm-btn { height: 44px; min-width: 44px; }
}
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
.lme-code .cm-gutters { background: var(--lm-surface); color: var(--lm-muted); border-right: 1px solid var(--lm-line); }
.lme-code .cm-activeLine { background: color-mix(in srgb, var(--lm-accent-soft) 45%, transparent); }
.lme-code .cm-activeLineGutter { background: var(--lm-accent-soft); }
/* the caret in the theme's own text colour, light on a dark theme: CodeMirror's base theme makes it black, as specific
   as one class and injected later, so this takes the editor's own class too */
.lme .lme-code .cm-editor .cm-content { caret-color: var(--lm-fg); }
.lme .lme-code .cm-editor .cm-cursor, .lme .lme-code .cm-editor .cm-dropCursor { border-left-color: var(--lm-fg); }
.lme-code .cm-selectionBackground, .lme-code .cm-focused .cm-selectionBackground { background: var(--lm-accent-soft) !important; }
.lme-code .cm-tooltip { background: var(--lm-surface); color: var(--lm-fg); border: 1px solid var(--lm-line); border-radius: 6px; font-family: var(--lm-font); }
.lme-code .cm-tooltip-autocomplete ul li[aria-selected] { background: var(--lm-accent); color: var(--lm-surface); }
.lme-code .cm-completionInfo { max-width: 340px; white-space: pre-wrap; font-size: .78rem; }
.lme-code .lm-hover { max-width: min(380px, 90vw); padding: 6px 9px; font-size: .78rem; line-height: 1.45; }
.lme-code .lm-hover p { margin: 4px 0 0; }
.lme-code .lm-hover code { font-family: var(--lm-mono); }
.lme-code .lm-hover-head { display: block; font-weight: 600; overflow-wrap: anywhere; }
.lme-code .lm-hover-note, .lme-code .lm-signature p { color: var(--lm-muted); }
.lme-code .lm-signature-active { color: var(--lm-accent); text-decoration: underline; }
.lme-code .lm-occurrence { background: var(--lm-accent-soft); border-radius: 2px; }
.lme-code .lm-rename input { font: 13px var(--lm-mono); color: var(--lm-fg); background: var(--lm-bg); border: 1px solid var(--lm-accent); border-radius: 4px; padding: 2px 6px; width: 16ch; }
.lme-code .lm-rename p { margin: 4px 0 0; color: var(--lm-drop); }
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
.lme[data-fill][data-dragging] { user-select: none; cursor: col-resize; }
.lme[data-fill] > .lme-bar { flex-wrap: nowrap; min-height: 48px; box-sizing: border-box; padding: 0 10px; gap: 8px; background: var(--lm-surface); border-bottom: 1px solid var(--lm-line); }
.lme[data-fill] .lme-tools { flex: none; flex-wrap: nowrap; }
.lme[data-fill] .lme-split { gap: 0; align-items: stretch; min-height: 0; }
.lme[data-fill] .lme-left { position: static; min-height: 0; grid-template-rows: minmax(0, 1fr) auto; padding: 10px 0 10px 10px; }
.lme[data-fill] .lme-code { min-height: 0; }
.lme[data-fill] .lme-code .cm-editor { height: 100%; }
.lme[data-fill] .lme-preview { min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 12px 16px 24px; }
.lme[data-fill] .lme-preview[hidden] { display: none; }
/* a canvas: the code's panel on the left, the side panel on the right, the diagram filling the room between */
.lme[data-canvas] > .lme-split { position: relative; display: block; overflow: hidden; }
.lme[data-canvas] .lme-preview { position: absolute; inset: 0 0 0 var(--lme-start); padding: 0; overflow: hidden; }
.lme[data-canvas] .lme-preview > .lm { --lm-pad: 0; --lm-root-bg: transparent; position: absolute; inset: 0; }
.lme[data-canvas] .lme-preview > .lme-empty { margin: 72px 24px 0; }
.lme-canvas { position: absolute; inset: 0 var(--lme-r) 0 0; container: lme-canvas / inline-size; }
.lme-canvas > .lm-wrap { position: absolute; inset: 0; }
.lme-canvas .lm-board { height: 100%; border: 0; border-radius: 0; background-color: var(--lm-bg); background-image: radial-gradient(color-mix(in srgb, var(--lm-muted) 30%, transparent) 1px, transparent 1.3px); background-size: 22px 22px; }
.lme-over { position: absolute; z-index: 2; left: 0; right: 0; display: flex; justify-content: center; padding: 0 12px; pointer-events: none; }
.lme-over > * { pointer-events: auto; max-width: min(760px, 100%); }
.lme-over > .lm-loadbar { flex: 1 1 auto; position: static; }
.lme-over-top { top: 12px; }
.lme-over-bottom { bottom: 60px; }
/* the legend and the zoom along the bottom edge, the story just above them: Fit leaves room for all three. The legend
   keeps to one line, clipped where the canvas is narrow */
.lme-canvas .lm-wrap[data-canvas] > .lm-bar, .lme-canvas .lm-wrap[data-canvas] .lm-zoom { bottom: 12px; }
.lme-canvas .lm-wrap[data-canvas] > .lm-bar { box-sizing: border-box; height: 34px; padding: 0 12px; }
.lme-canvas .lm-wrap[data-canvas] > .lm-bar .lm-legend { flex-wrap: nowrap; overflow: hidden; white-space: nowrap; }
.lme-over-note { top: var(--lme-t); justify-content: flex-start; }
/* everything over the canvas on one surface */
.lme-over > :is(.lm-scenarios, .lm-story, .lm-loadbar), .lme-canvas .lm-wrap[data-canvas] > .lm-bar, .lme-canvas .lm-zoom { background: var(--lm-surface); border: 1px solid var(--lm-line); border-radius: 10px; box-shadow: 0 6px 20px rgb(0 0 0 / .12); }
.lme-over > :is(.lm-scenarios, .lm-story, .lm-loadbar) { margin: 0; padding: 6px 10px; }
.lme-over .lme-stale { margin: 0; padding: 4px 10px; background: var(--lm-surface); border: 1px solid var(--lm-warn); border-radius: 6px; }
/* the load on one row beside its label, under the scenarios where the canvas is narrow; the story's text, as tall as
   its longest step, centred beside its buttons */
.lme-over .lm-loadbar .lm-load { grid-template: "label track value" / minmax(0, max-content) minmax(120px, 1fr) auto; align-items: start; }
.lme-over .lm-loadbar .lm-load > label { max-width: 12em; padding-top: 6px; }
.lme-over .lm-story p > span { align-self: center; }
@container lme-canvas (width < 760px) {
  .lme-over :is(.lm-loadbar, .lm-story) legend { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .lme-over .lm-story { flex-wrap: nowrap; }
  .lme-over .lm-story p { flex: 1 1 0; min-width: 0; }
  .lme-over .lm-story-nav { flex: none; }
}
/* the two panels: one frame and one header, flush to their edge with a border on the canvas's side, the edge that
   resizes them, and a rail when folded */
.lme[data-canvas] .lme-pane { position: absolute; z-index: 5; top: 0; bottom: 0; padding: 0; gap: 0; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; background: var(--lm-surface); }
.lme[data-canvas] .lme-pane[hidden] { display: none; }
.lme[data-canvas] .lme-pane[data-side="start"] { left: 0; width: var(--lme-start); border-right: 1px solid var(--lm-line); }
.lme[data-canvas] .lme-pane[data-side="end"] { right: 0; width: var(--lme-panel); border-left: 1px solid var(--lm-line); }
.lme[data-canvas] .lme-pane[data-mode="auto"] { top: 8px; right: calc(var(--lme-rail) + 8px); bottom: 8px; max-width: calc(100% - var(--lme-rail) - 24px); border: 1px solid var(--lm-line); border-radius: 10px; box-shadow: -8px 0 30px rgb(0 0 0 / .18); }
.lme-pane:focus { outline: none; }
.lme-pane:focus-visible { outline: 2px solid var(--lm-accent); outline-offset: -2px; }
.lme-pane-head { display: flex; align-items: center; gap: 8px; box-sizing: border-box; height: 46px; padding: 0 8px 0 14px; border-bottom: 1px solid var(--lm-line); }
.lme .lme-pane-head h2 { flex: none; margin: 0; font: 600 .92rem var(--lm-font); }
.lme-pane-head > .lm-btn { display: inline-flex; align-items: center; justify-content: center; height: 30px; }
.lme-pane-head > .lme-icon { width: 30px; font-size: 1.1rem; }
.lme[data-canvas] .lme-code { border: 0; border-radius: 0; }
.lme[data-canvas] .lme-problems { padding: 6px; border-top: 1px solid var(--lm-line); }
.lme-resize { position: absolute; z-index: 6; top: 0; bottom: 0; width: 10px; cursor: col-resize; touch-action: none; }
.lme-resize[data-side="start"] { right: -5px; }
.lme-resize[data-side="end"] { left: -5px; }
.lme-resize::after { content: ""; position: absolute; top: 50%; left: 3px; width: 4px; height: 40px; margin-top: -20px; border-radius: 2px; background: var(--lm-muted); opacity: .35; }
.lme-resize:hover::after, .lme-resize:focus-visible::after, .lme[data-dragging] .lme-resize::after { background: var(--lm-accent); opacity: 1; }
.lme-resize:focus-visible { outline: none; }
.lme-panel-body { padding: 4px 14px 16px; overflow: auto; overscroll-behavior: contain; container-type: inline-size; }
.lme-sec { padding: 8px 0; border-top: 1px solid var(--lm-line); }
.lme-panel-body > .lme-sec:first-child, .lme-panel-body > .lme-inspector + .lme-sec { border-top: 0; }
.lme-sec > summary { padding: 4px 0; cursor: pointer; font: 700 .72rem var(--lm-font); letter-spacing: .08em; text-transform: uppercase; color: var(--lm-muted); }
.lme-sec[open] > summary { margin-bottom: 8px; }
/* a part's own heading and box give way to the section's */
.lme-sec > :not(summary) > h3:first-child, .lme-sec > summary + h3 { display: none; }
.lme-sec .lm-card { padding: 0; background: none; border: 0; border-radius: 0; }
.lme[data-fill] .lme-panel .lme-inspector { position: static; max-height: none; padding: 8px 0 12px; border: 0; border-bottom: 1px solid var(--lm-line); border-radius: 0; box-shadow: none; }
.lme-rail { position: absolute; z-index: 4; top: 0; bottom: 0; width: var(--lme-rail); display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 14px 0; font: 600 .76rem var(--lm-font); color: var(--lm-fg); background: var(--lm-surface); border: 0; cursor: pointer; }
.lme-rail[data-side="start"] { left: 0; border-right: 1px solid var(--lm-line); }
.lme-rail[data-side="end"] { right: 0; border-left: 1px solid var(--lm-line); }
.lme-rail:hover { background: color-mix(in srgb, var(--lm-fg) 5%, var(--lm-surface)); }
.lme-rail span { writing-mode: vertical-rl; }
.lme-rail i { width: 12px; height: 12px; border-radius: 50%; background: var(--lm-ok); }
.lme-rail[data-tier="warn"] i { background: var(--lm-warn); }
.lme-rail[data-tier="over"] i { background: var(--lm-drop); }
.lme-rail:focus-visible { outline: 2px solid var(--lm-accent); outline-offset: -2px; }
.lme[data-fill] .lme-split[data-layout="reader"] { grid-template-columns: minmax(0, 1fr) minmax(240px, 280px); }
.lme[data-fill] .lme-inspector { position: static; max-height: none; border-width: 0 0 0 1px; border-radius: 0; box-shadow: none; }
/* a phone: the text or the diagram, the bar on top and the switch at the bottom clear of the notch and the home bar,
   targets a finger can hit, the panels in a sheet over the diagram's bottom. Typing, the editor takes the height the
   keyboard leaves, the switch goes, and a row of keys sits on top of the keyboard */
.lme[data-narrow] { grid-template-rows: auto minmax(0, 1fr) auto; overscroll-behavior: none; }
.lme[data-narrow][data-typing] { height: var(--lme-vv, 100%); transform: translateY(var(--lme-vt, 0px)); grid-template-rows: auto minmax(0, 1fr); }
.lme[data-narrow] > .lme-bar { flex-wrap: nowrap; padding: calc(4px + env(safe-area-inset-top)) calc(8px + env(safe-area-inset-right)) 4px calc(8px + env(safe-area-inset-left)); }
.lme[data-narrow] :is(.lme-bar, .lme-tools, .lme-share) > .lm-btn { height: 44px; min-width: 44px; }
.lme-switch [data-problems]::after { content: attr(data-problems); margin-left: 6px; padding: 1px 6px; border-radius: 8px; font-size: .75rem; color: var(--lm-surface); background: var(--lm-drop); }
.lme-switch [data-warn]::after { background: var(--lm-warn); }
.lme[data-narrow] > .lme-split { position: relative; display: block; overflow: hidden; }
.lme[data-narrow] .lme-left { position: absolute; inset: 0; padding: 0; gap: 0; grid-template-rows: minmax(0, 1fr) auto auto; }
.lme[data-narrow] .lme-code { border: 0; border-radius: 0; }
/* 16 px: Safari zooms the page into a field whose text is smaller */
.lme[data-narrow] .lme-code .cm-editor { height: 100%; font-size: 16px; }
.lme[data-narrow] .lme-problems { max-height: 20dvh; padding: 6px; border-top: 1px solid var(--lm-line); }
.lme[data-narrow] .lme-preview { position: absolute; inset: 0; padding: 0; overflow: hidden; }
.lme[data-narrow] .lme-preview[hidden] { display: none; }
.lme[data-narrow] .lme-preview > .lm { --lm-pad: 0; --lm-root-bg: transparent; position: absolute; inset: 0; }
.lme[data-narrow] .lme-over-top { top: 8px; justify-content: flex-start; padding-right: 136px; }
.lme[data-narrow] .lme-over .lm-scenarios legend { display: none; }
.lme[data-narrow] .lme-over .lm-scenarios button { min-height: 44px; }
.lme[data-narrow] .lme-over-note { top: 60px; }
.lme[data-narrow] .lme-over-bottom { bottom: calc(var(--lme-sheet) + 8px); }
/* the story in one line: its words cut short, its buttons beside them */
.lme[data-narrow] .lme-over .lm-story { flex-wrap: nowrap; gap: 6px; padding: 4px 6px 4px 10px; }
.lme[data-narrow] .lme-over .lm-story legend, .lme[data-narrow] .lme-over .lm-story-progress { display: none; }
.lme[data-narrow] .lme-over .lm-story p { flex: 1 1 auto; min-width: 0; font-size: .84rem; white-space: nowrap; }
.lme[data-narrow] .lme-over .lm-story p > span { overflow: hidden; text-overflow: ellipsis; }
.lme[data-narrow] .lme-over .lm-story-nav { flex: none; }
.lme[data-narrow] .lme-over .lm-story button { min-height: 44px; }
.lme[data-narrow] .lme-canvas .lm-wrap[data-canvas] > .lm-bar { display: none; }
.lme[data-narrow] .lme-canvas .lm-wrap[data-canvas] .lm-zoom { top: 8px; right: 8px; bottom: auto; }
/* fingers pinch: the zoom shown and Fit are enough */
.lme[data-narrow] .lme-canvas .lm-zoom .lm-btn:is(:first-child, :nth-child(3)) { display: none; }
.lme-sheet { position: absolute; z-index: 5; left: 0; right: 0; bottom: 0; display: flex; flex-direction: column; background: var(--lm-surface); border-radius: 16px 16px 0 0; box-shadow: 0 -6px 24px rgb(0 0 0 / .16); transition: height .2s ease-out; }
.lme-sheet[data-detent="drag"] { transition: none; }
@media (prefers-reduced-motion: reduce) { .lme-sheet { transition: none; } }
.lme-grab { flex: none; display: grid; place-items: center; width: 100%; height: 36px; padding: 0; background: none; border: 0; cursor: grab; touch-action: none; }
.lme-grab i { width: 40px; height: 5px; border-radius: 3px; background: var(--lm-line); }
.lme-grab:focus-visible { outline: 2px solid var(--lm-accent); outline-offset: -4px; border-radius: 16px 16px 0 0; }
.lme-peek { display: grid; gap: 8px; padding: 0 calc(16px + env(safe-area-inset-right)) 12px calc(16px + env(safe-area-inset-left)); }
.lme-peek-verdict { margin: 0; padding-left: 10px; border-left: 4px solid var(--lm-ok); font-size: .88rem; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.lme-peek-verdict[data-tier="warn"] { border-color: var(--lm-warn); }
.lme-peek-verdict[data-tier="over"] { border-color: var(--lm-drop); }
.lme-peek .lm-load { row-gap: 2px; }
.lme-sheet-tabs { flex: none; display: flex; gap: 4px; overflow-x: auto; padding: 0 12px 6px; scrollbar-width: none; }
.lme-sheet-tabs button { flex: none; min-height: 44px; padding: 0 12px; font: 500 .9rem var(--lm-font); color: var(--lm-muted); background: none; border: 0; border-radius: 8px; cursor: pointer; }
.lme-sheet-tabs [aria-selected="true"] { color: var(--lm-fg); font-weight: 600; background: var(--lm-accent-soft); }
.lme-sheet-body { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 4px 16px 16px; container-type: inline-size; }
.lme-sheet-body > .lme-inspector { position: static; max-height: none; padding: 0; border: 0; box-shadow: none; }
.lme-switch { display: flex; gap: 4px; padding: 6px calc(12px + env(safe-area-inset-right)) calc(6px + env(safe-area-inset-bottom)) calc(12px + env(safe-area-inset-left)); background: var(--lm-surface); border-top: 1px solid var(--lm-line); }
.lme[data-typing] .lme-switch { display: none; }
.lme-switch button { flex: 1; min-height: 44px; font: 500 .95rem var(--lm-font); color: var(--lm-fg); background: var(--lm-bg); border: 0; border-radius: 10px; cursor: pointer; }
.lme-switch [aria-selected="true"] { font-weight: 600; background: var(--lm-surface); box-shadow: inset 0 0 0 2px var(--lm-accent); }
.lme-keys { display: flex; gap: 6px; padding: 6px 8px; overflow-x: auto; background: var(--lm-surface); border-top: 1px solid var(--lm-line); }
.lme-keys .lm-btn { min-width: 44px; min-height: 40px; font-family: var(--lm-mono); }
.lme-empty { margin: 0; padding: 40px 16px; text-align: center; color: var(--lm-muted); border: 1px dashed var(--lm-line); border-radius: 8px; }
`

export function injectEditorStyles(doc: Document = document): void {
  if (doc.getElementById('loadmap-editor-css')) return
  const el = doc.createElement('style')
  el.id = 'loadmap-editor-css'
  el.textContent = EDITOR_CSS
  doc.head.appendChild(el)
}
