import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['packages/*/test/**/*.test.ts', 'examples/*/**/*.test.ts'],
          // the CLI test starts a dev server and Chromium; it gets time to
          testTimeout: 30_000,
          exclude: ['**/node_modules/**', '**/*.browser.test.*'],
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
