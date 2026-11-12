# Workflows

The rulesets on `main` require the `check`, `workflows` (zizmor) and `dependency-review` jobs (root `CLAUDE.md`,
Landing).

- Workflows: `permissions: {}` at the top and per job only what it needs, every action pinned to a full SHA with its
  version in a comment (Dependabot bumps them), `persist-credentials: false`, `timeout-minutes`. Never
  `pull_request_target`, never `${{ … }}` from an event inside `run:` (pass it through `env:`). `uvx zizmor .github/`
  runs the `workflows` check locally.
