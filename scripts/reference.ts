// The language guide and the reference as they ship outside the repository, in @loadmap/dsl's dist/REFERENCE.md and
// the docs site's llms-full.txt: the maintainers' comments go, a repository path becomes a link to it on GitHub.
// `node scripts/reference.ts <out>` writes it (the dsl build); the docs site imports it, and so does the assistant's
// eval (apps/eval), which gives a model the same llms-full.txt a reader's model gets.
import { readFileSync, writeFileSync } from 'node:fs'

export function shippedReference(): string {
  return readFileSync(new URL('../docs/dsl.md', import.meta.url), 'utf8')
    .replace(/^<!--.*-->\n\n?/gm, '')
    .replace(/`((?:examples|packages|docs)\/[^`\s]+)`/g, '[`$1`](https://github.com/jaim3r0jas/loadmap/blob/main/$1)')
    .trimEnd()
    .concat('\n')
}

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

/** llms-full.txt: the guide and the reference, then one model with every statement, then a model in several files. */
export function fullReference(): string {
  return [
    shippedReference().trimEnd(),
    '',
    '## A complete model',
    '',
    'Every statement and top-level property of the language at least once, and an edge with a block and one without:',
    '',
    '```loadmap',
    read('docs/every-statement.loadmap').trimEnd(),
    '```',
    '',
    '## A model in several files',
    '',
    'A model (`shop.loadmap`), a part of it, the library it imports and a variant of it:',
    '',
    ...['shop.loadmap', 'shop.story.loadmap', 'platform.loadmap', 'shop.big.loadmap'].flatMap((f) => [
      `\`docs/multi-file/${f}\`:`,
      '',
      '```loadmap',
      read(`docs/multi-file/${f}`).trimEnd(),
      '```',
      '',
    ]),
  ].join('\n')
}

if (import.meta.main) writeFileSync(process.argv[2]!, shippedReference())
