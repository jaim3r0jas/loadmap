---
'@loadmap/core': minor
'@loadmap/dsl': minor
'@loadmap/sim': minor
'@loadmap/react': minor
---

Retries at a hop: `retry { at: payments; times: 2 }` is the caller of payments calling again. What fails at that stage
or after it is sent again from there, so only the stages from it on see those attempts. A flow takes one rule without
`at` (its client's, as before) and one for each stage, and retries inside retries multiply: the attempts a stage sees
are the product of every rule around it, and an attempt fails only when every attempt inside it does. The rules are
solved together, the hops inside the client's. `ev.retry.<flow>.hops` gives each hop's attempts a unit, its failing
share and what fails every attempt there; the Live panel shows the attempts at each hop; a dot sent again at a hop
starts there. In TypeScript `retry` takes a list: `[{ times: 1 }, { at: 'payments', times: 2 }]`. A timeout stays the
client's. From `loadmap 1.8`.

Docs: /language/building-blocks/#retries
