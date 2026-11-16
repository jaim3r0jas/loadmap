// pnpm check in parts. CI runs each part on a runner of its own (.github/workflows/check.yml: `pnpm check:part <id>`).
// Locally, `pnpm check:changed` runs only what this branch's changes reach, split the same way, and leaves every
// whole part to CI: a Mac running several sessions times out a full run.
//
//   node scripts/check.mjs part <id>                  one part, as CI runs it
//   node scripts/check.mjs changed [--dry] [--base <ref>]
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
/** The node tests that drive Chromium: a part of their own (vitest.config.ts reads the same list). */
const CHROMIUM = JSON.parse(readFileSync(join(root, 'scripts/chromium-node-tests.json'), 'utf8'))
const xvfb = process.platform === 'linux' && !!process.env.CI
const E2E = ['--filter', '@loadmap/vscode', 'test:e2e']

/** Each part: its commands, as [command, args, env]. */
export const PARTS = {
  static: [
    ['pnpm', ['typecheck']],
    ['pnpm', ['lint']],
    ['pnpm', ['build']],
    ['pnpm', ['budget']],
  ],
  node: [['pnpm', ['test:node'], { LOADMAP_NODE_TESTS: 'rest' }]],
  chromium: [['pnpm', ['test:node'], { LOADMAP_NODE_TESTS: 'chromium' }]],
  browser: [['pnpm', ['test:browser']]],
  // a virtual display on CI's Linux runner
  vscode: [
    xvfb ? ['xvfb-run', ['-a', 'pnpm', ...E2E]] : ['pnpm', E2E],
    ['pnpm', ['--filter', '@loadmap/vscode', 'package']],
  ],
  pack: [['pnpm', ['verify:pack']]],
}

function run([command, args, env]) {
  const vars = Object.entries(env ?? {}).map(([k, v]) => `${k}=${v} `)
  console.log(`\n$ ${vars.join('')}${command} ${args.join(' ')}`)
  const r = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } })
  return r.status === 0
}

const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout.trim()

/** This branch's changes against where it left main, with what is not committed yet and new files. */
function changedFiles(base) {
  const from = mergeBase(base)
  const files = new Set([
    ...git('diff', '--name-only', from).split('\n'),
    ...git('ls-files', '--others', '--exclude-standard').split('\n'),
  ])
  return [...files].filter((f) => f && existsSync(join(root, f)))
}

const mergeBase = (base) => git('merge-base', 'HEAD', base) || base

/** What a stranger installs: a package's exports, dependencies or build, a new tarball (CLAUDE.md, verify:pack). */
function changesTarball(file, base) {
  if (file === 'pnpm-lock.yaml' || file === 'scripts/verify-pack.mjs') return true
  if (/^packages\/[^/]+\/tsdown\.config\.ts$/.test(file)) return true
  if (!/^packages\/[^/]+\/package\.json$/.test(file)) return false
  const diff = git('diff', mergeBase(base), '--', file)
  return (
    /^[-+]\s*"(exports|publishConfig|main|module|types|files|bin|dependencies|peerDependencies|optionalDependencies)"/m.test(
      diff,
    ) || /^[-+]\s*"(build)":/m.test(diff)
  )
}

const isTest = (f) => /\.test\.tsx?$/.test(f)

function testsIn(dir) {
  if (!existsSync(join(root, dir))) return []
  return readdirSync(join(root, dir), { recursive: true })
    .map((f) => join(dir, String(f)))
    .filter((f) => isTest(f) && !f.includes('node_modules'))
}

/**
 * The tests a changed file reaches without running whole packages: a test itself; for a source file, the tests named
 * after it (src/compile.ts: test/compile.test.ts, also .browser.test) and those that import it by its path; an
 * example's own tests; docs.test for the language guide. The rest (what imports it through an index) is CI's.
 */
