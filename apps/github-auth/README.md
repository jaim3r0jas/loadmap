# Sign in with GitHub for the live editor

The editor on the docs site (GitHub Pages, no server) reads and saves repositories with a GitHub token. A reader can
always paste a fine-grained token; with this set up, **Sign in with GitHub** gets one in a popup instead.

Why a Worker: GitHub's token endpoint (`github.com/login/oauth/access_token`) sends no CORS headers, so no page can call
it, and it wants the app's client secret even with PKCE
([docs](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)).
`worker.ts` holds the secret and swaps the popup's code for a token, nothing else: one path (`POST /token`), the site's
origins only, the PKCE verifier passed through, no refresh token handed out, nothing logged. It fits Cloudflare's free
Workers plan (100,000 requests a day; one sign-in is one request).

The token is a GitHub App user token: it reaches only the repositories the app is installed on, with only the app's
permissions, and expires after 8 hours (the reader signs in again; no refresh token is kept anywhere).

## 1. The GitHub App

GitHub → Settings → Developer settings → GitHub Apps → **New GitHub App**:

- **Name**: e.g. `loadmap editor` (its slug, in `github.com/apps/<slug>`, is what step 3 calls the slug).
- **Homepage URL**: `https://jaim3r0jas.github.io/loadmap/`
- **Callback URL**: `https://jaim3r0jas.github.io/loadmap/signed-in/` (add `http://localhost:5173/signed-in/` to try it
  with `pnpm dev`).
- **Expire user authorization tokens**: on. **Request user authorization (OAuth) during installation**: off. **Enable
  Device Flow**: off.
- **Webhook**: untick **Active**.
- **Repository permissions**: **Contents: Read and write**, **Pull requests: Read and write** (Metadata: read-only comes
  with them). Nothing else, no account permissions.
- **Where can this GitHub App be installed?**: **Any account** for every reader of the docs, or **Only on this account**
  to keep it to yours.

Then on the app's page: note the **Client ID**, and **Generate a new client secret** (shown once: it goes straight into
step 2, nowhere else). Install the app on the repositories it may reach (**Install App**).

## 2. The Worker

With a Cloudflare account (the free plan is enough), from the repository's root:

```bash
npx wrangler login
npx wrangler deploy apps/github-auth/worker.ts --name loadmap-github-auth --compatibility-date 2026-11-01 \
  --var GITHUB_CLIENT_ID:<the app's Client ID> \
  --var ALLOWED_ORIGINS:https://jaim3r0jas.github.io,http://localhost:5173
npx wrangler secret put GITHUB_CLIENT_SECRET --name loadmap-github-auth     # paste the client secret
```

The two `--var`s go with every deploy (a deploy replaces the Worker's plain variables with the ones it is given; the
secret stays). Leave `http://localhost:5173` out if you won't try it with `pnpm dev`. A Worker missing any of the three
answers `500 {"error":"not_configured"}`.

The Worker's address is `https://loadmap-github-auth.<your-subdomain>.workers.dev`.

## 3. The docs build

GitHub → the repository → Settings → Secrets and variables → Actions → **Variables** (not secrets: all three are
public, the page carries them):

- `LOADMAP_GITHUB_APP_CLIENT_ID`: the app's Client ID.
- `LOADMAP_GITHUB_APP_SLUG`: the app's slug.
- `LOADMAP_GITHUB_APP_EXCHANGE`: the Worker's address.

The `docs` workflow passes them to the build (`VITE_GITHUB_APP_*`); the editor page's Content-Security-Policy lets the
Worker's origin through. The next deploy shows **Sign in with GitHub** wherever the editor asks for a token. With any of
the three unset, the editor asks for a pasted token as before. For `pnpm dev`, put the same three in
`apps/docs/.env.local` as `VITE_GITHUB_APP_CLIENT_ID`, `VITE_GITHUB_APP_SLUG` and `VITE_GITHUB_APP_EXCHANGE`.

## Turning it off

Delete the repository variables (the next deploy drops the button), then the Worker, then the app (or revoke its client
secret).
