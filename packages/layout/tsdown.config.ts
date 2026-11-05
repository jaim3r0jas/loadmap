import { defineConfig } from 'tsdown'

export default defineConfig({ entry: ['src/index.ts', 'src/internal.ts'], dts: true, platform: 'neutral' })
