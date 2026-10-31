/** The editor's layout. It sits inside `.lm`, so it takes loadmap's theme tokens; the preview nests its own `.lm`. */
export const EDITOR_CSS = `
.lme { grid-template-rows: auto minmax(0, 1fr); }
.lme-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.lme-grow { flex: 1; }
.lme-status { font: 500 .8rem var(--lm-font); color: var(--lm-drop); }
.lme-status[data-ok="true"] { color: var(--lm-ok); }
.lme-note { font-size: .8rem; color: var(--lm-muted); }
.lme-split { display: grid; grid-template-columns: minmax(320px, 2fr) minmax(0, 3fr); gap: 14px; align-items: start; min-width: 0; }
@container (max-width: 980px) { .lme-split { grid-template-columns: minmax(0, 1fr); } }
.lme-left { display: grid; gap: 8px; min-width: 0; position: sticky; top: 8px; }
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
.lme-preview > .lm { padding: 0; }
.lme-preview[data-stale] > .lm { opacity: .55; }
.lme-stale { margin: 0 0 8px; font-size: .8rem; color: var(--lm-warn); }
.lme-empty { margin: 0; padding: 40px 16px; text-align: center; color: var(--lm-muted); border: 1px dashed var(--lm-line); border-radius: 8px; }
`

export function injectEditorStyles(doc: Document = document): void {
  if (doc.getElementById('loadmap-editor-css')) return
  const el = doc.createElement('style')
  el.id = 'loadmap-editor-css'
  el.textContent = EDITOR_CSS
  doc.head.appendChild(el)
}
