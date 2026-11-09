// The bundle budget: what a page that uses loadmap loads first, gzipped, React not counted. `pnpm check` builds the
// pages in scripts/budget from the workspace; `pnpm verify:pack` measures the same pages built from the tarballs.
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

/**
 * kB gzip: loadmap's code in a <Loadmap> page's first load, what the editor adds to it, and a page made to be framed
 * (an embed: the compiler and the board) on its own.
 */
export const BUDGET = { loadmap: 53, editor: 175, embed: 78 }

// a string only ELK's code has
const ELK_MARK = 'org.eclipse.elk'
const REACT = /[\\/]node_modules[\\/](\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(react|react-dom|scheduler)[\\/]/

/** Vite options that put React in a chunk of its own, so the rest of a page's first load is loadmap and the app. */
export const viteBuild = (outDir, input) => ({
  outDir,
  emptyOutDir: true,
  manifest: true,
  chunkSizeWarningLimit: 5000,
  rolldownOptions: { input, output: { codeSplitting: { groups: [{ name: 'react', test: REACT }] } } },
})

/** The JS each page loads before anything is imported lazily, gzipped; and where ELK ended up. */
export function measure(outDir) {
  const manifest = JSON.parse(readFileSync(join(outDir, '.vite/manifest.json'), 'utf8'))
  const kb = (file) => gzipSync(readFileSync(join(outDir, file))).length / 1024
  const text = (file) => readFileSync(join(outDir, file), 'utf8')
  const first = (key, seen = new Set()) => {
    if (seen.has(key)) return seen
    seen.add(key)
    for (const i of manifest[key].imports ?? []) first(i, seen)
    return seen
  }
  const pages = {}
  for (const [key, chunk] of Object.entries(manifest)) {
    if (!chunk.isEntry || !key.endsWith('.html')) continue
    const files = [...first(key)].map((k) => manifest[k].file)
    const own = files.filter((f) => !/(^|\/)react-[\w-]+\.js$/.test(f))
    pages[key.replace(/^.*\//, '').replace(/\.html$/, '')] = {
      kb: own.reduce((s, f) => s + kb(f), 0),
      elk: files.some((f) => text(f).includes(ELK_MARK)),
    }
  }
  const all = Object.values(manifest).map((c) => c.file)
  const worker = Object.values(manifest)
    .flatMap((c) => [c.file, ...(c.assets ?? [])])
    .concat(all)
    .find((f) => /elk\.worker/.test(f) && text(f).includes(ELK_MARK))
  return { pages, worker }
}

/** The failures against the budget, and a line per page. */
export function judge({ pages, worker }) {
  const fail = []
  const lines = []
  const loadmap = pages.loadmap
  const editor = pages.editor
  const embed = pages.embed
  if (!loadmap || !editor || !embed) fail.push('the build has no loadmap, editor or embed page')
  else {
    const extra = editor.kb - loadmap.kb
    lines.push(`<Loadmap> page: ${loadmap.kb.toFixed(1)} kB gzip first (budget ${BUDGET.loadmap})`)
    lines.push(`editor page: +${extra.toFixed(1)} kB gzip (budget ${BUDGET.editor})`)
    if (loadmap.kb > BUDGET.loadmap) fail.push(`the <Loadmap> page loads ${loadmap.kb.toFixed(1)} kB first`)
    if (extra > BUDGET.editor) fail.push(`the editor adds ${extra.toFixed(1)} kB`)
    lines.push(`embed page: ${embed.kb.toFixed(1)} kB gzip first (budget ${BUDGET.embed})`)
    if (embed.kb > BUDGET.embed) fail.push(`the embed page loads ${embed.kb.toFixed(1)} kB first`)
    for (const [name, p] of Object.entries(pages)) if (p.elk) fail.push(`ELK is in the ${name} page's first load`)
  }
  if (!worker) fail.push('no ELK worker chunk')
  else lines.push(`ELK: ${worker}, loaded on the first layout`)
  return { fail, lines }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { build } = await import('vite')
  const react = (await import('@vitejs/plugin-react')).default
  const root = fileURLToPath(new URL('budget', import.meta.url))
  const out = await mkdtemp(join(tmpdir(), 'loadmap-budget-'))
  try {
    await build({
      root,
      logLevel: 'warn',
      configFile: false,
      plugins: [react()],
      build: viteBuild(out, {
        loadmap: join(root, 'loadmap.html'),
        editor: join(root, 'editor.html'),
        embed: join(root, 'embed.html'),
      }),
    })
    const { fail, lines } = judge(measure(out))
    for (const l of lines) console.log(l)
    for (const f of fail) console.error(`over budget: ${f}`)
    process.exitCode = fail.length ? 1 : 0
  } finally {
    await rm(out, { recursive: true, force: true })
  }
}
