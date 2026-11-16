import type { Decl, Edge, Expr, Ident, Property, Stmt } from './ast'
import { didYouMean, type Span } from './diagnostics'
import { type Env, Expander, type Template } from './expand'
import { Bail, type Loader, MAX_LIBRARY_DEPTH, relativePath, type SourceFile } from './files'
import { BOXES, STAGES } from './schema'
import { before, CURRENT, LANGUAGE_VERSION, needs, stampOf, type Version, versionText } from './versions'

/** What a model's files come to: one list of statements, as if the model were written in one file. */
export interface Linked {
  body: Stmt[]
  /** The model's version: its parts say the same. */
  version: Version
  /** The version of the file an offset is in: a library is read under its own. */
  versionAt(offset: number): Version
  /** A library checked on its own: drawn from its defaults, with nothing around it. */
  preview: boolean
}

const VALUES = ['let', 'fit', 'metric', 'measure', 'tier', 'published'] as const
const TEMPLATES = [...BOXES, 'subsystem'] as const
const isValue = (k: string) => (VALUES as readonly string[]).includes(k)
const isTemplate = (k: string) => (TEMPLATES as readonly string[]).includes(k)
const idOf = (d: Decl) => (d.args[0]?.t === 'id' ? d.args[0] : undefined)

/** What a part leaves to its model, and what a variant may write. */
const MODEL_ONLY = new Set(['load', 'view'])
const VARIANT_PROPS = new Set(['title', 'assume', 'searchMax'])
const VARIANT_REPLACES = new Set(['let', 'fit', 'metric', 'measure', 'published'])
const VARIANT_ADDS = new Set(['preset', 'scenario', 'expect', 'step'])
const VARIANT_ONCE = new Set(['growth', 'thresholds'])

interface Library {
  file: SourceFile
  /** What it declares at its top, by id. */
  names: Map<string, Decl>
  /** What it imported, by the name it has here. */
  imported: Map<string, { lib: Library; decl: Decl }>
  env: Env
}

/**
 * The `loadmap` line of one file, checked: there, first, a version this loadmap reads, and no word in the file from a
 * later version than it says. Sets the file's version.
 */
export function stamp(loader: Loader, file: SourceFile, hosted: ReadonlySet<string>) {
  const report = loader.report
  const body = file.doc.body
  const first = body[0]
  const isHeader = (s: Stmt | undefined): s is Decl => s?.kind === 'decl' && s.keyword.name === 'loadmap'
  if (!isHeader(first)) {
    report.error(
      'language-version',
      first ?? { from: file.base, to: file.base },
      `a definition starts with "loadmap ${LANGUAGE_VERSION}"`,
      `add "loadmap ${LANGUAGE_VERSION}" as the first line`,
    )
    throw new Bail()
  }
  for (const s of body.slice(1))
    if (isHeader(s)) report.error('language-version', s.keyword, 'the "loadmap" line must be the first and only one')
  const found = stampOf(report.source, body)
  if (!found) {
    file.version = CURRENT
    return
  }
  const { at, text, version } = found
  if (!version) {
    report.error(
      'language-version',
      at,
      `there is no language version ${text}; the first is 1`,
      `write "loadmap ${LANGUAGE_VERSION}"`,
    )
    throw new Bail()
  }
  if (before(CURRENT, version)) {
    report.error(
      'language-version',
      at,
      `this definition is written in language version ${text}; this loadmap reads version ${LANGUAGE_VERSION}`,
      'update @loadmap/dsl',
    )
    throw new Bail()
  }
  file.version = version
  if (!before(version, CURRENT)) return
  // what a later version added, used under an earlier stamp: a reader of that stamp would not know it
  for (const n of needs(body, hosted))
    if (before(version, n.since))
      report.error(
        'language-version',
        n,
        `${n.what} is from loadmap ${versionText(n.since)}; this definition says loadmap ${text}`,
        `write "loadmap ${versionText(n.since)}" on the first line`,
        { version: versionText(n.since) },
      )
}

/**
 * Joins the files of a model into one list of statements: the model's own, its parts' in the order it includes them,
 * and what its imports bring, with every `like` and every subsystem written out. `entry` is the model (or, checked on
 * its own, a library); `variant` a file that extends it.
 */
export function link(loader: Loader, entry: SourceFile, hosted: ReadonlySet<string>, variant?: SourceFile): Linked {
  const l = new Linker(loader, hosted)
  stamp(loader, entry, hosted)
  const body = entry.role === 'library' ? l.alone(entry) : l.model(entry, variant)
  return {
    body,
    version: entry.version ?? CURRENT,
    versionAt: (offset) => loader.at(offset).version ?? CURRENT,
    preview: entry.role === 'library',
  }
}

