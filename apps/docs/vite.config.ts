import { join } from 'node:path'
import { PROVIDER_ORIGINS } from '@loadmap/dsl/assist'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { withPolicy } from './csp'
import { included, llms, SITE, searchIndex, writePages } from './pages'
import { signInConfig } from './site/islands/github/signin'

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
        // a page saved half written (a fence with no language yet) says so in the browser, and the server stays up
        try {
          writePages(base)
        } catch (err) {
          const { message, stack = '' } = err as Error
          server.config.logger.error(message)
          server.ws.send({ type: 'error', err: { message, stack } })
          return
        }
        server.ws.send({ type: 'full-reload' })
      })
      // llms.txt, llms-full.txt and the search's index, made fresh on each request
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0] ?? ''
        const name = path.startsWith(base) ? path.slice(base.length) : ''
        if (name === 'search.json') {
          res.setHeader('content-type', 'application/json')
          return res.end(JSON.stringify(searchIndex()))
        }
        if (name !== 'llms.txt' && name !== 'llms-full.txt') return next()
        res.setHeader('content-type', 'text/plain; charset=utf-8')
        res.end(llms()[name])
      })
    },
    generateBundle() {
      for (const [fileName, source] of Object.entries(llms())) this.emitFile({ type: 'asset', fileName, source })
      this.emitFile({ type: 'asset', fileName: 'search.json', source: JSON.stringify(searchIndex()) })
    },
  }
}

/**
 * The sign-in Worker's origin, when the build is given the site's GitHub App: the editor's page may call it. The same
 * rule (`signInConfig`) decides whether the editor shows the button, so the two never disagree.
 */
/** The model providers the Ask panel may call from the browser, and the local servers on their usual ports. */
const MODELS = [...PROVIDER_ORIGINS, 'http://localhost:11434', 'http://localhost:1234']

function exchangeOrigin(mode: string): string[] {
  const app = signInConfig(loadEnv(mode, import.meta.dirname, 'VITE_'))
  return app ? [new URL(app.exchange).origin] : []
}

/** The editor's page gets its Content-Security-Policy once built: the dev server's own scripts would break it. */
function policy(mode: string): Plugin {
  return {
    name: 'loadmap-docs-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html, ctx) =>
        ctx.path.replace(/^\//, '') === 'editor/index.html'
          ? withPolicy(html, [...exchangeOrigin(mode), ...MODELS])
          : html,
    },
  }
}

export default defineConfig(({ mode }) => ({
  root: SITE,
  base,
  // VITE_GITHUB_APP_* from the environment, or apps/docs/.env.local (apps/github-auth/README.md)
  envDir: import.meta.dirname,
  plugins: [pages(), react(), policy(mode)],
  // elkjs (about 1.5 MB) runs in a worker chunk of its own, loaded on the first layout
  build: { outDir: join(import.meta.dirname, 'dist'), emptyOutDir: true, chunkSizeWarningLimit: 2500 },
  server: {
    fs: { allow: [join(import.meta.dirname, '../..')] },
    // the plugin writes the pages and reloads after it; a second Vite (a test) writing them must not reload this one
    watch: { ignored: ['**/site/**/*.html'] },
  },
}))
