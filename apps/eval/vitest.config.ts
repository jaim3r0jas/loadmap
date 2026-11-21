import { defineConfig } from 'vitest/config'

// The live run alone: `pnpm --filter @loadmap/eval eval`. The harness's own tests (test/) run with every node test.
export default defineConfig({
  test: { include: ['live/**/*.live.ts'], testTimeout: 3_600_000, environment: 'node' },
})
