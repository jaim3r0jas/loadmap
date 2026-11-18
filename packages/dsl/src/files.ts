import type { Decl, Document, Ident, Stmt } from './ast'
import { type Placed, Reporter, type Span } from './diagnostics'
import { parse, parseAt } from './parser'
import { own } from './schema'
import { stampOf, type Version } from './versions'

/**
 * The other files of a model, by their path from the project root: a function, a Map or a plain object. The compiler
 * never reads a disk or a network: the host hands over what a definition may see, and a path the host does not have is
 * an error where it is written.
 */
export type Files =
  | ((path: string) => string | undefined)
  | ReadonlyMap<string, string>
  | Readonly<Record<string, string>>

/** The path of a text compiled without one. */
export const DEFAULT_PATH = 'input.loadmap'
/** More files, or more text over all of them, are refused: a link must not be able to exhaust its reader. */
export const MAX_FILES = 64
export const MAX_TOTAL = 1_000_000
/** Libraries that import libraries, this deep at most. */
export const MAX_LIBRARY_DEPTH = 8

/** Thrown after an error that leaves nothing to compile has been reported. */
export class Bail {}

/** A file's text, or undefined when the host has none: a path like "constructor" finds nothing. */
export function fileText(files: Files | undefined, path: string): string | undefined {
  if (!files) return undefined
  if (typeof files === 'function') return files(path)
  if (files instanceof Map) return (files as ReadonlyMap<string, string>).get(path)
  return own(files as Readonly<Record<string, string>>, path)
}

/** A path as the project root counts it: no "./", no "/" in front, "a/../b" as "b". Undefined when it leaves the root. */
export function normalizePath(path: string): string | undefined {
  const parts: string[] = []
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (!parts.length) return undefined
      parts.pop()
    } else parts.push(seg)
  }
  return parts.join('/')
}

/**
 * The file a path written in `from` names, from the project root: "./x.loadmap" and "../lib/x.loadmap" start at the
 * folder of `from`, "/lib/x.loadmap" at the root. Anything else is no path: a URL, a bare name, a backslash, another
 * ending, a way out of the root.
 */
export function resolvePath(from: string, written: string): { path: string } | { error: string } {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(written) || written.startsWith('//'))
    return { error: 'a file is named by its path, never by a URL' }
  if (written.includes('\\')) return { error: 'a path is written with "/"' }
  if (!written.endsWith('.loadmap')) return { error: 'a path ends in ".loadmap"' }
  const rooted = written.startsWith('/')
  if (!rooted && !written.startsWith('./') && !written.startsWith('../'))
    return { error: 'a path starts with "./" or "../" (from this file) or "/" (from the project root)' }
  const base = rooted ? '' : from.split('/').slice(0, -1).join('/')
  const path = normalizePath(`${base}/${written}`)
  return path == null ? { error: 'the path leaves the project' } : { path }
}

/** The path to write in `from` for the file `to`, both from the project root: "./x.loadmap", "../lib/x.loadmap". */
export function relativePath(from: string, to: string): string {
  const a = from.split('/').slice(0, -1)
  const b = to.split('/')
  let i = 0
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++
  const up = a.length - i
  return `${up ? '../'.repeat(up) : './'}${b.slice(i).join('/')}`
}

/** What a file is, said in its head: a model unless its second line says otherwise. */
export type Role = 'model' | 'part' | 'library' | 'variant'

/** One name of an import: `a`, or `local: theirs`. */
export interface Imported {
  local: Ident
  theirs: Ident
}

/** A line of a file's head. */
export interface HeadLine {
  kind: 'include' | 'import' | 'part' | 'library' | 'extends'
  decl: Decl
  /** The path as written, and where; undefined for `library`. */
  written?: string
  at: Span
  /** The file it names, from the project root; undefined when the path is not one (reported). */
  path?: string
  /** An import's names. */
  names: Imported[]
}

/** The statements a file's head holds, before anything else. */
export const HEAD = new Set(['include', 'import', 'part', 'library', 'extends'])

/** One file of a model, parsed, where the reporter holds it. */
export interface SourceFile extends Placed {
  text: string
  doc: Document
  role: Role
  head: HeadLine[]
  /** Its statements without the `loadmap` line and the head. */
  body: Stmt[]
  /** The `loadmap` line. */
  stamp?: Decl
  /** The version it says; set once its `loadmap` line is checked. */
  version?: Version
}