function testsFor(file) {
  if (isTest(file)) return [file]
  if (file === 'docs/dsl.md' || file === 'docs/every-statement.loadmap') return ['packages/dsl/test/docs.test.ts']
  const example = /^examples\/([^/]+)\//.exec(file)
  if (example) return testsIn(`examples/${example[1]}`).filter((t) => !t.includes('.browser.'))
  const src = /^((?:packages|apps)\/[^/]+)\/(?:src|site)\/(.+)\.tsx?$/.exec(file)
  if (!src) return []
  const name = basename(src[2])
  const tests = testsIn(`${src[1]}/test`)
  return tests.filter((t) => {
    const b = basename(t)
    if (b.startsWith(`${name}.test.`) || b.startsWith(`${name}.browser.test.`)) return true
    return new RegExp(`from '[./]+/(?:src|site)/${src[2]}'`).test(readFileSync(join(root, t), 'utf8'))
  })
}

/** Packages a <Loadmap>, editor or embed page loads: a change in their source can move the budget. */
const FIRST_LOAD = /^packages\/(core|layout|sim|react|dsl|editor|export)\/src\//

function changed(args) {
  const dry = args.includes('--dry')
  const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'origin/main'
  const files = changedFiles(base)
  if (!files.length) {
    console.log(`nothing changed against ${base}`)
    return true
  }
  const tests = new Set()
  const untested = []
  for (const f of files) {
    const t = testsFor(f)
    for (const x of t) tests.add(x)
    if (!t.length && /\/(src|site)\/.+\.tsx?$/.test(f)) untested.push(f)
  }
  const list = [...tests].sort()
  const browser = list.filter((t) => t.includes('.browser.test.'))
  const chromium = list.filter((t) => CHROMIUM.includes(t))
  const node = list.filter((t) => !browser.includes(t) && !chromium.includes(t))
  const lintable = files.filter((f) => /\.(ts|tsx|mjs|js|json|jsonc|css)$/.test(f))
  const steps = [['static: typecheck', ['pnpm', ['typecheck']]]]
  if (lintable.length)
    steps.push([
      'static: lint the changed files',
      ['pnpm', ['exec', 'biome', 'check', '--no-errors-on-unmatched', ...lintable]],
    ])
  if (files.some((f) => f.startsWith('.github/'))) steps.push(['workflows: zizmor', ['uvx', ['zizmor', '.github/']]])
  if (node.length) steps.push(['node', ['pnpm', ['vitest', 'run', '--project', 'node', ...node]]])
  if (chromium.length)
    steps.push([
      'chromium',
      ['pnpm', ['vitest', 'run', '--project', 'node', ...chromium], { LOADMAP_NODE_TESTS: 'chromium' }],
    ])
  if (browser.length) steps.push(['browser', ['pnpm', ['vitest', 'run', '--project', 'browser', ...browser]]])
  if (files.some((f) => FIRST_LOAD.test(f) || f.startsWith('scripts/budget')))
    steps.push(['static: budget', ['pnpm', ['budget']]])
  if (files.some((f) => f.startsWith('packages/vscode/') || /^packages\/cli\/src\/lsp/.test(f)))
    steps.push(['vscode', PARTS.vscode[0]])
  if (files.some((f) => changesTarball(f, base))) steps.push(['pack', PARTS.pack[0]])

  console.log(`${files.length} files changed against ${base}; locally:`)
  for (const [what, [command, a]] of steps) console.log(`  ${what}: ${command} ${a.join(' ')}`)
  if (untested.length) console.log(`no test named after or importing (CI covers them): ${untested.join(', ')}`)
  console.log('the full matrix runs on CI: push, then watch every part of check to the end')
  if (dry) return true
  const failed = steps.filter(([, step]) => !run(step)).map(([what]) => what)
  if (failed.length) console.log(`\nfailed: ${failed.join(', ')}`)
  return !failed.length
}

const [mode, ...rest] = process.argv.slice(2)
if (mode === 'part') {
  const steps = PARTS[rest[0]]
  if (!steps) {
    console.error(`no part "${rest[0]}": ${Object.keys(PARTS).join(', ')}`)
    process.exit(2)
  }
  process.exit(steps.every(run) ? 0 : 1)
} else if (mode === 'changed') {
  process.exit(changed(rest) ? 0 : 1)
} else {
  console.error('node scripts/check.mjs part <id> | changed [--dry] [--base <ref>]')
  process.exit(2)
}
