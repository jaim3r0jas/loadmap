---
'@loadmap/dsl': minor
'@loadmap/core': patch
'@loadmap/cli': patch
---

Connections in the language: `connection group { hop: topic -> pool; assign: exclusive; capacityPer: pod }`, with
`owner`, `parts`, `members` and `flows: [orders]`, as `connections` does in TypeScript. What the model refuses about a
connection is shown on its line; autocomplete, hover, rename and the outline know connections and the flows they list.
A flow a connection lists twice counts once.
