import { compareDefinitions } from '@loadmap/core'
import type { Expr } from '../ast'
import { type CompileOptions, type CompileResult, compile } from '../compile'
import { imports, MAX_FILES, MAX_TOTAL, normalizePath } from '../files'
import { format } from '../format'
import { applyOperations, type Operation, type OperationsApplied, type Project } from '../operations'
import { parse } from '../parser'
import type { Answer } from './answer'
import { fixedText } from './fixes'

/**
 * What stands between a model's answer and the reader's text: the operations applied (or the whole files taken), the
 * files laid out by format(), every model compiled, quick fixes for what they mend alone, then the checks. A refusal
 * is a sentence the model can act on; it goes back to the model, at most twice.
 */

/** A capacity the answer writes: where, as written, and whether the reader gave its numbers. */
export interface Figure {
  file: string
  line: number
  text: string
  provenance: 'measured' | 'estimated' | 'configured'
  given: boolean
}

export interface Proposal {
  before: Project
  project: Project
  /** What the model asked for: operations, or whole files by their path. */
  operations: Operation[]
  files: Record<string, string>
  changed: string[]
  added: string[]
  removed: string[]
  renamed: { from: string; to: string }[]
  /** One sentence per operation, then one per quick fix the gate applied. */
  notes: string[]
  /** Warnings the change brings. */
  warnings: string[]
  /** Expectations whose outcome changed: label, before, after. */
  expectations: { label: string; before?: string; after: string }[]
  figures: Figure[]
  /** Where the first limit was and is: one sentence, and what makes it worse. */
  moved?: { text: string; worse: string[] }
}

export type GateResult = { ok: true; proposal: Proposal } | { ok: false; error: string }

export interface GateOptions extends Pick<CompileOptions, 'functions' | 'catalog'> {
  /** The reader's words: a number written there counts as given. */
  request?: string
}

