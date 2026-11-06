# Without a bundler

[Getting started](/getting-started/) assumes a bundler that understands `new Worker(new URL(…, import.meta.url))`, as
Vite does: it finds the layout's worker next to `@loadmap/react` and serves it. Two pages that have none: one that
loads everything from a CDN, and one HTML file that carries everything.

## From a CDN

An import map points the bare names at [esm.sh](https://esm.sh), which serves each package as a module and rewrites
its imports; `?external=react,react-dom` keeps one copy of React, the one the map names. JSX needs a compiler, so the
page writes `h(Loadmap, …)`; the model and the view are the [quick start](/getting-started/)'s.

```html
<!doctype html>
<meta charset="utf-8">
<script type="importmap">
  {
    "imports": {
      "react": "https://esm.sh/react@19.3.1",
      "react/": "https://esm.sh/react@19.3.1/",
      "react-dom/client": "https://esm.sh/react-dom@19.3.1/client?external=react",
      "@loadmap/react": "https://esm.sh/@loadmap/react@%VERSION%?external=react,react-dom"
    }
  }
</script>
<div id="root"></div>
<script type="module">
  import { createElement as h } from 'react'
  import { createRoot } from 'react-dom/client'
  import { defineModel, defineView, edge, Loadmap, measured, node, p, workerElk } from '@loadmap/react'

  const shop = defineModel({ /* the quick start's model */ })
  const view = defineView(shop, { /* and its view */ })

  // the layout's worker, from esm.sh through a Blob: a page cannot start a worker from another origin
  const worker = 'import "https://esm.sh/@loadmap/react@%VERSION%/dist/elk.worker.js"'
  const elk = workerElk(() => new Worker(URL.createObjectURL(new Blob([worker], { type: 'text/javascript' })), { type: 'module' }))

  createRoot(document.getElementById('root')).render(h(Loadmap, { model: shop, view, elk }))
</script>
```

- **The worker.** Without `elk`, the page draws the same, with the layout on the main thread: the worker
  `@loadmap/react` starts lives on the CDN's origin, which a page cannot start, and the console says so once. The
  Blob works because esm.sh rewrites the worker's own `elkjs` import; jsDelivr serves the file as it is, with that
  import bare, so a Blob of it does not start.
- **A Content-Security-Policy** must allow the Blob (`worker-src blob:`) and esm.sh, or the worker is refused and the
  layout falls back, the console saying why.
- **Pin every version**, as above: a CDN serves the newest version for a bare name, and a page that changes under
  you is no page to trust.
- **Right after a release** a CDN can answer 404 for the new version until it has fetched it from npm. Keep the
  version you tested with, and move on once the CDN serves the new one.

## In one HTML file

For a page with no server at all, one file that opens from disk: Vite builds the page into one script, the worker
inlined in it (`?worker&inline`), and a few lines put the script into the HTML. The page is the quick start's, then:

```tsx
// page.jsx
import { createRoot } from 'react-dom/client'
import ElkWorker from '@loadmap/react/elk.worker.js?worker&inline'

// … the quick start's model and view, and workerElk in its import …

const elk = workerElk(() => new ElkWorker())
createRoot(document.getElementById('root')).render(<Loadmap model={shop} view={view} elk={elk} />)
```

```js
// build.mjs: node build.mjs writes dist/shop.html
import { readFileSync, writeFileSync } from 'node:fs'
import { build } from 'vite'

await build({
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: 'dist',
    minify: true,
    lib: { entry: 'page.jsx', formats: ['iife'], name: 'shop', fileName: () => 'page.js' },
    rolldownOptions: { output: { codeSplitting: false } },
  },
})
const js = readFileSync('dist/page.js', 'utf8').replace(/<\/script/gi, '<\\/script')
writeFileSync('dist/shop.html', `<!doctype html><meta charset="utf-8"><div id="root"></div><script>${js}</script>`)
```

- **The size**, with React 19: about 3.3 MB (1 MB gzip), since ELK is in it twice, in the worker and for the
  main-thread fallback. Leave out the worker (the import and `elk`) for 1.8 MB (550 kB gzip), the layout then on the
  main thread: slower to start on a large diagram, the same picture.
- **From disk.** It opens as a `file://` page: the inlined worker starts from a Blob, nothing else is fetched.
- **The warning and the extra file.** Vite warns about `import.meta.url` in an IIFE and writes
  `dist/assets/elk.worker-….js`: that is the worker `@loadmap/react` would start by URL, unused once the page hands in
  its own. Leave the file out.
