import type { Decl, Edge, Property, Stmt } from './ast'
import { type CompileOptions, compile } from './compile'
import { closest, type Span } from './diagnostics'
import type { TextChange } from './edit'
import { type Dsl, removeFile as dropFile, fileAt, renameFile as moveFile } from './fileops'
import { imports, MAX_FILES, MAX_TOTAL, normalizePath, type Role, relativePath, resolvePath } from './files'
import { format } from './format'
import { parse } from './parser'
import { cut } from './rewrite'
import { BOXES, STAGES } from './schema'
import { LANGUAGE_VERSION } from './versions'
import { importersOf, renameAcross } from './workspace'

/**
 * Changes to a definition's files by name, never by position: what an assistant asks for, what the language server
 * offers as refactorings, and what an editor's own buttons do. Each operation finds its statement by what it is called
 * (`node db`, `db.capacity`, `scenario "More workers"`), works on the texts as the operations before it left them, and
 * the whole list is refused when one of them is, or when a model that compiled no longer does after the last one: a
 * list may pass through a broken text (a box removed, then its route mended), never end in one.
 */

/** A definition's files: the model the diagram is drawn from, and every file by its path from the project root. */
export interface Project {
  entry: string
  files: Readonly<Record<string, string>>
}

/**
 * A target names a statement: its id (`db`), with its keyword in front when the id alone is not enough (`flow
 * orders`, `node db`: `node` and `box` stand for any box), a statement inside another after a dot (`kafka.topic`), a
 * name written as text in quotes (`scenario "More workers"`). Its last word may be a property (`db.capacity`, `title`
 * for the model's own). `file` says which file to look in when a name is in several.
 */
export type Operation =
  /** Every place the name is written, in every file of the model, and the files that import it from a library. */
  | { op: 'rename'; target: string; to: string; file?: string }
  /** A property set to a formula or a text as it is written (`estimated(8_000 ± 30%, "queries/s")`, `"the db"`). */
  | { op: 'set'; target: string; value: string; file?: string }
  | { op: 'unset'; target: string; file?: string }
  /**
   * Whole statements: each replaces the one at the top with its name (or its chain, for an edge), wherever it is
   * written, or is added to `file` (the model by default) after the last of its kind.
   */
  | { op: 'put'; text: string; file?: string }
  /**
   * A statement with what only it gave a meaning to: a box's edges and its place in routes and steps, a parameter's
   * values in scenarios, presets and steps. What a formula still reads of it is said, and the list must mend it.
   */
  | { op: 'remove'; target: string; file?: string }
  | { op: 'connect'; from: string; to: string; label?: string; file?: string }
  | { op: 'disconnect'; from: string; to: string }
  /** A statement at the top into another file of the model (a part, or the model). */
  | { op: 'move'; target: string; to: string; file?: string }
  /** A part, a library or a variant; `text` is what follows its head. */
  | { op: 'addFile'; path: string; role: 'part' | 'library' | 'variant'; text?: string }
  | { op: 'renameFile'; from: string; to: string }
  | { op: 'removeFile'; path: string }

export const OPERATIONS = [
  'rename',
  'set',
  'unset',
  'put',
  'remove',
  'connect',
  'disconnect',
  'move',
  'addFile',
  'renameFile',
  'removeFile',
] as const satisfies readonly Operation['op'][]

/** The texts each operation needs. */
const FIELDS: Readonly<Record<Operation['op'], readonly string[]>> = {
  rename: ['target', 'to'],
  set: ['target', 'value'],
  unset: ['target'],
  put: ['text'],
  remove: ['target'],
  connect: ['from', 'to'],
  disconnect: ['from', 'to'],
  move: ['target', 'to'],
  addFile: ['path', 'role'],
  renameFile: ['from', 'to'],
  removeFile: ['path'],
}

export interface OperationsApplied {
  ok: true
  project: Project
  /** Paths of the result: files whose text changed, files added; paths before it: files removed. */
  changed: string[]
  added: string[]
  removed: string[]
  renamed: { from: string; to: string }[]
  /** One short sentence per operation: what it did, and what it left for the list to mend. */
  notes: string[]
}

export interface OperationsRefused {
  ok: false
  error: string
  /** The operation refused, from 0; -1 when the result as a whole is (a model no longer compiles). */
  index: number
}

export type OperationsResult = OperationsApplied | OperationsRefused

export type OperationOptions = Pick<CompileOptions, 'functions' | 'catalog'>