/** The statements of one file with its own `like`s and subsystems written out, and nothing from any other file. */
export function expandAlone(loader: Loader, stmts: readonly Stmt[]): Stmt[] {
  const local = templatesOf(stmts)
  const env: Env = {
    template: (name) => {
      const decl = local.get(name)
      return decl && { decl, env }
    },
    templates: () => local.keys(),
  }
  return new Expander(loader.report).top(stmts, env)
}

/** The boxes and subsystems a list of statements declares, by id: the first of a name. */
function templatesOf(stmts: readonly Stmt[]): Map<string, Decl> {
  const out = new Map<string, Decl>()
  for (const s of stmts) {
    if (s.kind !== 'decl' || !isTemplate(s.keyword.name)) continue
    const id = idOf(s)
    if (id && !out.has(id.name)) out.set(id.name, s)
  }
  return out
}

class Linker {
  private libraries = new Map<string, Library | null>()
  /** Each value of a library that the model uses, by its file and id: the id it has in the model. */
  private canonical = new Map<string, string>()
  /** Those values, as statements of the model. */
  private brought: Stmt[] = []
  private expander: Expander

  constructor(
    private readonly loader: Loader,
    private readonly hosted: ReadonlySet<string>,
  ) {
    this.expander = new Expander(loader.report, hosted)
  }

  private get report() {
    return this.loader.report
  }

  model(m: SourceFile, variant?: SourceFile): Stmt[] {
    const report = this.report
    const stmts: Stmt[] = [...m.body]
    const included = new Set<string>()
    for (const h of m.head) {
      if (h.kind !== 'include' || h.path == null) continue
      if (included.has(h.path)) {
        report.error('duplicate', h.at, `"${h.written}" is included twice`, 'remove one of them')
        continue
      }
      included.add(h.path)
      const part = this.loader.load(h.path, h.at)
      if (!part) continue
      const of = part.head.find((x) => x.kind === 'part')
      if (part.role !== 'part' || !of) {
        report.error(
          'bad-file',
          h.at,
          `"${h.written}" is a ${part.role}, not a part: an included file says whose it is`,
          `part of "${relativePath(part.path, m.path)}" as its second line`,
          { file: part.path, line: `part of "${relativePath(part.path, m.path)}"` },
        )
        continue
      }
      if (of.path != null && of.path !== m.path) {
        report.error('bad-file', h.at, `"${h.written}" is a part of "${of.path}": a part has one model`)
        continue
      }
      stamp(this.loader, part, this.hosted)
      this.sameVersion(part, m, 'a part')
      stmts.push(...this.partBody(part))
    }
    const imported = new Map<string, Template>()
    const taken = new Map<string, Span>()
    for (const h of m.head) {
      if (h.kind !== 'import' || h.path == null) continue
      const lib = this.library(h.path, h.at, [m.path])
      if (!lib) continue
      for (const n of h.names) {
        const decl = this.exported(lib, n.theirs)
        if (!decl) continue
        if (taken.has(n.local.name)) {
          report.error(
            'duplicate',
            n.local,
            `"${n.local.name}" is imported twice`,
            `give one another name: other: ${n.theirs.name}`,
          )
          continue
        }
        taken.set(n.local.name, n.local)
        if (isValue(decl.keyword.name)) this.bring(lib, decl, n.local)
        else imported.set(n.local.name, { decl, env: lib.env })
      }
    }
    if (variant) this.vary(stmts, variant, m)
    const local = templatesOf(stmts)
    for (const [name, at] of taken)
      if (imported.has(name) && local.has(name))
        report.error(
          'duplicate',
          at,
          `"${name}" is also a box of this model`,
          `give the import another name: other: ${name}`,
        )
    const env: Env = {
      template: (name) => {
        const decl = local.get(name)
        return decl ? { decl, env } : imported.get(name)
      },
      templates: () => [...local.keys(), ...imported.keys()],
    }
    const written = this.expander.top(stmts, env)
    return [m.stamp!, ...this.brought, ...written]
  }

  /** A part says the version of its model, and a variant of the model it extends: one namespace reads one way. */
  private sameVersion(file: SourceFile, m: SourceFile, what: string) {
    const [a, b] = [file.version ?? CURRENT, m.version ?? CURRENT]
    if (a[0] === b[0] && a[1] === b[1]) return
    const at = stampOf(this.report.source, file.doc.body)?.at ??
      file.stamp?.keyword ?? { from: file.base, to: file.base }
    this.report.error(
      'language-version',
      at,
      `${what} says its model's version: "${m.path}" says loadmap ${versionText(b)}`,
      `write "loadmap ${versionText(b)}"`,
      { version: versionText(b), exact: 'true' },
    )
  }

