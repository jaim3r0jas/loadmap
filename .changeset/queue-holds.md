---
'@loadmap/core': minor
'@loadmap/dsl': minor
'@loadmap/sim': minor
'@loadmap/react': minor
---

A queue with a size: `holds: 10_000` on a queue makes it a bounded queue, a buffer, a mailbox. Once its reader is past
full the queue fills, and what the reader cannot take is turned away: `rejected` at the queue, so a retry sends it
again, a lost box counts it and `expect { lost }` sees it. `full: block` turns the unit away at the stage before the
queue instead. With a drop rule the queue takes in `holds` ÷ `olderThan` a second: what arrives above that finds it
full, and what it took in and its reader cannot take gets too old. A queue with a size and no lost box for what it turns away has a warning.
For a moment that `lasts`, the verdict says when the queue is full, and the board keeps no more waiting than it holds.
In TypeScript, `queue({ partitions, holds, whenFull })`, and `backlog()` gives `full: { holds, after }`. From
`loadmap 1.8`.

Docs: /language/building-blocks/#queues
