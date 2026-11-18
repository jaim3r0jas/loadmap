// Completion over a model's files: an entry of its own (`@loadmap/dsl/internal/completion`, no promise between
// versions), for loadmap's editor to load on the first completion it asks for, not with everything else at once.

import type { Decl } from './ast'
import { type CompileOptions, Compiler, type DslSymbol, type Front, front } from './compile'
import {
  type Completion,
  type Completions,
  completionsIn,
  headIn,
  type Input,
  inputsIn,
  inputsOf,
  routable,
} from './complete'
import { Reporter } from './diagnostics'
import { DEFAULT_PATH, type Files, fileText, type HeadLine, normalizePath, relativePath } from './files'
import { parse } from './parser'
import { back, headOf, inside, into, type Joined, join, type WorkspaceOptions } from './workspace'

export { type Completion, type Completions, completions } from './complete'

/**
 * The names a model's files declare, linked: what a `like` or a subsystem brings from a library too (`orderLine.kafka`,
 * the stage of a box like `postgres`). Each says its `file` when it is not the model's own (a part's own names say
 * theirs too). Here and not beside
 * `declarations`: an embed, which loads the compiler, never needs it. Never throws; a file that stops the link leaves
 * the names found before it.
 */
function declarationsAcross(source: string, o: Pick<CompileOptions, 'path' | 'files'>): DslSymbol[] {
  const f: Front = { report: new Reporter(source), doc: { body: [] }, role: 'model' }
  let c: Compiler | undefined
  try {
    front(source, o, f)
    if (!f.linked) return []
    c = new Compiler(f.report, {}, undefined, undefined, f.linked)
    c.run(f.linked.body, true)
  } catch {
    // a bail leaves the names found so far
  }
  return (c?.symbols ?? []).map((s) => {
    const { file, ...span } = f.report.local(s.span)
    const { file: _, ...decl } = f.report.local(s.decl)
    return { ...s, span, decl, ...(file != null && { file }) }
  })
}

/**
 * What may be typed at `offset`: a path in a head, the names of a library in an import's braces, and everywhere else
 * what the one-file help offers, with the names the model's files declare once linked (a library's prototypes written
 * out), what this file imports and the inputs of what a box is like, wherever it is declared.
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
  // the names of the model linked, what this file imports, and the inputs of a prototype wherever it is declared
  const imported = mine.head.flatMap((h) => {
    const text = h.kind === 'import' && h.path != null ? fileText(o.files, h.path) : undefined
    if (text == null) return []
    const body = headOf(text, h.path!).body
    return h.names.flatMap((n) => {
      const d = body.find(
        (s): s is Decl => s.kind === 'decl' && s.args[0]?.t === 'id' && s.args[0].name === n.theirs.name,
      )
      return d
        ? [
            {
              name: n.local.name,
              keyword: d.keyword.name,
              from: h.written ?? h.path!,
              inputs: inputsOf(text, d).length > 0,
              route: routable(d, body),
            },
          ]
        : []
    })
  })
  const c = completionsIn(j.text, into(j, offset), {
    symbols: linkedNames(source, self, o.files),
    head: headIn(source, mine.doc.body, offset),
    imported,
    inputsOf: (name) => inputsNamed(name, j, mine.head, o),
    range: { from: into(j, 0), to: into(j, source.length) },
  })
  const at = back(j, { from: c.from, to: c.to })
  // an edge it draws, in this text: never in another file
  const options = c.options.map((x) => {
    if (!x.edits) return x
    const edits = x.edits.flatMap((e) => {
      const { file, ...here } = back(j, e)
      return file == null ? [here] : []
    })
    return edits.length ? { ...x, edits } : (({ edits: _, ...rest }) => rest)(x)
  })
  return { from: at.from, to: at.to, options }
}

/** The inputs of the box or subsystem a file knows as `name`: its own, a part's, or an imported one. */
function inputsNamed(name: string, j: Joined, head: readonly HeadLine[], o: WorkspaceOptions): Input[] {
  for (const h of head) {
    const n = h.kind === 'import' && h.path != null ? h.names.find((x) => x.local.name === name) : undefined
    const text = n && fileText(o.files, h.path!)
    if (n && text != null) return inputsIn(text, parse(text, new Reporter(text)).doc.body, n.theirs.name)
  }
  return inputsIn(j.text, parse(j.text, new Reporter(j.text)).doc.body, name)
}

/** The last linked names, by the texts they were read from: completion asks again on every keystroke. */
let lastLinked: { source: string; path: string; files: Files | undefined; symbols: DslSymbol[] } | undefined

/** The same texts by the same paths: a host may hand a new object each time. */
function sameFiles(a: Files | undefined, b: Files | undefined): boolean {
  if (a === b) return true
  // a reader or a map is the same only as itself
  if (!a || !b || typeof a === 'function' || typeof b === 'function' || a instanceof Map || b instanceof Map)
    return false
  const [x, y] = [a as Readonly<Record<string, string>>, b as Readonly<Record<string, string>>]
  const keys = Object.keys(x)
  return keys.length === Object.keys(y).length && keys.every((k) => x[k] === y[k])
}

function linkedNames(source: string, path: string, files: Files | undefined): DslSymbol[] {
  if (lastLinked?.source !== source || lastLinked.path !== path || !sameFiles(lastLinked.files, files))
    lastLinked = { source, path, files, symbols: declarationsAcross(source, { path, files }) }
  return lastLinked.symbols
}
