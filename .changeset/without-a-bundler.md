---
"@loadmap/react": minor
---

A page without a bundler can keep the layout in a worker. `workerElk(() => new Worker(…))` makes an ELK engine for
`<Loadmap elk={…}>` from a worker the page starts, and `@loadmap/react/elk.worker.js` is the worker's file, for a
bundler to inline (`?worker&inline` in Vite) or a CDN to serve. When the worker cannot start and the layout falls back
to the main thread, the console says so once, with what to hand in. The docs have a "Without a bundler" page: a page
from a CDN with an import map, and one self-contained HTML file, with the sizes to expect.
