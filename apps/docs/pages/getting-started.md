# Getting started

A model of a web shop on a page, in four steps. You need a React 19 app; a fresh one is
`npm create vite@latest shop -- --template react-ts`.

## 1. Install

```bash
npm i @loadmap/react react react-dom
```

`@loadmap/react` brings the model, the view and the components. The layout runs in a Web Worker that the first diagram
starts; Vite and other bundlers that understand `new Worker(new URL(…, import.meta.url))` pick it up with no setup.

## 2. Write the model and the view

The **model** is plain TypeScript: the load (a multiple of today), the parameters a reader can change, the flows and
their rates, and the **components** that can run out, each with its demand and its capacity. The **view** says which
boxes to draw and where the dots start.

@include(packages/react/README.md, "```tsx", "```")
```

## 3. See it

<div class="island" data-island="quickstart"></div>

Move **Visitors** past 2×: the app pods turn amber, and the verdict says they are the first limit, at 2.2×. Switch to
8 pods and the database takes over, somewhere between 2.9× and 5.4×: a range, because its capacity is an estimate
within ± 30 %.

## 4. Make it yours

- Replace the numbers with yours, and say where each came from: `measured(…)` for what you measured, `estimated(…,
  { within: 0.3 })` for what you did not. `fitLinear` fits a cost per request from a series of measurements.
- Add `scenarios: { Today: {}, Proposed: { pods: 8 } }` to compare designs, and `growth` to turn multiples into dates.
- Add `expect: [{ target: 3 }]` and a test that calls `assertHolds(shop)`: a change that loses the headroom fails it.
- Add a `story` to walk a reader through it a step at a time.

[Concepts](/concepts/) explains each of these. The same model can also be written as a `.loadmap` text and edited
next to its diagram: see [the language](/language/) and [the editor](/editor/).
```
