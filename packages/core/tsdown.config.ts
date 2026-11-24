import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/backlog.ts',
    'src/calibrate.ts',
    'src/catalog.ts',
    'src/drift.ts',
    'src/format.ts',
    'src/internal.ts',
    'src/measure.ts',
    'src/outages.ts',
    'src/scaling.ts',
  ],
  dts: true,
  platform: 'neutral',
})
