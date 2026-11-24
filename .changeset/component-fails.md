---
'@loadmap/core': minor
'@loadmap/dsl': minor
'@loadmap/sim': minor
'@loadmap/layout': minor
'@loadmap/react': minor
---

Failures that are not about capacity: `fails: 2%` on a component is the share of the units its stages work on that
fail there whatever the load, a bug, a dependency that errors or a bad deploy. A failed unit is a new loss, `failed`:
a lost box takes it (`lost { takes: [failed] }`, and a box without `takes` takes it too), its dot goes there, the
flow's retries send it again, it counts toward the share that opens a breaker, a fallback serves it, and
`expect { lost }` holds it. The stages after the one that failed it are reached by the rest, in `at` too. It reads
the load and the parameters, so a scenario can be the bad deploy. A component that fails with no lost box for it warns
(`unseen-loss`), with the quick fix that adds the box. In TypeScript: `fails: 0.02` on the component;
`ev.stages.<id>.fails` is the share at the values. From `loadmap 1.8`.

Docs: /language/building-blocks/#lost-units