/**
 * The head of a file: its role and the files it names, with nothing reported. `path` is the file's own, from the
 * project root, so each named file comes back with its path from there too. For a host that must load the files
 * before it compiles: read the head, fetch what it names, read their heads, and so on.
 */
export function imports(
  source: string,
  path = DEFAULT_PATH,
): { role: Role; files: { kind: HeadLine['kind']; written: string; path?: string; names: string[] }[] } {
  const quiet = new Reporter(source)
  const { doc } = parse(source, quiet)
  const self = normalizePath(path) ?? DEFAULT_PATH
  const { role, head } = readHead(new Reporter(source), self, doc.body)
  return {
    role,
    files: head.flatMap((h) =>
      h.written == null
        ? []
        : [{ kind: h.kind, written: h.written, path: h.path, names: h.names.map((n) => n.theirs.name) }],
    ),
  }
}

/**
 * Every file a definition reaches, read through `files`: for a link, a recording or a flat copy. `path` is the file to
 * open: the model, also when `source` is one of its parts or a variant of it. `missing` are the paths nothing answered.
 */
export function gather(
  source: string,
  o: { path?: string; files?: Files } = {},
): { path: string; files: Record<string, string>; missing: string[] } {
  const self = normalizePath(o.path ?? DEFAULT_PATH) ?? DEFAULT_PATH
  const out: Record<string, string> = {}
  const missing: string[] = []
  const put = (p: string, text: string) =>
    Object.defineProperty(out, p, { value: text, enumerable: true, writable: true, configurable: true })
  let entry = self
  const todo: [string, string][] = [[self, source]]
  let total = 0
  while (todo.length) {
    const [p, text] = todo.pop()!
    if (Object.hasOwn(out, p) || Object.keys(out).length >= MAX_FILES || total + text.length > MAX_TOTAL) continue
    total += text.length
    put(p, text)
    const head = imports(text, p)
    for (const f of head.files) {
      if (f.path == null || Object.hasOwn(out, f.path)) continue
      // a part's model includes it, and is the file to open; a variant is opened as itself
      if (f.kind === 'part' && p === self) entry = f.path
      const other = f.path === self ? source : fileText(o.files, f.path)
      if (other == null) missing.push(f.path)
      else todo.push([f.path, other])
    }
  }
  return { path: entry, files: out, missing }
}

/** A file's role, its head lines and the statements after them. Head lines further down are reported and left out. */
export function readHead(
  report: Reporter,
  self: string,
  stmts: readonly Stmt[],
): { role: Role; head: HeadLine[]; body: Stmt[]; stamp?: Decl } {
  const head: HeadLine[] = []
  const body: Stmt[] = []
  const first = stmts[0]
  const stamp = first?.kind === 'decl' && first.keyword.name === 'loadmap' ? first : undefined
  let open = true
  for (const s of stamp ? stmts.slice(1) : stmts) {
    if (s.kind !== 'decl' || !HEAD.has(s.keyword.name) || (s.keyword.name === 'part' && !isPartOf(s))) {
      open = false
      body.push(s)
      continue
    }
    if (!open)
      report.error(
        'misplaced',
        s.keyword,
        `"${s.keyword.name}" goes in the head of the file, before any other statement`,
        'move it up, under the "loadmap" line',
      )
    const kind = s.keyword.name as HeadLine['kind']
    const text = s.args.find((a) => a.t === 'str')
    const line: HeadLine = { kind, decl: s, at: text ?? s.keyword, names: [] }
    if (kind !== 'library') {
      if (text?.t !== 'str') {
        report.error('missing-part', s.keyword, `"${kind}" needs a path in quotes`, own(EXAMPLES, kind))
      } else {
        line.written = text.value
        const r = resolvePath(self, text.value)
        if ('error' in r) report.error('missing-file', text, `"${text.value}" is no path: ${r.error}`)
        else if (r.path === self) report.error('bad-file', text, 'a file cannot name itself')
        else line.path = r.path
      }
    }
    if (kind === 'import') {
      for (const n of s.body ?? []) {
        if (n.kind === 'decl' && !n.args.length && !n.body && !n.init)
          line.names.push({ local: n.keyword, theirs: n.keyword })
        else if (n.kind === 'prop' && n.value.t === 'id' && !n.chain)
          line.names.push({ local: n.key, theirs: { name: n.value.name, from: n.value.from, to: n.value.to } })
        else report.error('syntax', n, 'an import lists names: "a", or "local: theirs"', own(EXAMPLES, 'import'))
      }
      if (!s.body) report.error('missing-part', s.keyword, 'an import names what it takes', own(EXAMPLES, 'import'))
    } else if (s.body) report.error('syntax', s.bodySpan ?? s, `"${kind}" takes no block`)
    head.push(line)
  }
  const roles = head.filter((h) => h.kind === 'part' || h.kind === 'library' || h.kind === 'extends')
  for (const extra of roles.slice(1))
    report.error('bad-file', extra.decl.keyword, `a file is one thing: this one is already "${roles[0]!.kind}"`)
  const kind = roles[0]?.kind
  const role: Role =
    kind === 'part' ? 'part' : kind === 'library' ? 'library' : kind === 'extends' ? 'variant' : 'model'
  for (const h of head) {
    const wrong =
      (h.kind === 'include' && role !== 'model' && 'only a model includes parts') ||
      (h.kind === 'import' &&
        role === 'part' &&
        "a part's imports go in its model's head: the one list of what it needs") ||
      (h.kind === 'import' && role === 'variant' && "a variant's imports are its model's")
    if (wrong) report.error('misplaced', h.decl.keyword, wrong)
  }
  return { role, head, body, stamp }
}

