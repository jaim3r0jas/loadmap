import { defineConfig } from 'tsdown'

// the ELK worker is plain JavaScript and stays a file of its own: index.js starts it by URL. source.js is the one entry
// that loads the compiler
export default defineConfig({
  entry: ['src/index.ts', 'src/source.tsx'],
  dts: true,
  platform: 'neutral',
  copy: [{ from: 'src/elk.worker.js', to: 'dist' }],
})
