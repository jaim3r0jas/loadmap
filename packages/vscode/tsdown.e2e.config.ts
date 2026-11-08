import { defineConfig } from 'tsdown'

// the e2e suite, bundled to run inside VS Code next to the staged extension
export default defineConfig({
  entry: { suite: 'test/e2e/suite.ts' },
  outDir: 'out/e2e',
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  external: ['vscode'],
  dts: false,
})
