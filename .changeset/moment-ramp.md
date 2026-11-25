---
'@loadmap/core': minor
'@loadmap/dsl': minor
'@loadmap/react': minor
---

A moment's way up. `ramp: 30s` on a preset is how long the load takes to climb from the default to the preset's, and
`ready: 90s` on an autoscaler is how long after a pod is wanted it takes work. No steady figure changes. While the
preset is shown, the verdict says what is lost on the way: "8× in 30 s: up to 75 % of requests is lost for 100 s,
until the eighth pod of the API is ready." `moment(model, values, preset)` from `@loadmap/core/moments` walks a fixed
number of steps over the ramp and the moment's length and gives each flow's lost units, share and span; the page loads
it only while such a preset is shown. In TypeScript, `ramps` beside `peaks` and `ready` in the `autoscale`. From
`loadmap 1.8`.

Docs: /language/controls/#presets
