---
'@loadmap/dsl': minor
'@loadmap/react': minor
'@loadmap/cli': minor
'@loadmap/editor': patch
'@loadmap/core': patch
---

The `.loadmap` language takes published figures: `published brokersRef kafka { edition: "2026-11"; brokers: 3; … }`
names a component of the catalog and the conditions of its run, and `capacity: brokersRef` uses the figure. The
checker names a component, condition, edition or figure that does not exist (and which component covers `redis`),
warns when the conditions written match no published run, and says when a later edition has other figures;
autocomplete offers the components, their conditions and the values their runs used, hover the figure with its
conditions and source. The catalog loads only for a text that names it: `loadCatalog()` (and `needsCatalog(text)`)
from `@loadmap/dsl`; `<LoadmapSource>`, the editor, the CLI and the language server load it themselves.
