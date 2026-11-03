# Changesets

Every change a user of the packages would notice gets a changeset: `pnpm changeset`, pick the bump, write one line
for the changelog. All `@loadmap/*` packages share one version. A release is `pnpm changeset version` (bumps the
versions, writes the changelogs), `pnpm check`, a commit, then `pnpm release` (builds and publishes what npm does not
have yet).

On GitHub, `.github/workflows/release.yml` runs the same two steps with `changesets/action`: a pull request that
bumps the versions, then the publish once it is merged. It holds no npm token: each package's settings on npmjs.com
name `release.yml` as its trusted publisher (GitHub Actions, `jaim3r0jas/loadmap`), and npm signs the provenance.
A new trusted publisher expires after 48 hours unless a publish through it succeeds, so add one just before a release.

A package npm has never seen has no settings yet: publish its first version by hand, then add its trusted publisher.
By hand means a real terminal (`pnpm changeset publish`): with a security key, npm prints a link to approve in the
browser, and changesets only follows it on a TTY (tick "skip 2FA for 5 minutes" there for the other packages).
