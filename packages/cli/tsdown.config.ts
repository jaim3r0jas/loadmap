import { defineConfig } from 'tsdown'

// .js like the other packages (the package is type: module)
export default defineConfig({
  entry: ['src/index.ts', 'src/bin.ts'],
  dts: true,
  platform: 'node',
  fixedExtension: false,
})
