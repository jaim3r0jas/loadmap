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

/* full screen (the browser's, or a fixed overlay): the diagram as large as fits, beside a panel of the verdict, the
   live meters and the controls; the board's size comes from Diagram (--lm-fit), the load never changes it */
.lm-side, .lm-ranked { display: contents; }
.lm[data-full] { height: 100vh; height: 100dvh; padding: 16px; overflow: auto; overscroll-behavior: contain; align-content: start; }
.lm[data-full="overlay"] { position: fixed; inset: 0; z-index: 2147483000; width: auto; max-width: none; max-height: none; margin: 0; border: 0; }
.lm[data-full]:has(> .lm-side) { overflow: hidden; grid-template-columns: minmax(0, 1fr) clamp(300px, 24vw, 400px); grid-template-rows: repeat(3, auto) minmax(0, 1fr); row-gap: 0; }
.lm[data-full]:has(> .lm-side) > :is(h2, .lm-scenarios, .lm-story) { grid-column: 1; margin-bottom: 12px; }
/* a page of its own keeps the rest outside full screen, as <Loadmap> does */
.lm[data-full]:has(> .lm-side) > :not(h2, .lm-scenarios, .lm-story, .lm-wrap, .lm-side) { display: none; }
.lm[data-full] .lm-wrap { height: calc(100dvh - 32px); grid-template-rows: auto auto; align-content: center; }
.lm[data-full]:has(> .lm-side) > .lm-wrap { grid-column: 1; grid-row: 4; height: auto; min-height: 0; }
/* left under the bar, so the legend starts where the board does */
.lm[data-full] .lm-board { width: var(--lm-fit, 100%); margin: 0; align-self: start; justify-self: start; }
.lm[data-full] > .lm-side { grid-column: 2; grid-row: 1 / -1; display: grid; gap: 14px; align-content: start; min-height: 0; overflow: auto; overscroll-behavior: contain; container-type: inline-size; }
.lm[data-full] .lm-more { display: none; }
@media (max-width: 760px) {
  .lm[data-full]:has(> .lm-side) { grid-template-columns: minmax(0, 1fr); grid-template-rows: repeat(3, auto) minmax(0, 3fr) minmax(0, 2fr); }
  .lm[data-full] > .lm-side { grid-column: 1; grid-row: 5; margin-top: 12px; }
  .lm[data-full] > h2 { display: none; }
  /* a phone keeps the board as wide as the screen and scrolls it: fitted to the height it is too small to read */
  .lm[data-full]:has(> .lm-side) > .lm-wrap { overflow: auto; align-content: start; }
  .lm[data-full] .lm-board { width: 100%; }
  /* the controls first in the short panel: the diagram, the verdict and the meters answer them */
  .lm[data-full] .lm-side > .lm-strip:not(.lm-more) { display: contents; }
  .lm[data-full] .lm-side .lm-controls { order: -1; }
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
.lm-story p { flex: 1 1 240px; margin: 0; font: 400 .9rem/1.4 var(--lm-font); color: var(--lm-fg); }
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

@media (prefers-reduced-motion: reduce) { .lm-fill { transition: none; } }
`

/** Adds the stylesheet once per document. */
export function injectStyles(doc: Document = document): void {
  if (doc.getElementById('loadmap-css')) return
  const el = doc.createElement('style')
  el.id = 'loadmap-css'
  el.textContent = LOADMAP_CSS
  doc.head.appendChild(el)
}
