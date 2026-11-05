// What a stranger gets from npm, proven before anything is published: packs every package, installs the tarballs with
// npm into a fresh Vite + React app outside the monorepo, typechecks it, builds it, measures the budget, and opens it
// in Chromium (built, and on the dev server) to see checkout and the README's quick start drawn without an error.
// Needs the npm registry for React and Vite. `--keep` leaves the app in place and prints where.
import { execFileSync, spawn } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { judge, measure } from './budget.mjs'

const repo = fileURLToPath(new URL('..', import.meta.url))
const keep = process.argv.includes('--keep')
const root = mkdtempSync(join(tmpdir(), 'loadmap-pack-'))
const packs = join(root, 'packs')
const app = join(root, 'app')
const fail = []
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })
const step = (s) => console.log(`· ${s}`)

try {
  step('build and pack every package')
  run('pnpm', ['-r', '--filter', './packages/*', 'build'], repo)
  mkdirSync(packs)
  const packages = readdirSync(join(repo, 'packages'))
  for (const p of packages) run('pnpm', ['pack', '--pack-destination', packs], join(repo, 'packages', p))
  const tarballs = Object.fromEntries(
    readdirSync(packs).map((f) => [`@loadmap/${f.replace(/^loadmap-/, '').replace(/-\d+\.\d+\.\d+.*\.tgz$/, '')}`, f]),
  )
  for (const [name, file] of Object.entries(tarballs)) {
    const files = run('tar', ['-tzf', join(packs, file)], packs).split('\n')
    for (const need of ['package/LICENSE', 'package/README.md', 'package/package.json'])
      if (!files.includes(need)) fail.push(`${name}: no ${need.slice(8)} in the tarball`)
    const manifest = JSON.parse(run('tar', ['-xzOf', join(packs, file), 'package/package.json'], packs))
    if (JSON.stringify(manifest).includes('workspace:')) fail.push(`${name}: a workspace: version in package.json`)
    for (const e of Object.values(manifest.exports))
      for (const target of typeof e === 'string' ? [e] : Object.values(e))
        if (!files.includes(join('package', target))) fail.push(`${name}: exports ${target}, not in the tarball`)
  }

  step('a fresh Vite + React app installs the tarballs with npm')
  const dev = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).devDependencies
  const tgz = (n) => `file:../packs/${tarballs[n]}`
  mkdirSync(join(app, 'src'), { recursive: true })
  const pkg = {
    name: 'stranger',
    private: true,
    type: 'module',
    dependencies: {
      '@loadmap/react': tgz('@loadmap/react'),
      '@loadmap/editor': tgz('@loadmap/editor'),
      react: dev.react,
      'react-dom': dev['react-dom'],
    },
    devDependencies: {
      '@types/react': dev['@types/react'],
      '@types/react-dom': dev['@types/react-dom'],
      '@vitejs/plugin-react': dev['@vitejs/plugin-react'],
      typescript: dev.typescript,
      vite: dev.vite,
    },
    // the packages depend on each other at 0.1.0, which the registry does not have yet
    overrides: Object.fromEntries(Object.keys(tarballs).map((n) => [n, tgz(n)])),
  }
  writeFileSync(join(app, 'package.json'), JSON.stringify(pkg, null, 2))
  writeFileSync(
    join(app, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2023',
        lib: ['ES2023', 'DOM', 'DOM.Iterable'],
        module: 'Preserve',
        moduleResolution: 'bundler',
        jsx: 'react-jsx',
        strict: true,
        noUncheckedIndexedAccess: true,
        resolveJsonModule: true,
        noEmit: true,
        types: ['vite/client'],
      },
      include: ['src'],
    }),
  )
  writeFileSync(
    join(app, 'vite.config.mjs'),
    `import react from '@vitejs/plugin-react'
import { join } from 'node:path'
import { defineConfig } from 'vite'
import { viteBuild } from ${JSON.stringify(pathToFileURL(join(repo, 'scripts/budget.mjs')).href)}

const page = (n) => join(import.meta.dirname, n + '.html')
export default defineConfig({
  plugins: [react()],
  build: viteBuild('dist', { loadmap: page('loadmap'), editor: page('editor'), quickstart: page('quickstart') }),
})
`,
  )

  // checkout as a user writes it: every import from @loadmap/react
  const oneInstall = (s) => s.replace(/'@loadmap\/(core|layout)(\/calibrate|\/format)?'/g, "'@loadmap/react'")
  for (const f of ['model.ts', 'view.ts'])
    writeFileSync(
      join(app, 'src', f),
      oneInstall(readFileSync(join(repo, 'examples/checkout', f), 'utf8')).replace(
        /import \{ ([^}]*) \} from '@loadmap\/react'\nimport \{ ([^}]*) \} from '@loadmap\/react'\n/,
        "import { $1, $2 } from '@loadmap/react'\n",
      ),
    )
  copyFileSync(join(repo, 'examples/checkout/worker-cpu.json'), join(app, 'src/worker-cpu.json'))
  copyFileSync(join(repo, 'examples/checkout/checkout.loadmap'), join(app, 'src/checkout.loadmap'))
  for (const page of ['loadmap', 'editor']) {
    copyFileSync(join(repo, `scripts/budget/${page}.html`), join(app, `${page}.html`))
    const html = join(app, `${page}.html`)
    writeFileSync(html, readFileSync(html, 'utf8').replace(`./${page}.tsx`, `./src/${page}.tsx`))
    writeFileSync(
      join(app, `src/${page}.tsx`),
      readFileSync(join(repo, `scripts/budget/${page}.tsx`), 'utf8').replace(
        /'\.\.\/\.\.\/examples\/checkout\//g,
        "'./",
      ),
    )
  }
  // the quick start in @loadmap/react's README, as written there
  const readme = readFileSync(join(repo, 'packages/react/README.md'), 'utf8')
  const quick = readme.match(/```tsx\n([\s\S]*?)```/)?.[1]
  if (!quick) throw new Error('no tsx block in packages/react/README.md')
  writeFileSync(
    join(app, 'src/quickstart.tsx'),
    `${quick}\nimport { createRoot } from 'react-dom/client'\ncreateRoot(document.getElementById('root')!).render(<App />)\n`,
  )
  writeFileSync(
    join(app, 'quickstart.html'),
    readFileSync(join(app, 'loadmap.html'), 'utf8').replace('./src/loadmap.tsx', './src/quickstart.tsx'),
  )
  run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], app)

  step('tsc, then vite build')
  try {
    run('npx', ['tsc', '-p', '.'], app)
  } catch (e) {
    fail.push(`tsc: ${e.stdout || e.stderr}`)
  }
  run('npx', ['vite', 'build', '--logLevel', 'warn'], app)
  const budget = judge(measure(join(app, 'dist')))
  for (const l of budget.lines) console.log(`  ${l}`)
  fail.push(...budget.fail.map((f) => `over budget: ${f}`))

  step('Chromium: the built app, then the dev server')
  const browser = await chromium.launch()
  try {
    for (const [mode, args, port] of [
      ['built', ['vite', 'preview', '--strictPort', '--port', '4791'], 4791],
      ['dev', ['vite', '--strictPort', '--port', '4792'], 4792],
    ]) {
      const server = spawn('npx', args, { cwd: app, stdio: 'ignore' })
      try {
        await until(`http://localhost:${port}/loadmap.html`)
        for (const [page, nodes] of [
          ['loadmap', 5],
          ['quickstart', 3],
        ]) {
          const r = await open(browser, `http://localhost:${port}/${page}.html`, nodes)
          console.log(`  ${mode} ${page}: ${r.drawn} nodes, ELK ${r.worker ? 'in a worker' : 'on the main thread'}`)
          if (r.drawn !== nodes) fail.push(`${mode} ${page}: ${r.drawn} nodes drawn, not ${nodes}`)
          if (mode === 'built' && !r.worker) fail.push(`${mode} ${page}: ELK did not run in a worker`)
          fail.push(...r.errors.map((e) => `${mode} ${page}: ${e}`))
        }
      } finally {
        server.kill()
      }
    }
  } finally {
    await browser.close()
  }
} catch (e) {
  fail.push(String(e.stderr || e.stack || e))
}

