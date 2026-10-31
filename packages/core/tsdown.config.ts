import { defineConfig } from 'tsdown'

export default defineConfig({ entry: ['src/index.ts', 'src/calibrate.ts'], dts: true, platform: 'neutral' })
