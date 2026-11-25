---
'@loadmap/core': minor
'@loadmap/dsl': minor
'@loadmap/react': minor
---

What a design costs. `cost: running * 140` on a box is what it costs a month, where `running` is the pods its pool runs
at this load (an autoscaled pool costs what it runs), the members left across a domain, or 1; `currency: "€"` says what
it is counted in. `ev.cost` gives the total and each component's, `compare()` puts the total in each scenario's row and
says what the headroom costs ("…, for 2,300 € a month more"), the scenarios table has a "Cost a month" column with the
change from the first, and `expect { cost: 5_000; underTarget: 3× }` holds a budget. In TypeScript, `currency` on the
model and `cost: ({ running }) => running * 140` on a component. From `loadmap 1.8`.

Docs: /language/scenarios/
