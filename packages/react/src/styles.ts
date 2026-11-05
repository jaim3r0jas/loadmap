const LIGHT = `
  --lm-bg: #eef2f5; --lm-surface: #ffffff; --lm-fg: #17212b; --lm-muted: #5d6d7c; --lm-line: #c6d0da;
  --lm-accent: #0b6b8f; --lm-accent-soft: #d6e9f0; --lm-alt: #7a4f9a; --lm-alt-soft: #efe5f6;
  --lm-ok: #2a7f5a; --lm-warn: #b86e00; --lm-drop: #b7392e; --lm-lane: #e3e9ee;
  --lm-s1: #2a78d6; --lm-s2: #eb6834; --lm-s3: #6250d6; --lm-s4: #eda100; color-scheme: light;`
const DARK = `
  --lm-bg: #0d141b; --lm-surface: #151e27; --lm-fg: #e4ebf1; --lm-muted: #93a3b3; --lm-line: #2a3744;
  --lm-accent: #5fb7d6; --lm-accent-soft: #163442; --lm-alt: #c39be0; --lm-alt-soft: #2b2236;
  --lm-ok: #5fc08f; --lm-warn: #e2a24a; --lm-drop: #e26a5c; --lm-lane: #1b2631;
  --lm-s1: #3987e5; --lm-s2: #d95926; --lm-s3: #9085e9; --lm-s4: #c98500; color-scheme: dark;`

