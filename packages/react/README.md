# @loadmap/react

Interactive capacity models for React. Declare the components of a system, the flows through it and what each one
can take; `<Loadmap>` draws the architecture with moving dots, ranks the components by when they run out, and writes
the verdict.

```bash
npm i @loadmap/react react react-dom
```

```tsx
import {
  defineModel,
  defineView,
  edge,
  estimated,
  Loadmap,
  measured,
  node,
  p,
  pool,
  store,
  workers,
} from '@loadmap/react'

// the model: plain TypeScript, no React
const shop = defineModel({
  title: 'Web shop',
  load: p.load({ label: 'Visitors, × today', max: 50, default: 1 }),
  params: { pods: p.select({ label: 'App pods', options: [2, 4, 8], default: 2 }) },
  flows: { requests: { label: 'requests', rate: ({ load }) => 300 * load, unit: 'request' } },
  components: {
    app: {
      name: 'App pods',
      short: 'the app pods',
      plural: true,
      demand: ({ flows }) => flows.requests * 0.003,
      capacity: ({ pods }) => measured(pods * 2, 'cores', 'pod CPU limit'),
      over: 'requests wait and time out',
    },
    db: {
      name: 'Postgres',
      short: 'the database',
      demand: ({ flows }) => flows.requests * 2,
      capacity: estimated(5_000, 'queries/s', { source: 'last year’s load test', within: 0.3 }),
      over: 'queries queue on the primary',
    },
  },
  stages: { app: workers('app', { pods: ({ pods }) => pods, perPod: 4 }), db: store('db') },
  routes: { requests: ['app', 'db'] },
})

// the view: which boxes to draw and where the dots start
const view = defineView(shop, {
  nodes: {
    users: node({ label: 'Browsers' }),
    app: pool({ label: 'App', sub: ({ pods }) => `${pods} pods`, stage: 'app' }),
    db: node({ label: 'Postgres', stage: 'db', shape: 'cylinder' }),
  },
  edges: [edge('users', 'app'), edge('app', 'db')],
  flows: { requests: { from: 'users', color: 'accent' } },
})

export function App() {
  return <Loadmap model={shop} view={view} theme="inherit" />
}
```

Every capacity says where it came from (`measured`, `estimated`, or a fit from measurements), and `± 30 %` turns
each limit into a range. `published(kafka, { brokers: 3, replication: 3, acks: 'all', messageSize: '1 KB', producers: 4
})`, with `kafka` from `@loadmap/react/catalog`, takes the figure published for that configuration, labelled and
linked to its source; a configuration no published run matches gets no number, and the verdict says so. Add `scenarios` to compare designs, `growth` to turn multiples into dates, `expect` to fail
a test when headroom is lost. The layout runs in a Web Worker; nothing loads it before the first diagram. A page
without a bundler (from a CDN, or one self-contained HTML file) hands in its own: `elk={workerElk(…)}`, with
`@loadmap/react/elk.worker.js` to inline; https://jaim3r0jas.github.io/loadmap/without-a-bundler/ has both recipes.

`theme="inherit"` follows the page's own light and dark switch (`data-theme="dark"` or `"light"`, or a `dark` or
`light` class, on `<html>`), and the system's while the page sets none; `auto` (the default) follows the system's
only. Inside a card of its own, `.card > .lm { --lm-pad: 0; --lm-root-bg: transparent }` drops the root's padding and
background (full screen keeps both); in a grid or a flex row, give it `min-width: 0`, since it sizes the diagram to
its width.

