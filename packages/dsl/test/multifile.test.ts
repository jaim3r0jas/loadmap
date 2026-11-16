import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  addImport,
  compile,
  completionsAcross,
  decodeShare,
  definitionAcross,
  encodeShare,
  flatten,
  gather,
  hover,
  importersOf,
  imports,
  libraryOf,
  referencesAcross,
  renameAcross,
} from '../src'
import { edit, fileText, inspect, relativePath, resolvePath } from '../src/internal'

/** The multi-file example of the docs: a model, its part, the library it imports and a variant. */
const DIR = 'docs/multi-file'
const read = (f: string) => readFileSync(new URL(`../../../${DIR}/${f}`, import.meta.url), 'utf8')
const MODEL = `${DIR}/shop.loadmap`
const STORY = `${DIR}/shop.story.loadmap`
const LIB = `${DIR}/platform.loadmap`
const BIG = `${DIR}/shop.big.loadmap`
const base: Readonly<Record<string, string>> = {
  [MODEL]: read('shop.loadmap'),
  [STORY]: read('shop.story.loadmap'),
  [LIB]: read('platform.loadmap'),
  [BIG]: read('shop.big.loadmap'),
}

/** The example with some files changed (a text), added, or taken out (null). */
const set = (changes: Record<string, string | null> = {}) => {
  const out: Record<string, string> = { ...base }
  for (const [p, text] of Object.entries(changes)) {
    if (text == null) delete out[p]
    else out[p] = text
  }
  return out
}
const run = (path: string, files: Record<string, string> = set()) => compile(files[path]!, { path, files })
const swap = (path: string, from: string, to: string) => {
  expect(base[path]).toContain(from)
  return base[path]!.replace(from, to)
}
const errors = (r: ReturnType<typeof compile>) => r.diagnostics.filter((d) => d.severity === 'error')

