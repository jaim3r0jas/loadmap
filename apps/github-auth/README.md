# Connect to GitHub for the live editor

The editor on the docs site (GitHub Pages, no server) reads and saves repositories with a GitHub token. A reader can
always paste a fine-grained token; with this set up, **Connect to GitHub** gets one in a popup instead.

Why a Worker: GitHub's token endpoint (`github.com/login/oauth/access_token`) sends no CORS headers, so no page can call
it, and it wants the app's client secret even with PKCE
([docs](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)).
`worker.ts` holds the secret and does four things, nothing else, for the site's origins only, logging nothing and
storing only each reader's sealed settings:

- `POST /token`: the popup's code for a token (the PKCE verifier passed through).
- `POST /refresh`: a returning reader's sealed session for a new token, without a click.
- `POST /revoke`: Disconnect ends the token at GitHub at once.
- `POST /settings`: a reader's choice of model and their keys, remembered for them (`store.ts`).

The token is a GitHub App user token: it reaches only the repositories the app is installed on, with only the app's
permissions, and expires after 8 hours. GitHub also gives a refresh token (6 months, each used once). The page never
holds it as it is: when the page sends its browser's public key (a P-256 key it made and cannot export), `seal.ts`
seals the refresh token, the reader's GitHub id and that public key with `SEAL_KEY` (AES-GCM), and the page keeps that
text in IndexedDB. `/refresh` opens it only with a signature by the same browser's key over the session and the time
(5 minutes either way), asks GitHub for a new pair, and seals the next one. A copied session is worth nothing on another
browser; a reader who revokes the app on GitHub ends it. Without `SEAL_KEY` the Worker hands out no session, and a
returning reader connects with one click.

`/settings` keeps, in the D1 database, one row per entry (the choice of provider and model, each provider's key),
filed under GitHub's id of the reader and sealed with `SEAL_KEY`, bound to the reader and the entry: a copy of the table
opens nothing. It answers only a request signed by the browser the session is bound to, of a session GitHub refreshed
in the last 8 hours, so revoking the app on GitHub ends it within 8 hours. A key leaves the Worker only for the
question that needs it. Limits: 120 entries and 200 writes a day for one reader. Whoever can deploy this Worker can
read the keys: keep two-step sign-in on the Cloudflare account. Without the database, nothing is remembered and a key
stays in the reader's tab.

It fits Cloudflare's free Workers plan (100,000 requests a day; a sign-in or a return is one or two).

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
  with them), and **Repository creation: Read and write**, which lets **Save to a new repository** make one in
  the reader's account (GitHub's narrow permission for it: it creates, forks and generates repositories, and gives the
  app the ones it made; never **Administration**, which also deletes them, changes their settings and adds
  collaborators). Nothing else, no account permissions. Without it a new repository needs a pasted token. A permission added later is asked of every account that installed the app
  (Settings → Applications → the app → review the request); a token from before keeps the old ones.
- **Where can this GitHub App be installed?**: **Any account** for every reader of the docs, or **Only on this account**
  to keep it to yours.

Then on the app's page: note the **Client ID**, and **Generate a new client secret** (shown once: it goes straight into
step 2, nowhere else). Install the app on the repositories it may reach (**Install App**).

## 2. The Worker

With a Cloudflare account (the free plan is enough), from the repository's root. `wrangler.jsonc` beside the Worker
holds its name, the app's client id and the site's origins (edit them there for a fork); the two secrets are never in a
file:

```bash
npx wrangler login
npx wrangler secret put GITHUB_CLIENT_SECRET --name loadmap-github-auth   # paste the client secret
openssl rand -base64 32 | npx wrangler secret put SEAL_KEY --name loadmap-github-auth
npx wrangler deploy --config apps/github-auth/wrangler.jsonc
```

The first deploy also makes the D1 database `loadmap-settings` (free: 5 GB, 100,000 rows written a day) and writes
its id into `wrangler.jsonc`: commit that line. It holds each reader's model settings for "Remember it for my
account", sealed with `SEAL_KEY` (below). A deploy keeps the secrets. Leave `http://localhost:5173` out of `ALLOWED_ORIGINS` if you won't try it with `pnpm dev`.
A Worker missing the client id, its secret or the origins answers `500 {"error":"not_configured"}`; one without
`SEAL_KEY` works as before, with one click on return. A new `SEAL_KEY` ends every kept session (each reader clicks
once): the way to end them all.

The Worker's address is `https://loadmap-github-auth.<your-subdomain>.workers.dev`.

## 3. The docs build

GitHub → the repository → Settings → Secrets and variables → Actions → **Variables** (not secrets: all three are
public, the page carries them):

- `LOADMAP_GITHUB_APP_CLIENT_ID`: the app's Client ID.
- `LOADMAP_GITHUB_APP_SLUG`: the app's slug.
- `LOADMAP_GITHUB_APP_EXCHANGE`: the Worker's address.

The `docs` workflow passes them to the build (`VITE_GITHUB_APP_*`); the editor page's Content-Security-Policy lets the
Worker's origin through. The next deploy's **Connect to GitHub** (the editor's bar, and wherever it asks for a token) signs in through the app. With any of
the three unset, the editor asks for a pasted token as before. For `pnpm dev`, put the same three in
`apps/docs/.env.local` as `VITE_GITHUB_APP_CLIENT_ID`, `VITE_GITHUB_APP_SLUG` and `VITE_GITHUB_APP_EXCHANGE`.

## Turning it off

Delete the repository variables (the next deploy drops the button), then the Worker, then the app (or revoke its client
secret).
