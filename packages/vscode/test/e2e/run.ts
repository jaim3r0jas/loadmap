// The e2e tests: a pinned VS Code (downloaded once into .vscode-test) opens a scratch workspace with the staged
// extension (out/extension) and runs out/e2e/suite.cjs inside it. Under Linux CI it needs a display: xvfb-run -a.
// `pnpm --filter @loadmap/vscode test:e2e` builds, stages and runs it.
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runTests } from '@vscode/test-electron'

/** Pinned so a VS Code release never changes what CI sees; the extension supports 1.91 and up. */
const VERSION = '1.144.1'
const root = join(import.meta.dirname, '../..')
// short: VS Code's socket lives in the user data folder, and macOS refuses a socket path past 103 characters
const scratch = mkdtempSync(join(tmpdir(), 'lm-e2e-'))
const folder = join(scratch, 'ws')

try {
  mkdirSync(folder)
  copyFileSync(join(root, '../../examples/checkout/checkout.loadmap'), join(folder, 'checkout.loadmap'))
  writeFileSync(join(folder, 'messy.loadmap'), 'loadmap 1\nload "Users" {max: 10;default:2}\n')
  await runTests({
    version: VERSION,
    cachePath: join(root, '.vscode-test'),
    extensionDevelopmentPath: join(root, 'out/extension'),
    extensionTestsPath: join(root, 'out/e2e/suite.cjs'),
    // the CLI's command, for the loadmap.server.path test
    extensionTestsEnv: { LOADMAP_BIN: join(root, '../cli/dist/bin.js') },
    launchArgs: [
      folder,
      '--disable-extensions',
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
      `--user-data-dir=${join(scratch, 'u')}`,
    ],
  })
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
