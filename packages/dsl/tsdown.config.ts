import { defineConfig } from 'tsdown'

// an editor's help (completion, hover) is a file of its own, not part of index.js: an app's bundler splits chunks by
// module, so only the pages that edit load it, not every page that reads a definition
export default defineConfig({
  entry: ['src/index.ts', 'src/internal.ts', 'src/help.ts'],
  dts: true,
  platform: 'neutral',
})