  /** A part's statements: anything a model holds but what there is one of, which stays in the model's own file. */
  private partBody(part: SourceFile): Stmt[] {
    return part.body.filter((s) => {
      if (s.kind === 'prop') {
        this.report.error('misplaced', s.key, `"${s.key.name}" goes in the model's own file: a part holds statements`)
        return false
      }
      if (s.kind === 'decl' && MODEL_ONLY.has(s.keyword.name)) {
        this.report.error('misplaced', s.keyword, `"${s.keyword.name}" goes in the model's own file: there is one`)
        return false
      }
      return true
    })
  }

  /**
   * A variant's statements, laid over its model's: a parameter here replaces the lines it writes of that parameter, a
   * let, fit, measure, metric or published figure the one of its name; presets, scenarios, expectations and steps are
   * added. The system itself (flows, boxes, edges) is the model's.
   */
  private vary(stmts: Stmt[], v: SourceFile, m: SourceFile) {
    const report = this.report
    stamp(this.loader, v, this.hosted)
    this.sameVersion(v, m, 'a variant')
    const at = (k: string, id: string) =>
      stmts.findIndex((s) => s.kind === 'decl' && s.keyword.name === k && idOf(s)?.name === id)
    for (const s of v.body) {
      if (s.kind === 'prop') {
        if (!VARIANT_PROPS.has(s.key.name)) {
          report.error('misplaced', s.key, `a variant does not set "${s.key.name}": that is its model's`)
          continue
        }
        const i = stmts.findIndex((x) => x.kind === 'prop' && x.key.name === s.key.name)
        if (i >= 0 && s.key.name !== 'assume') stmts[i] = s
        else stmts.push(s)
        continue
      }
      if (s.kind !== 'decl') {
        report.error('misplaced', s, "a variant changes values: the boxes and the edges are its model's")
        continue
      }
      const k = s.keyword.name
      const id = idOf(s)
      if (VARIANT_ADDS.has(k)) stmts.push(s)
      else if (VARIANT_ONCE.has(k)) {
        const i = stmts.findIndex((x) => x.kind === 'decl' && x.keyword.name === k)
        if (i >= 0) stmts[i] = s
        else stmts.push(s)
      } else if ((k === 'param' || VARIANT_REPLACES.has(k)) && id) {
        const i = at(k, id.name)
        if (i < 0) {
          const known = stmts.flatMap((x) =>
            x.kind === 'decl' && x.keyword.name === k && idOf(x) ? [idOf(x)!.name] : [],
          )
          report.error('unknown-name', id, `"${m.path}" has no ${k} "${id.name}"`, didYouMean(id.name, known))
          continue
        }
        const old = stmts[i] as Decl
        if (k !== 'param') stmts[i] = s
        else {
          // the lines written here replace the same lines there; the rest of the parameter stays
          const mine = new Set((s.body ?? []).flatMap((p) => (p.kind === 'prop' ? [p.key.name] : [])))
          const kept = (old.body ?? []).filter((p) => p.kind !== 'prop' || !mine.has(p.key.name))
          stmts[i] = { ...old, args: s.args.length > 1 ? s.args : old.args, body: [...kept, ...(s.body ?? [])] }
        }
      } else
        report.error(
          'misplaced',
          s.keyword,
          `a variant does not hold "${k}": it changes parameters and values, and adds presets, scenarios, expectations and steps`,
        )
    }
  }

  /** A library by its path, read once; `trail` is who imports whom down to here, for the loop it would close. */
  private library(path: string, at: Span, trail: readonly string[]): Library | undefined {
    const report = this.report
    if (trail.includes(path)) {
      const loop = [...trail.slice(trail.indexOf(path)), path]
      report.error('import-loop', at, `libraries import each other in a loop: ${loop.join(' → ')}`)
      return undefined
    }
    if (trail.length > MAX_LIBRARY_DEPTH) {
      report.error('too-large', at, `libraries import libraries at most ${MAX_LIBRARY_DEPTH} deep`)
      return undefined
    }
    const known = this.libraries.get(path)
    if (known !== undefined) return known ?? undefined
    const file = this.loader.load(path, at)
    if (!file) {
      this.libraries.set(path, null)
      return undefined
    }
    if (file.role !== 'library') {
      report.error(
        'bad-file',
        at,
        `"${path}" is a ${file.role}, not a library: only a library is imported`,
        'library "…" as its second line',
      )
      this.libraries.set(path, null)
      return undefined
    }
    stamp(this.loader, file, this.hosted)
    const lib = this.read(file, [...trail, path])
    this.libraries.set(path, lib)
    return lib
  }

