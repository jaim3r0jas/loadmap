import { defineConfig } from 'vite'

// the viewer `loadmap record x.loadmap` serves: built into dist/viewer with the CLI; elkjs makes it large
export default defineConfig({
  root: import.meta.dirname,
  base: './',
  logLevel: 'warn',
  build: { outDir: '../dist/viewer', emptyOutDir: true, chunkSizeWarningLimit: 2500, target: 'es2023' },
})