const DSL: Dsl = { imports, resolvePath, relativePath, parse, MAX_FILES, LANGUAGE_VERSION }
const HEAD = new Set(['loadmap', 'include', 'import', 'part', 'library', 'extends'])
const isBox = (k: string) => (BOXES as readonly string[]).includes(k)

/** The operations applied in order, then every model of the project compiled: all of them, or none. */
export function applyOperations(
  project: Project,
  operations: readonly Operation[],
  options: OperationOptions = {},
): OperationsResult {
  const w = new Work(project)
  for (const [i, op] of operations.entries()) {
    let note: string
    try {
      note = w.run(op, options)
    } catch (e) {
      if (e instanceof Refusal) return { ok: false, error: e.message, index: i }
      throw e
    }
    w.notes.push(note)
  }
  return w.finish(project, options)
}

class Refusal extends Error {}
const refuse = (message: string): never => {
  throw new Refusal(message)
}

interface Found {
  file: string
  /** The statement named, when the target names one. */
  decl?: Decl
  /** The block the statement or the property stands in. */
  owner: { body?: Stmt[]; bodySpan?: Span }
  /** A property the target ends in, written or not yet. */
  prop?: { name: string; at?: Property }
}

const idOf = (d: Decl): string | undefined => {
  const a = d.args[0]
  return a?.t === 'id' ? a.name : a?.t === 'str' ? a.value : undefined
}

const MAX_TARGET = 500
const NOT_A_TARGET = (t: string) =>
  `"${t.slice(0, 80)}" is no target: a name, a keyword and a name, or names joined by "."`

/** A quoted name's text: `\"` and `\\` read as the character, nothing else escaped. */
function unquote(q: string): string {
  let out = ''
  for (let i = 1; i < q.length - 1; i++) {
    const c = q[i]!
    if (c === '\\') {
      const n = q[i + 1]
      if (n !== '"' && n !== '\\') refuse(`${q.slice(0, 80)}: only \\" and \\\\ are written with a backslash`)
      out += n
      i++
    } else out += c
  }
  return out
}

/** The words of a target, read one character at a time: a name, a text in quotes, or a dot. */
function readTarget(t: unknown): { keyword?: string; path: string[] } {
  if (typeof t !== 'string' || !t.trim()) return refuse('a target names something')
  if (t.length > MAX_TARGET) refuse(`a target is at most ${MAX_TARGET} characters`)
  const words: string[] = []
  let i = 0
  const word = (c: string) => /[A-Za-z0-9_]/.test(c)
  while (i < t.length) {
    const c = t[i]!
    if (c === ' ' || c === '\t') i++
    else if (c === '.') {
      words.push('.')
      i++
    } else if (c === '"') {
      let j = i + 1
      while (j < t.length && t[j] !== '"') j += t[j] === '\\' ? 2 : 1
      if (j >= t.length) refuse(NOT_A_TARGET(t))
      words.push(t.slice(i, j + 1))
      i = j + 1
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i + 1
      while (j < t.length && word(t[j]!)) j++
      words.push(t.slice(i, j))
      i = j
    } else refuse(NOT_A_TARGET(t))
  }
  const keyword = words.length > 1 && /^\w/.test(words[0]!) && words[1] !== '.' ? words.shift() : undefined
  const path: string[] = []
  for (const [k, w] of words.entries()) {
    if ((k % 2 === 1) !== (w === '.')) refuse(NOT_A_TARGET(t))
    if (w !== '.') path.push(w.startsWith('"') ? unquote(w) : w)
  }
  if (!path.length || words.at(-1) === '.') refuse(NOT_A_TARGET(t))
  return { ...(keyword && { keyword }), path }
}

const kindFits = (keyword: string | undefined, d: Decl) =>
  !keyword || d.keyword.name === keyword || ((keyword === 'node' || keyword === 'box') && isBox(d.keyword.name))

function* edgesIn(body: readonly Stmt[]): Generator<Edge> {
  for (const s of body) {
    if (s.kind === 'edge') yield s
    else if (s.kind === 'decl' && s.body) yield* edgesIn(s.body)
  }
}

function* declsIn(body: readonly Stmt[], owner: { body?: Stmt[]; bodySpan?: Span }): Generator<[Decl, typeof owner]> {
  for (const s of body) {
    if (s.kind !== 'decl') continue
    yield [s, owner]
    if (s.body) yield* declsIn(s.body, s)
  }
}

const applyTo = (text: string, changes: readonly TextChange[]) =>
  [...changes].sort((a, b) => b.from - a.from).reduce((t, c) => t.slice(0, c.from) + c.insert + t.slice(c.to), text)

