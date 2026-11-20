# React and the page

`@loadmap/react` draws a model on a page: `<Loadmap>` is the whole piece in one box, the canvas (the title, the
scenarios and the story in a bar, the diagram with its dots, the load and the verdict under it, and the limits, the
design, the headroom chart, the live meters and the assumptions in panels), and `useLoadmap` with `Canvas` or the
panel components builds a layout of your own from the same parts. It also
re-exports everything from `@loadmap/core` and the view API, so most pages install this package alone:
[The model in TypeScript](/api/model/) has the model and [the view](/api/model/#the-view). React 19 is a peer.

## Install

```bash
npm i @loadmap/react react react-dom
```

| Entry                          | What                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| `@loadmap/react`               | `<Loadmap>`, `Canvas`, `useLoadmap`, the panels, the styles, and the model and view API      |
| `@loadmap/react/source`        | `<LoadmapSource>` and `useCatalog`: a `.loadmap` text drawn; the one entry with the compiler |
| `@loadmap/react/catalog`       | `@loadmap/core/catalog` for a page that installs only react                                  |
| `@loadmap/react/elk.worker.js` | The layout's worker as a file, for a page that serves or inlines it                          |

[Getting started](/getting-started/) has a first page; [Without a bundler](/without-a-bundler/) the same from a CDN
or in one HTML file.

## `<Loadmap>`

```tsx
import { Loadmap } from '@loadmap/react'

export function Capacity() {
  return <Loadmap model={shop} view={view} theme="inherit" closed={['eu']} />
}
```

`model` and `view` are required. Every other prop is optional.

It draws everything in one box, the canvas: the title, the scenarios and the story's button in a bar over the diagram,
the load and the verdict in one line under it, and the rest in panels that open one at a time from their tabs
(Limits, Design, Headroom, Live, Assumes). The page gives the box its height (`.lm-canvas`, by default
`clamp(420px, 70dvh, 760px)`), and nothing the reader does changes it: [the canvas](#the-canvas).

What it shows:

| Prop          | Type                                       | Default      | What                                                                                                         |
| ------------- | ------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------ |
| `theme`       | `'auto' \| 'light' \| 'dark' \| 'inherit'` | `'auto'`     | `auto` follows the system; `inherit` the page's own switch ([Styling](/api/styling/#light-dark-and-inherit)) |
| `title`       | `ReactNode \| false`                       | the model's  | The heading; `false` leaves it out                                                                           |
| `assumptions` | `readonly ReactNode[]`                     | none         | Lines put before the generated ones in "What this assumes"                                                   |
| `panels`      | `readonly LoadmapPanel[]`                  | every one    | The panels offered, in the order of their tabs; `[]` for none                                                |
| `open`        | `LoadmapPanel \| null`                     | none         | The panel that is open; leave it out and the loadmap keeps it itself                                         |
| `defaultOpen` | `LoadmapPanel \| null`                     | `null`       | The panel open at first, when the loadmap keeps it itself                                                    |
| `onOpen`      | `(panel: LoadmapPanel \| null) => void`    | none         | A panel opened, or closed (`null`)                                                                           |
| `headroom`    | `boolean`                                  | `true`       | The Headroom tab                                                                                             |
| `compare`     | `boolean`                                  | `true`       | The scenarios side by side in Headroom, when the model declares two or more                                  |
| `initial`     | `Partial<Values<P>>`                       | the defaults | Values to start from instead of the model's defaults                                                         |
| `closed`      | `readonly string[]`                        | none         | The subsystems drawn closed at first, by their ids in the view                                               |
| `onNodeClick` | `(id: string) => void`                     | none         | A click, or Enter, on a box, by its id: every box is a button then                                           |
| `selected`    | `string \| null`                           | none         | The box drawn as selected, by its id                                                                         |
| `children`    | `ReactNode`                                | none         | A `Canvas.Panel` each: a tab before the loadmap's own. Anything else is drawn over the canvas                |
| `ref`         | `Ref<LoadmapHandle>`                       | none         | The page's handle on the board: [the handle](#the-handle)                                                    |

How the diagram is laid out:

| Prop          | Type                          | Default         | What                                                                              |
| ------------- | ----------------------------- | --------------- | --------------------------------------------------------------------------------- |
| `direction`   | `'auto' \| 'RIGHT' \| 'DOWN'` | `'auto'`        | Which way the diagram runs                                                        |
| `rows`        | `number \| 'auto'`            | `'auto'`        | The rows a long diagram is folded into (columns, running down); 1 never folds     |
| `narrowBelow` | `number`                      | `640`           | The container width, in pixels, under which the diagram runs down and never folds |
| `transition`  | `number`                      | `0.8`           | Seconds the diagram takes to move to a new structure; 0 cuts                      |
| `elk`         | `ElkEngine`                   | a shared worker | Where ELK lays the diagram out: [where the layout runs](#where-the-layout-runs)   |

`direction: 'auto'` takes the way that fits the room the diagram is given larger (the board's width by most of the
window's height on a page; a board that fills its container, the canvas between its insets), and where both fit about
as well, the way its shape suggests (`directionOf(view)`: right unless its widest layer has more boxes than its longest
chain). Only the room and the structure turn it, never the load, a scenario, a step or a control. Below `narrowBelow`
it is always down, whatever is set.

`rows: 'auto'` keeps one row where the titles read with ease in the room, and otherwise takes the fewest rows, three
at most, that draw the diagram clearly larger.

A scenario, a story step or a control that changes the structure (more pods, more brokers) moves the diagram to it in
`transition` seconds: what stays moves to its new place, what is new fades in. With reduced motion it always cuts. The
load never moves a box.

The reader pans and zooms the diagram: a drag pans (a press that hardly moves still clicks a box), the wheel with
Ctrl or ⌘ held zooms about the pointer, the keys + − 0 and the arrows work on the focused board, and the buttons on
it go − · zoom · + · Fit. The page keeps its plain wheel and one finger, which scroll it; two fingers pan and pinch
the diagram. In full screen the wheel and one finger are the diagram's. A click on a subsystem's frame flies in to
it, and the path to where the view is shows over the board. Pictures and recordings always show the whole diagram.
`zoom` is still taken and no longer needed.

Full screen:

| Prop      | Type               | Default       | What                                                                    |
| --------- | ------------------ | ------------- | ----------------------------------------------------------------------- |
| `chrome`  | `'all' \| 'least'` | `'all'`       | What stands around the diagram in full screen, and in a root that fills |
| `fill`    | `boolean`          | `false`       | The root fills its container, for good, with no Full screen button      |
| `scrolls` | `boolean`          | not in `fill` | The page around it scrolls: the plain wheel and one finger are its own  |

[Full screen](#full-screen) has what each does.

The dots (the simulation's options, `SimOptions` from `@loadmap/sim`):

| Prop           | Type     | Default | What                                                                         |
| -------------- | -------- | ------- | ---------------------------------------------------------------------------- |
| `speed`        | `number` | `10`    | Simulated seconds per real second                                            |
| `seed`         | `number` | `1`     | The seed of the dots' randomness: the same seed draws the same dots          |
| `dotTarget`    | `number` | `28`    | About how many dots a second all flows together spawn; sets the dot scale    |
| `minDots`      | `number` | `1`     | Dots a second every flow with any rate spawns at least, so a small one shows |
| `maxDots`      | `number` | `40`    | Dots a second a flow spawns at most                                          |
| `legSeconds`   | `number` | `0.45`  | Real seconds a dot takes from one stage to the next                          |
| `maxParticles` | `number` | `800`   | Most dots alive at once                                                      |

The dots never decide anything: a stage drains what its flows carry at the load where its component is full, so the
board and the bars always agree.

## The canvas

The canvas reads its own size, never the window's, and arranges itself by it:

- From 900 px wide the panels' tabs are a rail down its right edge; narrower, a row over the load. A canvas under
  420 px high has one menu for them, at the top.
- The open panel stands beside the diagram, between the bars. On a canvas under 520 px wide it is a sheet that stands
  on the load, half of the room or all of it. The load and the verdict stay in view either way.
- Under 520 px the scenarios are one control; from 900 px the bar shows the flows' legend.

The diagram is arranged once for the room the bars and the tabs always leave. A panel that opens moves the view into
what is left and never lays the diagram out again; neither does the load, a scenario or the story.

**▶ Story** gives the canvas's top to the story: its text and its buttons lie over the bar, the tabs and the open
panel are away, and the load and the verdict stay. ← → step it; Done puts everything back.

`LOADMAP_PANELS` names the panels, in the order of their tabs: `'limits'` (with the verdict's sentence),
`'controls'` (the design: the load is in the console), `'headroom'` (with the scenarios compared), `'live'`,
`'assumptions'`. `LoadmapPanel` is their type. `panels={['limits', 'live']}` offers only those; Design stays out of
a model with nothing to set but the load.

[Styling](/api/styling/#sizing-the-canvas) has how a page sets the canvas's height, and the classes and attributes
its own rules can use.

## Full screen

The bar's **Full screen** button opens the browser's full screen, or a fixed overlay where the browser has none (an
iPhone) or refuses (a frame without the permission); Esc leaves either. It is the same canvas at the screen's size.
From 1280 px wide one panel stays open beside the diagram, in a slot that is out of the diagram's room from the
start.

**Panels** beside Close, or the F key, switches the tabs and the panel off and on: with `chrome="least"` full screen
opens with the diagram, the load and the verdict alone. The reader switches it; a page that changes the prop resets
the reader's choice.

`fill` makes the root fill its container, with no Full screen button: for a page of its own made to be framed. The
container gives it its height, and `chrome` says whether it has the tabs. It takes the wheel and one finger for
itself; `scrolls` gives them back to a page that scrolls around the frame. [Embedding](/embedding/) uses both.

`fullScreen` and `fullScreenMode` are the names these had before 0.41: they still work and say so in the console.
`fullScreen` took the panels' old names (`'verdict'` is in Limits now, `'compare'` in Headroom) and is `panels`;
`fullScreenMode="focus"` is `chrome="least"`.
`panelsOf(names)` gives the tabs a list of names stands for, old names or new: for a link or a setting stored with
the old ones.

## The load bar for readers

In `<Loadmap>` the load is in the console, under the diagram: its slider, and under it the verdict in one line. Both
stay in view whatever panel is open, so the reader moves the load and watches what it does. The scenarios are in the
bar over the diagram. Picking a scenario keeps the load.

- The track is coloured by what the load does: under the target, past it, past capacity, and a ± range as a blend
  between its edges.
- A load whose range spans 10× or more (`max` at least 10 times `min`, `min` above 0) runs on a log scale, as the
  headroom chart does.
- Under the track, a mark for today (1×, when the range holds it), for each preset that sets the load, for the target
  and for where it runs out. A click takes it; the mark of the values shown is underlined.
- ← → (and ↑ ↓) move the load a step, Page Up and Page Down to the next mark, Home and End to either end.
- The value shows its date when the model has `growth`.

`LoadBar` is the part for a page of its own ([a layout of your own](#a-layout-of-your-own)): the scenarios and the
same slider in one bar. It stays in view while the page scrolls (a page with a fixed header sets `--lm-sticky-top`:
[Styling](/api/styling/#the-tokens)); on a phone it sits under the diagram, in thumb reach. `<Loadmap>` does not draw
it.

## The handle

The `ref` of `<Loadmap>` (and of `<LoadmapSource>`) is a `LoadmapHandle`: what a page, a test or `@loadmap/export`
drives from outside.

| Member                | What                                                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `ready(timeoutMs?)`   | Resolves once the current values are laid out and drawn (and a move has its frame); rejects after `timeoutMs`, default 10 000 |
| `values()`            | The values shown                                                                                                              |
| `setValues(v)`        | Sets some values (`Partial<Values>`)                                                                                          |
| `setStoryStep(i)`     | Shows a story step (its values and the box it points at); `null` leaves the story                                             |
| `storyStep()`         | The step shown; `null` outside the story                                                                                      |
| `playStory()`         | Plays the story from its first step on the engine's clock, as Play does; returns its length in seconds                        |
| `pause()`, `resume()` | Stops and starts the dots                                                                                                     |
| `step(dtReal)`        | Advances the dots (and a move to a new structure) by `dtReal` real seconds and draws: the deterministic way to animate        |
| `reset(seed?)`        | Empties the queues and the dots and starts over with this seed (default: the first one)                                       |
| `show(ids)`           | On a board that zooms, brings these boxes into view, flying there                                                             |
| `board()`             | `{ svg, canvas, scene }` of the drawn board, for capturing frames; `null` before it is drawn                                  |
| `engine`              | The engine that runs the board (`Engine`): low level, for export                                                              |

`playStory()` throws while nothing is drawn yet or the model has no story. Picking a step or a value stops it.

```tsx
const board = useRef<LoadmapHandle>(null)

async function worstCase() {
  board.current?.setValues({ load: 8, pods: 2 })
  await board.current?.ready()
}

return <Loadmap model={shop} view={view} ref={board} />
```

[Media, simulation and layout](/api/more/) uses the handle for pictures and recordings.

## `useLoadmap` and the controller

`useLoadmap(model, view, options?)` is the state behind `<Loadmap>`: the values, the model's evaluation, the layout
and the engine that draws the dots. It takes `LoadmapOptions`: every prop of the tables above under "How the diagram is
laid out" and "The dots", `chrome` and `fill`, with `initial` and `closed` (not the display props: `theme`, `title`,
`assumptions`, `panels`, `open`, `defaultOpen`, `onOpen`, `headroom`, `compare`, `scrolls`, `onNodeClick`, `selected`,
`children`, `ref`). It returns a `LoadmapController`, which every panel takes as `lm`.

One option is for a layout of your own alone: `zoom: true` lets the reader pan and zoom a `<Diagram>` that stands in
the page's flow. A canvas always pans and zooms, so `<Loadmap>` and `<Canvas>` do not read it.

| Field                                    | What                                                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `model`, `view`                          | The model, and the view drawn (with the closed subsystems closed)                                                                     |
| `values`, `setValues(v)`                 | The values shown, and a change to some of them                                                                                        |
| `ev`                                     | `model.evaluate(values)`: the verdict, the limits and the rest ([the evaluation](/api/model/#the-evaluation))                         |
| `scenario`                               | The scenario the values match, load aside; `null` for values of the reader's own                                                      |
| `setScenario(label)`                     | Takes a scenario's values; the load stays                                                                                             |
| `step`, `setStep(i)`                     | The story step shown, by index (`null` outside the story), and a step to show                                                         |
| `stepChanged`                            | The reader changed a value since the step was shown                                                                                   |
| `focus`                                  | The component the story points at now                                                                                                 |
| `storyPlaying`, `setStoryPlaying(on)`    | The story plays; play from the step after the one shown, or pause                                                                     |
| `cue`                                    | What the board says about the step played (`Cue`: `step`, `title`, `detail`, `after`, `top`, `seconds`); `null` when it does not play |
| `closed`, `setClosed(ids)`               | The subsystems drawn closed; draws these closed and every other one open                                                              |
| `fullScreen`, `toggleFullScreen()`       | The root is full screen (the browser's, the overlay, or `fill`); in or out                                                            |
| `fullScreenMode`, `setFullScreenMode(m)` | What stands around the diagram in full screen: `'panels'` (`chrome="all"`) or `'focus'` (`chrome="least"`)                            |
| `fill`, `zoom`                           | The options as given                                                                                                                  |
| `scene`                                  | The laid out diagram; `null` until the first layout is done                                                                           |
| `labels`, `direction`, `reducedMotion`   | The labels at these values, the direction laid out, the reader's motion setting                                                       |
| `engine`                                 | The engine (dots, camera, story)                                                                                                      |
| `rootRef`, `root`                        | Attach `rootRef` to the element with the `.lm` class: its width picks the direction, its tokens the colours                           |

A value the reader changes, a scenario or a step they pick stops the story. A new `model` (an edited text) starts from
its own defaults; the engine stays, and what is drawn moves to the new structure.

## The pieces

Each takes the controller as `lm`.

| Component       | Props                          | What                                                                                                                      |
| --------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `LoadmapRoot`   | `lm`, `theme?`, `children`     | The root (`.lm`): the theme's tokens, the styles, the size the layout follows                                             |
| `Canvas`        | `CanvasProps`                  | One box with the diagram, a bar, a console and panels: [a layout of your own](#a-layout-of-your-own)                      |
| `Diagram`       | `DiagramProps` (below)         | The board: SVG for the structure, a canvas on top for the dots, Full screen                                               |
| `LoadBar`       | `lm`                           | The scenarios and the load in one bar that stays in view, for a document of the parts                                     |
| `Scenarios`     | `lm`                           | One button per scenario; nothing when the model has none                                                                  |
| `LoadRange`     | `lm`                           | The load slider with its zones and marks                                                                                  |
| `Story`         | `lm`                           | The story a step at a time: text, Play, back and next; ← → while it has the focus                                         |
| `Verdict`       | `lm`                           | The verdict, and the capacity worth measuring                                                                             |
| `Limits`        | `lm`, `title?`                 | Each component's utilization in the order they reach the target                                                           |
| `Meters`        | `lm`                           | Live, from the dots: lag and drops per queue, busy workers, pods running, cache hits, rejections, retries, p99, time-outs |
| `Controls`      | `lm`, `load?` (default `true`) | The load slider, the presets that set no load, and every parameter; `load={false}` leaves the load to a `LoadBar`         |
| `HeadroomChart` | `lm`, `title?`                 | Utilization over the load multiple, per scenario; hover or the arrow keys read it                                         |
| `Compare`       | `lm`, `title?`                 | The scenarios side by side; nothing with fewer than two                                                                   |
| `Assumptions`   | `lm`, `extra?`                 | Every capacity with where it came from, every fit, and `extra` lines first                                                |

The `title` defaults are "Where it runs out, in order", "Headroom" and "Scenarios compared". The type of
`ev.verdict` is `VerdictResult` (from core); the panel is `Verdict`.

`DiagramProps`:

| Prop          | Type                         | Default | What                                                                                        |
| ------------- | ---------------------------- | ------- | ------------------------------------------------------------------------------------------- |
| `lm`          | `LoadmapController`          |         | The controller                                                                              |
| `legend`      | `boolean`                    | `true`  | The flows' legend under the board                                                           |
| `onNodeClick` | `(id: string) => void`       | none    | A click, or Enter, on a box: every box is a button then, one without a component too        |
| `selected`    | `string \| null`             | `null`  | The box drawn as selected                                                                   |
| `canvas`      | `boolean \| Partial<Insets>` | `false` | The board fills its container as a canvas the wheel alone zooms, with no Full screen button |

`canvas` takes insets, `{ top, right, bottom, left }` in pixels: what the page floats over the board. Fit frames the
diagram in what they leave, and the legend and the zoom buttons stay clear of them. The container gives the board its
height.

```tsx
<Diagram lm={lm} canvas={{ left: 420 }} />
```

The diagram is arranged for the room the insets leave, so a new inset can lay it out again. `reserve` names the part
of them that is always there: the diagram is arranged for what `reserve` leaves, and the rest only moves the view.
A panel 340 px wide that opens over a rail of 44 px:

```tsx
<Diagram lm={lm} canvas={{ right: open ? 340 : 44, reserve: { right: 44 } }} />
```

A canvas takes the wheel and one finger for itself, as a board that fills its page should. With `scrolls: true` it
lies in a page that scrolls: the wheel zooms only with Ctrl or ⌘ held, one finger scrolls the page, and two fingers
pan and pinch the board.

```tsx
<Diagram lm={lm} canvas={{ scrolls: true }} />
```

## A layout of your own

There are two ways, from the same parts. Both start with `useLoadmap` and a `LoadmapRoot`.

### The canvas with your own parts

`Canvas` is the box `<Loadmap>` draws in. The diagram fills it, `Canvas.Bar` lies over its top, `Canvas.Console` over
its bottom, and each `Canvas.Panel` is a tab that opens its panel, one at a time. It arranges itself by its own size
and takes its height from the page, as [the canvas](#the-canvas) says.

```tsx
import { Canvas, Limits, LoadmapRoot, LoadRange, Scenarios, useLoadmap, Verdict } from '@loadmap/react'

function Capacity() {
  const lm = useLoadmap(shop, view)
  return (
    <LoadmapRoot lm={lm} theme="inherit">
      <Canvas lm={lm} defaultOpen="limits">
        <Canvas.Bar>
          <Scenarios lm={lm} />
          <button type="button" className="lm-btn" onClick={lm.toggleFullScreen}>
            Full screen
          </button>
        </Canvas.Bar>
        <Canvas.Console>
          <LoadRange lm={lm} />
        </Canvas.Console>
        <Canvas.Panel id="limits" title="Limits">
          <Verdict lm={lm} />
          <Limits lm={lm} />
        </Canvas.Panel>
        <Canvas.Panel id="notes" title="Notes">
          <p>Measured in the last load test.</p>
        </Canvas.Panel>
      </Canvas>
    </LoadmapRoot>
  )
}
```

`CanvasProps`:

| Prop                                | Type                | What                                                                                   |
| ----------------------------------- | ------------------- | -------------------------------------------------------------------------------------- |
| `lm`                                | `LoadmapController` | The controller                                                                         |
| `label`                             | `string`            | The region's name for a screen reader; default the model's title                       |
| `open`, `defaultOpen`, `onOpen`     | as `<Loadmap>`'s    | The open panel, by its `id`; leave `open` out and the canvas keeps it itself           |
| `over`                              | `ReactNode`         | What takes the top for a while, a `<Story>`: the tabs and the open panel are away then |
| `scrolls`                           | `boolean`           | The page around it scrolls; default `true` in a page, `false` in a root that fills     |
| `legend`, `onNodeClick`, `selected` | as `Diagram`'s      | Passed to the diagram                                                                  |
| `className`, `style`, `ref`         |                     | The box's own, `.lm-canvas`: `style` for a height the page's CSS does not give         |

- `Canvas.Bar`, `Canvas.Console` and every `Canvas.Panel` are direct children of `Canvas`, which places them by their
  type: the bar and the console at most once each. Anything else is drawn over the canvas.
- A `Canvas.Panel` takes `id`, `title` (what its tab says) and its children, drawn only while it is open.
- The diagram in a canvas has no Full screen button: a button of yours calls `lm.toggleFullScreen()`. Full screen is
  the same canvas at the screen's size, with one panel kept open from 1280 px.
- `useCanvasSize()` gives a part in the canvas its size class, `{ width, short, pinned }`: `width` is `'compact'`
  (under 520 px), `'regular'` or `'wide'` (from 900 px), `short` a canvas under 420 px high, `pinned` a full screen
  that keeps its panel open. A part folds by it, never by the window.
- `useCanvasPanels()` gives `{ panels, open, show, under }`: the panels' ids, the one that is open, `show(id)` to open
  one (`show(null)` closes it), and `under`, true while something lies over the bar.
- `CANVAS` has those sizes in pixels (`compact`, `wide`, `short`, `pin`) and the widths of the rail and the panel.

A panel of your own in `<Loadmap>` needs none of this: give it a `Canvas.Panel` child, and its tab comes before the
loadmap's.

### A document of the parts

Every panel on the page at once, in the page's own flow, as `<Loadmap>` was before 0.41:

```tsx
import { Assumptions, Diagram, LoadBar, LoadmapRoot, Story, useLoadmap, Verdict } from '@loadmap/react'

function Capacity() {
  const lm = useLoadmap(shop, view, { zoom: true })
  return (
    <LoadmapRoot lm={lm} theme="inherit">
      <LoadBar lm={lm} />
      <Story lm={lm} />
      <Diagram lm={lm} />
      <div className="lm-side">
        <Verdict lm={lm} />
        <Assumptions lm={lm} />
      </div>
      <p>Not shown in full screen.</p>
    </LoadmapRoot>
  )
}
```

The diagram has its own **Full screen** button here. It takes the whole root as a column that never scrolls, and the
classes say where each piece goes:

- A title (`h2`), the `LoadBar` (or `Scenarios`) and the `Story` stay above the diagram.
- Inside a `<div className="lm-side">` after the `Diagram`, the pieces become a box below it that scrolls on its own.
  On the page `.lm-side` lays nothing out of its own (`display: contents`): its pieces are the root's.
- Anything else in the root waits outside full screen, and so does an element with a `data-out` attribute.
- A switch beside Close, or the F key, turns it into focus: the `.lm-side` goes, and the diagram and the story stand
  in the middle of the screen. `chrome: 'least'` opens full screen there.
- Under 760 px wide the title and the legend go, the diagram pans in a box of its own, and the `LoadBar` moves under
  it.
- `.lm-card` draws a card (the surface, a border, rounded corners); `.lm-strip` puts two cards side by side, one
  column on a narrow root.

It has no tabs, no panel beside the diagram and no pinned panel: those are the canvas's. The dock of compact cards
and the drawer that `<Loadmap>` gave this full screen before 0.41 are gone.

The controller has the state for controls of your own: `lm.fullScreen`, `lm.toggleFullScreen()`,
`lm.fullScreenMode`, `lm.storyPlaying`, `lm.cue`. `handleOf(lm)` makes the [handle](#the-handle) of a layout of your
own, for export.

## A `.loadmap` text on a page

`<LoadmapSource>`, from `@loadmap/react/source`, draws a `.loadmap` text as `<Loadmap>`. It is the one entry that
loads the compiler: a page built from TypeScript never does.

```tsx
import { LoadmapSource } from '@loadmap/react/source'
import text from './shop.loadmap?raw'

export function Capacity() {
  return <LoadmapSource source={text} name="shop.loadmap" theme="inherit" />
}
```

| Prop        | Type                               | What                                                                                              |
| ----------- | ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| `source`    | `string`                           | The text; compiled again when its tokens change (spaces, line breaks and comments change nothing) |
| `name`      | `string`                           | The file the diagnostics name, as `loadmap check` does; default `input.loadmap`                   |
| `functions` | `CompileOptions['functions']`      | The host's own functions for the formulas, as `compile` takes them                                |
| `files`     | `Readonly<Record<string, string>>` | The other files of a model in several, by their path from the project root                        |
| `path`      | `string`                           | This text's own path among them (`models/checkout.loadmap`)                                       |

Every `<Loadmap>` prop but `model` and `view` works too. The options the definition declares in its `view` block
(`speed`, `transition`, `direction`, `rows`, `closed`, `fullScreen` as `panels`, `fullScreenMode` as `chrome`, and
its assumptions) are passed on ([The view](/language/view/)); a prop the page sets wins, and the page's
`assumptions` come first.

- While the text does not compile, its diagnostics show as `loadmap check` prints them, above the last version that
  did.
- An edit keeps the values the board shows (the load, a scenario's, the controls) where they still fit the new
  version; `initial` is for the first.
- It fetches nothing: a part, a library or a model that is not in `files` is an error in the text.
- To start another file from its own defaults rather than the values shown, give each file its own `key`.

[Several files](/language/several-files/) has how a model is split; [The language in code](/api/language/) the
compiler itself.

## The catalog on a page

A text with a `published` statement needs the catalog, which no first load carries. `<LoadmapSource>` loads it when
the text needs it. `useCatalog(source)` (from `@loadmap/react/source`) does the same for a component of your own: it
starts loading the catalog when `source` has a `published` statement, and is `true` while the text still waits for it.

```tsx
const waiting = useCatalog(text)
const result = useMemo(() => (waiting ? null : compile(text)), [text, waiting])
```

A TypeScript model imports the figures from `@loadmap/react/catalog` (or `@loadmap/core/catalog`):
`published(kafka, { brokers: 3, replication: 3, acks: 'all', messageSize: '1 KB', producers: 4 })`.
[Published figures](/language/published/) has the rules.

## Styles and theme

The stylesheet goes into the document's `<head>` on the first render; nothing to import. `LOADMAP_CSS` is the
stylesheet as a string and `injectStyles(doc?)` adds it once to a document (default `document`): for server rendering,
a shadow root, or a document of your own. `usePageTheme(theme)` returns the theme a root draws (`'auto'`, `'light'`
or `'dark'`), following the page's own switch for `'inherit'`. [Styling](/api/styling/) has the tokens, the themes,
and the canvas's height and classes.

## Where the layout runs

The layout (ELK) runs in a Web Worker that every board on the page shares, started with the first layout; nothing
loads it before the first diagram. When the worker cannot start (no `Worker`, a Content-Security-Policy without
`worker-src`, a dev server that moved the worker file), every layout runs on the main thread instead: slower to start,
the same result, and the console says why once.

`workerElk(make)` is ELK in a worker the page starts, falling back the same way. Make it once, outside a component:
each engine starts its own worker.

```tsx
import { Loadmap, workerElk } from '@loadmap/react'

const elk = workerElk(() => new Worker(new URL('./elk.worker.js', import.meta.url), { type: 'module' }))

export const Capacity = () => <Loadmap model={shop} view={view} elk={elk} />
```

`@loadmap/react/elk.worker.js` is the worker to serve or inline; [Without a bundler](/without-a-bundler/) has both
recipes. Any object with `layout(graph): Promise<graph>` is an `ElkEngine`.

## Also exported

- Everything from `@loadmap/core` and `@loadmap/core/catalog`, with `fitLinear`, the number formats (`fmt`, `compact`,
  `pct`, `secs`, `multiple`) and the measured-data readers (`fromSnapshot`, `parseSnapshot`, `MEASURES`, `summarize`,
  `originText`): [The model in TypeScript](/api/model/), [Media, simulation and layout](/api/more/).
- The view: `defineView`, `node`, `pool`, `cluster`, `edge`, `directionOf` and their types:
  [the view](/api/model/#the-view).
- `scenarioColor(model, label)`: a scenario's colour (`var(--lm-s1)` to `var(--lm-s4)`, then muted; the text colour
  for values of the reader's own), for a chart of your own.
- `useComparison(lm)`: `compare(model, load)` at the load shown, memoized.
- The types `LoadmapProps`, `LoadmapOptions`, `LoadmapController`, `LoadmapHandle`, `LoadmapPanel`, `CanvasProps`,
  `CanvasSize`, `Chrome`, `FullScreenMode`, `Theme`, `DiagramProps`, `Cue`, `Dot` and `Engine`.
