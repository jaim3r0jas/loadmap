// Fails early, with the fix, when the shell's Node is older than .nvmrc: Vite 8 and Vitest 5 crash on Node < 22.12
// with errors that do not say why.
import { readFileSync } from 'node:fs'

const want = Number(readFileSync(new URL('../.nvmrc', import.meta.url), 'utf8').trim())
const have = Number(process.versions.node.split('.')[0])
if (have < want) {
  console.error(`loadmap needs Node ${want}; this shell runs ${process.version}. Run: nvm use && corepack enable pnpm`)
  process.exit(1)
}
