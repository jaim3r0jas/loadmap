---
'@loadmap/dsl': minor
---

Two ways to say a thing once, from `loadmap 1.2`. `like: db` on a box takes every line and stage of the box `db` that
this one does not write itself, so a second shard is one line. `out.<stage>` is what a fan-out sends, a second (what
reaches it of each flow times that branch's copies), so its box says `demand: out.push` instead of repeating the
copies of its branches. `out` is a reserved name from 1.2; a file stamped before keeps a parameter or let of that name.
