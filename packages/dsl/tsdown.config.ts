import { defineConfig } from 'tsdown'

// completion is a file of its own, not part of index.js: an app's bundler splits chunks by module, so only the pages
// that complete (the editor) load it, not every page that reads a definition
export default defineConfig({
  entry: ['src/index.ts', 'src/internal.ts', 'src/complete.ts'],
  dts: true,
  platform: 'neutral',
})