const errorsOf = (r: CompileResult, path: string) =>
  r.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.file ?? path}:${d.line}: ${d.message}`)

/** Every model and variant of a project compiled, by its path. */
function compileAll(p: Project, o: GateOptions): Map<string, CompileResult> {
  const out = new Map<string, CompileResult>()
  for (const [path, text] of Object.entries(p.files)) {
    const role = imports(text, path).role
    if (role !== 'model' && role !== 'variant') continue
    out.set(path, compile(text, { path, files: p.files, functions: o.functions, catalog: o.catalog }))
  }
  return out
}

/** The answer's whole files over the project's: only .loadmap paths inside the root, within the limits. */
function withFiles(before: Project, files: Record<string, string>): Project | string {
  const next: Record<string, string> = { ...before.files }
  for (const [written, text] of Object.entries(files)) {
    const p = normalizePath(written)
    if (!p?.endsWith('.loadmap')) return `"${written.slice(0, 80)}" is no path of a .loadmap file in the project`
    next[p] = text.endsWith('\n') ? text : `${text}\n`
  }
  if (Object.keys(next).length > MAX_FILES) return `a definition has at most ${MAX_FILES} files`
  if (Object.values(next).reduce((n, t) => n + t.length, 0) > MAX_TOTAL) return 'the files are too large'
  return { entry: before.entry, files: next }
}

/** The answer applied and checked, or why not, in words the model can act on. */
export function gate(before: Project, answer: Answer, o: GateOptions = {}): GateResult {
  if (answer.problems.length) return { ok: false, error: answer.problems.slice(0, 5).join('\n') }
  const hasOps = answer.operations.length > 0
  const hasFiles = Object.keys(answer.files).length > 0
  if (hasOps && hasFiles) return { ok: false, error: 'answer with operations or with whole files, not both' }
  if (!hasOps && !hasFiles) return { ok: false, error: 'there is no change in the answer' }

  let applied: Pick<OperationsApplied, 'project' | 'changed' | 'added' | 'removed' | 'renamed' | 'notes'>
  if (hasOps) {
    const r = applyOperations(before, answer.operations, o)
    if (!r.ok)
      return {
        ok: false,
        error:
          r.index < 0
            ? `after the last operation the definition does not compile: ${r.error}`
            : `operation ${r.index + 1} (${describe(answer.operations[r.index]!)}) was refused: ${r.error}`,
      }
    applied = r
  } else {
    const next = withFiles(before, answer.files)
    if (typeof next === 'string') return { ok: false, error: next }
    // laid out as format() lays out the files that were, and mended where a quick fix alone mends it
    const files: Record<string, string> = {}
    const notes: string[] = []
    for (const [p, t] of Object.entries(next.files)) {
      if (before.files[p] === t) {
        files[p] = t
        continue
      }
      const f = format(t)
      files[p] = f.ok ? f.text : t
    }
    const project = { entry: before.entry, files }
    for (const [path, r] of compileAll(project, o)) {
      const mended = fixedText(files[path]!, r)
      if (mended) {
        files[path] = mended.text
        notes.push(...mended.notes)
      }
    }
    const changed = Object.keys(files).filter((p) => p in before.files && before.files[p] !== files[p])
    const added = Object.keys(files).filter((p) => !(p in before.files))
    applied = { project, changed, added, removed: [], renamed: [], notes }
  }

  // what compiled before must compile after
  const was = compileAll(before, o)
  const now = compileAll(applied.project, o)
  for (const [path, r] of now) {
    const old = was.get(path)
    const known = old ? errorsOf(old, path) : []
    const fresh = errorsOf(r, path).filter((e) => !known.includes(e))
    if (fresh.length) return { ok: false, error: `the definition does not compile:\n${fresh.slice(0, 5).join('\n')}` }
  }

  const figures = figuresOf(before, applied.project, [...applied.changed, ...applied.added], o.request ?? '')
  const invented = figures.find((f) => !f.given && f.provenance !== 'estimated')
  if (invented)
    return {
      ok: false,
      error: `${invented.file}:${invented.line}: ${invented.text} uses a number the reader did not give. Write it as estimated(…, "unit", "assistant's guess"), or ask for the number.`,
    }

  const head = now.get(applied.project.entry)
  const base = was.get(before.entry)
  const warnings = head
    ? head.diagnostics
        .filter((d) => d.severity === 'warning')
        .map((d) => `${d.file ?? applied.project.entry}:${d.line}: ${d.message}`)
        .filter((w) => !(base?.diagnostics ?? []).some((d) => w.endsWith(`: ${d.message}`)))
    : []
  // an expectation by its keyword and label as written: its line moves with the edit
  const outcomes = (r: CompileResult | undefined, p: Project) =>
    new Map(
      (r?.expectations ?? []).map((e) => [
        (p.files[e.file ?? p.entry] ?? '').slice(e.at.from, e.at.to),
        e.result.outcome as string,
      ]),
    )
  const b = outcomes(base, before)
  const expectations = [...outcomes(head, applied.project)]
    .filter(([k, v]) => b.get(k) !== v)
    .map(([k, v]) => ({ label: k, ...(b.has(k) && { before: b.get(k) }), after: v }))
  let moved: Proposal['moved']
  if (base?.definition && head?.definition) {
    const c = compareDefinitions(base.definition.model, head.definition.model)
    moved = { text: c.text, worse: c.triggers.map((t) => t.text) }
  }
  return {
    ok: true,
    proposal: {
      before,
      project: applied.project,
      operations: answer.operations,
      files: answer.files,
      changed: applied.changed,
      added: applied.added,
      removed: applied.removed,
      renamed: applied.renamed,
      notes: applied.notes,
      warnings,
      expectations,
      figures,
      ...(moved && { moved }),
    },
  }
}

/** An operation in a few words, for a refusal. */
export function describe(op: Operation): string {
  const o = op as unknown as Record<string, unknown>
  const what = o.target ?? o.path ?? (o.from && o.to ? `${o.from} -> ${o.to}` : undefined)
  return `${op.op}${what ? ` ${String(what).slice(0, 60)}` : ''}`
}

const PROVENANCE = new Set(['measured', 'estimated', 'configured'])

/** The numbers a text gives, without "_" and as written: "8_000" and "8000" are one. */
function numbersIn(text: string): Set<string> {
  const out = new Set<string>()
  for (const m of text.matchAll(/\d[\d_]*(?:\.\d+)?/g)) out.add(String(Number(m[0].replaceAll('_', ''))))
  return out
}

function* calls(e: Expr): Generator<Extract<Expr, { t: 'call' }>> {
  if (e.t === 'call') yield e
  const kids =
    e.t === 'unary'
      ? [e.arg]
      : e.t === 'bin'
        ? [e.left, e.right]
        : e.t === 'cond'
          ? [e.test, e.then, e.else]
          : e.t === 'call'
            ? e.args
            : e.t === 'array'
              ? e.items
              : e.t === 'pm'
                ? [e.value, e.within]
                : []
  for (const k of kids) yield* calls(k)
}

function literals(e: Expr, out: string[] = []): string[] {
  if (e.t === 'num') out.push(String(e.written ?? e.value))
  for (const c of e.t === 'call'
    ? e.args
    : e.t === 'pm'
      ? [e.value, e.within]
      : e.t === 'bin'
        ? [e.left, e.right]
        : e.t === 'unary'
          ? [e.arg]
          : [])
    literals(c, out)
  return out
}

/**
 * The capacities the change writes that were not in the files before: each with whether the reader's words or the
 * files before hold every number in it.
 */
export function figuresOf(before: Project, after: Project, paths: readonly string[], request: string): Figure[] {
  const known = numbersIn(request)
  for (const t of Object.values(before.files)) for (const n of numbersIn(t)) known.add(n)
  const had = new Set<string>()
  for (const t of Object.values(before.files)) for (const c of capacityCalls(t)) had.add(c.text.replace(/\s+/g, ''))
  const out: Figure[] = []
  for (const p of paths) {
    const text = after.files[p]
    if (text == null) continue
    for (const c of capacityCalls(text)) {
      if (had.has(c.text.replace(/\s+/g, ''))) continue
      const given = c.numbers.every((n) => known.has(String(Number(n.replaceAll('_', '')))))
      out.push({ file: p, line: c.line, text: c.text, provenance: c.provenance, given })
    }
  }
  return out
}

function capacityCalls(text: string) {
  const { doc } = parse(text)
  const out: { text: string; line: number; provenance: Figure['provenance']; numbers: string[] }[] = []
  const lineOf = (i: number) => text.slice(0, i).split('\n').length
  const visit = (stmts: typeof doc.body) => {
    for (const s of stmts) {
      const exprs: Expr[] =
        s.kind === 'prop'
          ? [s.value]
          : s.kind === 'decl'
            ? [...s.args, ...(s.init ? [s.init] : [])]
            : s.kind === 'edge' && s.value
              ? [s.value]
              : []
      for (const e of exprs)
        for (const c of calls(e))
          if (PROVENANCE.has(c.callee.name))
            out.push({
              text: text.slice(c.from, c.to),
              line: lineOf(c.from),
              provenance: c.callee.name as Figure['provenance'],
              // the value and its ±, not the unit or the source
              numbers: c.args[0] ? literals(c.args[0]) : [],
            })
      if ((s.kind === 'decl' || s.kind === 'edge') && s.body) visit(s.body)
    }
  }
  visit(doc.body)
  return out
}
