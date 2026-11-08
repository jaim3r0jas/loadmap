# Changesets

Every change a user of the packages would notice gets a changeset: `pnpm changeset`, pick the bump, write one line
for the changelog. All `@loadmap/*` packages share one version. A release is `pnpm changeset version` (bumps the
versions, writes the changelogs), `pnpm check`, a commit, then `pnpm release` (builds and publishes what npm does not
have yet).

On GitHub, `.github/workflows/release.yml` runs the same two steps with `changesets/action`: a pull request that
bumps the versions ("Version Packages"), then the publish once it is merged. A release is that one merge, once its
`check` is green. Three jobs:

- `version` opens and updates the pull request with a token of the GitHub App `loadmap-release` (Contents and Pull
  requests, read and write, installed on this repository only). A pull request that `GITHUB_TOKEN` opens gets its
  workflow runs held for a maintainer's approval (GitHub, June 2026); one the App opens runs `check` by itself.
- `build` builds `packages/*` without any credential, once no changesets are pending.
- `publish` installs with no scripts, takes those files and runs `changeset publish`, then the tags and the GitHub
  releases (with the App's token). It is the only job with `id-token: write`, and it runs in the `release`
  environment, which only `main` may use and which holds the App's client id (`RELEASE_APP_CLIENT_ID`, a variable)
  and key (`RELEASE_APP_PRIVATE_KEY`, a secret).

It holds no npm token: each package's settings on npmjs.com name `release.yml` and the environment `release` as its
trusted publisher (GitHub Actions, `jaim3r0jas/loadmap`), and npm signs the provenance. Publishing access on each
package is "Require two-factor authentication and disallow tokens", so nothing but that workflow and a maintainer
with a security key can publish. A new trusted publisher expires after 48 hours unless a publish through it
succeeds, so add one just before a release. A lost App key: generate a new one in the App's settings, then
`gh secret set RELEASE_APP_PRIVATE_KEY --env release < key.pem` and delete the file.

A package npm has never seen has no settings yet: publish its first version by hand, then add its trusted publisher
(with the environment) and set its publishing access as above. By hand means a real terminal (`pnpm changeset
publish`): with a security key, npm prints a link to approve in the browser, and changesets only follows it on a TTY
(tick "skip 2FA for 5 minutes" there for the other packages).

The VS Code extension (`packages/vscode`, private) is not on npm: `.github/workflows/vscode.yml` publishes it, started
by hand on main once a release is on npm (`gh workflow run vscode.yml`). Its `.vsix` takes the CLI's version and goes
to the VS Code Marketplace (Trusted Publishing: the publisher `jaim3r0jas` has a policy naming this repository, the
workflow `vscode.yml` and the environment `marketplace`), to Open VSX (the namespace `jaim3r0jas`, the token
`OVSX_PAT` in the `marketplace` environment) and onto the CLI's GitHub release. A store that already has the version
skips it, so a failed run can run again.
