import type { Decl, Stmt } from './ast'
import { type CompileOptions, compile, type Definition } from './compile'
import { type Completion, type Completions, completions } from './complete'
import { Reporter, type Span } from './diagnostics'
import type { TextChange } from './edit'
import { DEFAULT_PATH, type Files, fileText, type HeadLine, normalizePath, readHead, relativePath } from './files'
import { type Hover, hover } from './hover'
import { parse } from './parser'
import { definition, references, rename } from './references'

/**
 * The help an editor gives, over the files of a model: where a name is declared, every place it is written, a rename,
 * what may be typed. A model and its parts are one namespace, so they are read as one text: each part after the model,
 * its head blanked out, every character where it was. What the one-file help finds there is then mapped back to its
 * file. A place in another file says so in `file`, its path from the project root.
 */

/** A place: in the text that was asked about, or in `file`. */
export type Located = Span & { file?: string }

export interface WorkspaceOptions {
  /** This text's own path from the project root. */
  path?: string
  /** The other files, by their path. */
  files?: Files
  /** Every `.loadmap` file of the project, by its path: what a path in a head may complete to. */
  paths?: readonly string[]
}

interface Piece {
  path: string
  base: number
  end: number
}

interface Joined {
  /** The path of the text that was asked about. */
  self: string
  text: string
  pieces: Piece[]
}

const blank = (text: string, spans: readonly Span[]) => {
  let out = text
  for (const s of spans) out = out.slice(0, s.from) + out.slice(s.from, s.to).replace(/[^\n]/g, ' ') + out.slice(s.to)
  return out
}

const headOf = (text: string, path: string) => {
  const { doc } = parse(text, new Reporter(text))
  return { doc, ...readHead(new Reporter(text), path, doc.body) }
}

/** The model the text belongs to and its parts as one text; the text alone when it is a library or has no parts. */
function join(source: string, o: WorkspaceOptions): Joined {
  const self = normalizePath(o.path ?? DEFAULT_PATH) ?? DEFAULT_PATH
  const alone: Joined = { self, text: source, pieces: [{ path: self, base: 0, end: source.length }] }
  const mine = headOf(source, self)
  if (mine.role === 'library' || mine.role === 'variant') return alone
  const owner = mine.role === 'part' ? mine.head.find((h) => h.kind === 'part')?.path : self
  const text = owner === self ? source : owner == null ? undefined : fileText(o.files, owner)
  if (owner == null || text == null) return alone
  const model = owner === self ? mine : headOf(text, owner)
  const includes = model.head.filter((h) => h.kind === 'include' && h.path != null)
  if (!includes.length || (owner !== self && !includes.some((h) => h.path === self))) return alone
  // the model without its includes: its parts follow as its own statements
  let out = blank(
    text,
    includes.map((h) => h.decl),
  )
  const pieces: Piece[] = [{ path: owner, base: 0, end: text.length }]
  for (const h of includes) {
    const path = h.path!
    if (pieces.some((p) => p.path === path)) continue
    const part = path === self ? source : fileText(o.files, path)
    if (part == null) continue
    const head = headOf(part, path)
    if (head.role !== 'part') continue
    const base = out.length + 1
    out += `\n${blank(part, [...(head.stamp ? [head.stamp] : []), ...head.head.map((x) => x.decl)])}`
    pieces.push({ path, base, end: base + part.length })
  }
  return { self, text: out, pieces }
}

/** A place of the text that was asked about, in the joined text. */
const into = (j: Joined, offset: number) => (j.pieces.find((p) => p.path === j.self)?.base ?? 0) + offset

/** A place of the joined text, in its file. */
function back<T extends Span>(j: Joined, s: T): T & { file?: string } {
  const p = [...j.pieces].reverse().find((x) => x.base <= s.from) ?? j.pieces[0]!
  const out: T & { file?: string } = { ...s, from: s.from - p.base, to: s.to - p.base }
  if (p.path !== j.self) out.file = p.path
  return out
}

/** The word at a place, dots included: `orderLine.consumers`. */
function wordAt(text: string, offset: number): (Span & { text: string }) | undefined {
  const part = /[\w.]/
  let from = offset
  let to = offset
  while (from > 0 && part.test(text[from - 1]!)) from--
  while (to < text.length && part.test(text[to]!)) to++
  const word = text.slice(from, to).replace(/^\.+|\.+$/g, '')
  return word ? { from, to, text: word } : undefined
}

