#!/usr/bin/env node
// Fails when a changeset would stop the release: `changeset version` refuses one that names both a package it
// versions and one it does not ("mixed changeset"), and then no "Version Packages" pull request is made. Private
// packages (@loadmap/vscode, the examples, the docs) are not versioned (.changeset/config.json, privatePackages), so
// a changeset names none of them: what changes in the extension goes in the words of the changeset, not its head.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')

/** Each package of the workspace by its name, and whether it is private. */
function packages() {
  const out = new Map()
  for (const dir of ['packages', 'examples', 'apps'])
    for (const name of readdirSync(join(root, dir))) {
      let pkg
      try {
        pkg = JSON.parse(readFileSync(join(root, dir, name, 'package.json'), 'utf8'))
      } catch {
        continue
      }
      out.set(pkg.name, pkg.private === true)
    }
  return out
}

/** The problems of the changesets in `dir`, as lines to print: none when a release can be made of them. */
export function changesetProblems(dir = join(root, '.changeset'), known = packages()) {
  const problems = []
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md')) {
    const head = /^---\n([\s\S]*?)\n---/.exec(readFileSync(join(dir, file), 'utf8'))?.[1]
    if (head == null) {
      problems.push(`.changeset/${file}: no "---" head with the packages it bumps`)
      continue
    }
    for (const line of head.split('\n').filter((l) => l.trim())) {
      const m = /^['"]?([^'":]+)['"]?:\s*(major|minor|patch|none)\s*$/.exec(line.trim())
      if (!m) problems.push(`.changeset/${file}: "${line.trim()}" is not "'@loadmap/name': minor"`)
      else if (!known.has(m[1])) problems.push(`.changeset/${file}: there is no package ${m[1]}`)
      else if (known.get(m[1]))
        problems.push(
          `.changeset/${file}: ${m[1]} is private, so it is not versioned: take its line out (say what changed for it in the text)`,
        )
    }
  }
  return problems
}

if (process.argv[1] === import.meta.filename) {
  const problems = changesetProblems()
  for (const p of problems) console.error(p)
  if (problems.length) {
    console.error('changeset version would fail on these ("mixed changeset"): no release could be made')
    process.exit(1)
  }
  console.log('changesets: each names only packages that are versioned')
}
