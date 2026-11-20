/**
 * The canvas's part of the stylesheet: the box has the height the page gives it (a default one otherwise), and nothing
 * in it changes that height: the diagram fills it, the bar and the console lie over its top and its bottom.
 */
export const CANVAS_CSS = `
/* without weight: a page's own .lm-canvas { height } wins, wherever its stylesheet stands */
:where(.lm-canvas) { height: clamp(420px, 70dvh, 760px); }
.lm-canvas { position: relative; box-sizing: border-box; overflow: hidden; contain: layout; border: 1px solid var(--lm-line); border-radius: var(--lm-radius, 10px); background: var(--lm-surface); }
.lm.lm[data-full] > .lm-canvas { display: block; flex: 1 1 0; height: auto; min-height: 0; }
/* the spacer that centres a page of parts with the least around it would take a gap under the canvas */
.lm.lm[data-full]:has(> .lm-canvas)::after { content: none; }
.lm-canvas > .lm-wrap[data-canvas] { position: absolute; inset: 0; }
.lm-canvas-bar, .lm-canvas-console { position: absolute; left: 0; right: var(--lm-canvas-right, 0px); z-index: 3; box-sizing: border-box; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; padding: 8px 12px; background: var(--lm-surface); }
.lm-canvas-bar { top: 0; border-bottom: 1px solid var(--lm-line); }
.lm-canvas-console { bottom: 0; border-top: 1px solid var(--lm-line); }
/* over the bar for a while, across the whole top: as tall as it needs */
.lm-canvas-panel[hidden] { display: none; }
/* never more than the diagram can give: a long step scrolls in its strip */
.lm-canvas-over { position: absolute; z-index: 5; top: 0; left: 0; right: 0; box-sizing: border-box; display: flex; align-items: center; max-height: 45%; overflow: auto; overscroll-behavior: contain; background: var(--lm-surface); border-bottom: 1px solid var(--lm-line); box-shadow: 0 8px 18px -14px rgb(0 0 0 / .45); }
.lm-canvas-over > .lm-story { flex: 1 1 auto; border: 0; border-radius: 0; background: none; }
.lm-canvas-over > .lm-canvas-leave { flex: none; margin-right: 12px; }
/* the bar's own buttons, at its end */
.lm-canvas-tools { display: flex; flex: none; gap: 6px; margin-left: auto; }
.lm-canvas-tools .lm-btn { padding: 4px 9px; }
.lm-canvas-tools .lm-btn[aria-pressed="true"].lm-canvas-chrome { border-color: var(--lm-fg); box-shadow: inset 0 0 0 1px var(--lm-fg); }
.lm-frame .lm-canvas-bar > .lm-legend + .lm-canvas-tools { margin-left: 0; }
/* a slot that holds nothing takes no room */
.lm-canvas-bar:empty, .lm-canvas-console:empty { display: none; }
.lm-canvas[data-width="compact"] :is(.lm-canvas-bar, .lm-canvas-console) { padding: 6px 8px; }
.lm-canvas[data-short] .lm-canvas-bar { padding: 4px 8px; }
/* on a touch screen two fingers zoom a narrow canvas: Fit alone stays, clear of the boxes */
@media (pointer: coarse) { .lm-canvas[data-width="compact"] .lm-zoom .lm-btn:not(:last-child) { display: none; } }
/* a page of its own parts has full-screen rules for a phone (the load on two lines, no legend): not the canvas's */
.lm.lm[data-full] .lm-canvas .lm-load { display: grid; }
.lm.lm[data-full] .lm-canvas .lm-load small { display: block; }
.lm.lm[data-full] .lm-canvas .lm-load > label { position: static; width: auto; height: auto; clip-path: none; }
.lm.lm[data-full] .lm-canvas .lm-load > output { margin-left: 0; }
.lm.lm[data-full] .lm-canvas .lm-headline { flex-basis: auto; }
.lm.lm[data-full] .lm-canvas .lm-legend { display: flex; }

/* the panels: their tabs, and the one that is open. Nothing but the open panel scrolls in a canvas */
.lm-canvas-tabs { position: absolute; z-index: 3; display: flex; box-sizing: border-box; background: var(--lm-surface); }
.lm-canvas-tabs button { flex: none; font: 500 .8rem var(--lm-font); color: var(--lm-muted); background: none; border: 0; padding: 0 12px; cursor: pointer; white-space: nowrap; }
.lm-canvas-tabs button:hover { color: var(--lm-fg); }
.lm-canvas-tabs button[aria-expanded="true"] { color: var(--lm-fg); font-weight: 600; box-shadow: inset 0 -2px 0 var(--lm-fg); }
.lm-canvas-tabs button:focus-visible, .lm-canvas-menu:focus-visible { outline: 2px solid var(--lm-accent); outline-offset: -2px; }
.lm-canvas[data-tabs="row"] .lm-canvas-tabs { left: 0; right: 0; bottom: var(--lm-canvas-bottom); height: 36px; border-top: 1px solid var(--lm-line); overflow-x: auto; scrollbar-width: none; }
.lm-canvas[data-tabs="row"] .lm-canvas-tabs::-webkit-scrollbar { display: none; }
/* the five share a narrow row */
.lm-canvas[data-tabs="row"][data-width="compact"] .lm-canvas-tabs button { flex: 1 1 auto; padding: 0 4px; }
.lm-canvas[data-tabs="rail"] .lm-canvas-tabs { top: 0; right: 0; bottom: 0; width: 44px; flex-direction: column; align-items: stretch; padding-top: 6px; border-left: 1px solid var(--lm-line); overflow: hidden; }
.lm-canvas[data-tabs="rail"] .lm-canvas-tabs button { padding: 12px 0; display: flex; justify-content: center; }
.lm-canvas[data-tabs="rail"] .lm-canvas-tabs button span { writing-mode: vertical-rl; }
.lm-canvas[data-tabs="rail"] .lm-canvas-tabs button[aria-expanded="true"] { box-shadow: inset 2px 0 0 var(--lm-fg); }
.lm-canvas[data-tabs="head"] .lm-canvas-tabs { top: 0; right: 0; width: var(--lm-canvas-right); height: 40px; border-left: 1px solid var(--lm-line); border-bottom: 1px solid var(--lm-line); overflow-x: auto; scrollbar-width: none; }
.lm-canvas[data-tabs="head"] .lm-canvas-tabs::-webkit-scrollbar { display: none; }
.lm-canvas-menu { position: absolute; z-index: 4; top: 5px; right: 8px; width: 116px; font: 500 .8rem var(--lm-font); color: var(--lm-fg); background: var(--lm-surface); border: 1px solid var(--lm-line); border-radius: 6px; padding: 4px 6px; }
.lm-canvas[data-tabs="menu"] .lm-canvas-bar, .lm-canvas[data-tabs="menu"] .lm-canvas-bar:empty { display: flex; min-height: 40px; padding-right: 132px; }
.lm-canvas-panel { position: absolute; z-index: 4; box-sizing: border-box; display: grid; grid-template-rows: auto minmax(0, 1fr); background: var(--lm-surface); outline: 0; }
.lm-canvas-panel[data-place="side"] { top: var(--lm-canvas-top); bottom: var(--lm-canvas-under); right: var(--lm-canvas-right); width: calc(var(--lm-canvas-reach) - var(--lm-canvas-right)); border-left: 1px solid var(--lm-line); box-shadow: -8px 0 18px -14px rgb(0 0 0 / .45); }
.lm-canvas[data-pinned] .lm-canvas-panel { top: 40px; right: 0; bottom: 0; width: var(--lm-canvas-right); box-shadow: none; }
.lm-canvas[data-pinned] .lm-canvas-panel-head { display: none; }
.lm-canvas-panel[data-place="sheet"] { left: 0; right: 0; bottom: var(--lm-canvas-under); height: var(--lm-canvas-reach); border-top: 1px solid var(--lm-line); border-radius: 10px 10px 0 0; box-shadow: 0 -8px 18px -14px rgb(0 0 0 / .45); }
.lm-canvas-panel-head { display: flex; align-items: center; gap: 6px; padding: 6px 8px 6px 12px; border-bottom: 1px solid var(--lm-line); }
.lm-canvas-panel-head h3 { flex: 1 1 auto; min-width: 0; margin: 0; font-size: .86rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lm-canvas-panel-head .lm-btn { padding: 3px 8px; }
.lm-canvas-panel-body { display: grid; gap: 14px; align-content: start; min-height: 0; padding: 12px; overflow: auto; overscroll-behavior: contain; container-type: inline-size; }
@media (prefers-reduced-motion: no-preference) {
  .lm-canvas-panel[data-place="side"] { animation: lm-canvas-side .16s ease-out; }
  .lm-canvas[data-pinned] .lm-canvas-panel { animation: none; }
  .lm-canvas-panel[data-place="sheet"] { animation: lm-canvas-sheet .16s ease-out; }
}
@keyframes lm-canvas-side { from { transform: translateX(16px); opacity: 0; } }
@keyframes lm-canvas-sheet { from { transform: translateY(16px); opacity: 0; } }

/* the frame: what <Frame> puts in the two slots. Each is one row of a height nothing the reader does changes */
.lm-frame .lm-canvas-bar { flex-wrap: nowrap; overflow: hidden; }
.lm-frame .lm-canvas-bar > h2 { flex: 0 5 auto; min-width: 0; font-size: .95rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lm-frame .lm-canvas-bar > .lm-scenarios { flex: 0 2 auto; flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; padding: 2px; }
.lm-frame .lm-canvas-bar > .lm-scenarios::-webkit-scrollbar { display: none; }
.lm-frame .lm-canvas-bar > .lm-scenarios > * { flex: none; white-space: nowrap; }
.lm-frame .lm-canvas-bar > .lm-scenarios button { padding: 4px 10px; }
/* named for a screen reader, unseen: the buttons say what they are */
.lm-frame .lm-canvas-bar > .lm-scenarios legend, .lm.lm .lm-frame[data-short] .lm-load > label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
/* one row whatever is on: an entry that does not fit wraps under it, out of view, whole */
.lm-frame .lm-canvas-bar > .lm-legend { flex: 1 1 0; justify-content: flex-end; min-width: 0; height: 1.5em; line-height: 1.5; overflow: hidden; white-space: nowrap; }
.lm-canvas-pick { flex: 0 1 auto; min-width: 0; max-width: 100%; font: 500 .84rem var(--lm-font); color: var(--lm-fg); background: var(--lm-surface); border: 1px solid var(--lm-line); border-radius: 6px; padding: 5px 8px; }
.lm-frame .lm-canvas-console { display: grid; grid-template-columns: minmax(0, 1fr); gap: 2px; padding: 6px 12px 8px; }
.lm-frame .lm-canvas-console > .lm-load { grid-template: "label track value" / minmax(0, max-content) minmax(120px, 1fr) auto; align-items: start; }
.lm-frame .lm-canvas-console > .lm-load > label { max-width: 14em; padding-top: 6px; }
.lm-frame .lm-canvas-console > .lm-load > output { padding-top: 5px; }
.lm-canvas-verdict { display: flex; align-items: center; gap: 6px 14px; min-width: 0; padding-left: 8px; border-left: 4px solid var(--lm-ok); }
.lm-canvas-verdict[data-tier="warn"] { border-color: var(--lm-warn); }
.lm-canvas-verdict[data-tier="over"] { border-color: var(--lm-drop); }
.lm-frame[data-width="compact"] .lm-canvas-console { padding: 6px 8px; }
.lm-frame[data-width="compact"] .lm-canvas-console > .lm-load { grid-template: "label value" "track track" / minmax(0, 1fr) auto; align-items: center; }
.lm-frame[data-width="compact"] .lm-canvas-console > .lm-load > :is(label, output) { padding-top: 0; }
/* room for the date under the load, with one or not */
.lm-frame[data-width="compact"] .lm-canvas-console > .lm-load > output { min-height: 2.1rem; }
/* two lines kept whatever the verdict says: the load never changes the console's height */
.lm-frame[data-width="compact"]:not([data-short]) .lm-headline { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; height: 2.6em; line-height: 1.3; white-space: normal; }
.lm-frame[data-short] .lm-canvas-console { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: center; gap: 12px; padding: 2px 8px; }
.lm-frame[data-short] .lm-canvas-console > .lm-load { grid-template: "track value" / minmax(0, 1fr) auto; align-items: start; }
.lm-frame[data-short][data-width="compact"] .lm-canvas-console { grid-template-columns: minmax(0, 1fr); gap: 0; }
`