`<Loadmap>` draws everything in one box, the canvas: the title, the scenarios and **▶ Story** in a bar over the
diagram, the load and the verdict in one line under it, and five panels that open one at a time from their tabs:
Limits (with the verdict's sentence), Design, Headroom (with the scenarios compared), Live and Assumes. The box has a
fixed height, `clamp(420px, 70dvh, 760px)` by default: give it yours with `.lm-canvas { height: 560px }`, or `fill` the
container. The canvas arranges itself by its own size:
the tabs are a rail from 900 px wide, a row when narrower and a menu under 420 px high; the open panel stands beside
the diagram, or is a sheet under 520 px. Nothing the reader does changes the box's height or lays the diagram out
again.

`panels={['limits', 'live']}` offers only those tabs (`LOADMAP_PANELS` lists the five: `limits`, `controls`,
`headroom`, `live`, `assumptions`; `[]` for none). `open`, `defaultOpen` and `onOpen` choose and follow the open one,
and `headroom={false}` or `compare={false}` leaves the chart or the scenarios compared out of Headroom. A
`Canvas.Panel` child of `<Loadmap>` is a panel of your own, its tab before the others.

A `.loadmap` text draws with `<LoadmapSource source={text} name="shop.loadmap" />` from `@loadmap/react/source`: it
compiles when the text changes, passes on the options the definition declares (your props win), and while the text
does not compile shows its diagnostics as `loadmap check` prints them. An edit keeps the values the board shows (the
load, the scenario, the controls) where they still fit; `initial` is for the first version, and a `key` per file
starts another file from its own defaults. It is the one entry that loads the compiler.

A scenario, a story step or a control that changes the structure (more pods, more brokers) moves the diagram to it:
what stays moves to its new place, what is new fades in. `transition={1.2}` sets the seconds it takes (default 0.8);
0 cuts, and so does reduced motion. The load never moves it.

The load is under the diagram, in view whatever panel is open, so the reader moves it and watches what it does. Its
track is coloured by what the load does (under the target, past it, past capacity, a ± range as a blend) and runs on
a log scale when the load spans ten times or more. Under it, a mark for today, each preset that sets the load, the
target and where it runs out: a click takes it. ← → move a step, Page Up and Page Down to the next mark. Picking a
scenario keeps the load.

The bar's **Full screen** button shows the same canvas at the screen's size; from 1280 px wide one panel stays open
beside the diagram. **Panels** beside Close, or the F key, switches the tabs and the panel off and on:
`chrome="least"` opens full screen with the diagram, the load and the verdict alone. `fill` makes the root fill its
container for good, with no Full screen button, and `scrolls` leaves the plain wheel and one finger to a page that
scrolls around it. `fullScreen` and `fullScreenMode` are the names `panels` and `chrome` had before: they still work,
and say so in the console.

**▶ Story** puts the story over the bar: its text, Play, back and next. Play tells it on the diagram: the whole
diagram, a close-up on what each step changes, the change, and the whole diagram again for the step's `seconds`, a
short title on the board (the step's `title`, or what it changes). The component that runs out first wears a ring
that breathes while the story plays and once it is past the target. With reduced motion the camera cuts and the ring
holds still. `ref.playStory()` plays it on the engine's clock, which `step()` advances.

The reader pans and zooms the diagram: a drag pans (a press that hardly moves still clicks a box), two fingers or the
wheel with Ctrl or ⌘ zoom about the pointer, the keys + − 0 and the arrows work on the focused board, and the buttons
on it go − · zoom · + · Fit. The page keeps its plain wheel and one finger; in full screen they are the diagram's.
`zoom` is still taken and no longer needed. Pictures and recordings always show the whole diagram, whatever the
reader's view.

A layout of your own starts with `useLoadmap` and `LoadmapRoot`, and goes one of two ways. `Canvas` is the same box
with your parts in it: `Canvas.Bar`, `Canvas.Console` and a `Canvas.Panel` for each tab, with `useCanvasSize` and
`useCanvasPanels` for a part that folds by the canvas's size or opens a panel. Or a document of the parts, every
panel on the page at once: `Diagram`, `Story`, `Verdict`, `Limits`, `Controls` and the others, with `LoadBar` for the
scenarios and the load in one bar that stays in view (`--lm-sticky-top` puts it under a fixed header; `Scenarios` and
`LoadRange` are its two halves, and `<Controls load={false}>` leaves the load to it). There the diagram has its own
Full screen, which takes the whole root: inside a `<div className="lm-side">` after the `Diagram`, your pieces become
a box below it that scrolls on its own; a title, the `LoadBar` and the `Story` stay above the diagram, and the rest
waits outside. `useLoadmap(model, view, { zoom: true })` lets the reader pan and zoom that diagram, and
`<Diagram lm={lm} canvas={{ left: 420 }} />` fills its container as a canvas; the insets are what the page floats
over it. The controller has the state: `lm.fullScreen`, `lm.toggleFullScreen()`, `lm.fullScreenMode`,
`lm.storyPlaying`, `lm.cue` (what the board says about the step played).

Docs, live examples and the editor: https://jaim3r0jas.github.io/loadmap/ · MIT