const inside = (s: Span | undefined, offset: number) => !!s && s.from <= offset && offset <= s.to

/** The top-level declaration of `name` in a file: a let, a box, a subsystem. */
function declared(stmts: readonly Stmt[], name: string): Span | undefined {
  for (const s of stmts) {
    const id = s.kind === 'decl' ? s.args[0] : undefined
    if (id?.t === 'id' && id.name === name) return { from: id.from, to: id.to }
  }
  return undefined
}

/** Where the name at `offset` is declared, in this file or another of the model; null when nothing declares it. */
export function definitionAcross(source: string, offset: number, o: WorkspaceOptions = {}): Located | null {
  const self = normalizePath(o.path ?? DEFAULT_PATH) ?? DEFAULT_PATH
  const mine = headOf(source, self)
  // in the head: a path is its file, a name of an import is the library's own
  for (const h of mine.head) {
    if (h.path == null) continue
    if (h.written != null && inside(h.at, offset)) return { file: h.path, from: 0, to: 0 }
    const n = h.names.find((x) => inside(x.theirs, offset) || inside(x.local, offset))
    const text = n && fileText(o.files, h.path)
    if (n && text != null) {
      const at = declared(headOf(text, h.path).body, n.theirs.name)
      return at ? { file: h.path, ...at } : { file: h.path, from: 0, to: 0 }
    }
  }
  const j = join(source, o)
  const local = definition(j.text, into(j, offset))
  if (local) return back(j, local)
  // a name that reaches into a subsystem, or one a library declares: what the compiler found, by its id
  const word = wordAt(source, offset)
  if (!word) return null
  const r = compile(source, { path: self, files: o.files })
  for (let name = word.text; name; name = name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : '') {
    const s = r.symbols.find((x) => x.id === name)
    if (s) return { ...s.span, ...(s.file != null && { file: s.file }) }
    const here = declared(mine.body, name)
    if (here) return here
  }
  return null
}

/** Every place the name at `offset` is written in the model and its parts, its declaration included; null when none. */
export function referencesAcross(source: string, offset: number, o: WorkspaceOptions = {}): Located[] | null {
  const j = join(source, o)
  const found = references(j.text, into(j, offset))
  return found ? found.map((s) => back(j, s)) : null
}

/**
 * The name at `offset` renamed everywhere it is written in the model and its parts. Each change says its file. An
 * imported name keeps the library's own: `import { a }` becomes `import { b: a }`.
 */
export function renameAcross(
  source: string,
  offset: number,
  name: string,
  o: WorkspaceOptions & Pick<CompileOptions, 'functions' | 'catalog'> = {},
): { error: string } | { changes: (TextChange & { file?: string })[] } {
  const j = join(source, o)
  const r = rename(j.text, into(j, offset), name)
  if ('error' in r) return r
  // a name imported under the library's own (`{ a }`): the library keeps it
  const bare = new Set<number>()
  for (const p of j.pieces) {
    const text = p.path === j.self ? source : fileText(o.files, p.path)
    if (text == null) continue
    for (const h of headOf(text, p.path).head)
      for (const n of h.names) if (n.local.from === n.theirs.from) bare.add(p.base + n.local.from)
  }
  const changes = r.changes.map((c) => {
    const insert = bare.has(c.from) ? `${c.insert}: ${j.text.slice(c.from, c.to)}` : c.insert
    return back(j, { ...c, insert })
  })
  // the model must still compile where it did
  const files = new Map<string, string>()
  for (const p of j.pieces) {
    const text = p.path === j.self ? source : fileText(o.files, p.path)
    if (text == null) continue
    const mine = changes.filter((c) => (c.file ?? j.self) === p.path).sort((a, b) => b.from - a.from)
    files.set(
      p.path,
      mine.reduce((t, c) => t.slice(0, c.from) + c.insert + t.slice(c.to), text),
    )
  }
  const lookup = (path: string) => files.get(path) ?? fileText(o.files, path)
  const options = { path: j.self, functions: o.functions, catalog: o.catalog }
  if (compile(source, { ...options, files: o.files }).ok) {
    const after = compile(files.get(j.self) ?? source, { ...options, files: lookup })
    if (!after.ok) return { error: `the result would not compile: ${after.diagnostics[0]?.message ?? 'an error'}` }
  }
  return { changes }
}