/** `part of "…"`: a statement, where a box called `part` is not. */
function isPartOf(d: Decl): boolean {
  const [of, path] = d.args
  return of?.t === 'id' && of.name === 'of' && path?.t === 'str'
}

const EXAMPLES: Readonly<Record<string, string>> = {
  include: 'include "./checkout.story.loadmap"',
  part: 'part of "./checkout.loadmap"',
  import: 'import "./lib/platform.loadmap" { postgres; pool: podPool }',
  extends: 'extends "./checkout.loadmap"',
}

/** The files of one compile, each read at most once. */
export class Loader {
  private byPath = new Map<string, SourceFile>()
  readonly list: SourceFile[] = []
  private total = 0

  constructor(
    readonly report: Reporter,
    private readonly files: Files | undefined,
    /** The text that was asked about, under its path: it wins over what the host has there. */
    private readonly given: { path: string; text: string },
  ) {}

  /** The first file: the reporter's own text, already parsed. */
  first(path: string, doc: Document): SourceFile {
    const text = this.report.source
    const f: SourceFile = { path, base: 0, end: text.length, text, doc, ...readHead(this.report, path, doc.body) }
    f.version = stampOf(this.report.source, doc.body)?.version
    this.byPath.set(path, f)
    this.list.push(f)
    this.total = text.length
    return f
  }

  has(path: string) {
    return this.byPath.has(path)
  }

  /** The file an offset is in. */
  at(offset: number): SourceFile {
    for (let i = this.list.length - 1; i > 0; i--) if (this.list[i]!.base <= offset) return this.list[i]!
    return this.list[0]!
  }

  /** A file by its path, read and parsed on first use; undefined (and an error at `at`) when there is none. */
  load(path: string, at: Span): SourceFile | undefined {
    const known = this.byPath.get(path)
    if (known) return known
    const text = path === this.given.path ? this.given.text : fileText(this.files, path)
    if (text == null) {
      const why = this.files ? 'it is not among the files of this definition' : 'this definition came as one file'
      this.report.error('missing-file', at, `there is no "${path}": ${why}`)
      return undefined
    }
    if (this.list.length >= MAX_FILES) {
      this.report.error('too-large', at, `a definition has at most ${MAX_FILES} files`)
      return undefined
    }
    if (this.total + text.length > MAX_TOTAL) {
      this.report.error('too-large', at, `the files of a definition hold at most ${MAX_TOTAL} characters together`)
      return undefined
    }
    this.total += text.length
    const placed = this.report.append(path, text)
    const doc = parseAt(this.report, placed.base, placed.end)
    const f: SourceFile = { ...placed, text, doc, ...readHead(this.report, path, doc.body) }
    this.byPath.set(path, f)
    this.list.push(f)
    return f
  }
}
