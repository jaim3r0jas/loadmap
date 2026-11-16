---
'@loadmap/dsl': minor
'@loadmap/layout': patch
'@loadmap/editor': patch
---

Language versions with a minor: `loadmap 1.1`. `loadmap 1` reads as 1.0, the language of @loadmap/dsl 0.32, and a
file keeps compiling as it did under the version it names: a check a later version makes strict is a warning before it
("… (an error from loadmap 1.1)") and an error from it on, so a hop without its edge in a `loadmap 1` file warns and
its dots cross straight, as they did. Something a version added (`lost` boxes, numbers with units, `as` after a
demand: 1.1) needs that version on the first line, an error with a quick fix that writes it, so a loadmap too old for
it says "update @loadmap/dsl" instead of "unknown statement" (one from before this release reads `loadmap 1.1` that
way already). `loadmap fmt` raises the first line to the lowest version that has everything the file uses, and never
lowers it; `1.10` comes after `1.9`. The reference says which version added a statement, and docs/dsl.md has the rule
and a table of versions. `LANGUAGE_VERSION` is now a string, `'1.1'`. The templates, examples and docs' definitions
say `loadmap 1.1`.
