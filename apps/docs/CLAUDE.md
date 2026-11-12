# Docs site

`apps/docs` is the site (Vite + React, static HTML). Pages are Markdown in `apps/docs/pages`, listed in `PAGES`
(`apps/docs/pages.ts`), written into `apps/docs/site/` (the Vite root; the HTML is ignored by git) before Vite runs.
`@include(path, "from", "to")` pulls lines from a repository file (the guide and the reference come from
`docs/dsl.md`, the quick start from `packages/react/README.md`); site links are written from the root (`/language/`)
and made relative, so the build works at any base (`DOCS_BASE=/loadmap/` for GitHub Pages). Live parts are islands
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

`pnpm dev` serves on `[::1]` only; from another machine tunnel it: `ssh -N -L '5173:[::1]:5173' jaime@mbpro.internal`
(quoted: zsh globs the brackets).
