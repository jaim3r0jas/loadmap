import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

/** The node tests that drive Chromium: a part of their own (LOADMAP_NODE_TESTS=chromium or rest, scripts/check.mjs). */
import CHROMIUM from './scripts/chromium-node-tests.json' with { type: 'json' }

const part = process.env.LOADMAP_NODE_TESTS

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include:
            part === 'chromium'
              ? CHROMIUM
              : ['packages/*/test/**/*.test.ts', 'examples/*/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
          // the CLI test starts a dev server and Chromium; it gets time to
          testTimeout: 30_000,
          exclude: ['**/node_modules/**', '**/*.browser.test.*', ...(part === 'rest' ? CHROMIUM : [])],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'browser',
          include: ['**/*.browser.test.{ts,tsx}'],
          exclude: ['**/node_modules/**'],
          browser: { enabled: true, headless: true, provider: playwright(), instances: [{ browser: 'chromium' }] },
        },
      },
    ],
  },
})