/** What a hover says at `offset`, with the names the model's other files declare. */
export function hoverAcross(
  source: string,
  offset: number,
  o: WorkspaceOptions = {},
  definition?: Definition,
): Hover | null {
  const j = join(source, o)
  const h = hover(j.text, into(j, offset), definition)
  if (!h) return null
  const at = back(j, { from: h.from, to: h.to })
  // a hover is about the place asked: one that landed in another file has no range here
  return at.file != null ? { ...h, from: offset, to: offset } : { ...h, from: at.from, to: at.to }
}

/** The block of `keyword` whose braces hold `offset`, innermost, with the statements around it. */
function blockAt(stmts: readonly Stmt[], offset: number, path: Decl[] = []): Decl[] {
  for (const s of stmts) {
    if (s.kind !== 'decl' || !inside(s.bodySpan, offset)) continue
    return blockAt(s.body ?? [], offset, [...path, s])
  }
  return path
}

/**
 * What may be typed at `offset`: a path in a head, the names of a library in an import's braces, the inputs of what
 * a box or a subsystem is like in its `with`, and everywhere else what the one-file help offers, with the names the
 * model's other files declare.
 */
export function completionsAcross(source: string, offset: number, o: WorkspaceOptions = {}): Completions {
  const self = normalizePath(o.path ?? DEFAULT_PATH) ?? DEFAULT_PATH
  const mine = headOf(source, self)
  const word = /[\w]*$/.exec(source.slice(0, offset))![0]
  const here = { from: offset - word.length, to: offset }
  for (const h of mine.head) {
    // inside the quotes of a path
    if (h.written != null && h.at.from < offset && offset < h.at.to) {
      const options: Completion[] = (o.paths ?? [])
        .filter((p) => p !== self && p.endsWith('.loadmap'))
        .map((p) => ({ label: relativePath(self, p), type: 'constant' as const, detail: 'file' }))
      return { from: h.at.from + 1, to: h.at.to - 1, options }
    }
    if (h.kind === 'import' && h.path != null && inside(h.decl.bodySpan, offset)) {
      const text = fileText(o.files, h.path)
      if (text == null) return { ...here, options: [] }
      const taken = new Set(h.names.map((n) => n.theirs.name))
      const options: Completion[] = headOf(text, h.path).body.flatMap((s) => {
        const id = s.kind === 'decl' ? s.args[0] : undefined
        if (s.kind !== 'decl' || id?.t !== 'id' || id.name.startsWith('_') || taken.has(id.name)) return []
        return [{ label: id.name, type: 'variable' as const, detail: `${s.keyword.name} of ${h.path}` }]
      })
      return { ...here, options }
    }
  }
  const j = join(source, o)
  // the inputs of what this box or subsystem is like
  const path = blockAt(mine.doc.body, offset)
  const block = path.at(-1)
  const line = source.slice(source.lastIndexOf('\n', offset - 1) + 1, offset)
  // where a name starts: after the block's "{" or a ";", before any ":"
  if (block?.keyword.name === 'with' && !line.replace(/^.*[{;]/, '').includes(':')) {
    const owner = path.at(-2)
    const like = owner?.body?.find((s) => s.kind === 'prop' && s.key.name === 'like')
    const name = like?.kind === 'prop' && like.value.t === 'id' ? like.value.name : undefined
    const inputs = name == null ? [] : inputsOf(name, j, mine.head, o)
    const set = new Set((block.body ?? []).flatMap((s) => (s.kind === 'prop' ? [s.key.name] : [])))
    return {
      ...here,
      options: inputs
        .filter((i) => !set.has(i.name))
        .map((i) => ({
          label: i.name,
          type: 'property' as const,
          detail: i.flow ? 'a flow' : i.default != null ? `default ${i.default}` : 'required',
          apply: `${i.name}: `,
        })),
    }
  }
  const c = completions(j.text, into(j, offset))
  const at = back(j, { from: c.from, to: c.to })
  return { ...c, from: at.from, to: at.to }
}

/** The inputs of the box or subsystem a file knows as `name`: its own, a part's, or an imported one. */
function inputsOf(
  name: string,
  j: Joined,
  head: readonly HeadLine[],
  o: WorkspaceOptions,
): { name: string; flow: boolean; default?: string }[] {
  const list = (text: string, stmts: readonly Stmt[], id: string) => {
    const d = stmts.find((s): s is Decl => s.kind === 'decl' && s.args[0]?.t === 'id' && s.args[0].name === id)
    return (d?.body ?? []).flatMap((s) => {
      if (s.kind !== 'decl' || s.keyword.name !== 'input') return []
      const [first, second] = s.args
      if (first?.t === 'id' && first.name === 'flow' && second?.t === 'id') return [{ name: second.name, flow: true }]
      if (first?.t !== 'id') return []
      return [{ name: first.name, flow: false, ...(s.init && { default: text.slice(s.init.from, s.init.to) }) }]
    })
  }
  for (const h of head) {
    const n = h.kind === 'import' && h.path != null ? h.names.find((x) => x.local.name === name) : undefined
    const text = n && fileText(o.files, h.path!)
    if (n && text != null) return list(text, parse(text, new Reporter(text)).doc.body, n.theirs.name)
  }
  return list(j.text, parse(j.text, new Reporter(j.text)).doc.body, name)
}

/** One library that declares `name`, for a quick fix that imports it: its path and what the name is there. */
export function libraryOf(name: string, o: WorkspaceOptions): { path: string; keyword: string } | undefined {
  for (const p of o.paths ?? []) {
    const text = fileText(o.files, p)
    if (text == null || name.startsWith('_')) continue
    const head = headOf(text, p)
    if (head.role !== 'library') continue
    const d = head.body.find((s): s is Decl => s.kind === 'decl' && s.args[0]?.t === 'id' && s.args[0].name === name)
    if (d) return { path: p, keyword: d.keyword.name }
  }
  return undefined
}

/**
 * The change that imports `name` from the library at `from` into this text: the name added to the import of that
 * library when there is one, else a new import line at the end of the head.
 */
export function addImport(
  source: string,
  name: string,
  from: string,
  o: WorkspaceOptions = {},
): TextChange | undefined {
  const self = normalizePath(o.path ?? DEFAULT_PATH) ?? DEFAULT_PATH
  const mine = headOf(source, self)
  if (mine.role === 'part' || mine.role === 'variant') return undefined
  const known = mine.head.find((h) => h.kind === 'import' && h.path === from && h.decl.bodySpan)
  if (known) {
    if (known.names.some((n) => n.theirs.name === name)) return undefined
    const open = known.decl.bodySpan!.from + 1
    const inner = source.slice(open, known.decl.bodySpan!.to - 1)
    const kept = inner.trimEnd()
    // after the last name, as the names before it are written: on its line, or on a line of its own
    if (!kept.trim()) return { from: open, to: open + inner.length, insert: ` ${name} ` }
    const at = open + kept.length
    return { from: at, to: at, insert: kept.includes('\n') ? `\n  ${name}` : `; ${name}` }
  }
  const last = mine.head.at(-1)?.decl ?? mine.stamp
  if (!last) return undefined
  const end = source.indexOf('\n', last.to)
  const at = end < 0 ? source.length : end
  return { from: at, to: at, insert: `\nimport "${relativePath(self, from)}" { ${name} }` }
}

/**
 * Every file of the project that imports the library at `path`, with what a rename of one of its names changes
 * there: the library's name in the import, the local one kept (`{ a }` becomes `{ a: b }`).
 */
export function importersOf(
  path: string,
  theirs: string,
  name: string,
  o: WorkspaceOptions,
): (TextChange & { file: string })[] {
  const out: (TextChange & { file: string })[] = []
  for (const p of o.paths ?? []) {
    const text = p === path ? undefined : fileText(o.files, p)
    if (text == null) continue
    for (const h of headOf(text, p).head) {
      if (h.kind !== 'import' || h.path !== path) continue
      for (const n of h.names) {
        if (n.theirs.name !== theirs) continue
        const bare = n.local.from === n.theirs.from
        out.push({ file: p, from: n.theirs.from, to: n.theirs.to, insert: bare ? `${theirs}: ${name}` : name })
      }
    }
  }
  return out
}
