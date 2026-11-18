import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { changesetProblems } from '../../../scripts/changesets.mjs'
import { DOCS_LINE, releases, whatsNew } from '../changelog'
import { PAGES, render } from '../pages'

const repo = join(import.meta.dirname, '../../..')
const dirs: string[] = []
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadmap-whats-new-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true })
})

/** A packages folder with these changelogs, by package. */
function packagesWith(changelogs: Record<string, string>): string {
  const dir = temp()
  for (const [name, text] of Object.entries(changelogs)) {
    mkdirSync(join(dir, name))
    writeFileSync(join(dir, name, 'CHANGELOG.md'), text)
  }
  return dir
}

/** The section ids each page of the site renders, by its route as a link names it (`/language/`). */
const sections = new Map(
  PAGES.map((p) => [`/${p.route ? `${p.route}/` : ''}`, new Set(render(p).headings.map((h) => h.id))]),
)

/** Whether `/page/#section` names a page of the site and a section it has. */
function resolves(link: string): boolean {
  const [path, id] = link.split('#')
  return sections.get(path!)?.has(id!) ?? false
}

describe("what's new", () => {
  it('lists each release newest first, each change once with the packages that name it, without dependency bumps', () => {
    const dir = packagesWith({
      core: [
        '# @loadmap/core',
        '',
        '## 0.10.0',
        '',
        '### Minor Changes',
        '',
        '- abc1234: Connections: an exclusive one makes a component',
        '  run out when its busiest member does.',
        '',
        '  Docs: /language/#connections',
        '',
        '### Patch Changes',
        '',
        '- Updated dependencies [abc1234]',
        '  - @loadmap/sim@0.10.0',
        '',
        '## 0.9.0',
        '',
        '### Patch Changes',
        '',
        '- def5678: A fix.',
        '',
      ].join('\n'),
      react: [
        '# @loadmap/react',
        '',
        '## 0.10.0',
        '',
        '### Minor Changes',
        '',
        '- abc1234: Connections: an exclusive one makes a component',
        '  run out when its busiest member does.',
        '',
        '  Docs: /language/#connections',
        '',
        '### Patch Changes',
        '',
        '- @loadmap/core@0.10.0',
        '  - @loadmap/layout@0.10.0',
        '',
      ].join('\n'),
    })
    const list = releases(dir)
    expect(list.map((r) => r.version)).toEqual(['0.10.0', '0.9.0'])
    expect(list[0]!.added).toEqual([
      {
        text: 'Connections: an exclusive one makes a component\nrun out when its busiest member does.',
        packages: ['core', 'react'],
        docs: '/language/#connections',
      },
    ])
    expect(list[0]!.fixed).toEqual([])
    expect(list[1]!.fixed).toEqual([{ text: 'A fix.', packages: ['core'], docs: undefined }])
    const md = whatsNew(list)
    expect(md).toContain('## 0.10.0')
    expect(md).toContain('[Read more →](/language/#connections)')
    expect(md).not.toContain('Docs:')
    expect(md).not.toContain('@loadmap/sim')
  })

  it('keeps a fenced example whole, and reads no section from a Docs: with none after it', () => {
    const dir = packagesWith({
      dsl: [
        '## 0.2.0',
        '',
        '### Minor Changes',
        '',
        '- abc1234: A statement:',
        '',
        '  ```loadmap',
        '  preset "Peak" { load: 40 }',
        '  ```',
        '',
        '  Docs: /language/#presets',
        '',
        '### Patch Changes',
        '',
        '- def5678: A fix.',
        '  Docs:',
        '  /language/#versions',
        '',
      ].join('\n'),
    })
    const [release] = releases(dir)
    expect(release!.fixed[0]!.docs).toBeUndefined()
    const md = whatsNew([release!])
    expect(md).toContain('  ```\n\n  <span class="packages">dsl</span> [Read more →](/language/#presets)')
  })

  it('reads every release of the packages, the current one first', () => {
    const version = JSON.parse(readFileSync(join(repo, 'packages/react/package.json'), 'utf8')).version
    const list = releases(join(repo, 'packages'))
    expect(list[0]!.version).toBe(version)
    expect(list.at(-1)!.version).toBe('0.1.1')
    for (const r of list) for (const e of [...r.added, ...r.fixed]) expect(e.text, r.version).not.toMatch(/^@loadmap\//)
  })

  it('links every change to a section that exists', () => {
    for (const r of releases(join(repo, 'packages')))
      for (const e of [...r.added, ...r.fixed])
        if (e.docs) expect(resolves(e.docs), `${r.version}: ${e.docs}`).toBe(true)
  })
})

describe('a changeset', () => {
  const known = new Map([
    ['@loadmap/core', false],
    ['@loadmap/vscode', true],
  ])
  function problemsOf(files: Record<string, string>): string[] {
    const dir = temp()
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
    return changesetProblems(dir, known)
  }

  it('of a feature says where the docs tell of it, or that they need not', () => {
    expect(problemsOf({ 'a.md': "---\n'@loadmap/core': minor\n---\n\nA feature.\n" })).toEqual([
      '.changeset/a.md: a feature says where the docs tell of it, on a line of its own: "Docs: /<page>/#<section>", or "Docs: none"',
    ])
    expect(
      problemsOf({ 'a.md': "---\n'@loadmap/core': minor\n---\n\nA feature.\n\nDocs: /language/#versions\n" }),
    ).toEqual([])
    expect(problemsOf({ 'a.md': "---\n'@loadmap/core': major\n---\n\nInternal.\n\nDocs: none\n" })).toEqual([])
    // a fix needs none
    expect(problemsOf({ 'a.md': "---\n'@loadmap/core': patch\n---\n\nA fix.\n" })).toEqual([])
  })

  it('names a page with its section', () => {
    expect(problemsOf({ 'a.md': "---\n'@loadmap/core': minor\n---\n\nA feature.\n\nDocs: /language/\n" })).toEqual([
      '.changeset/a.md: "Docs: /language/" is not a page of the site with a section, "/<page>/#<section>"',
    ])
  })

  it('waiting for the release names a section the site has', () => {
    const dir = join(repo, '.changeset')
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md')) {
      const docs = DOCS_LINE.exec(readFileSync(join(dir, file), 'utf8'))?.[1]
      if (docs && docs !== 'none') expect(resolves(docs), `${file}: Docs: ${docs}`).toBe(true)
    }
  })
})
