---
"@loadmap/cli": minor
---

`loadmap check`, `loadmap fmt` and `loadmap --help` run without Playwright: it is an optional peer dependency now
(any version from 1.40), loaded only by `loadmap record`, so a CI step that only checks a model does not download a
browser driver. A project that records installs it next to the command, `npm i -D @loadmap/cli playwright`, then
`npx playwright install chromium`; `npx @loadmap/cli record` alone no longer finds it, since npx never installs an
optional peer. Without it, `record` says so before doing any work.
