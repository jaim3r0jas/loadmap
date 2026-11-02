# Concepts

A loadmap is a **model** (plain data and functions, no React), a **view** (which boxes to draw), and the page that
shows both. Everything a page says comes from the model, so a test or `loadmap check` can say the same without a
browser.

## The load and the parameters

The **load** is a multiple of today: 1× is the busy period you measured, 10× is ten times that. **Parameters** are what
a reader may change: a number of pods (`p.select`), a switch (`p.switch`), a range (`p.range`). A **preset** is a named
set of values offered as a button ("Black Friday": 40× with 6 pods).

## Flows and components

A **flow** is something that moves through the system at a rate that depends on the load: orders per second, events,
files. A **component** is something that can run out: its **demand** (what it must handle, from the flows) against its
**capacity**. Every capacity says where it came from:

- `measured(12, 'cores', 'pod CPU limit')`: you know it.
- `estimated(20_000, 'req/s', { source: 'vendor benchmark', within: 0.3 })`: you believe it, within ± 30 %.
- a `fitLinear(points, …)` result: a cost per unit fitted from measurements, with its r² in the assumptions.

The page lists every one of them under **Assumptions**, so a reader can see which answers rest on guesses.

## Limits and the verdict

Each component's utilization is demand ÷ capacity. Two thresholds matter: the **target** (50 % by default, the
headroom you want to keep) and **full** (100 %). For each component loadmap finds the load multiple where it crosses
each one, ranks them, and writes the **verdict**: "At 10×, every component is under the 50 % target. It holds up to
14×; the worker pool is the first limit."

With a `±` on a capacity, every crossing becomes a range ("between 7.4× and 10×"). The ranking, the first limit and
every check use the **pessimistic edge**, every capacity at its low bound, where it may already happen. When a range
is wide, a line under the verdict names the capacity whose measurement would change the answer most.

## Stages: what the dots do

**Stages** say how each flow moves, so the dots behave like the system: `pass` (rejects what is above capacity),
`queue` (partitions that fill up and drain), `workers` (pods × threads that take work), `store` (where a flow ends),
`sink` (a receiver), `fanout` (one unit becomes several). A **route** lists the stages a flow passes. The simulation
never has numbers of its own: a stage drains exactly what its component can take at 100 %, so the dots and the bars
always agree.

## Scenarios, growth and the headroom chart

A **scenario** is a named design: parameter values without the load ("Proposed": 2 gateways, 6 pods). The page shows
a button per scenario, the scenarios side by side, and a **headroom chart**: utilization over the load multiple, one
line (or band) per scenario. With **growth** (`{ rate: 0.06, per: 'month', asOf: '2026-11-01' }`), multiples become
dates: "around March 2031". The date is counted from `asOf`, never from today, so the page and its recordings say the
same thing tomorrow.

## Expectations and checks

An **expectation** is a promise: "Today keeps 7×", "the database never fills before 100×". `check(model)` tests them on
the pessimistic edge, `assertHolds(model)` throws in a test, and `loadmap check model.loadmap` exits 1 in CI. The
editor marks a broken one on its line.

## A story

A **story** is a list of steps, each with a text, values and a component to point at. The page shows a bar with
back and next; `loadmap record --story` plays it with the text under the board. Each step starts from the defaults, so
it looks the same whichever step came before.

## The view and the layout

The view names the boxes (`node`, `cluster` for brokers holding partitions, `pool` for pods), the edges and their
labels, and where each flow's dots start. ELK lays it out once per structure: a label reserves room for its widest
text across the whole load range, so moving the load never moves a box, and no label covers another.

## As text

Everything above can be written as a `.loadmap` definition instead of TypeScript, and edited next to its live
diagram. This one is drawn from its text right here:

```loadmap live
loadmap 1
title: "A gateway and a worker pool"
load "Users, × today" { max: 100; default: 10 }
param pods "Worker pods" { options: [2, 3, 4, 6]; default: 3 }
scenario "Today" {}
scenario "Proposed" { pods: 6 }

flow orders "orders" { rate: 40 * load; route: gateway -> workers; from: phones }

node phones "Phones"
node gateway "API gateway" {
  pass
  short: "the API gateway"
  demand: flows.orders
  capacity: estimated(6_000 ± 30%, "req/s", "vendor benchmark")
  over: "clients get 429s"
}
pool workers "Workers" `${pods} pods × 8 threads` {
  workers { pods: pods; perPod: 8 }
  short: "the workers"
  plural: true
  demand: flows.orders * 0.004
  capacity: measured(pods * 2, "cores", "pod CPU limit")
  over: "messages wait and the lag keeps growing"
}

phones -> gateway -> workers
```

[The language](/language/) describes every statement.
