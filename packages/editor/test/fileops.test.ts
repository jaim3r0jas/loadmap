import { compile, imports, LANGUAGE_VERSION } from '@loadmap/dsl'
import { MAX_FILES, relativePath, resolvePath } from '@loadmap/dsl/internal'
import { describe, expect, it } from 'vitest'
import platform from '../../../docs/multi-file/platform.loadmap?raw'
import shop from '../../../docs/multi-file/shop.loadmap?raw'
import story from '../../../docs/multi-file/shop.story.loadmap?raw'
import {
  type Dsl,
  type FileChange,
  type FileSet,
  newFile,
  pathFor,
  removeFile,
  renameFile,
  roleOf,
} from '../src/fileops'

const dsl: Dsl = { imports, resolvePath, relativePath, MAX_FILES, LANGUAGE_VERSION }
const all: FileSet = {
  path: 'shop.loadmap',
  files: { 'shop.loadmap': shop, 'shop.story.loadmap': story, 'platform.loadmap': platform },
}

/** The files an operation leaves. */
function after(set: FileSet, c: FileChange): FileSet {
  const files: Record<string, string> = { ...set.files, ...c.texts }
  if (c.add) files[c.add.path] = c.add.text
  let path = set.path
  if (c.rename) {
    files[c.rename.to] = files[c.rename.from]!
    delete files[c.rename.from]
    if (path === c.rename.from) path = c.rename.to
  }
  if (c.remove) delete files[c.remove]
  return { path, files }
}
const ok = (r: FileChange | { error: string }): FileChange => {
  if ('error' in r) throw new Error(r.error)
  return r
}
const errors = (set: FileSet) =>
  compile(set.files[set.path]!, { path: set.path, files: set.files })
    .diagnostics.filter((d) => d.severity === 'error')
    .map((d) => d.message)

describe('the explorer’s file operations', () => {
  it('reads what a file is from its head', () => {
    expect(Object.entries(all.files).map(([p, text]) => roleOf(dsl, text, p))).toEqual(['model', 'part', 'library'])
    expect(roleOf(dsl, 'loadmap 1.5\nextends "./shop.loadmap"\n', 'shop.big.loadmap')).toBe('variant')
  })

  it('reads a typed name as a path, and refuses what is not one', () => {
    expect(pathFor('story')).toEqual({ path: 'story.loadmap' })
    expect(pathFor(' lib/platform.loadmap ')).toEqual({ path: 'lib/platform.loadmap' })
    for (const bad of ['', '../x', 'a//b', 'a b', '/x', 'x/']) expect(pathFor(bad), bad).toHaveProperty('error')
  })

  it('adds a part and a library under the last line of the model’s head, and a variant without a line', () => {
    const part = ok(newFile(dsl, all, 'part', 'data'))
    expect(part.add).toEqual({ path: 'shop.data.loadmap', text: `${shop.split('\n')[0]}\npart of "./shop.loadmap"\n` })
    const lines = part.texts!['shop.loadmap']!.split('\n')
    const at = lines.indexOf('include "./shop.data.loadmap"')
    // after the head the model had, before anything else
    expect(at).toBeGreaterThan(0)
    expect(lines.slice(0, at).every((l, i) => i === 0 || /^(include|import|\s|\})/.test(l))).toBe(true)
    expect(part.texts!['shop.loadmap']!.replace('include "./shop.data.loadmap"\n', '')).toBe(shop)
    expect(errors(after(all, part))).toEqual([])
    const library = ok(newFile(dsl, all, 'library', 'shared'))
    expect(library.add!.text).toMatch(/^loadmap \S+\nlibrary "shared"\n$/)
    expect(library.texts!['shop.loadmap']).toContain('import "./shared.loadmap" { }')
    const variant = ok(newFile(dsl, all, 'variant', 'big'))
    expect(variant.add).toEqual({
      path: 'shop.big.loadmap',
      text: `${shop.split('\n')[0]}\nextends "./shop.loadmap"\n`,
    })
    expect(variant.texts).toBeUndefined()
    // a name that is no file name, and one that is taken
    expect(newFile(dsl, all, 'part', 'a/b')).toHaveProperty('error')
    expect(newFile(dsl, all, 'part', 'story')).toEqual({ error: 'There is a shop.story.loadmap already' })
  })

  it('renames a file with every line that names it, and its own paths when it moves', () => {
    const moved = ok(renameFile(dsl, all, 'shop.story.loadmap', 'parts/walk'))
    expect(moved.rename).toEqual({ from: 'shop.story.loadmap', to: 'parts/walk.loadmap' })
    expect(moved.texts!['shop.loadmap']).toBe(
      shop.replace('include "./shop.story.loadmap"', 'include "./parts/walk.loadmap"'),
    )
    expect(moved.texts!['shop.story.loadmap']).toBe(
      story.replace('part of "./shop.loadmap"', 'part of "../shop.loadmap"'),
    )
    expect(errors(after(all, moved))).toEqual([])
    // the model renamed: its part says so, and it stays the model
    const model = ok(renameFile(dsl, all, 'shop.loadmap', 'store'))
    expect(model.texts).toEqual({ 'shop.story.loadmap': story.replace('"./shop.loadmap"', '"./store.loadmap"') })
    expect(after(all, model).path).toBe('store.loadmap')
    expect(errors(after(all, model))).toEqual([])
    // a library: only the import's path, never its names
    const lib = ok(renameFile(dsl, all, 'platform.loadmap', 'lib/blocks'))
    expect(Object.keys(lib.texts!)).toEqual(['shop.loadmap'])
    expect(lib.texts!['shop.loadmap']).toBe(shop.replace('"./platform.loadmap"', '"./lib/blocks.loadmap"'))
    expect(errors(after(all, lib))).toEqual([])
    expect(renameFile(dsl, all, 'platform.loadmap', 'shop')).toEqual({ error: 'There is a shop.loadmap already' })
    expect(renameFile(dsl, all, 'platform.loadmap', 'platform')).toEqual({ note: '' })
  })

  it('removes a part with its include; an import that takes names stays, and the note says so', () => {
    const part = ok(removeFile(dsl, all, 'shop.story.loadmap'))
    expect(part.remove).toBe('shop.story.loadmap')
    expect(part.texts!['shop.loadmap']).toBe(shop.replace('include "./shop.story.loadmap"\n', ''))
    expect(part.note).toBe('Removed shop.story.loadmap')
    const lib = ok(removeFile(dsl, all, 'platform.loadmap'))
    expect(lib.texts).toEqual({})
    expect(lib.note).toBe('Removed platform.loadmap; shop.loadmap still names it')
    // an import that takes nothing goes with its file
    const added = after(all, ok(newFile(dsl, all, 'library', 'shared')))
    expect(ok(removeFile(dsl, added, 'shared.loadmap')).texts!['shop.loadmap']).toBe(shop)
    expect(removeFile(dsl, all, 'shop.loadmap')).toHaveProperty('error')
  })
})
