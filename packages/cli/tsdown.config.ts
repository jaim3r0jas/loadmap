import { defineConfig } from 'tsdown'

// .js like the other packages (the package is type: module). The @loadmap packages are bundled in: `check` and the
// compile before `record x.loadmap` run in Node, where a workspace package is TypeScript source
export default defineConfig({
  entry: ['src/index.ts', 'src/bin.ts'],
  dts: true,
  platform: 'node',
  fixedExtension: false,
  noExternal: [/^@loadmap\//],
})
