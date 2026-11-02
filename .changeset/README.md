# Changesets

Every change a user of the packages would notice gets a changeset: `pnpm changeset`, pick the bump, write one line
for the changelog. All `@loadmap/*` packages share one version. A release is `pnpm changeset version` (bumps the
versions, writes the changelogs), `pnpm check`, a commit, then `pnpm release` (builds and publishes what npm does not
have yet). 0.1.0 is the first release: the versions already say it, so it needs no changeset.

On GitHub, `.github/workflows/release.yml` runs the same two steps with `changesets/action`: a pull request that
bumps the versions, then the publish once it is merged (an `NPM_TOKEN` secret with rights on the `@loadmap` scope).