// on its own: a failure above must not hide this one
try {
  step('the cli alone, without Playwright: --help, check, and record says how to add it')
  const cli = join(root, 'cli')
  mkdirSync(cli)
  writeFileSync(
    join(cli, 'package.json'),
    JSON.stringify({
      name: 'ci',
      private: true,
      devDependencies: {
        '@loadmap/cli': `file:../packs/${readdirSync(packs).find((f) => f.startsWith('loadmap-cli-'))}`,
      },
    }),
  )
  run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], cli)
  const bin = join(cli, 'node_modules/.bin/loadmap')
  const checkout = join(repo, 'examples/checkout/checkout.loadmap')
  for (const args of [['--help'], ['check', checkout]]) {
    try {
      run(bin, args, cli)
      console.log(`  loadmap ${args[0]}: ok`)
    } catch (e) {
      fail.push(`loadmap ${args[0]} without Playwright: ${e.stderr || e.stdout}`)
    }
  }
  try {
    run(bin, ['record', checkout, '--out', join(cli, 'x.png')], cli)
    fail.push('loadmap record ran without Playwright')
  } catch (e) {
    if (!String(e.stderr).includes('npm i -D playwright')) fail.push(`loadmap record without Playwright: ${e.stderr}`)
    else console.log('  loadmap record: says how to add Playwright')
  }
} catch (e) {
  fail.push(String(e.stderr || e.stack || e))
} finally {
  if (keep) console.log(`app kept in ${app}`)
  else rmSync(root, { recursive: true, force: true })
}

for (const f of fail) console.error(`✗ ${f}`)
console.log(fail.length ? `${fail.length} failed` : '✓ the tarballs install, typecheck, build and draw')
process.exitCode = fail.length ? 1 : 0

async function until(url, ms = 60_000) {
  const t0 = Date.now()
  for (;;) {
    try {
      if ((await fetch(url)).ok) return
    } catch {}
    if (Date.now() - t0 > ms) throw new Error(`${url} did not answer`)
    await new Promise((r) => setTimeout(r, 250))
  }
}

async function open(browser, url, nodes) {
  const page = await browser.newPage()
  const errors = []
  let worker = false
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('worker', (w) => {
    if (/elk/.test(w.url())) worker = true
  })
  try {
    await page.goto(url)
    await page.waitForFunction((n) => document.querySelectorAll('[data-node]').length >= n, nodes, { timeout: 30_000 })
  } catch (e) {
    errors.push(String(e.message).split('\n')[0])
  }
  const drawn = await page.evaluate(() => document.querySelectorAll('[data-node]').length)
  await page.close()
  return { drawn, worker, errors }
}