  /** A library's own names and what it imports. In a library an id is one thing: a name declared twice is an error. */
  private read(file: SourceFile, trail: readonly string[]): Library {
    const report = this.report
    const names = new Map<string, Decl>()
    const imported = new Map<string, { lib: Library; decl: Decl }>()
    const lib: Library = { file, names, imported, env: undefined as unknown as Env }
    lib.env = {
      library: { path: file.path, value: (name, space) => this.value(lib, name, space) },
      template: (name) => {
        const own = names.get(name)
        if (own) return isTemplate(own.keyword.name) ? { decl: own, env: lib.env } : undefined
        const far = imported.get(name)
        return far && isTemplate(far.decl.keyword.name) ? { decl: far.decl, env: far.lib.env } : undefined
      },
      templates: () => [...names.keys(), ...imported.keys()],
    }
    for (const h of file.head) {
      if (h.kind !== 'import' || h.path == null) continue
      const other = this.library(h.path, h.at, trail)
      if (!other) continue
      for (const n of h.names) {
        const decl = this.exported(other, n.theirs)
        if (!decl) continue
        if (imported.has(n.local.name)) report.error('duplicate', n.local, `"${n.local.name}" is imported twice`)
        else imported.set(n.local.name, { lib: other, decl })
      }
    }
    for (const s of file.body) {
      if (s.kind !== 'decl' || !(isValue(s.keyword.name) || isTemplate(s.keyword.name))) {
        const at = s.kind === 'decl' ? s.keyword : s.kind === 'prop' ? s.key : s.kind === 'edge' ? s.chain[0]! : s
        const what = s.kind === 'decl' ? `"${s.keyword.name}"` : s.kind === 'prop' ? `"${s.key.name}"` : 'an edge'
        report.error(
          'misplaced',
          at,
          `${what} cannot go in a library: it holds values (let, fit, metric, measure, tier, published), boxes and subsystems`,
        )
        continue
      }
      const id = idOf(s)
      if (!id) {
        report.error('missing-part', s.keyword, `"${s.keyword.name}" needs its id`)
        continue
      }
      if (names.has(id.name) || imported.has(id.name))
        report.error(
          'duplicate',
          id,
          `"${id.name}" is declared twice: in a library a name is one thing`,
          'rename one of them',
        )
      else names.set(id.name, s)
    }
    return lib
  }

  /** What a library gives under a name: something it declares itself, and nothing whose name starts with "_". */
  private exported(lib: Library, name: Ident): Decl | undefined {
    const decl = lib.names.get(name.name)
    if (!decl) {
      const what = lib.imported.has(name.name)
        ? `"${name.name}" is not "${lib.file.path}"'s own: import it from where it is declared`
        : `"${lib.file.path}" has no "${name.name}"`
      this.report.error(
        'unknown-name',
        name,
        what,
        didYouMean(
          name.name,
          [...lib.names.keys()].filter((n) => !n.startsWith('_')),
        ),
      )
      return undefined
    }
    if (name.name.startsWith('_')) {
      this.report.error(
        'unknown-name',
        name,
        `"${name.name}" is private to "${lib.file.path}": a name that starts with "_" stays in its file`,
      )
      return undefined
    }
    return decl
  }

  /** The id in the model of a value a library reads by `name`, brought along on first use. */
  private value(lib: Library, name: string, space: 'formula' | 'metric' | 'tier'): string | undefined {
    const own = lib.names.get(name)
    const far = own ? undefined : lib.imported.get(name)
    const decl = own ?? far?.decl
    if (!decl) return undefined
    const k = decl.keyword.name
    const fits =
      space === 'metric'
        ? k === 'metric'
        : space === 'tier'
          ? k === 'tier'
          : isValue(k) && k !== 'metric' && k !== 'tier'
    return fits ? this.bring(far?.lib ?? lib, decl) : undefined
  }

