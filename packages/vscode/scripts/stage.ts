// The extension as it ships: out/extension/ holds the manifest (named `loadmap`, versioned like the @loadmap packages,
// without the workspace's scripts and dependencies) and only what VS Code reads; then `vsce package` makes
// out/loadmap-<version>.vsix from it. `--folder` stops before the .vsix (the e2e tests run the folder).
// `node scripts/stage.ts [--folder]` after `pnpm build`.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const out = join(root, 'out')
const folder = join(out, 'extension')
/** A .vsix past this has taken in something it should not (a source map, node_modules). */
const MAX_BYTES = 3_000_000
const SHIPPED = [
  'dist/extension.cjs',
  'dist/server.cjs',
  'dist/webview',
  'syntaxes',
  'icons',
  'language-configuration.json',
  'README.md',
  'LICENSE',
]

const read = (path: string) => JSON.parse(readFileSync(join(root, path), 'utf8'))
const manifest = read('package.json')
const { version } = read('../cli/package.json')

for (const path of SHIPPED)
  if (!existsSync(join(root, path))) throw new Error(`${path} is missing: run pnpm build first`)
// the server runs where `vscode` does not exist, and never records
const server = readFileSync(join(root, 'dist/server.cjs'), 'utf8')
for (const word of ['require("vscode")', 'playwright'])
  if (server.includes(word)) throw new Error(`dist/server.cjs holds ${word}`)

rmSync(out, { recursive: true, force: true })
mkdirSync(join(folder, 'dist'), { recursive: true })
for (const path of SHIPPED) cpSync(join(root, path), join(folder, path), { recursive: true })
const { private: _, type: __, scripts: ___, devDependencies: ____, ...shipped } = manifest
// README.md goes in by itself; a `files` list that leaves LICENSE out leaves it out of the .vsix
const files = SHIPPED.filter((p) => p !== 'README.md')
writeFileSync(
  join(folder, 'package.json'),
  `${JSON.stringify({ ...shipped, name: 'loadmap', version, files }, null, 2)}\n`,
)

if (!process.argv.includes('--folder')) {
  const vsix = join(out, `loadmap-${version}.vsix`)
  execFileSync(join(root, 'node_modules/.bin/vsce'), ['package', '--no-dependencies', '--out', vsix], {
    cwd: folder,
    stdio: 'inherit',
  })
  const listed = execFileSync('unzip', ['-Z1', vsix], { encoding: 'utf8' }).split('\n')
  for (const need of [
    'extension/LICENSE.txt',
    'extension/readme.md',
    'extension/dist/server.cjs',
    'extension/dist/webview/main.js',
  ])
    if (!listed.includes(need)) throw new Error(`${vsix} has no ${need}`)
  const size = statSync(vsix).size
  if (size > MAX_BYTES) throw new Error(`${vsix} is ${size} bytes, more than ${MAX_BYTES}`)
  console.log(`${vsix}: ${(size / 1000).toFixed(0)} kB`)
}
