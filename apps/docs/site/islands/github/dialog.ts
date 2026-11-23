// The GitHub dialogs' shared rules and frame: each is a loadmap root of its own (its colours), in the theme the editor
// shows. The editor's bar is behind the backdrop, so the theme cannot change while one is open.

export const DIALOG_CSS = `
.lmg-dialog { width: min(560px, calc(100vw - 32px)); max-height: min(640px, calc(100dvh - 32px)); padding: 0; color: var(--lm-fg); background: var(--lm-surface); border: 1px solid var(--lm-line); border-radius: 12px; box-shadow: 0 12px 40px rgb(0 0 0 / .25); font: 400 .9rem var(--lm-font); }
.lmg-dialog.lmg-wide { width: min(760px, calc(100vw - 32px)); max-height: min(720px, calc(100dvh - 32px)); }
.lmg-dialog[open] { display: flex; flex-direction: column; }
.lmg-dialog:not([open]) { display: none; }
.lmg-dialog::backdrop { background: rgb(0 0 0 / .35); }
.lmg-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--lm-line); }
.lmg-head h2 { margin: 0; font-size: 1rem; }
.lmg-body { display: grid; gap: 10px; min-height: 0; overflow: auto; padding: 12px 14px 14px; }
.lmg-row { display: flex; gap: 8px; }
.lmg-row input { flex: 1; min-width: 0; }
.lmg-dialog input:not([type="checkbox"]), .lmg-dialog textarea, .lmg-dialog select { box-sizing: border-box; padding: 6px 8px; font: inherit; color: var(--lm-fg); background: var(--lm-bg); border: 1px solid var(--lm-line); border-radius: 6px; }
.lmg-dialog input:focus-visible, .lmg-dialog textarea:focus-visible, .lmg-dialog select:focus-visible { outline: 2px solid var(--lm-accent); outline-offset: -1px; }
.lmg-body:focus { outline: none; }
.lmg-hint { margin: 0; color: var(--lm-muted); font-size: .8rem; line-height: 1.45; }
.lmg-error { margin: 0; padding: 8px 10px; border-left: 3px solid var(--lm-warn); background: color-mix(in srgb, var(--lm-warn) 8%, transparent); border-radius: 0 6px 6px 0; line-height: 1.45; overflow-wrap: anywhere; }
.lmg-at { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; }
.lmg-at b { font-family: var(--lm-mono); font-weight: 600; overflow-wrap: anywhere; }
.lmg-at code, .lmg-at a { font: .8rem var(--lm-mono); color: var(--lm-muted); }
.lmg-at button { margin-left: auto; }
.lmg-foot { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--lm-line); }
.lmg-foot .lmg-grow { margin-right: auto; }
`

/** The theme the editor shows now, for a dialog drawn outside it. */
export const editorTheme = () => document.querySelector('.lm.lme')?.getAttribute('data-theme') ?? undefined
