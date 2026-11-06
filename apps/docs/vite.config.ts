import { join } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { included, llms, SITE, writePages } from './pages'

// DOCS_BASE is where the site is served: "/" here, "/loadmap/" on GitHub Pages
const base = process.env.DOCS_BASE ?? '/'

/** Writes the pages before Vite reads them, and again whenever a page or an included file changes. */
function pages(): Plugin {
  return {
    name: 'loadmap-docs-pages',
    config: () => {
      const files = writePages(base)
      return { build: { rolldownOptions: { input: files } } }
    },
    configureServer(server) {
      const pages = join(import.meta.dirname, 'pages')
      const files = new Set(included())
      server.watcher.add([pages, ...files])
      server.watcher.on('change', (file) => {
        if (!file.startsWith(pages) && !files.has(file)) return
        writePages(base)
        server.ws.send({ type: 'full-reload' })
      })
      // llms.txt and llms-full.txt, read fresh on each request
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0] ?? ''
        const name = path.startsWith(base) ? path.slice(base.length) : ''
        if (name !== 'llms.txt' && name !== 'llms-full.txt') return next()
        res.setHeader('content-type', 'text/plain; charset=utf-8')
        res.end(llms()[name])
      })
    },
    generateBundle() {
      for (const [fileName, source] of Object.entries(llms())) this.emitFile({ type: 'asset', fileName, source })
    },
  }
}

export default defineConfig({
  root: SITE,
  base,
  plugins: [pages(), react()],
  // elkjs (about 1.5 MB) runs in a worker chunk of its own, loaded on the first layout
  build: { outDir: join(import.meta.dirname, 'dist'), emptyOutDir: true, chunkSizeWarningLimit: 2500 },
  server: {
    fs: { allow: [join(import.meta.dirname, '../..')] },
    // the plugin writes the pages and reloads after it; a second Vite (a test) writing them must not reload this one
    watch: { ignored: ['**/site/**/*.html'] },
  },
})
