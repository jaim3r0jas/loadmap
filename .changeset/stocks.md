---
'@loadmap/core': minor
'@loadmap/dsl': minor
'@loadmap/react': minor
'@loadmap/editor': minor
---

Stocks: a component that fills over time, not at a load. `fills` is what it gains a second (a disk, a topic's
retention, a database's size), read with every flow at its new `average`, its rate over a day against its peak. With
`keeps: 7d` it holds what it gains that long and settles at fills × keeps; with `level: measured(120, "GB", …)` it
stands there on growth's `asOf` and grows as the load does, so it is ranked at the load multiple whose day it is full,
with that date. Without growth such a stock is not ranked, and the verdict says why. `expect { lasts: 365d }` holds a
time through the growth. The limits list says what a stock gains a day and how long it has left at that rate
(`ev.components.<id>.stock`), and the editor has a starter, "Disk that fills up". All new in language 1.7.

Docs: /language/building-blocks/#stocks