describe('a model in several files', () => {
  it('reads a part as its own statements, and says a mistake in the part, in the part', () => {
    const files = set({ [STORY]: swap(STORY, 'focus: orderLine.consumers }', 'focus: nowhere }') })
    const fromModel = errors(run(MODEL, files))
    expect(fromModel).toHaveLength(1)
    expect(fromModel[0]).toMatchObject({ code: 'unknown-name', file: STORY, line: 6 })
    // the same mistake from the part itself: it is this text's, so it names no file, at the same place
    const fromPart = errors(run(STORY, files))
    expect(fromPart).toHaveLength(1)
    expect(fromPart[0]!.file).toBeUndefined()
    expect(fromPart[0]).toMatchObject({ code: 'unknown-name', line: 6, column: fromModel[0]!.column })
    expect(files[STORY]!.slice(fromPart[0]!.from, fromPart[0]!.to)).toBe('nowhere')
  })

  it('wants a part to say its model, the model to include it, and both the same version', () => {
    // included, but no part
    const notPart = run(MODEL, set({ [STORY]: swap(STORY, 'part of "./shop.loadmap"\n', '') }))
    expect(errors(notPart)[0]).toMatchObject({ code: 'bad-file', data: { line: 'part of "./shop.loadmap"' } })
    // a part of another model
    const other = run(MODEL, set({ [STORY]: swap(STORY, './shop.loadmap', './other.loadmap') }))
    expect(errors(other)[0]).toMatchObject({ code: 'bad-file' })
    // a part its model does not include
    const left = run(STORY, set({ [MODEL]: swap(MODEL, 'include "./shop.story.loadmap"\n', '') }))
    expect(errors(left)[0]).toMatchObject({
      code: 'bad-file',
      data: { file: MODEL, line: 'include "./shop.story.loadmap"' },
    })
    // a part alone: its model is not among the files
    expect(errors(compile(base[STORY]!, { path: STORY }))[0]).toMatchObject({ code: 'missing-file' })
    // one namespace, one version
    const older = run(MODEL, set({ [STORY]: swap(STORY, 'loadmap 1.3', 'loadmap 1.1') }))
    expect(errors(older).map((d) => d.message)).toContain(
      `a part says its model's version: "${MODEL}" says loadmap 1.3`,
    )
    // what there is one of stays in the model's own file
    const twice = run(MODEL, set({ [STORY]: `${base[STORY]}title: "Mine"\nload "L" { max: 2 }\n` }))
    expect(errors(twice).map((d) => d.code)).toEqual(['misplaced', 'misplaced'])
  })

  it('reads a path as a path, from the file or the root, and nothing else', () => {
    expect(resolvePath('a/b/m.loadmap', './x.loadmap')).toEqual({ path: 'a/b/x.loadmap' })
    expect(resolvePath('a/b/m.loadmap', '../lib/x.loadmap')).toEqual({ path: 'a/lib/x.loadmap' })
    expect(resolvePath('a/b/m.loadmap', '/lib/x.loadmap')).toEqual({ path: 'lib/x.loadmap' })
    for (const bad of [
      'https://example.com/x.loadmap',
      '//example.com/x.loadmap',
      'file:///etc/x.loadmap',
      'x.loadmap',
      './x.txt',
      './x',
      '.\\x.loadmap',
      '../../../x.loadmap',
    ])
      expect(resolvePath('a/b/m.loadmap', bad), bad).toHaveProperty('error')
    expect(relativePath('a/b/m.loadmap', 'a/lib/x.loadmap')).toBe('../lib/x.loadmap')
    expect(relativePath('m.loadmap', 'x.loadmap')).toBe('./x.loadmap')
    // a file is found by its own name only: nothing an object inherits is a file
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty'])
      expect(fileText({}, name)).toBeUndefined()
    // in a definition: an error where the path is written, and the model does not compile
    const url = run(
      MODEL,
      set({ [MODEL]: swap(MODEL, '"./platform.loadmap"', '"https://example.com/platform.loadmap"') }),
    )
    expect(errors(url)[0]).toMatchObject({ code: 'missing-file', line: 3 })
    expect(errors(url)[0]!.message).toContain('never by a URL')
    const out = run(MODEL, set({ [MODEL]: swap(MODEL, '"./platform.loadmap"', '"../../../etc/platform.loadmap"') }))
    expect(errors(out)[0]!.message).toContain('leaves the project')
  })

  it('says which file is missing, where it is named', () => {
    const r = run(MODEL, set({ [LIB]: null }))
    expect(errors(r)[0]).toMatchObject({ code: 'missing-file', line: 3 })
    expect(errors(r)[0]!.message).toContain(`there is no "${LIB}"`)
    // without any files: the same, said for a definition that came as one file
    expect(errors(compile(base[MODEL]!))[0]).toMatchObject({ code: 'missing-file' })
  })

  it('takes from a library what it declares by name, and nothing private', () => {
    const none = run(MODEL, set({ [MODEL]: swap(MODEL, '{ postgres; pipeline }', '{ postgres; pipeline; nope }') }))
    expect(errors(none)[0]).toMatchObject({ code: 'unknown-name', message: `"${LIB}" has no "nope"` })
    const lib = swap(LIB, 'let messageCost = 2ms', 'let _hidden = 1\nlet messageCost = 2ms')
    const secret = run(
      MODEL,
      set({ [LIB]: lib, [MODEL]: swap(MODEL, '{ postgres; pipeline }', '{ postgres; pipeline; _hidden }') }),
    )
    expect(errors(secret)[0]!.message).toContain('is private')
    // a value under another name: the library's let, as a let of the model
    const renamed = run(
      MODEL,
      set({ [MODEL]: swap(MODEL, '{ postgres; pipeline }', '{ postgres; pipeline; cost: messageCost }') }),
    )
    expect(errors(renamed)).toEqual([])
    expect(renamed.symbols.find((s) => s.id === 'cost')).toMatchObject({ kind: 'let' })
    // only a library is imported
    const model = run(MODEL, set({ [MODEL]: swap(MODEL, '"./platform.loadmap"', '"./shop.big.loadmap"') }))
    expect(errors(model)[0]).toMatchObject({ code: 'bad-file' })
  })

  it('refuses libraries that import each other', () => {
    const a = 'loadmap 1.3\nlibrary "A"\nimport "./b.loadmap" { y }\nlet x = y\n'
    const b = 'loadmap 1.3\nlibrary "B"\nimport "./a.loadmap" { x }\nlet y = x\n'
    const r = compile(a, { path: 'a.loadmap', files: { 'a.loadmap': a, 'b.loadmap': b } })
    const loop = errors(r).find((d) => d.code === 'import-loop')
    expect(loop?.message).toBe('libraries import each other in a loop: a.loadmap → b.loadmap → a.loadmap')
  })

  it('keeps a library to its inputs and its own names, and a model out of the library', () => {
    // a library's line reads a name of the model: an error in the library, whoever imports it
    const leak = set({
      [LIB]: swap(LIB, 'demand: flows.main * messageCost', 'demand: flows.main * messageCost * pods2'),
    })
    for (const from of [MODEL, LIB]) {
      const found = errors(run(from, leak)).find((d) => d.message.includes('"pods2"'))
      expect(found, from).toMatchObject({ code: 'unknown-name' })
      expect(found!.file, from).toBe(from === LIB ? undefined : LIB)
    }
    // a flow is the model's: a library takes its name as an input
    const flow = errors(run(MODEL, set({ [LIB]: swap(LIB, 'demand: writes', 'demand: flows.orders') })))
    expect(flow[0]).toMatchObject({ code: 'wrong-scope', file: LIB })
    // the model does not see what it did not import
    const inside = errors(run(MODEL, set({ [MODEL]: swap(MODEL, 'rate: 40 * load', 'rate: 40 * load * messageCost') })))
    expect(inside[0]).toMatchObject({ code: 'unknown-name', message: 'unknown name "messageCost"' })
    expect(inside[0]!.file).toBeUndefined()
  })

  it('checks the inputs where they are set', () => {
    const withs = (to: string) =>
      errors(run(MODEL, set({ [MODEL]: swap(MODEL, 'with { main: orders; pods: pods }', to) })))
    expect(withs('with { pods: pods }')[0]).toMatchObject({ code: 'bad-input', data: { input: 'main' } })
    expect(withs('with { main: orders; pods: pods; threads: 4 }')[0]).toMatchObject({
      code: 'bad-input',
      message: '"pipeline" has no input "threads"',
    })
    expect(withs('with { main: 3; pods: pods }')[0]).toMatchObject({ code: 'bad-input' })
    // a default is left as it is: the library's 3 pods
    expect(withs('with { main: orders }')).toEqual([])
    const db = (to: string) => errors(run(MODEL, set({ [MODEL]: swap(MODEL, 'with { writes: flows.orders }', to) })))
    expect(db('with { writes: flows.orders; limit: "a lot" }')[0]).toMatchObject({ code: 'wrong-type' })
    expect(db('with { limit: 9_000 }')[0]).toMatchObject({ code: 'bad-input', data: { input: 'writes' } })
    // a box of the model has no inputs
    const local = errors(
      run(
        MODEL,
        set({ [MODEL]: `${base[MODEL]}node db2 "Second" { like: db; with { writes: 1 } }\ngateway -> db2\n` }),
      ),
    )
    expect(local.map((d) => d.code)).toContain('bad-input')
  })

  it('writes a subsystem out under its id, and bounds how far that goes', () => {
    const r = run(MODEL)
    expect(r.definition!.model.stageIds).toEqual(['gateway', 'orderLine.topic', 'orderLine.consumers', 'db'])
    // its boxes are found in the library, where they are written
    expect(r.symbols.find((s) => s.kind === 'node' && s.id === 'orderLine.consumers')).toMatchObject({ file: LIB })
    // subsystems inside subsystems, at most four deep
    const deep = ['loadmap 1.3', 'library "Deep"', 'subsystem s0 "S" { node n "N" }']
    for (let i = 1; i <= 5; i++) deep.push(`subsystem s${i} "S" { subsystem inner "I" { like: s${i - 1} } }`)
    const files = set({
      [`${DIR}/deep.loadmap`]: `${deep.join('\n')}\n`,
      [MODEL]: swap(
        MODEL,
        'import "./platform.loadmap" { postgres; pipeline }',
        'import "./platform.loadmap" { postgres; pipeline }\nimport "./deep.loadmap" { s5 }',
      ).concat('subsystem tower "T" { like: s5 }\n'),
    })
    expect(errors(run(MODEL, files)).map((d) => d.code)).toContain('too-large')
    // and no more boxes than a definition may have
    const many = Array.from({ length: 260 }, (_, i) => `node extra${i} "X"`).join('\n')
    const crowd = errors(run(MODEL, set({ [MODEL]: `${base[MODEL]}${many}\n` })))
    expect(crowd.find((d) => d.code === 'too-large')?.message).toContain('at most 256 boxes')
    // nor more files
    const parts: Record<string, string> = {}
    let head = ''
    for (let i = 0; i < 70; i++) {
      parts[`${DIR}/p${i}.loadmap`] = 'loadmap 1.3\npart of "./shop.loadmap"\n'
      head += `include "./p${i}.loadmap"\n`
    }
    const wide = run(
      MODEL,
      set({
        ...parts,
        [MODEL]: swap(MODEL, 'include "./shop.story.loadmap"\n', `include "./shop.story.loadmap"\n${head}`),
      }),
    )
    expect(errors(wide).find((d) => d.code === 'too-large')?.message).toContain('at most 64 files')
  })

  it('lays a variant over its model: what it writes, and nothing of the system', () => {
    const r = run(BIG)
    expect(r.diagnostics).toEqual([])
    expect(r.definition!.model.defaults().pods).toBe(6)
    // the rest of the parameter is its model's
    expect(r.definition!.model.params.find((p) => p.id === 'pods')!.def.label).toBe('Worker pods')
    const unknown = errors(
      run(BIG, set({ [BIG]: swap(BIG, 'param pods { default: 6 }', 'param cores { default: 6 }') })),
    )
    expect(unknown[0]).toMatchObject({ code: 'unknown-name', message: `"${MODEL}" has no param "cores"` })
    const box = errors(run(BIG, set({ [BIG]: `${base[BIG]}node extra "X"\n` })))
    expect(box[0]).toMatchObject({ code: 'misplaced' })
  })

  it('knows a file by its head, and gathers every file a definition reaches', () => {
    expect(imports(base[MODEL]!, MODEL)).toEqual({
      role: 'model',
      files: [
        { kind: 'include', written: './shop.story.loadmap', path: STORY, names: [] },
        { kind: 'import', written: './platform.loadmap', path: LIB, names: ['postgres', 'pipeline'] },
      ],
    })
    expect(imports(base[STORY]!, STORY).role).toBe('part')
    expect(imports(base[LIB]!, LIB).role).toBe('library')
    expect(imports(base[BIG]!, BIG).role).toBe('variant')
    const files = set()
    // from the part: the file to open is its model
    const fromPart = gather(base[STORY]!, { path: STORY, files })
    expect(fromPart.path).toBe(MODEL)
    expect(Object.keys(fromPart.files).sort()).toEqual([LIB, MODEL, STORY])
    expect(fromPart.missing).toEqual([])
    // a variant is opened as itself, with its model's files
    const fromVariant = gather(base[BIG]!, { path: BIG, files })
    expect(fromVariant.path).toBe(BIG)
    expect(Object.keys(fromVariant.files).sort()).toEqual([LIB, BIG, MODEL, STORY].sort())
    expect(gather(base[MODEL]!, { path: MODEL }).missing.sort()).toEqual([LIB, STORY])
  })

  it('carries every file in a link, and one file in the link it always made', async () => {
    const files = { [MODEL]: base[MODEL]!, [STORY]: base[STORY]!, [LIB]: base[LIB]! }
    const hash = await encodeShare(base[MODEL]!, { load: 30 }, { path: MODEL, files })
    expect(hash).toMatch(/^v2\./)
    expect(await decodeShare(`#${hash}`)).toEqual({ source: base[MODEL], values: { load: '30' }, path: MODEL, files })
    // one file: the link every page out there reads
    const one = await encodeShare(base[MODEL]!, {}, { path: MODEL, files: { [MODEL]: base[MODEL]! } })
    expect(one).toMatch(/^v1\./)
    expect(await decodeShare(one)).toEqual({ source: base[MODEL], values: {} })
    // a link is untrusted: a path that is none, a file that is no text, an entry that is not there
    const pack = async (data: unknown) => {
      const stream = new Blob([JSON.stringify(data)]).stream().pipeThrough(new CompressionStream('deflate-raw'))
      const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
      return `v2.${btoa(String.fromCharCode(...bytes))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replace(/=+$/, '')}`
    }
    for (const bad of [
      { entry: 'a.loadmap', files: { '../a.loadmap': 'x' } },
      { entry: 'a.loadmap', files: { 'a.loadmap': 1 } },
      { entry: 'b.loadmap', files: { 'a.loadmap': 'x' } },
      { entry: 'a.loadmap', files: { 'a.loadmap': 'x', 'b.txt': 'y' } },
      [],
    ])
      expect(await decodeShare(await pack(bad)), JSON.stringify(bad)).toHaveProperty('error')
  })

  it('flattens to one file that computes the same', () => {
    const flat = flatten(base[MODEL]!, { path: MODEL, files: set() })
    if ('error' in flat) throw new Error(`${flat.error}: ${flat.diagnostics.map((d) => d.message).join('; ')}`)
    expect(flat.text).not.toMatch(/^(include|import|subsystem)\b/m)
    expect(flat.text).toContain('pool orderLine.consumers')
    const one = compile(flat.text)
    expect(one.diagnostics).toEqual([])
    const several = run(MODEL)
    const [a, b] = [one.definition!.model, several.definition!.model]
    expect([a.flowIds, a.componentIds, a.stageIds]).toEqual([b.flowIds, b.componentIds, b.stageIds])
    expect([a.scenarios, a.expectations, a.story]).toEqual([b.scenarios, b.expectations, b.story])
    for (const load of [1, 30, 90]) {
      const [x, y] = [a.evaluate({ load }), b.evaluate({ load })]
      expect(x.components).toEqual(y.components)
      expect(x.verdict).toEqual(y.verdict)
      expect(x.ranked.map((c) => c.id)).toEqual(y.ranked.map((c) => c.id))
    }
    // a definition that does not compile has no flat copy
    expect(flatten(base[MODEL]!)).toHaveProperty('error')
  })

  it('changes a box of the model from the file it is written in', () => {
    const files = set()
    const r = edit(base[MODEL]!, 'node:gateway/short', 'the front door', { path: MODEL, files })
    if ('error' in r) throw new Error(r.error)
    expect(r.source).toContain('short: "the front door"')
    expect(compile(r.source, { path: MODEL, files }).ok).toBe(true)
  })
})

