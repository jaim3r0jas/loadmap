import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/calibrate.ts', 'src/catalog.ts', 'src/format.ts', 'src/internal.ts', 'src/measure.ts'],
  dts: true,
  platform: 'neutral',
})
