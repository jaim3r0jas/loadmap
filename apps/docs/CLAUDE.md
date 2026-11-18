# Docs site

`apps/docs` is the site (Vite + React, static HTML). Pages are Markdown in `apps/docs/pages`, listed in `PAGES`
(`apps/docs/pages.ts`), written into `apps/docs/site/` (the Vite root; the HTML is ignored by git) before Vite runs.
`@include(path, "from", "to")` pulls lines from a repository file (the reference comes from `docs/dsl.md`, the quick
start from `packages/react/README.md`), and `@section(path, "### Heading")` one heading's section without the heading,
its own headings moved up to h2: the guide stays one file (`docs/dsl.md`, which ships as REFERENCE.md and in
llms-full.txt) and the site shows it a section or two a page (`/language/…`, `/checks/`). A link to a section another
page holds goes there (`anchors()`), and a page that was split (`/language/`, `/api/`) forwards the anchors it held
(`OLD_ANCHORS`, frozen, and `movedAnchors()`), since links to them are out there; site links are written from the
root (`/language/`) and made relative, so the build works at any base (`DOCS_BASE=/loadmap/` for GitHub Pages). Live parts are islands
under `apps/docs/site/islands`, loaded only on the pages that use them: a ` ```loadmap live` fence, or
`<div class="island" data-island="example|editor|gallery|quickstart">`. A page with `frame: 'app'` (the editor at
`/editor/`) is its Markdown alone in the window, without the site's frame, pager or llms.txt entry; `hidden: true`
leaves a page out of the sidebar. A page that moves keeps its old route in `MOVED` (a page that sends the reader on,
in no list). `/embed/` is not a page: `writePages` writes it bare (no docs CSS) for
`site/embed.tsx`, which draws a share link's definition filling an iframe (`<Loadmap fill>`); the editor's "Copy embed
link" makes its links. `apps/docs/test/site.test.ts` builds the site, checks every link, and draws the live
pages in Chromium. The build also writes `llms.txt` (the pages) and
`llms-full.txt` (`docs/dsl.md` and `docs/every-statement.loadmap`, which must hold every statement of the schema:
`docs.test.ts`); the dsl build copies `docs/dsl.md` into its `dist/REFERENCE.md`.

The site documents the latest release, not main: `release.yml` calls `docs.yml` once npm has the packages (never
while a changeset waits), the header's badge and every page's footer name the packages' version and the language's
(`packagesVersion()`, `LANGUAGE_VERSION`), and What's new (`@changelog` in `pages/whats-new.md`, `changelog.ts`) is
every release read from the packages' changelogs, each feature linked to the section its changeset's `Docs:` line
names (`test/whats-new.test.ts` checks that the section exists).

The search (the top bar's button, `/`, ⌘K) is `site/search.ts`, loaded with its styles on first use; its index,
`search.json`, is every page cut at its h2 and h3 headings (`searchIndex()`), written by the build and served fresh by
the dev server. Nothing of it is in a page's first load.

`pnpm dev` serves on `[::1]` only; from another machine tunnel it: `ssh -N -L '5173:[::1]:5173' jaime@mbpro.internal`
(quoted: zsh globs the brackets).

A fence names its language, one of `FENCES` (`apps/docs/highlight.ts`): the build colours it there (Lezer, the
editor's loadmap highlighter) into `<span class="tok-…">` inside `<pre class="code">`, and refuses a fence without
one. In the browser `site/snippet.ts` (CodeMirror's state and view only, loaded once a snippet nears the window) puts
a read-only view after the `<pre>` and hides it, when the reader points at the snippet or the focus reaches it: the
view's tokens are the spans, so no parser ships, and the `<pre>` stays the text the copy button and an island read.
An untouched snippet stays the `<pre>`: a view draws only the lines near the window, so the browser's find and print
would miss the rest. The token colours are `--tok-*` in `docs.css`, the editor's by
value (`site.test.ts` compares them in light and dark). Vite loads the config with `--configLoader runner` (the
scripts, and `configLoader: 'runner'` wherever a test builds or serves the site): the config imports the editor's
highlighter, whose workspace imports the default loader hands to Node as TypeScript.

The editor opens GitHub repositories (`?repo=owner/name&ref=…&path=…`, New → Open from GitHub): `site/islands/github/`,
loaded only on that menu or address, talks to `api.github.com` and `raw.githubusercontent.com` and nothing else
(`api.ts`), pins the commit a ref names, and reads the model and what it reaches through `imports()` within the
definition's limits (`load.ts`). A repository is untrusted input: its paths go through `cleanPath`. A token never goes
into an address, a share link or localStorage. Tests answer from `test/fake-github.ts` (as `fetch` in node, through
`page.route` in Chromium): nothing reaches the real GitHub. The editor page alone gets a Content-Security-Policy, as a
`<meta>` put in at build (`csp.ts`: the dev server's scripts would break it). **Sign in with GitHub** shows only in a build
given a GitHub App (`VITE_GITHUB_APP_*`, repository variables in `docs.yml`): a popup to GitHub, back to `/signed-in/`,
and the code swapped for a token by the Worker in `apps/github-auth` (its README has the setup, which is the owner's to do).
