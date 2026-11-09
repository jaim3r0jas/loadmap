---
'@loadmap/react': minor
'@loadmap/layout': minor
'@loadmap/dsl': minor
'@loadmap/editor': minor
'@loadmap/export': patch
---

Every tier lane is filled: the first, third… in the new theme token `--lm-tier-base`, the others in `--lm-tier`, with
the lane shades and headers a step apart in both themes. `lanes: striped` (`lanes: 'striped'` in the view) brings back
every other lane clear. A tier can have a colour of its own, `tier data "Data" { fill: "#e6f2ec"; fillDark: "#1c2b26" }`
(`fill` and `fillDark` beside its `label` in TypeScript); without `fillDark`, dark keeps the colour's hue as dark as the
theme's lanes, and `fillDark` alone leaves light the theme's. In a definition a colour is hex, `rgb()` or `hsl()`:
`compile` refuses anything else, such as a `url(…)` that would fetch from a shared link, and now also what only looks
like one (`"#12345"`, `"rgb(1)"`), for flows' colours too. Exports write a lane's own colours in rgb, as they write the
theme's tokens.

In the editor, **View** switches the lanes' fills and the canvas's dot grid (`grid: false`, read only by the editor),
which now shows through the lanes; the model's tab gives each lane a light and a dark colour, and Reset takes them out.
Each is one edit of the text: `setProperty` writes, changes or takes out a property of the definition or of a tier.