describe('a box like another', () => {
  const twins = [
    'loadmap 1.3',
    'load "L" { max: 2 }',
    'flow f "f" { rate: load; route: a; from: start }',
    'node start "Start"',
    'node a "A" { store; capacity: estimated(1_000, "req/s", "a test"); over: "requests queue" }',
    'node b "B" { like: a; short: "the second" }',
    'start -> a',
    '',
  ].join('\n')

  it('says in a hover and in the inspector what it takes from the other', () => {
    const h = hover(twins, twins.indexOf('node b') + 5)
    expect(h?.body[0]).toBe('Like `a`: from it `store`, `capacity`, `over`.')
    const box = inspect(twins, { node: 'b' })!.sections[0]!
    expect(box.like).toEqual({ from: 'a', taken: ['store', 'capacity', 'over'] })
    // a prototype of a library: the other box is not in this text
    expect(inspect(base[MODEL]!, { node: 'db' })!.sections[0]!.like).toEqual({ from: 'postgres', taken: [] })
  })
})

describe('the help across the files of a model', () => {
  const files = set()
  const at = (path: string, text: string, nth = 0) => {
    let i = -1
    for (let k = 0; k <= nth; k++) i = files[path]!.indexOf(text, i + 1)
    expect(i, text).toBeGreaterThanOrEqual(0)
    return i + 1
  }

  it('finds where a name is declared, in whichever file', () => {
    // a path in the head is its file
    expect(definitionAcross(files[MODEL]!, at(MODEL, './platform.loadmap'), { path: MODEL, files })).toMatchObject({
      file: LIB,
    })
    // a name in an import: the library's own declaration
    const inLib = definitionAcross(files[MODEL]!, at(MODEL, 'pipeline }'), { path: MODEL, files })
    expect(inLib).toMatchObject({ file: LIB })
    expect(files[LIB]!.slice(inLib!.from, inLib!.to)).toBe('pipeline')
    // where the model uses it: the import that brings it
    const used = definitionAcross(files[MODEL]!, at(MODEL, 'like: pipeline') + 6, { path: MODEL, files })
    expect(used?.file).toBeUndefined()
    expect(files[MODEL]!.slice(used!.from, used!.to)).toBe('pipeline')
    expect(used!.from).toBeLessThan(files[MODEL]!.indexOf('title:'))
    // from the part: a box of the model, and a box of a subsystem in the library that declares it
    const sub = definitionAcross(files[STORY]!, at(STORY, 'orderLine.consumers') + 12, { path: STORY, files })
    expect(sub).toMatchObject({ file: LIB })
    expect(files[LIB]!.slice(sub!.from, sub!.to)).toBe('consumers')
  })

  it('finds and renames a name over the model and its parts', () => {
    const story = swap(STORY, '{ load: 1 }', '{ load: 1; focus: gateway }')
    const all = set({ [STORY]: story })
    const offset = all[MODEL]!.indexOf('node gateway') + 6
    const refs = referencesAcross(all[MODEL]!, offset, { path: MODEL, files: all })!
    expect(refs.filter((r) => r.file === STORY)).toHaveLength(1)
    expect(refs.filter((r) => r.file == null).length).toBeGreaterThanOrEqual(3)
    const renamed = renameAcross(all[MODEL]!, offset, 'frontDoor', { path: MODEL, files: all })
    if ('error' in renamed) throw new Error(renamed.error)
    const inStory = renamed.changes.filter((c) => c.file === STORY)
    expect(inStory).toHaveLength(1)
    expect(story.slice(inStory[0]!.from, inStory[0]!.to)).toBe('gateway')
    // a flow handed to a subsystem is renamed where it is handed over
    const flow = renameAcross(all[MODEL]!, all[MODEL]!.indexOf('flow orders') + 6, 'purchases', {
      path: MODEL,
      files: all,
    })
    if ('error' in flow) throw new Error(flow.error)
    expect(flow.changes.map((c) => all[MODEL]!.slice(c.from, c.to))).toEqual(['orders', 'orders', 'orders'])
    // an imported name keeps the library's own
    const imported = renameAcross(all[MODEL]!, all[MODEL]!.indexOf('like: postgres') + 7, 'pg', {
      path: MODEL,
      files: all,
    })
    if ('error' in imported) throw new Error(imported.error)
    expect(imported.changes.map((c) => c.insert)).toEqual(['pg: postgres', 'pg'])
  })

  it('offers paths, the names of a library and the inputs of what a box is like', () => {
    const o = { path: MODEL, files, paths: Object.keys(files) }
    const paths = completionsAcross(files[MODEL]!, at(MODEL, './platform.loadmap') + 2, o)
    expect(paths.options.map((x) => x.label).sort()).toEqual([
      './platform.loadmap',
      './shop.big.loadmap',
      './shop.story.loadmap',
    ])
    const names = completionsAcross(files[MODEL]!, at(MODEL, '{ postgres; pipeline }') + 1, o)
    expect(names.options.map((x) => x.label)).toEqual(['messageCost'])
    const less = swap(MODEL, 'with { main: orders; pods: pods }', 'with { main: orders;  }')
    const inputs = completionsAcross(less, less.indexOf('with { main: orders; ') + 'with { main: orders; '.length, {
      ...o,
      files: set({ [MODEL]: less }),
    })
    expect(inputs.options.map((x) => x.label)).toEqual(['pods'])
    // everywhere else: what one file offers, with the names its other files declare
    const story = `${files[STORY]}step "More" { focus:  }\n`
    const focus = completionsAcross(story, story.lastIndexOf('focus: ') + 7, {
      ...o,
      path: STORY,
      files: set({ [STORY]: story }),
    })
    expect(focus.options.map((x) => x.label)).toContain('gateway')
  })

  it('imports a name a library declares, and tells who imports a library', () => {
    const o = { path: MODEL, files, paths: Object.keys(files) }
    expect(libraryOf('messageCost', o)).toEqual({ path: LIB, keyword: 'let' })
    expect(libraryOf('nothing', o)).toBeUndefined()
    const change = addImport(files[MODEL]!, 'messageCost', LIB, o)!
    const after = files[MODEL]!.slice(0, change.from) + change.insert + files[MODEL]!.slice(change.to)
    expect(after).toContain('{ postgres; pipeline; messageCost }')
    expect(compile(after, { path: MODEL, files }).diagnostics).toEqual([])
    // a library that is not imported yet: a line of its own in the head
    const fresh = addImport('loadmap 1.3\nload "L" { max: 2 }\n', 'messageCost', LIB, { path: `${DIR}/new.loadmap` })!
    expect(fresh.insert).toBe('\nimport "./platform.loadmap" { messageCost }')
    // a rename in the library: every importer keeps its own name for it
    expect(importersOf(LIB, 'postgres', 'pg', o)).toEqual([
      expect.objectContaining({ file: MODEL, insert: 'postgres: pg' }),
    ])
  })
})
