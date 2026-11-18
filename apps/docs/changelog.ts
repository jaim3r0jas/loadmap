// What's new: every release of the packages, read from their CHANGELOG.md files (changesets writes them in the release
// commit), so each release updates the site with no step of its own. The packages are versioned together, and a
// changeset that names several packages is written into each of their changelogs: one entry here, with its packages.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DOCS_LINE } from '../../scripts/changesets.mjs'

/** A changeset's `Docs:` line, as the changesets check reads it. */
export { DOCS_LINE }

export interface Entry {
  /** Its Markdown, without the commit it came from or its `Docs:` line. */
  text: string
  /** The packages it names, short: `editor`, `dsl`. */
  packages: string[]
  /** The site's page and section that tell more (`/language/errors/#versions`), from the changeset's `Docs:` line. */
  docs?: string
}

export interface Release {
  version: string
  added: Entry[]
  fixed: Entry[]
}

const versionKey = (v: string) => v.split('.').map(Number)
const newer = (a: string, b: string) => {
  const [x, y] = [versionKey(a), versionKey(b)]
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0)
  return 0
}

/** The entries of one changelog by version: `## 0.39.0`, then `### Minor Changes` and `### Patch Changes` lists. */
function readChangelog(text: string): Map<string, { kind: 'added' | 'fixed'; text: string }[]> {
  const out = new Map<string, { kind: 'added' | 'fixed'; text: string }[]>()
  let version: string | undefined
  let kind: 'added' | 'fixed' | undefined
  let entry: string[] | undefined
  const flush = () => {
    if (version && kind && entry) out.get(version)!.push({ kind, text: entry.join('\n') })
    entry = undefined
  }
  for (const line of text.split('\n')) {
    const v = /^## (\d+\.\d+\.\d+(?:-[\w.]+)?)\s*$/.exec(line)
    if (v) {
      flush()
      version = v[1]!
      kind = undefined
      out.set(version, out.get(version) ?? [])
      continue
    }
    const k = /^### (Major|Minor|Patch) Changes\s*$/.exec(line)
    if (k) {
      flush()
      kind = k[1] === 'Patch' ? 'fixed' : 'added'
      continue
    }
    if (line.startsWith('- ')) {
      flush()
      entry = [line.slice(2)]
    } else if (entry && (line.startsWith('  ') || line === '')) entry.push(line.slice(2))
    else flush()
  }
  flush()
  return out
}

/** One entry's text as the page shows it: no commit, no dependency bumps, its `Docs:` line taken out. */
function clean(raw: string): { text: string; docs?: string } | undefined {
  const text = raw.replace(/^[0-9a-f]{7,40}:\s*/, '').trimEnd()
  // a version of a package it depends on, alone or under "Updated dependencies": the release says it already
  const bumps = text.split('\n').every((l) => /^(- )?@loadmap\/[\w-]+@\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(l.trim()))
  if (/^Updated dependencies\b/.test(text) || bumps) return undefined
  const docs = DOCS_LINE.exec(text)?.[1]
  const body = text.replace(DOCS_LINE, '').trimEnd()
  return { text: body, docs: docs && docs !== 'none' ? docs : undefined }
}

/** The changelog of each package under `packagesDir` that has one, by the package's folder. */
export const changelogFiles = (packagesDir: string): { dir: string; file: string }[] =>
  readdirSync(packagesDir)
    .sort()
    .map((dir) => ({ dir, file: join(packagesDir, dir, 'CHANGELOG.md') }))
    .filter(({ file }) => existsSync(file))

/** Every release of the packages under `packagesDir`, newest first, each entry once with the packages that name it. */
export function releases(packagesDir: string): Release[] {
  const byVersion = new Map<string, Map<string, Entry & { kind: 'added' | 'fixed' }>>()
  for (const { dir, file } of changelogFiles(packagesDir)) {
    for (const [version, entries] of readChangelog(readFileSync(file, 'utf8'))) {
      const seen = byVersion.get(version) ?? new Map()
      byVersion.set(version, seen)
      for (const { kind, text: raw } of entries) {
        const e = clean(raw)
        if (!e) continue
        const known = seen.get(e.text)
        if (known) known.packages.push(dir)
        else seen.set(e.text, { ...e, kind, packages: [dir] })
      }
    }
  }
  return [...byVersion]
    .sort(([a], [b]) => newer(a, b))
    .map(([version, entries]) => {
      const of = (kind: 'added' | 'fixed') =>
        [...entries.values()].filter((e) => e.kind === kind).map(({ kind: _, ...e }) => e)
      return { version, added: of('added'), fixed: of('fixed') }
    })
    .filter((r) => r.added.length || r.fixed.length)
}

/**
 * An entry as a Markdown list item: its text, the packages it names, and a link to its section when it has one. They
 * end its last paragraph, or make one of their own after a fence, a list or a quote, which they would break.
 */
function item(e: Entry): string {
  const lines = e.text.split('\n')
  const tail = `<span class="packages">${e.packages.join(' · ')}</span>${e.docs ? ` [Read more →](${e.docs})` : ''}`
  const last = lines[lines.length - 1]!
  if (/^\s*(```|[-*>]|\d+\.)/.test(last) || lines.some((l) => /^\s*```/.test(l))) lines.push('', tail)
  else lines[lines.length - 1] = `${last} ${tail}`
  return `- ${lines.map((l, i) => (i && l ? `  ${l}` : l)).join('\n')}`
}

/** The releases as Markdown, newest first: a section per release, what it added, then what it fixed. */
export function whatsNew(list: readonly Release[]): string {
  return list
    .map((r) =>
      [
        `## ${r.version}`,
        ...(r.added.length ? ['', '**Added**', '', ...r.added.map(item)] : []),
        ...(r.fixed.length ? ['', '**Fixed**', '', ...r.fixed.map(item)] : []),
      ].join('\n'),
    )
    .join('\n\n')
}