/** Theme tokens and the layout of every piece. Scoped to `.lm`; override any `--lm-*` token to restyle. */
export const LOADMAP_CSS = `
.lm { ${LIGHT}
  --lm-font: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --lm-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font: 14px/1.45 var(--lm-font); color: var(--lm-fg); background: var(--lm-bg);
  display: grid; gap: 14px; padding: 16px; min-width: 0; box-sizing: border-box; }
@media (prefers-color-scheme: dark) { .lm:not([data-theme="light"]) { ${DARK} } }
.lm[data-theme="dark"] { ${DARK} }
.lm *, .lm *::before, .lm *::after { box-sizing: border-box; }
.lm h2 { font-size: 1.3rem; font-weight: 600; margin: 0; text-wrap: balance; }
.lm h3 { font: 600 .74rem var(--lm-font); text-transform: uppercase; letter-spacing: .08em; color: var(--lm-muted); margin: 0; }
.lm button:focus-visible, .lm input:focus-visible, .lm select:focus-visible { outline: 2px solid var(--lm-accent); outline-offset: 2px; }
.lm-card { background: var(--lm-surface); border: 1px solid var(--lm-line); border-radius: 8px; padding: 14px 16px; display: grid; gap: 12px; align-content: start; min-width: 0; }

.lm-wrap { display: grid; gap: 8px; min-width: 0; position: relative; }
.lm-bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.lm-btn { font: 500 .8rem var(--lm-font); color: var(--lm-fg); background: var(--lm-surface); border: 1px solid var(--lm-line); border-radius: 6px; padding: 6px 12px; cursor: pointer; white-space: nowrap; }
.lm-board { position: relative; background: var(--lm-surface); border: 1px solid var(--lm-line); border-radius: 8px; overflow: hidden; margin: 0 auto; width: 100%; }
.lm-board svg { display: block; width: 100%; height: auto; font-family: var(--lm-font); }
.lm-board canvas { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.lm-legend { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: .78rem; color: var(--lm-muted); }
.lm-legend i { display: inline-block; width: 10px; height: 10px; border-radius: 50%; vertical-align: -1px; margin-right: 5px; }

/* full screen (the browser's, or a fixed overlay): a column that never scrolls. The diagram as wide as the screen on
   top; under it the verdict in a line and the panels, compact, in a dock the screen sizes. The load changes what is
   in them, never their size, so it never moves the board. Focus: the diagram, the story, the verdict and the load */
.lm-side, .lm-card > .lm-panel { display: contents; }
.lm-panel { display: grid; gap: 14px; min-width: 0; }
.lm[data-full] { height: 100vh; height: 100dvh; padding: 16px; overflow: hidden; overscroll-behavior: contain; display: flex; flex-direction: column; gap: 10px; position: relative; }
.lm[data-full="overlay"] { position: fixed; inset: 0; z-index: 2147483000; width: auto; max-width: none; max-height: none; margin: 0; border: 0; }
.lm[data-full] > * { flex: none; }
/* a page of its own keeps the rest outside full screen, as <Loadmap> does */
.lm[data-full] > :not(.lm-head, h2, .lm-scenarios, .lm-story, .lm-wrap, .lm-line, .lm-dock, .lm-side) { display: none; }
.lm-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 20px; min-width: 0; }
.lm-head h2 { font-size: 1.1rem; }
.lm[data-full] .lm-wrap { gap: 6px; }
/* the board as large as fits (--lm-fit, from Diagram), left under the bar, so the legend starts where the board does */
.lm[data-full] .lm-board { width: var(--lm-fit, 100%); margin: 0; align-self: start; justify-self: start; }
.lm-tools { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.lm-modes { display: inline-flex; margin: 0; padding: 0; min-width: 0; border: 1px solid var(--lm-line); border-radius: 6px; overflow: hidden; }
.lm-modes button { font: 500 .8rem var(--lm-font); color: var(--lm-fg); background: var(--lm-surface); border: 0; padding: 6px 12px; cursor: pointer; }
.lm-modes button[aria-pressed="true"] { background: var(--lm-fg); color: var(--lm-surface); }
.lm[data-full] .lm-story { padding: 6px 12px; }
.lm[data-full] [data-out] { display: none; }

.lm-line { display: flex; align-items: center; gap: 6px 14px; min-width: 0; padding: 6px 12px; border-left: 4px solid var(--lm-ok); background: var(--lm-accent-soft); border-radius: 0 6px 6px 0; }
.lm-line[data-tier="warn"] { border-color: var(--lm-warn); }
.lm-line[data-tier="over"] { border-color: var(--lm-drop); }
.lm-headline { flex: 1 1 auto; min-width: 0; margin: 0; font-size: .9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lm-num { font: 600 .95em var(--lm-mono); font-variant-numeric: tabular-nums; }
.lm-link { font: 500 .8rem var(--lm-font); color: var(--lm-accent); background: none; border: 0; padding: 2px 4px; cursor: pointer; white-space: nowrap; }
.lm-line .lm-range { flex: 0 1 380px; display: grid; grid-template-columns: auto minmax(100px, 1fr); align-items: center; gap: 10px; font-size: .84rem; }
.lm-line output { font-family: var(--lm-mono); font-variant-numeric: tabular-nums; }
.lm-line input[type=range] { width: 100%; accent-color: var(--lm-accent); }

.lm-dock { display: flex; gap: 10px; min-width: 0; }
.lm[data-full] > .lm-dock { flex: 1 1 0; min-height: clamp(200px, 26dvh, 340px); }
.lm-tabs { display: none; margin: 0; padding: 0; border: 0; min-width: 0; }
.lm-mini { position: relative; flex: 1 1 0; min-width: 0; min-height: 0; display: grid; container-type: inline-size; }
.lm-mini[data-mini="controls"] { flex-grow: 1.25; }
.lm-mini[data-mini="limits"] { flex-grow: 1.45; }
.lm-mini[data-mini="live"] { flex-grow: .8; }
.lm-mini[data-mini="headroom"] { flex-grow: .9; }
.lm-mini[data-mini="compare"] { flex-grow: 1.3; }
.lm-mini > .lm-card { min-height: 0; overflow: hidden; padding: 10px 12px; gap: 6px; align-content: start; }
.lm-mini [data-clip] { visibility: hidden; }
.lm-more { position: absolute; top: 6px; right: 6px; font: 500 .8rem var(--lm-font); color: var(--lm-accent); background: var(--lm-surface); border: 0; border-radius: 4px; padding: 2px 6px; cursor: pointer; }
.lm-more[data-more]:not([data-more=""])::before { content: attr(data-more) " "; }
.lm-mini .lm-meters { grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 4px; }
.lm-mini .lm-meter { display: flex; align-items: baseline; gap: 8px; padding: 3px 8px; }
.lm-mini .lm-meter b { flex: none; font-size: .9rem; }
.lm-mini .lm-meter span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* one grid for every row, so the bars line up whatever the names */
.lm-mini-limits { display: grid; grid-template-columns: minmax(0, max-content) minmax(48px, 1fr) auto auto; gap: 6px 10px; }
.lm-mini-lim { display: grid; grid-column: 1 / -1; grid-template-columns: subgrid; align-items: center; font-size: .8rem; }
.lm-mini-lim .lm-name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lm-mini-lim .lm-tag { margin-left: 5px; }
.lm-mini-lim .lm-track { height: 9px; }
.lm-mini-lim .lm-val { white-space: nowrap; }
.lm-mini-lim .lm-sub { font: 400 .74rem var(--lm-mono); color: var(--lm-muted); }
.lm-mini .lm-controls { gap: 6px; column-gap: 16px; }
.lm-mini .lm-controls small, .lm-mini .lm-controls > h3:not(:first-child) { display: none; }
.lm-mini .lm-controls label.lm-range { grid-template-columns: minmax(0, 1fr) minmax(90px, 1.2fr); align-items: center; gap: 10px; font-size: .8rem; }
.lm-mini .lm-select { grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px; font-size: .8rem; }
.lm-mini .lm-select select { width: auto; padding: 1px 6px; font-size: .78rem; }
.lm-mini .lm-switch { font-size: .8rem; }
.lm-mini .lm-switch input { margin-top: 2px; }
.lm-mini .lm-presets { gap: 4px; }
.lm-mini .lm-presets button { padding: 2px 8px; font-size: .72rem; }
@container (min-width: 420px) {
  .lm-mini .lm-controls { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .lm-mini .lm-controls > :is(h3, .lm-presets), .lm-mini .lm-controls > h3 + .lm-range { grid-column: 1 / -1; }
}
.lm-mini .lm-compare > :not(h3:first-child, .lm-table-wrap:nth-child(3)) { display: none; }
.lm-mini .lm-table { font-size: .76rem; }
.lm-mini .lm-table th, .lm-mini .lm-table td { padding: 3px 8px 3px 0; }
.lm-mini .lm-table small { display: none; }
.lm-mini .lm-table thead th { white-space: nowrap; font-size: .6rem; }
.lm-mini > .lm-card:has(> .lm-spark) { grid-template-rows: auto minmax(0, 1fr) auto; align-content: stretch; }
.lm-spark { position: relative; min-height: 0; }
.lm-spark svg { position: absolute; inset: 0; display: block; overflow: visible; }
.lm-spark-th { stroke: var(--lm-muted); stroke-dasharray: 4 3; }
.lm-spark-load { stroke: var(--lm-fg); opacity: .45; }
.lm-spark-text { margin: 0; font-size: .76rem; color: var(--lm-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* the drawer: the page's own panel, alone, over the right of the board */
.lm[data-full] > .lm-drawer:not([data-drawer]) { display: none; }
.lm[data-full] > .lm-drawer[data-drawer] { display: grid; gap: 14px; align-content: start; position: absolute; top: 16px; right: 16px; bottom: 16px; z-index: 4; width: min(640px, calc(100% - 32px)); overflow: auto; overscroll-behavior: contain; padding: 14px; background: var(--lm-bg); border: 1px solid var(--lm-line); border-radius: 10px; box-shadow: -8px 0 30px rgb(0 0 0 / .2); container-type: inline-size; }
.lm-side[data-drawer] :is(.lm-panel, .lm-strip, .lm-charts, .lm-card):not([data-drawn]):not(.lm-panel *) { display: none; }
.lm-side[data-drawer] .lm-strip { grid-template-columns: minmax(0, 1fr); }
.lm-drawer-bar { display: flex; justify-content: flex-end; }

/* a page of its own: its .lm-side is a box under the board that scrolls on its own, the board as large as leaves it a
   third of the screen */
.lm[data-full] > .lm-side:not(.lm-drawer) { display: grid; gap: 14px; align-content: start; flex: 1 1 0; min-height: 33dvh; overflow: auto; overscroll-behavior: contain; container-type: inline-size; }

/* focus: the board and what runs on it in the middle of the screen */
.lm[data-mode="focus"] .lm-scenarios, .lm[data-mode="focus"] > .lm-side:not(.lm-drawer) { display: none; }
.lm[data-mode="focus"] > .lm-wrap { margin-top: auto; }
.lm[data-mode="focus"] > :is(.lm-story, .lm-line) { order: 1; }
.lm[data-mode="focus"]::after { content: ""; order: 2; margin-top: auto; }
.lm[data-mode="focus"] > .lm-story { border-left-width: 4px; padding: 10px 14px; }
.lm[data-mode="focus"] > .lm-story p { font-size: 1.1rem; }

@media (max-width: 760px) {
  .lm[data-full] { padding: 10px; gap: 8px; }
  /* the page has the title, and the legend: here they would leave the diagram no room */
  .lm[data-full] > h2, .lm[data-full] :is(.lm-head h2, .lm-legend, .lm-story legend) { display: none; }
  /* the one exception: here the diagram runs top to bottom, and shrunk to the screen it is too small to read, so it
     pans in a box of its own with the bar on top. The page never scrolls */
  .lm[data-full] .lm-board { width: 100%; }
  .lm[data-full] > .lm-wrap { height: 40dvh; overflow: auto; row-gap: 0; overscroll-behavior: contain; }
  .lm[data-mode="focus"] > .lm-wrap { height: auto; flex: 1 1 0; min-height: 0; margin-top: 0; }
  .lm[data-full] .lm-bar { position: sticky; top: 0; z-index: 1; padding-bottom: 8px; background: var(--lm-bg); }
  .lm[data-full] .lm-line { flex-wrap: wrap; }
  .lm[data-full] > .lm-story { padding: 6px 10px; gap: 6px 10px; }
  .lm[data-full] > .lm-story p { font-size: .84rem; }
  .lm[data-full] .lm-story button { padding: 4px 10px; }
  .lm[data-full] .lm-headline { flex-basis: 100%; }
  .lm-dock { flex-direction: column; min-height: 0; gap: 6px; }
  .lm-tabs { display: flex; flex: none; gap: 2px; border-bottom: 1px solid var(--lm-line); overflow: hidden; }
  .lm-tabs button { font: 500 .78rem var(--lm-font); color: var(--lm-muted); background: none; border: 0; border-bottom: 2px solid transparent; padding: 6px 8px; cursor: pointer; white-space: nowrap; }
  .lm-tabs button[aria-pressed="true"] { color: var(--lm-fg); border-color: var(--lm-fg); }
  .lm-mini:not([data-active]) { display: none; }
  .lm[data-full] > .lm-side[data-drawer] { inset: 8px; width: auto; }
}

.lm-verdict { margin: 0; padding: 10px 14px; border-left: 4px solid var(--lm-ok); background: var(--lm-accent-soft); border-radius: 0 6px 6px 0; }
.lm-verdict[data-tier="warn"] { border-color: var(--lm-warn); }
.lm-verdict[data-tier="over"] { border-color: var(--lm-drop); }
.lm-measure { margin: 6px 0 0; padding: 0 14px; font-size: .86rem; color: var(--lm-muted); }

.lm-strip { display: grid; grid-template-columns: minmax(0, 3fr) minmax(280px, 2fr); gap: 14px; align-items: start; }
@container (max-width: 860px) { .lm-strip { grid-template-columns: minmax(0, 1fr); } }
.lm { container-type: inline-size; }

.lm-meters { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
.lm-meter { padding: 8px 10px; border-radius: 6px; background: var(--lm-bg); min-width: 0; }
.lm-meter b { display: block; font: 500 1.15rem var(--lm-mono); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lm-meter span { font-size: .74rem; color: var(--lm-muted); }
.lm-meter[data-state="warn"] b { color: var(--lm-warn); } .lm-meter[data-state="over"] b { color: var(--lm-drop); }

.lm-limits { display: grid; gap: 10px; }
.lm-lim, .lm-scale { display: grid; grid-template-columns: minmax(0, 14rem) minmax(0, 1fr) 10rem; gap: 4px 14px; align-items: center; }
@container (max-width: 640px) { .lm-lim, .lm-scale { grid-template-columns: minmax(0, 1fr); } .lm-scale > :first-child, .lm-scale > :last-child { display: none; } }
.lm-lim b { display: block; font-weight: 600; font-size: .88rem; }
.lm-lim .lm-sub { display: block; font-size: .74rem; color: var(--lm-muted); }
.lm-tag { font: 600 .64rem var(--lm-font); text-transform: uppercase; letter-spacing: .06em; border-radius: 3px; padding: 1px 5px; margin-left: 6px; vertical-align: 1px; }
.lm-tag[data-kind="first"] { color: var(--lm-surface); background: var(--lm-drop); }
.lm-tag[data-kind="estimated"] { color: var(--lm-warn); border: 1px solid currentColor; }
.lm-tag[data-kind="range"] { color: var(--lm-muted); border: 1px solid currentColor; }
.lm-track { position: relative; height: 16px; background: var(--lm-bg); border-radius: 3px; overflow: hidden; }
.lm-fill { position: absolute; inset: 0 auto 0 0; background: var(--lm-ok); transition: width .25s ease; }
.lm-fill[data-state="warn"] { background: var(--lm-warn); } .lm-fill[data-state="over"] { background: var(--lm-drop); }
.lm-tick { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--lm-fg); opacity: .55; }
.lm-val { font: 500 .8rem var(--lm-mono); font-variant-numeric: tabular-nums; }
.lm-val small { display: block; font: 400 .72rem var(--lm-font); color: var(--lm-muted); }
.lm-scale { font: 400 .7rem var(--lm-mono); color: var(--lm-muted); }
.lm-scale div { position: relative; height: 12px; }
.lm-scale div span { position: absolute; transform: translateX(-50%); white-space: nowrap; }

.lm-controls label.lm-range { display: grid; gap: 4px; font-size: .84rem; }
.lm-controls label.lm-range > span { display: flex; justify-content: space-between; gap: 8px; }
.lm-controls output { font-family: var(--lm-mono); font-variant-numeric: tabular-nums; }
.lm-controls input[type=range] { width: 100%; accent-color: var(--lm-accent); }
.lm-presets { display: flex; flex-wrap: wrap; gap: 6px; }
.lm-presets button { font: 500 .76rem var(--lm-font); background: var(--lm-accent-soft); color: var(--lm-fg); border: 1px solid transparent; border-radius: 5px; padding: 5px 10px; cursor: pointer; }
.lm-presets button[aria-pressed="true"] { border-color: var(--lm-accent); }
.lm-switch { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0 8px; align-items: start; font-size: .84rem; cursor: pointer; }
.lm-switch input { margin: 3px 0 0; accent-color: var(--lm-accent); }
.lm-switch small, .lm-select small { grid-column: 2; color: var(--lm-muted); font-size: .74rem; line-height: 1.3; }
.lm-select { display: grid; gap: 4px; font-size: .84rem; }
.lm-select select { width: 100%; min-width: 0; font: 400 .84rem var(--lm-font); color: var(--lm-fg); background: var(--lm-surface); border: 1px solid var(--lm-line); border-radius: 5px; padding: 5px 8px; }
.lm-off { opacity: .45; cursor: default; }

.lm-facts { margin: 0; padding-left: 1.1em; font-size: .88rem; columns: 2; column-gap: 28px; }
@container (max-width: 860px) { .lm-facts { columns: 1; } }
.lm-facts li { margin-bottom: 8px; break-inside: avoid; }
.lm-prov { font: 600 .66rem var(--lm-font); text-transform: uppercase; letter-spacing: .06em; }
.lm-prov[data-kind="measured"] { color: var(--lm-ok); } .lm-prov[data-kind="estimated"] { color: var(--lm-warn); }
.lm-prov[data-kind="configured"] { color: var(--lm-accent); }

/* scenario identity colours (s1–s4) are checked for colour-blind separation on both surfaces; text never wears them */
.lm-scenarios { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; border: 0; padding: 0; margin: 0; min-width: 0; }
.lm-scenarios legend { float: left; font: 600 .74rem var(--lm-font); text-transform: uppercase; letter-spacing: .08em; color: var(--lm-muted); margin-right: 6px; padding: 0; }
.lm-scenarios button { font: 500 .84rem var(--lm-font); color: var(--lm-fg); background: var(--lm-surface); border: 1px solid var(--lm-line); border-radius: 6px; padding: 6px 12px; cursor: pointer; }
.lm-scenarios button[aria-pressed="true"] { border-color: var(--lm-fg); box-shadow: inset 0 0 0 1px var(--lm-fg); }
.lm-scenarios i, .lm-table i { display: inline-block; width: 10px; height: 10px; border-radius: 50%; vertical-align: -1px; margin-right: 6px; }
.lm-story { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin: 0; min-width: 0; padding: 8px 12px; border: 1px solid var(--lm-line); border-left: 3px solid var(--lm-accent); border-radius: 6px; background: var(--lm-surface); }
.lm-story legend { float: left; font: 600 .74rem var(--lm-font); text-transform: uppercase; letter-spacing: .08em; color: var(--lm-muted); padding: 0; }
.lm-story p { flex: 1 1 240px; display: grid; margin: 0; font: 400 .9rem/1.4 var(--lm-font); color: var(--lm-fg); }
.lm-story p > span { grid-area: 1 / 1; }
.lm-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.lm-story p > span:not([data-shown]), .lm-story em:not([data-shown]) { visibility: hidden; }
.lm-story-progress { display: flex; align-items: center; gap: 4px; }
.lm-story-progress i { position: relative; width: 28px; height: 4px; border-radius: 2px; background: var(--lm-line); overflow: hidden; }
.lm-story-progress i[data-state="done"], .lm-story:not([data-playing]) .lm-story-progress i[data-state="now"] { background: var(--lm-accent); }
.lm-story[data-playing] .lm-story-progress i[data-state="now"]::before { content: ""; position: absolute; inset: 0; background: var(--lm-accent); transform-origin: left; animation: lm-step var(--lm-step) linear both; }
@keyframes lm-step { from { transform: scaleX(0); } to { transform: scaleX(1); } }
.lm-story b { font-weight: 600; color: var(--lm-muted); margin-right: 4px; white-space: nowrap; }
.lm-story-nav { display: flex; gap: 6px; }
.lm-story em { color: var(--lm-muted); }
.lm-story button { font: 500 .84rem var(--lm-font); color: var(--lm-fg); background: var(--lm-surface); border: 1px solid var(--lm-line); border-radius: 6px; padding: 6px 12px; cursor: pointer; }
.lm-story button[aria-disabled="true"] { opacity: .45; cursor: default; }
.lm-own { font-size: .78rem; color: var(--lm-muted); }
.lm-key { display: inline-block; width: 14px; height: 2px; border-radius: 1px; vertical-align: 3px; margin-right: 6px; }

.lm-compare-text { margin: 0; }
.lm-table-wrap { overflow-x: auto; }
.lm-table { border-collapse: collapse; width: 100%; font-size: .84rem; }
.lm-table th, .lm-table td { text-align: left; padding: 6px 10px 6px 0; border-bottom: 1px solid var(--lm-line); vertical-align: top; }
.lm-table thead th { font: 600 .7rem var(--lm-font); text-transform: uppercase; letter-spacing: .06em; color: var(--lm-muted); }
.lm-table tbody th { font-weight: 600; white-space: nowrap; }
.lm-table td { font-family: var(--lm-mono); font-variant-numeric: tabular-nums; }
.lm-table td.lm-text { font-family: var(--lm-font); }
.lm-table td small { display: block; font: 400 .72rem var(--lm-font); color: var(--lm-muted); }
.lm-table tr[aria-current] th { text-decoration: underline; text-underline-offset: 3px; }

.lm-chart { position: relative; min-width: 0; }
.lm-chart svg { display: block; overflow: visible; }
.lm-chart:focus-visible { outline: 2px solid var(--lm-accent); outline-offset: 2px; }
.lm-axis, .lm-axis text { font: 400 11px var(--lm-mono); fill: var(--lm-muted); }
.lm-mark { font: 600 11px var(--lm-mono); fill: var(--lm-fg); }
.lm-tip { position: absolute; z-index: 2; display: grid; gap: 2px; width: max-content; max-width: 17rem; padding: 8px 10px; font-size: .78rem; background: var(--lm-surface); color: var(--lm-fg); border: 1px solid var(--lm-line); border-radius: 6px; box-shadow: 0 4px 14px rgb(0 0 0 / .14); pointer-events: none; }
.lm-tip strong { font: 600 .82rem var(--lm-mono); font-variant-numeric: tabular-nums; }
.lm-tip .lm-sub { color: var(--lm-muted); }
.lm-nowrap { white-space: nowrap; }
.lm-node { cursor: pointer; outline: none; }
.lm-node:focus-visible > :first-child { stroke-width: 3; }

@media (prefers-reduced-motion: reduce) {
  .lm-fill { transition: none; }
  .lm-story[data-playing] .lm-story-progress i[data-state="now"]::before { animation: none; transform: none; }
}
`

/** Adds the stylesheet once per document. */
export function injectStyles(doc: Document = document): void {
  if (doc.getElementById('loadmap-css')) return
  const el = doc.createElement('style')
  el.id = 'loadmap-css'
  el.textContent = LOADMAP_CSS
  doc.head.appendChild(el)
}
