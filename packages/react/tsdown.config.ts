import { defineConfig } from 'tsdown'

// the ELK worker is plain JavaScript and stays a file of its own: index.js starts it by URL
export default defineConfig({
  entry: ['src/index.ts'],
  dts: true,
  platform: 'neutral',
  copy: [{ from: 'src/elk.worker.js', to: 'dist' }],
})
