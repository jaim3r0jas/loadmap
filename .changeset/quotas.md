---
'@loadmap/core': minor
'@loadmap/dsl': minor
'@loadmap/react': minor
---

A quota over a window: `limit { per: day }` (or `hour`, `month`; language 1.7; `limit('plan', { per: 'day' })` in
TypeScript). Its capacity is what the window allows, `configured(5_000_000, "requests/day", …)`, and its demand what
reaches it in one window, at the peak for an hour and at each flow's average for a day or a month. It runs out at a
load multiple like any rate, and past it the limits list says how far into the window it is gone. A quota whose
capacity is written per second warns.

Docs: /language/building-blocks/#rate-limits
