# Workflows

The rulesets on `main` require the `check`, `workflows` (zizmor) and `dependency-review` jobs (root `CLAUDE.md`,
Landing).

- Workflows: `permissions: {}` at the top and per job only what it needs, every action pinned to a full SHA with its
  version in a comment (Dependabot bumps them), `persist-credentials: false`, `timeout-minutes`. Never
  `pull_request_target`, never `${{ … }}` from an event inside `run:` (pass it through `env:`). `uvx zizmor .github/`
  runs the `workflows` check locally.
- `check` runs `pnpm check` in parallel parts (a matrix job, `part`, each step `pnpm check:part <part>`) and the `check`
  job is green only when every part is. A new part goes in `PARTS` in `scripts/check.mjs` and in the matrix, never as
  a required check of its own; `pnpm check:changed` picks from the same parts locally. The node tests that drive
  Chromium are a part of their own (`scripts/chromium-node-tests.json`, read by `vitest.config.ts`). The slowest part
  sets the time: keep each under about two minutes.