const lineStart = (s: string, i: number) => s.lastIndexOf('\n', i - 1) + 1

/** A statement taken out of its block, with the comment lines right above it when it stood on lines of its own. */
function takeOut(source: string, owner: { body?: Stmt[]; bodySpan?: Span }, s: Stmt): TextChange {
  const c = cut(source, owner, s)
  if (c.from !== lineStart(source, c.from) || c.from !== lineStart(source, s.from)) return c
  let from = c.from
  for (;;) {
    const above = lineStart(source, from - 1)
    if (from === 0 || !/^[ \t]*#/.test(source.slice(above, from - 1))) break
    from = above
  }
  return { ...c, from }
}

/** After the line `at` ends on, or at the end, with the file's last line ended first. */
function addAfter(source: string, at: number | undefined, text: string): TextChange {
  const block = text.trim()
  if (at == null) {
    const end = source.length
    const sep = !source ? '' : source.endsWith('\n\n') ? '' : source.endsWith('\n') ? '\n' : '\n\n'
    return { from: end, to: end, insert: `${sep}${block}\n` }
  }
  const eol = source.indexOf('\n', at)
  const pos = eol < 0 ? source.length : eol
  return { from: pos, to: pos, insert: `\n${block}` }
}

class Work {
  files: Map<string, string>
  entry: string
  notes: string[] = []
  added = new Set<string>()
  removed = new Set<string>()
  renamed: { from: string; to: string }[] = []

  constructor(p: Project) {
    this.files = new Map(Object.entries(p.files))
    this.entry = normalizePath(p.entry) ?? p.entry
    if (!this.files.has(this.entry)) refuse(`there is no ${this.entry}`)
  }

  text(path: string) {
    const t = this.files.get(path)
    if (t == null) refuse(`there is no ${path}`)
    return t!
  }

  record() {
    return Object.fromEntries(this.files)
  }

  role(path: string): Role {
    return imports(this.text(path), path).role
  }

  /**
   * The files whose statements share one set of names with `file`: a library's own, or the model with its parts and
   * variants (a library declares names of its own).
   */
  namespace(file: string): string[] {
    if (this.role(file) === 'library') return [file]
    return this.order().filter((p) => this.role(p) !== 'library')
  }

  /** The files in the order they are searched: the model first, then the rest. */
  order(file?: string) {
    if (file != null) {
      const p = normalizePath(file) ?? file
      this.text(p)
      return [p]
    }
    return [this.entry, ...[...this.files.keys()].filter((p) => p !== this.entry)]
  }

  /**
   * The statement or the property a target names. A property not written yet is found only with `create` (what
   * `set` writes).
   */
  find(target: string, file?: string, create = false): Found {
    const { keyword, path } = readTarget(target)
    const found: Found[] = []
    const names = new Set<string>()
    for (const f of this.order(file)) {
      const { doc } = parse(this.text(f))
      // the block searched, the statement found in it, and the block that statement stands in
      let scope: { body?: Stmt[]; bodySpan?: Span } = { body: doc.body }
      let owner = scope
      let decl: Decl | undefined
      let hit: Found | undefined
      for (const [i, name] of path.entries()) {
        const body = scope.body ?? []
        for (const s of body) if (s.kind === 'decl' && idOf(s)) names.add(idOf(s)!)
        const fit = body.filter(
          (s): s is Decl =>
            s.kind === 'decl' && !HEAD.has(s.keyword.name) && idOf(s) === name && (i > 0 || kindFits(keyword, s)),
        )
        if (fit.length > 1) refuse(`${f} has ${fit.length} statements named "${name}": say which with its keyword`)
        if (fit[0]) {
          owner = scope
          decl = fit[0]
          scope = decl
          if (i === path.length - 1) hit = { file: f, decl, owner }
          continue
        }
        // the last word: a property of the statement before it, or of the model (in the model's file only)
        const top =
          !decl && !keyword && path.length === 1 && f === (file != null ? (normalizePath(file) ?? file) : this.entry)
        if (i === path.length - 1 && (decl || top)) {
          const at = body.find((s): s is Property => s.kind === 'prop' && s.key.name === name)
          if (at || create) hit = { file: f, ...(decl && { decl }), owner: scope, prop: { name, ...(at && { at }) } }
        }
        break
      }
      if (hit) found.push(hit)
    }
    // a statement named wins over a property of the model with the same word
    const named = found.filter((x) => !x.prop)
    const list = named.length ? named : found
    if (list.length > 1) refuse(`"${target}" is in ${list.map((x) => x.file).join(' and ')}: say which with "file"`)
    if (list[0]) return list[0]
    const near = closest(path.at(-1)!, names)
    return refuse(`nothing is named "${target}"${near && near !== path.at(-1) ? `: did you mean "${near}"?` : ''}`)
  }

  run(op: Operation, o: OperationOptions): string {
    // a list from a model or a client's command is untrusted: each field it needs is checked before it is read
    if (typeof op !== 'object' || op === null) return refuse('an operation is an object with "op"')
    const need = FIELDS[op.op as keyof typeof FIELDS]
    if (!need) return refuse(`no operation "${String((op as { op: unknown }).op).slice(0, 40)}"`)
    const fields = op as unknown as Record<string, unknown>
    for (const k of need) if (typeof fields[k] !== 'string') refuse(`${op.op} takes "${k}"`)
    for (const k of ['file', 'label'])
      if (fields[k] != null && typeof fields[k] !== 'string') refuse(`"${k}" of ${op.op} is a text`)
    switch (op.op) {
      case 'rename':
        return this.rename(op.target, op.to, op.file, o)
      case 'set':
        return this.set(op.target, op.value, op.file)
      case 'unset':
        return this.unset(op.target, op.file)
      case 'put':
        return this.put(op.text, op.file)
      case 'remove':
        return this.remove(op.target, op.file)
      case 'connect':
        return this.connect(op.from, op.to, op.label, op.file)
      case 'disconnect':
        return this.disconnect(op.from, op.to)
      case 'move':
        return this.move(op.target, op.to, op.file)
      case 'addFile':
        return this.addFile(op.path, op.role, op.text)
      case 'renameFile':
        return this.renameFile(op.from, op.to)
      case 'removeFile':
        return this.removeFile(op.path)
      default:
        return refuse(`no operation "${(op as { op: unknown }).op}"`)
    }
  }

  rename(target: string, to: string, file: string | undefined, o: OperationOptions) {
    const quoted = to.length > 1 && to.startsWith('"') && to.endsWith('"')
    const name = quoted ? to.slice(1, -1) : to
    if (quoted ? /["\\\n]/.test(name) : !/^[A-Za-z_]\w*$/.test(name)) refuse(`"${to.slice(0, 80)}" is no name`)
    const f = this.find(target, file)
    if (!f.decl || f.prop) return refuse(`only a statement is renamed: "${target}" is a property`)
    const source = this.text(f.file)
    const arg = f.decl.args[0]!
    const r = renameAcross(source, arg.from + 1, arg.t === 'str' ? `"${name}"` : name, {
      path: f.file,
      files: this.record(),
      ...o,
    })
    if ('error' in r) return refuse(r.error)
    const changes: (TextChange & { file?: string })[] = [...r.changes]
    if (this.role(f.file) === 'library')
      changes.push(
        ...importersOf(f.file, idOf(f.decl)!, name, {
          path: f.file,
          files: this.record(),
          paths: [...this.files.keys()],
        }),
      )
    const byFile = new Map<string, TextChange[]>()
    for (const c of changes) byFile.set(c.file ?? f.file, [...(byFile.get(c.file ?? f.file) ?? []), c])
    for (const [p, list] of byFile) this.files.set(p, applyTo(this.text(p), list))
    const others = [...byFile.keys()].filter((p) => p !== f.file)
    return `Renamed ${idOf(f.decl)} to ${name}${others.length ? `, also in ${others.join(', ')}` : ''}`
  }

  set(target: string, value: string, file?: string) {
    const f = this.find(target, file, true)
    if (!f.prop) return refuse(`"${target}" names a statement: set takes a property, as "${target}.capacity"`)
    if (!value.trim()) refuse('set takes a value: unset takes a property out')
    const source = this.text(f.file)
    const line = `${f.prop.name}: ${value.trim()}`
    if (f.prop.at) {
      this.files.set(f.file, applyTo(source, [{ from: f.prop.at.from, to: f.prop.at.to, insert: line }]))
      return `Set ${target}`
    }
    if (f.decl) {
      const d = f.decl
      if (!d.bodySpan) this.files.set(f.file, applyTo(source, [{ from: d.to, to: d.to, insert: ` { ${line} }` }]))
      else this.files.set(f.file, applyTo(source, [inBlock(source, d, line)]))
      return `Set ${target}`
    }
    // a property of the model: under its head
    const { doc } = parse(source)
    const head = doc.body.filter((s) => s.kind === 'decl' && HEAD.has(s.keyword.name)).at(-1)
    const at = head ? source.indexOf('\n', head.to) : -1
    const pos = at < 0 ? (head ? source.length : 0) : at + 1
    this.files.set(f.file, applyTo(source, [{ from: pos, to: pos, insert: `${line}\n` }]))
    return `Set ${target}`
  }

  unset(target: string, file?: string) {
    const f = this.find(target, file)
    if (!f.prop) return refuse(`"${target}" names a statement: remove takes it out`)
    if (!f.prop.at) return `${target} was not set`
    const source = this.text(f.file)
    this.files.set(f.file, applyTo(source, [takeOut(source, f.owner, f.prop.at)]))
    return `Took out ${target}`
  }

  put(text: string, file?: string) {
    const { doc, report } = parse(text)
    if (report.failed) {
      const d = report.list.find((x) => x.severity === 'error')
      return refuse(`the text to put does not parse: ${d?.message ?? 'a syntax error'} (its line ${d?.line ?? 1})`)
    }
    if (!doc.body.length) refuse('put takes at least one statement')
    const into = file != null ? (normalizePath(file) ?? file) : this.entry
    if (file != null && !this.files.has(into)) refuse(`there is no ${into}: addFile makes it first`)
    const done: string[] = []
    this.explicit = file != null
    let prev = 0
    for (const s of doc.body) {
      // the comment lines over a statement go with it
      const lead = text.slice(prev, s.from)
      const comments = lead
        .split('\n')
        .filter((l) => /^\s*#/.test(l))
        .map((l) => l.trim())
      const chunk = [...comments, text.slice(s.from, s.to)].join('\n')
      prev = s.to
      if (s.kind === 'decl' && HEAD.has(s.keyword.name))
        refuse(`"${s.keyword.name}" is a head line: addFile writes those`)
      if (s.kind === 'row') refuse('a row of numbers belongs in a fit')
      done.push(this.putOne(s, chunk, into))
    }
    return done.join('; ')
  }

  /** Whether the put being applied names its file. */
  explicit = false

  putOne(s: Stmt, chunk: string, into: string): string {
    const name =
      s.kind === 'decl'
        ? `${s.keyword.name} ${idOf(s) ?? ''}`.trim()
        : s.kind === 'edge'
          ? s.chain.map((c) => c.name).join(' -> ')
          : s.kind === 'prop'
            ? s.key.name
            : 'a row'
    // the same statement written already: replaced where it is, in the file named (a variant overrides there), else
    // in the files that share names with it (never a library's own statement for the model's)
    const where = this.explicit ? [into] : this.namespace(into)
    for (const f of where) {
      const source = this.text(f)
      const { doc } = parse(source)
      const same = doc.body.find((x) => {
        if (s.kind === 'decl' && x.kind === 'decl') {
          const id = idOf(s)
          return (
            !!id &&
            idOf(x) === id &&
            !HEAD.has(x.keyword.name) &&
            (x.keyword.name === s.keyword.name || (isBox(x.keyword.name) && isBox(s.keyword.name)))
          )
        }
        if (s.kind === 'edge' && x.kind === 'edge')
          return x.chain.map((c) => c.name).join('>') === s.chain.map((c) => c.name).join('>')
        if (s.kind === 'prop' && x.kind === 'prop') return f === into && x.key.name === s.key.name
        return false
      })
      if (same) {
        this.files.set(
          f,
          applyTo(source, [{ from: same.from, to: same.to, insert: chunk.replace(/^(\s*#.*\n)+/, '') }]),
        )
        return `Replaced ${name}${f === this.entry ? '' : ` in ${f}`}`
      }
    }
    const source = this.text(into)
    const { doc } = parse(source)
    const kin = doc.body.filter((x) =>
      s.kind === 'decl'
        ? x.kind === 'decl' &&
          !HEAD.has(x.keyword.name) &&
          (x.keyword.name === s.keyword.name || (isBox(x.keyword.name) && isBox(s.keyword.name)))
        : x.kind === s.kind,
    )
    // a property of the model goes under the head; anything else after the last of its kind, else at the end
    const head = doc.body.filter((x) => x.kind === 'decl' && HEAD.has(x.keyword.name)).at(-1)
    const after = kin.at(-1)?.to ?? (s.kind === 'prop' ? head?.to : undefined)
    const sep = kin.length || s.kind === 'prop' ? '' : '\n'
    this.files.set(into, applyTo(source, [addAfter(source, after, `${sep}${chunk}`)]))
    return `Added ${name}${into === this.entry ? '' : ` to ${into}`}`
  }

  remove(target: string, file?: string) {
    const f = this.find(target, file)
    if (!f.decl || f.prop) return refuse(`"${target}" is a property: unset takes it out`)
    const d = f.decl
    const id = idOf(d)!
    const source = this.text(f.file)
    this.files.set(f.file, applyTo(source, [takeOut(source, f.owner, d)]))
    let edges = 0
    let routes = 0
    let values = 0
    // what flows pass through: a box, or a stage written inside one
    const box = isBox(d.keyword.name) || (STAGES as readonly string[]).includes(d.keyword.name)
    for (const p of this.namespace(f.file)) {
      const text = this.text(p)
      const { doc } = parse(text)
      const changes: TextChange[] = []
      if (box) {
        for (const e of edgesIn(doc.body)) {
          const i = e.chain.findIndex((c) => c.name === id)
          if (i < 0) continue
          edges++
          const left = e.chain.slice(0, i)
          const right = e.chain.slice(i + 1)
          const keep = [left, right].filter((c) => c.length > 1).map((c) => c.map((x) => x.name).join(' -> '))
          if (keep.length && (e.value || e.body))
            refuse(
              `${e.chain.map((c) => c.name).join(' -> ')} has a label or a block: put it again without ${id} first`,
            )
          if (!keep.length) {
            const owner = ownerOf(doc.body, e) ?? { body: doc.body }
            changes.push(takeOut(text, owner, e))
          } else changes.push({ from: e.from, to: e.to, insert: keep.join(`\n${indentAt(text, e.from)}`) })
        }
      }
      for (const [x] of declsIn(doc.body, { body: doc.body })) {
        for (const s of x.body ?? []) {
          if (s.kind !== 'prop') continue
          if (box && s.chain?.some((c) => c.name === id)) {
            routes++
            const rest = s.chain.filter((c) => c.name !== id).map((c) => c.name)
            changes.push(
              rest.length
                ? { from: s.from, to: s.to, insert: `${s.key.name}: ${rest.join(' -> ')}` }
                : takeOut(text, x, s),
            )
          } else if (
            box &&
            x.keyword.name === 'step' &&
            s.key.name === 'focus' &&
            s.value.t === 'id' &&
            s.value.name === id
          ) {
            values++
            changes.push(takeOut(text, x, s))
          } else if (
            d.keyword.name === 'param' &&
            s.key.name === id &&
            ['scenario', 'preset', 'step'].includes(x.keyword.name)
          ) {
            values++
            changes.push(takeOut(text, x, s))
          }
        }
      }
      if (changes.length) this.files.set(p, applyTo(text, dedupe(changes)))
    }
    const parts = [
      edges && `${edges} edge${edges > 1 ? 's' : ''}`,
      routes && `${routes} route${routes > 1 ? 's' : ''}`,
      values && `${values} value${values > 1 ? 's' : ''}`,
    ].filter(Boolean)
    // what a formula still reads of it: said, never guessed
    const still = this.stillNamed(id, f.file)
    return `Removed ${d.keyword.name} ${id}${parts.length ? ` with ${parts.join(', ')}` : ''}${
      still.length ? `; still named in ${still.join(', ')}` : ''
    }`
  }

  /**
   * Where a name is still written, as "file:line", for the note of a removal: in a library its own file, else the
   * files that read the model's names (a library has names of its own).
   */
  stillNamed(id: string, from: string): string[] {
    const out: string[] = []
    if (!/^[A-Za-z_]\w*$/.test(id)) return out
    for (const p of this.namespace(from)) {
      for (const line of namesAt(this.text(p), id)) out.push(`${p}:${line}`)
      if (out.length >= 8) break
    }
    return out.slice(0, 8)
  }

  edgeWith(from: string, to: string) {
    for (const p of this.namespace(this.entry)) {
      const text = this.text(p)
      const { doc } = parse(text)
      for (const e of edgesIn(doc.body)) {
        const i = e.chain.findIndex((c, k) => c.name === from && e.chain[k + 1]?.name === to)
        if (i >= 0) return { p, text, doc, e, i }
      }
    }
    return undefined
  }

  connect(from: string, to: string, label: string | undefined, file?: string) {
    if (from === to) refuse('an edge joins two boxes')
    for (const n of [from, to]) this.find(n)
    if (this.edgeWith(from, to)) refuse(`${from} -> ${to} is there already`)
    const into = file != null ? (normalizePath(file) ?? file) : this.entry
    const source = this.text(into)
    const { doc } = parse(source)
    const last = doc.body.filter((x) => x.kind === 'edge').at(-1)
    const line = `${from} -> ${to}${label?.trim() ? `: ${label.trim()}` : ''}`
    this.files.set(into, applyTo(source, [addAfter(source, last?.to, last ? line : `\n${line}`)]))
    return `Connected ${from} -> ${to}`
  }

  disconnect(from: string, to: string) {
    const hit = this.edgeWith(from, to)
    if (!hit) return refuse(`there is no edge ${from} -> ${to}`)
    const { p, text, doc, e, i } = hit
    const left = e.chain.slice(0, i + 1)
    const right = e.chain.slice(i + 1)
    const keep = [left, right].filter((c) => c.length > 1).map((c) => c.map((x) => x.name).join(' -> '))
    if (keep.length && (e.value || e.body))
      refuse(`${from} -> ${to} is part of a longer edge with a label or a block: put it again whole`)
    const change = keep.length
      ? { from: e.from, to: e.to, insert: keep.join('\n') }
      : takeOut(text, ownerOf(doc.body, e) ?? { body: doc.body }, e)
    this.files.set(p, applyTo(text, [change]))
    return `Disconnected ${from} -> ${to}`
  }

  move(target: string, to: string, file?: string) {
    const f = this.find(target, file)
    if (!f.decl || f.prop) return refuse(`"${target}" is a property: only a statement moves`)
    const dest = normalizePath(to) ?? to
    if (!this.files.has(dest)) refuse(`there is no ${dest}: addFile makes it first`)
    if (dest === f.file) return `${target} is in ${dest} already`
    if (f.owner.bodySpan) refuse('only a statement at the top of its file moves')
    const roles = [this.role(f.file), this.role(dest)]
    if (roles.some((r) => r === 'library' || r === 'variant'))
      refuse('a statement moves between a model and its parts: a library and a variant read the model their own way')
    const source = this.text(f.file)
    const cutAt = takeOut(source, f.owner, f.decl)
    const chunk = source.slice(cutAt.from, cutAt.to).trim()
    this.files.set(f.file, applyTo(source, [cutAt]))
    const destText = this.text(dest)
    this.files.set(dest, applyTo(destText, [addAfter(destText, undefined, chunk)]))
    return `Moved ${idOf(f.decl)} to ${dest}`
  }

  addFile(path: string, role: 'part' | 'library' | 'variant', text?: string) {
    const p = normalizePath(path)
    if (!p?.endsWith('.loadmap')) return refuse(`"${path.slice(0, 80)}" is no path of a .loadmap file`)
    if (!['part', 'library', 'variant'].includes(role)) refuse('a new file is a part, a library or a variant')
    const r = fileAt(DSL, { path: this.entry, files: this.record() }, role, p, text)
    if ('error' in r) return refuse(r.error)
    for (const [q, t] of Object.entries(r.texts ?? {})) this.files.set(q, t)
    this.files.set(p, r.add!.text)
    this.added.add(p)
    return `Added ${p}`
  }

  renameFile(from: string, to: string) {
    const a = normalizePath(from) ?? from
    const r = moveFile(DSL, { path: this.entry, files: this.record() }, a, to)
    if ('error' in r) return refuse(r.error)
    for (const [p, t] of Object.entries(r.texts ?? {})) this.files.set(p, t)
    if (r.rename) {
      const t = this.text(r.rename.from)
      this.files.delete(r.rename.from)
      this.files.set(r.rename.to, t)
      if (this.entry === r.rename.from) this.entry = r.rename.to
      // a file renamed again keeps one entry, from where it was before the list
      const was = this.renamed.find((x) => x.to === r.rename!.from)
      if (this.added.delete(r.rename.from)) this.added.add(r.rename.to)
      else if (was) was.to = r.rename.to
      else this.renamed.push(r.rename)
    }
    return r.note
  }

  removeFile(path: string) {
    const p = normalizePath(path) ?? path
    const r = dropFile(DSL, { path: this.entry, files: this.record() }, p)
    if ('error' in r) return refuse(r.error)
    for (const [q, t] of Object.entries(r.texts ?? {})) this.files.set(q, t)
    this.files.delete(p)
    if (!this.added.delete(p)) {
      const was = this.renamed.find((x) => x.to === p)
      if (was) this.renamed = this.renamed.filter((x) => x !== was)
      this.removed.add(was?.from ?? p)
    }
    return r.note
  }

  finish(before: Project, o: OperationOptions): OperationsResult {
    let total = 0
    for (const t of this.files.values()) total += t.length
    if (total > MAX_TOTAL)
      return { ok: false, error: `the files would hold more than ${MAX_TOTAL} characters`, index: -1 }
    const was = new Map(Object.entries(before.files))
    const from = (p: string) => this.renamed.find((x) => x.to === p)?.from ?? p
    // a file that was laid out by format() stays so
    for (const [p, t] of this.files) {
      const old = was.get(from(p))
      if (old === t) continue
      const laidOut = old == null || format(old).text === old
      const f = format(t)
      if (laidOut && f.ok) this.files.set(p, f.text)
    }
    const after = this.record()
    const errors = (text: string, path: string, files: Readonly<Record<string, string>>) =>
      compile(text, { path, files, ...o })
        .diagnostics.filter((d) => d.severity === 'error')
        .map((d) => ({
          key: `${d.file ?? path}|${d.message}`,
          where: `${d.file ?? path}:${d.line}`,
          message: d.message,
        }))
    for (const [p, t] of this.files) {
      const role = imports(t, p).role
      if (role !== 'model' && role !== 'variant') continue
      const old = was.get(from(p))
      const known =
        old == null ? [] : errors(old, from(p), before.files).map((x) => x.key.replace(`${from(p)}|`, `${p}|`))
      const next = errors(t, p, after).find((x) => {
        const i = known.indexOf(x.key)
        if (i < 0) return true
        known.splice(i, 1)
        return false
      })
      if (next) return { ok: false, error: `${next.where}: ${next.message}`, index: -1 }
    }
    const changed = [...this.files.keys()].filter((p) => !this.added.has(p) && was.get(from(p)) !== this.files.get(p))
    return {
      ok: true,
      project: { entry: this.entry, files: after },
      changed,
      added: [...this.added],
      removed: [...this.removed],
      renamed: this.renamed,
      notes: this.notes,
    }
  }
}

/** The lines (from 1) where `id` is written as a name: outside texts and comments, read one character at a time. */
function namesAt(text: string, id: string): number[] {
  const lines: number[] = []
  let line = 1
  for (let i = 0; i < text.length; ) {
    const c = text[i]!
    if (c === '\n') {
      line++
      i++
    } else if (c === '#') {
      while (i < text.length && text[i] !== '\n') i++
    } else if (c === '"' || c === "'") {
      i++
      while (i < text.length && text[i] !== c && text[i] !== '\n') i += text[i] === '\\' ? 2 : 1
      i++
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i + 1
      while (j < text.length && /\w/.test(text[j]!)) j++
      if (j - i === id.length && text.startsWith(id, i) && lines.at(-1) !== line) lines.push(line)
      i = j
    } else i++
  }
  return lines
}

/** The spaces in front of the line `at` is on. */
function indentAt(text: string, at: number): string {
  const start = lineStart(text, at)
  let end = start
  while (text[end] === ' ' || text[end] === '\t') end++
  return text.slice(start, end)
}

/** A line written as the last of a statement's block, indented as the lines before it. */
function inBlock(source: string, d: Decl, line: string): TextChange {
  const span = d.bodySpan!
  const last = d.body?.at(-1)
  const inner = source.slice(span.from + 1, span.to - 1)
  if (!inner.includes('\n')) {
    if (!last) return { from: span.from + 1, to: span.to - 1, insert: ` ${line} ` }
    return { from: last.to, to: last.to, insert: `; ${line}` }
  }
  const indent = last
    ? /^[ \t]*/.exec(source.slice(lineStart(source, last.from)))![0]
    : `${/^[ \t]*/.exec(source.slice(lineStart(source, d.from)))![0]}  `
  const at = last ? (source.indexOf('\n', last.to) < span.to ? source.indexOf('\n', last.to) : last.to) : span.from + 1
  return { from: at, to: at, insert: `\n${indent}${line}` }
}

/** The block an edge stands in. */
function ownerOf(body: readonly Stmt[], e: Stmt): { body?: Stmt[]; bodySpan?: Span } | undefined {
  if (body.includes(e)) return { body: body as Stmt[] }
  for (const s of body)
    if ((s.kind === 'decl' || s.kind === 'edge') && s.body) {
      if (s.body.includes(e)) return s
      const inner = ownerOf(s.body, e)
      if (inner) return inner
    }
  return undefined
}

/** Changes that do not overlap: of two that do, the wider one. */
function dedupe(changes: TextChange[]): TextChange[] {
  const out: TextChange[] = []
  for (const c of [...changes].sort((a, b) => a.from - b.from || b.to - a.to)) {
    const prev = out.at(-1)
    if (prev && c.from < prev.to) continue
    out.push(c)
  }
  return out
}