  /**
   * A value of a library as a statement of the model: under the name its import gives it, or, when only the library's
   * own lines read it, under an id no text can write. Once, however many ways lead to it.
   */
  private bring(lib: Library, decl: Decl, local?: Ident): string {
    const own = idOf(decl)!
    const key = `${lib.file.path}#${own.name}`
    const known = this.canonical.get(key)
    if (known != null) {
      if (local && local.name !== known)
        this.report.error(
          'duplicate',
          local,
          known.includes('@')
            ? `"${own.name}" is imported after a line that reads it`
            : `"${own.name}" is already imported as "${known}"`,
          'import it once, first',
        )
      return known
    }
    const id = local?.name ?? `${own.name}@${lib.file.path}`
    this.canonical.set(key, id)
    const [copy] = this.expander.settled([decl], lib.env) as [Decl]
    // declared where the import names it: a clash with a name of the model shows there
    const at = local ?? own
    copy.args = [{ t: 'id', name: id, from: at.from, to: at.to }, ...copy.args.slice(1)]
    this.brought.push(copy)
    return id
  }

  /**
   * A library on its own: every value under its own name, and every prototype and subsystem once, drawn from its
   * defaults with a load and one flow for each flow it asks for. What it reads beyond its inputs and its own names
   * shows here, with no model around.
   */
  alone(file: SourceFile): Stmt[] {
    const lib = this.read(file, [file.path])
    this.libraries.set(file.path, lib)
    const at: Span = file.head.find((h) => h.kind === 'library')?.decl.keyword ?? { from: 0, to: 0 }
    const id = (name: string): Ident & { t: 'id' } => ({ t: 'id', name, from: at.from, to: at.to })
    const num = (value: number): Expr => ({ t: 'num', value, from: at.from, to: at.to })
    const text = (value: string): Expr => ({ t: 'str', value, from: at.from, to: at.to })
    const prop = (key: string, value: Expr, chain?: Ident[]): Property => ({
      kind: 'prop',
      key: { name: key, from: at.from, to: at.to },
      value,
      ...(chain && { chain }),
      from: at.from,
      to: at.to,
    })
    const decl = (keyword: string, args: Expr[], body?: Stmt[]): Decl => ({
      kind: 'decl',
      keyword: { name: keyword, from: at.from, to: at.to },
      args,
      ...(body && { body }),
      from: at.from,
      to: at.to,
    })
    for (const d of lib.names.values()) if (isValue(d.keyword.name)) this.bring(lib, d, idOf(d))
    const stmts: Stmt[] = [decl('load', [text('Load')], [prop('max', num(100))])]
    /** Each flow the templates ask for, and the boxes it passes. */
    const flows = new Map<string, string[]>()
    for (const [name, d] of lib.names) {
      if (!isTemplate(d.keyword.name)) continue
      const body = d.body ?? []
      const set: Stmt[] = []
      for (const i of body) {
        if (i.kind !== 'decl' || i.keyword.name !== 'input') continue
        const [first, second] = i.args
        if (first?.t === 'id' && first.name === 'flow' && second?.t === 'id') {
          set.push(prop(second.name, id(second.name)))
          const passes = flows.get(second.name) ?? []
          const routed =
            d.keyword.name === 'subsystem'
              ? body.some((s) => s.kind === 'prop' && s.key.name === 'route')
              : body.some((s) => s.kind === 'decl' && (STAGES as readonly string[]).includes(s.keyword.name))
          if (routed) passes.push(name)
          flows.set(second.name, passes)
        } else if (first?.t === 'id' && !i.init) set.push(prop(first.name, num(1)))
      }
      const like = prop('like', id(name))
      stmts.push(
        decl(d.keyword.name, [id(name), ...d.args.slice(1)], set.length ? [like, decl('with', [], set)] : [like]),
      )
    }
    for (const [flow, passes] of flows) {
      if (!passes.length) {
        // nothing in the library gives it a stage: it ends in a box of its own, so its rate is still a number
        passes.push(`${flow}End`)
        stmts.push(decl('node', [id(`${flow}End`), text(flow)], [decl('sink', [])]))
      }
      // from a box of its own, with the edges its dots take
      const source = `${flow}From`
      stmts.push(decl('node', [id(source), text(flow)]))
      const chain = passes.map((p) => id(p))
      stmts.push(
        decl(
          'flow',
          [id(flow), text(flow)],
          [prop('rate', id('load')), prop('route', chain[0]!, chain), prop('from', id(source))],
        ),
      )
      stmts.push({ kind: 'edge', chain: [id(source), ...chain], from: at.from, to: at.to } satisfies Edge)
    }
    const env: Env = {
      template: (name) => lib.env.template(name),
      templates: () => lib.env.templates(),
    }
    const written = this.expander.top(stmts, env)
    return [file.stamp!, ...this.brought, ...written]
  }
}
