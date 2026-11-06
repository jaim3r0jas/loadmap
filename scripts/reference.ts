// The language guide and the reference as they ship outside the repository, in @loadmap/dsl's dist/REFERENCE.md and
// the docs site's llms-full.txt: the maintainers' comments go, a repository path becomes a link to it on GitHub.
// `node scripts/reference.ts <out>` writes it (the dsl build); the docs site imports it.
import { readFileSync, writeFileSync } from 'node:fs'

export function shippedReference(): string {
  return readFileSync(new URL('../docs/dsl.md', import.meta.url), 'utf8')
    .replace(/^<!--.*-->\n\n?/gm, '')
    .replace(/`((?:examples|packages|docs)\/[^`\s]+)`/g, '[`$1`](https://github.com/jaim3r0jas/loadmap/blob/main/$1)')
    .trimEnd()
    .concat('\n')
}

if (import.meta.main) writeFileSync(process.argv[2]!, shippedReference())
