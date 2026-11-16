# Workflows

The rulesets on `main` require the `check`, `workflows` (zizmor) and `dependency-review` jobs (root `CLAUDE.md`,
Landing).

- Workflows: `permissions: {}` at the top and per job only what it needs, every action pinned to a full SHA with its
  version in a comment (Dependabot bumps them), `persist-credentials: false`, `timeout-minutes`. Never
  `pull_request_target`, never `${{ … }}` from an event inside `run:` (pass it through `env:`). `uvx zizmor .github/`
  runs the `workflows` check locally.
- `check` runs `pnpm check` in parallel parts (a matrix job, `part`) and the `check` job is green only when every part
  is: a new part goes in the matrix, never as a required check of its own. The node tests that drive Chromium run in
  a part of their own (`LOADMAP_NODE_TESTS` in `vitest.config.ts`). The slowest part sets the time: keep each under
  about two minutes.
