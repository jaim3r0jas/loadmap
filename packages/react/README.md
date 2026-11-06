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
  return <Loadmap model={shop} view={view} />
}
```

Every capacity says where it came from (`measured`, `estimated`, or a fit from measurements), and `± 30 %` turns
each limit into a range. Add `scenarios` to compare designs, `growth` to turn multiples into dates, `expect` to fail
a test when headroom is lost. The layout runs in a Web Worker; nothing loads it before the first diagram. A page
without a bundler (from a CDN, or one self-contained HTML file) hands in its own: `elk={workerElk(…)}`, with
`@loadmap/react/elk.worker.js` to inline; https://jaim3r0jas.github.io/loadmap/without-a-bundler/ has both recipes.

`theme="inherit"` follows the page's own light and dark switch (`data-theme="dark"` or `"light"`, or a `dark` or
`light` class, on `<html>`), and the system's while the page sets none; `auto` (the default) follows the system's
only. Inside a card of its own, `.card > .lm { --lm-pad: 0; --lm-root-bg: transparent }` drops the root's padding and
background (full screen keeps both); in a grid or a flex row, give it `min-width: 0`, since it sizes the diagram to
its width.

A scenario, a story step or a control that changes the structure (more pods, more brokers) moves the diagram to it:
what stays moves to its new place, what is new fades in. `transition={1.2}` sets the seconds it takes (default 0.8);
0 cuts, and so does reduced motion. The load never moves it.

The diagram's **Full screen** fits the screen without scrolling: the diagram as wide as it, the verdict in one line
under it, and the panels of the page side by side in a compact form (a phone shows one at a time, under tabs, and
pans the diagram in its own box). Each compact panel opens whole over the diagram. `fullScreen={['verdict', 'live',
'controls']}` keeps only those (`LOADMAP_PANELS` lists them all: `verdict`, `live`, `limits`, `controls`, `headroom`,
`compare`, `assumptions`). A switch beside Close, or the F key, turns full screen into **focus**: the diagram, the
story and, of the panels listed, the verdict and the load slider. `fullScreenMode="focus"` opens full screen there
(default `'panels'`). The story bar plays the story, each step for its `seconds`.

`useLoadmap` with `LoadmapRoot`, `Diagram`, `Verdict`, `Limits`, `Controls` and the others builds a page of your own
layout from the same pieces. The diagram's Full screen takes the whole root: inside a `<div className="lm-side">`
after the `Diagram`, your pieces become a box below it that scrolls on its own; a title, the `Scenarios` and the
`Story` stay above the diagram, and the rest waits outside. The controller has the state: `lm.fullScreen`,
`lm.toggleFullScreen()`, `lm.fullScreenMode`, `lm.storyPlaying`.

Docs, live examples and the editor: https://jaim3r0jas.github.io/loadmap/ · MIT
