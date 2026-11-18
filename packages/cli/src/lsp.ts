import { dirname, join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  addImport,
  type CompileResult,
  type Completion,
  compile,
  type Definition,
  type Diagnostic,
  definitionAcross,
  format,
  hoverAcross,
  importersOf,
  imports,
  type Located,
  libraryOf,
  loadCatalog,
  problems,
  quickFixes,
  referencesAcross,
  renameAcross,
  signatureHelp,
  type WorkspaceOptions,
} from '@loadmap/dsl'
import { completionsAcross } from '@loadmap/dsl/completion'
import { BOXES, type Decl, parse, Reporter, relativePath, SCHEMA, STAGES } from '@loadmap/dsl/internal'
import { loadmapFiles, project } from './project'

/**
 * `loadmap lsp`: the language server protocol over standard input and output, for any editor that speaks it. The
 * help is the editor's own, from @loadmap/dsl: errors and failing expectations, completion, hover with the values at
 * the defaults, signature help, formatting, quick fixes, definition, references, rename and an outline. The whole text
 * on each change; nothing but Node.
 *
 * A definition in several files is read with them: a part through its model, a model with its parts and libraries.
 * An open document wins over the file on disk, and nothing outside the workspace folder (else the git checkout) is
 * read. Definition, references and rename cross the files of a model; a change to any file checks the open ones again.
 */

interface Message {
  jsonrpc: '2.0'
  id?: number | string | null
  method?: string
  params?: any
  result?: unknown
  error?: { code: number; message: string }
}

interface Doc {
  uri: string
  version: number
  text: string
  /** Where each line starts, in UTF-16 code units like the protocol's positions. */
  lines: number[]
  result?: { text: string; epoch: number; r: CompileResult }
  /** The last definition without errors: hover's values while the text has one. */
  good?: Definition
  timer?: ReturnType<typeof setTimeout>
}

interface Position {
  line: number
  character: number
}

const ERROR = { parse: -32700, request: -32600, method: -32601, internal: -32603, failed: -32803 }
/** CompletionItemKind for each kind of completion. */
const KIND: Record<Completion['type'], number> = {
  keyword: 14,
  property: 10,
  variable: 6,
  function: 3,
  constant: 21,
  type: 9,
}
/** SymbolKind for each statement in the outline. */
const SYMBOL: Readonly<Record<string, number>> = {
  param: 13,
  let: 13,
  fit: 12,
  flow: 24,
  node: 5,
  cluster: 5,
  pool: 5,
  component: 7,
  connection: 11,
  tier: 3,
  scenario: 10,
  preset: 10,
  step: 20,
  expect: 17,
  load: 14,
  growth: 14,
  thresholds: 14,
}

export const CAPABILITIES = {
  positionEncoding: 'utf-16',
  textDocumentSync: { openClose: true, change: 1 },
  completionProvider: { triggerCharacters: ['.', ':', '>', '(', ',', '"', '{', '['] },
  hoverProvider: true,
  signatureHelpProvider: { triggerCharacters: ['(', ','] },
  definitionProvider: true,
  referencesProvider: true,
  documentHighlightProvider: true,
  documentSymbolProvider: true,
  documentFormattingProvider: true,
  codeActionProvider: { codeActionKinds: ['quickfix'] },
  renameProvider: { prepareProvider: true },
  workspace: { workspaceFolders: { supported: true } },
}

/** Serves until the client says exit (or goes away); resolves to the exit code: 0 after a shutdown, else 1. */
export function lsp(input: Readable = process.stdin, output: Writable = process.stdout, delay = 150): Promise<number> {
  const docs = new Map<string, Doc>()
  /** The open documents by their file: what a definition reads before the disk. */
  const byFile = new Map<string, Doc>()
  /** The workspace folder, when the client has one: the root of the paths in a head. */
  let folder: string | undefined
  /** Counts every change to any file: a compile is good for the text and the files it read. */
  let epoch = 0
  /** For each open document, the problems it last found in files that are not open, by their uri. */
  const reported = new Map<string, Map<string, object[]>>()
  /** Counts the files that came or went (opened, closed, changed on disk): the list of them is read again then. */
  let listing = 0
  let listed: { listing: number; root: string; paths: string[] } | undefined
  let watch = false
  let shutdown = false
  let stopped = false
  // what the client can show: plain text where it reads no snippets or Markdown
  let client = { snippets: true, markdown: true }
  let done: (code: number) => void = () => {}
  const finished = new Promise<number>((resolve) => {
    done = (code) => {
      if (stopped) return
      stopped = true
      for (const d of docs.values()) clearTimeout(d.timer)
      input.removeListener('data', read)
      resolve(code)
    }
  })

  const send = (m: Omit<Message, 'jsonrpc'>) => {
    if (stopped) return
    const json = JSON.stringify({ jsonrpc: '2.0', ...m })
    output.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`)
  }
  const notify = (method: string, params: unknown) => send({ method, params })

  // headers, a blank line, then Content-Length bytes of JSON
  let buffer = Buffer.alloc(0)
  function read(chunk: Buffer) {
    buffer = Buffer.concat([buffer, chunk])
    for (;;) {
      const end = buffer.indexOf('\r\n\r\n')
      if (end < 0) return
      const length = Number(/content-length: *(\d+)/i.exec(buffer.subarray(0, end).toString('ascii'))?.[1])
      if (!Number.isFinite(length)) {
        buffer = buffer.subarray(end + 4)
        continue
      }
      if (buffer.length < end + 4 + length) return
      const body = buffer.subarray(end + 4, end + 4 + length).toString('utf8')
      buffer = buffer.subarray(end + 4 + length)
      let m: Message
      try {
        m = JSON.parse(body)
      } catch {
        send({ id: null, error: { code: ERROR.parse, message: 'the message is not JSON' } })
        continue
      }
      receive(m)
      if (stopped) return
    }
  }
  // the catalog first, so a published statement compiles, completes and hovers from the first message on; without it
  // (a build that left it out), everything else still works
  void loadCatalog()
    .catch(() => undefined)
    .then(() => {
      if (!stopped) input.on('data', read)
    })
  input.on('end', () => done(shutdown ? 0 : 1))
  // the client gone mid-write (EPIPE) or its pipe broken: an exit, not a crash
  input.on('error', () => done(1))
  output.on('error', () => done(1))

  const fileOf = (uri: string): string | undefined => {
    try {
      return uri.startsWith('file:') ? fileURLToPath(uri) : undefined
    } catch {
      return undefined
    }
  }

  /** Where a document is in its project, and the project's files as the editor has them: open ones first. */
  function place(d: Doc) {
    const file = fileOf(d.uri)
    if (file == null) return undefined
    const p = project(file, dirname(file), folder)
    const abs = (path: string) => join(p.root, ...path.split('/'))
    const files = (path: string) => byFile.get(abs(path))?.text ?? p.files(path)
    const paths = () => {
      // not on every keystroke: the files of a project change when one is made, removed or saved
      if (listed?.listing !== listing || listed.root !== p.root)
        listed = { listing, root: p.root, paths: loadmapFiles(p.root) }
      return listed.paths
    }
    const uriOf = (path: string) => byFile.get(abs(path))?.uri ?? pathToFileURL(abs(path)).href
    /** A file as a document, for its positions: the open one, or its text read now. */
    const docOf = (path: string): Doc => {
      const open = byFile.get(abs(path))
      if (open) return open
      const text = files(path) ?? ''
      return { uri: uriOf(path), version: 0, text, lines: lineStarts(text) }
    }
    return { path: p.path, files, paths, uriOf, docOf }
  }

  /** What the cross-file help takes for a document; for one that is no file, nothing: it is read alone. */
  function around(d: Doc, withPaths = false): WorkspaceOptions {
    const p = place(d)
    return p ? { path: p.path, files: p.files, ...(withPaths && { paths: p.paths() }) } : {}
  }

  function receive(m: Message) {
    // an answer to a request of ours (registering for file events): nothing to do with it
    if (m.method === undefined) return
    const isRequest = m.id !== undefined && m.id !== null
    if (shutdown && isRequest && m.method !== 'shutdown') {
      send({ id: m.id, error: { code: ERROR.request, message: 'the server is shutting down' } })
      return
    }
    try {
      const result = handle(m.method ?? '', m.params ?? {})
      if (isRequest) {
        if (result === NO_METHOD) send({ id: m.id, error: { code: ERROR.method, message: `no method ${m.method}` } })
        else send({ id: m.id, result: result ?? null })
      }
    } catch (err) {
      if (!isRequest) return
      const failed = err instanceof Refused
      send({ id: m.id, error: { code: failed ? ERROR.failed : ERROR.internal, message: (err as Error).message } })
    }
  }

  function handle(method: string, p: any): unknown {
    switch (method) {
      case 'initialize': {
        const c = p.capabilities?.textDocument
        const markdown = (formats: unknown) => !Array.isArray(formats) || formats.includes('markdown')
        client = {
          snippets: c?.completion?.completionItem?.snippetSupport !== false,
          markdown: markdown(c?.hover?.contentFormat) && markdown(c?.completion?.completionItem?.documentationFormat),
        }
        const first = p.workspaceFolders?.[0]?.uri ?? p.rootUri
        folder = typeof first === 'string' ? fileOf(first) : undefined
        watch = p.capabilities?.workspace?.didChangeWatchedFiles?.dynamicRegistration === true
        return { capabilities: CAPABILITIES, serverInfo: { name: 'loadmap' } }
      }
      case 'initialized':
        // a file changed on disk (a library nobody has open) checks the open documents again
        if (watch)
          send({
            id: 'loadmap-watch',
            method: 'client/registerCapability',
            params: {
              registrations: [
                {
                  id: 'loadmap-files',
                  method: 'workspace/didChangeWatchedFiles',
                  registerOptions: { watchers: [{ globPattern: '**/*.loadmap' }] },
                },
              ],
            },
          })
        return undefined
      case 'workspace/didChangeWatchedFiles':
        epoch++
        listing++
        for (const d of docs.values()) schedule(d)
        return undefined
      case 'workspace/didChangeWorkspaceFolders':
      case '$/cancelRequest':
      case '$/setTrace':
      case '$/progress':
      case 'workspace/didChangeConfiguration':
      case 'textDocument/didSave':
        return undefined
      case 'shutdown':
        shutdown = true
        return null
      case 'exit':
        done(shutdown ? 0 : 1)
        return undefined
      case 'textDocument/didOpen':
        open(p.textDocument.uri, p.textDocument.text, p.textDocument.version)
        return undefined
      case 'textDocument/didChange': {
        // full sync: the last change holds the whole text
        const text = p.contentChanges.at(-1)?.text
        if (typeof text === 'string') open(p.textDocument.uri, text, p.textDocument.version)
        return undefined
      }
      case 'textDocument/didClose': {
        const d = docs.get(p.textDocument.uri)
        clearTimeout(d?.timer)
        docs.delete(p.textDocument.uri)
        const file = fileOf(p.textDocument.uri)
        if (file != null && byFile.get(file) === d) byFile.delete(file)
        notify('textDocument/publishDiagnostics', { uri: p.textDocument.uri, diagnostics: [] })
        const theirs = [...(reported.get(p.textDocument.uri)?.keys() ?? [])]
        reported.delete(p.textDocument.uri)
        // what the documents still open say about those files stays
        for (const uri of theirs) publishFor(uri)
        listing++
        // the disk's text counts again: what read this file is checked again
        epoch++
        for (const other of docs.values()) schedule(other)
        return undefined
      }
    }
    if (!method.startsWith('textDocument/')) return NO_METHOD
    const d = docs.get(p.textDocument?.uri)
    if (!d) return null
    const at = p.position ? offsetAt(d, p.position) : 0
    /** A place as the protocol names it: in this document, or in the file it says. */
    const loc = (s: Located) => {
      const other = s.file != null ? place(d)?.docOf(s.file) : undefined
      const doc = other ?? d
      return { uri: doc.uri, range: range(doc, s.from, s.to) }
    }
    /** Changes by the document each is in, as a workspace edit. */
    const edits = (changes: readonly (Located & { insert: string })[]) => {
      const out: Record<string, { range: ReturnType<typeof range>; newText: string }[]> = {}
      for (const c of changes) {
        const { uri, range: r } = loc(c)
        out[uri] = [...(out[uri] ?? []), { range: r, newText: c.insert }]
      }
      return { changes: out }
    }
    switch (method) {
      case 'textDocument/completion': {
        const c = completionsAcross(d.text, at, around(d, true))
        return {
          // an item that changes the text elsewhere (an edge) is asked for again on every key: its places move
          isIncomplete: c.options.some((o) => o.edits),
          items: c.options.map((o, i) => ({
            label: o.label,
            kind: KIND[o.type],
            detail: o.detail,
            documentation: o.info ? { kind: client.markdown ? 'markdown' : 'plaintext', value: o.info } : undefined,
            sortText: `${String(100 - (o.boost ?? 0)).padStart(3, '0')}${String(i).padStart(4, '0')}`,
            filterText: o.label,
            insertTextFormat: o.snippet && client.snippets ? 2 : 1,
            textEdit: { range: range(d, c.from, c.to), newText: text(o) },
            ...(o.edits && {
              additionalTextEdits: o.edits.map((e) => ({ range: range(d, e.from, e.to), newText: e.insert })),
            }),
          })),
        }
      }
      case 'textDocument/hover': {
        const r = result(d)
        const h = hoverAcross(d.text, at, around(d), r.definition ?? d.good)
        if (!h) return null
        const stale = !r.definition && d.good && h.body.length > (hoverAcross(d.text, at, around(d))?.body.length ?? 0)
        const lines = [...h.body, ...(stale ? ['Values from the last version without errors.'] : [])]
        return {
          contents: client.markdown
            ? { kind: 'markdown', value: `\`\`\`loadmap\n${h.head}\n\`\`\`\n\n${lines.join('\n\n')}` }
            : { kind: 'plaintext', value: [h.head, ...lines].join('\n\n') },
          range: range(d, h.from, h.to),
        }
      }
      case 'textDocument/signatureHelp': {
        const s = signatureHelp(d.text, at)
        if (!s) return null
        return {
          signatures: [{ label: s.label, documentation: s.doc, parameters: s.params.map((label) => ({ label })) }],
          activeSignature: 0,
          activeParameter: s.active,
        }
      }
      case 'textDocument/formatting': {
        const f = format(d.text)
        return f.ok && f.text !== d.text ? [{ range: range(d, 0, d.text.length), newText: f.text }] : []
      }
      case 'textDocument/codeAction': {
        const from = offsetAt(d, p.range.start)
        const to = offsetAt(d, p.range.end)
        // this document's own problems: one in another file is fixed there
        const list = problems(result(d)).filter((x) => x.file == null)
        const fixes = quickFixes(d.text, list)
        const here = place(d)
        return list.flatMap((diag, i) => {
          if (diag.to < from || diag.from > to) return []
          const own = fixes[i]!.map((f) => ({
            title: f.title,
            kind: 'quickfix',
            diagnostics: [toLsp(d, diag)],
            edit: {
              changes: { [d.uri]: f.changes.map((c) => ({ range: range(d, c.from, c.to), newText: c.insert })) },
            },
          }))
          const across: object[] = []
          // a line another file lacks: the part's "part of", the model's "include"
          if (here && diag.code === 'bad-file' && diag.data?.file != null && diag.data.line != null) {
            const other = here.docOf(diag.data.file)
            const end = other.text.indexOf('\n')
            const at = end < 0 ? other.text.length : end
            across.push({
              title: `Add ${diag.data.line} to ${diag.data.file}`,
              kind: 'quickfix',
              diagnostics: [toLsp(d, diag)],
              edit: { changes: { [other.uri]: [{ range: range(other, at, at), newText: `\n${diag.data.line}` }] } },
            })
          }
          // a name a library of the workspace declares: import it
          if (here && diag.code === 'unknown-name') {
            const name = d.text.slice(diag.from, diag.to)
            const lib = /^[A-Za-z_]\w*$/.test(name) ? libraryOf(name, around(d, true)) : undefined
            const change = lib && addImport(d.text, name, lib.path, around(d))
            if (lib && change)
              across.push({
                title: `Import "${name}" from ${relativePath(here.path, lib.path)}`,
                kind: 'quickfix',
                diagnostics: [toLsp(d, diag)],
                edit: {
                  changes: { [d.uri]: [{ range: range(d, change.from, change.to), newText: change.insert }] },
                },
              })
          }
          return [...own, ...across]
        })
      }
      case 'textDocument/definition': {
        const s = definitionAcross(d.text, at, around(d))
        return s ? loc(s) : null
      }
      case 'textDocument/references': {
        const decl = definitionAcross(d.text, at, around(d))
        const spans = referencesAcross(d.text, at, around(d)) ?? []
        const keep =
          p.context?.includeDeclaration === false
            ? spans.filter((s) => s.from !== decl?.from || s.file !== decl?.file)
            : spans
        return keep.map(loc)
      }
      case 'textDocument/documentHighlight':
        return (referencesAcross(d.text, at, around(d)) ?? [])
          .filter((s) => s.file == null)
          .map((s) => ({ range: range(d, s.from, s.to), kind: 1 }))
      case 'textDocument/prepareRename': {
        const s = referencesAcross(d.text, at, around(d))?.find((k) => k.file == null && k.from <= at && at <= k.to)
        return s ? { range: range(d, s.from, s.to), placeholder: d.text.slice(s.from, s.to) } : null
      }
      case 'textDocument/rename': {
        const out = renameAcross(d.text, at, p.newName, around(d))
        if ('error' in out) throw new Refused(out.error)
        // a library's name: every file that imports it keeps its own name for it
        const here = place(d)
        const old = out.changes.find((c) => c.file == null && c.from <= at && at <= c.to)
        const far =
          here && old && imports(d.text, here.path).role === 'library'
            ? importersOf(here.path, d.text.slice(old.from, old.to), p.newName, around(d, true))
            : []
        return edits([...out.changes, ...far])
      }
      case 'textDocument/documentSymbol':
        return outline(d)
      default:
        return NO_METHOD
    }
  }

  function open(uri: string, text: string, version: number) {
    const prev = docs.get(uri)
    clearTimeout(prev?.timer)
    const d: Doc = { uri, version, text, lines: lineStarts(text), good: prev?.good }
    docs.set(uri, d)
    if (!prev) listing++
    const file = fileOf(uri)
    if (file != null) byFile.set(file, d)
    epoch++
    // a model reads its parts and libraries, a part its model: every open document is checked again
    for (const other of docs.values()) schedule(other)
  }

  /**
   * The problems of a file that is not open, as every open document that reads it found them: two models that import
   * one library each say what they see in it, and neither takes the other's away.
   */
  function publishFor(uri: string) {
    if (docs.has(uri)) return
    const seen = new Set<string>()
    const diagnostics: object[] = []
    for (const lists of reported.values())
      for (const x of lists.get(uri) ?? []) {
        const key = JSON.stringify(x)
        if (!seen.has(key)) diagnostics.push(x)
        seen.add(key)
      }
    notify('textDocument/publishDiagnostics', { uri, diagnostics })
  }

  /** Checks a document after a pause in typing, as the editor's linter does. */
  function schedule(d: Doc) {
    clearTimeout(d.timer)
    d.timer = setTimeout(() => {
      if (docs.get(d.uri) !== d) return
      // compile never throws, but a server must outlive a bug: one lost check, not the editor's help
      try {
        const found = problems(result(d))
        notify('textDocument/publishDiagnostics', {
          uri: d.uri,
          version: d.version,
          diagnostics: found.filter((x) => x.file == null).map((x) => toLsp(d, x)),
        })
        // what it found in files that are not open: an open one is checked as itself
        const here = place(d)
        const theirs = new Map<string, { doc: Doc; list: Diagnostic[] }>()
        if (here)
          for (const x of found) {
            if (x.file == null) continue
            const doc = here.docOf(x.file)
            if (docs.get(doc.uri) === doc) continue
            const entry = theirs.get(doc.uri) ?? { doc, list: [] }
            entry.list.push(x)
            theirs.set(doc.uri, entry)
          }
        const before = [...(reported.get(d.uri)?.keys() ?? [])]
        reported.set(d.uri, new Map([...theirs].map(([uri, { doc, list }]) => [uri, list.map((x) => toLsp(doc, x))])))
        for (const uri of new Set([...before, ...theirs.keys()])) publishFor(uri)
      } catch {}
    }, delay)
  }

  /** What a completion inserts: its snippet, or for a client without snippets, the snippet's text with its fields filled by their names. */
  function text(o: Completion): string {
    if (!o.snippet) return o.apply ?? o.label
    return client.snippets
      ? o.snippet
      : o.snippet.replace(/\$\{\d+(?::([^}]*))?\}/g, (_, name: string | undefined) => name ?? '')
  }

  /** The compile of the text as it is, once per text. */
  function result(d: Doc): CompileResult {
    if (d.result?.text !== d.text || d.result.epoch !== epoch) {
      const here = place(d)
      d.result = { text: d.text, epoch, r: compile(d.text, here ? { path: here.path, files: here.files } : {}) }
    }
    const r = d.result.r
    if (r.definition) d.good = r.definition
    return r
  }

  return finished
}

/** A rename the dsl refuses: an error the client shows, not a fault. */
class Refused extends Error {}
const NO_METHOD = Symbol('no method')

function lineStarts(text: string): number[] {
  const out = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') out.push(i + 1)
  return out
}

function offsetAt(d: Doc, p: Position): number {
  const line = Math.min(Math.max(p.line, 0), d.lines.length - 1)
  const start = d.lines[line]!
  const end = line + 1 < d.lines.length ? d.lines[line + 1]! - 1 : d.text.length
  return Math.min(start + Math.max(p.character, 0), end)
}

function positionAt(d: Doc, offset: number): Position {
  let lo = 0
  let hi = d.lines.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (d.lines[mid]! <= offset) lo = mid
    else hi = mid - 1
  }
  return { line: lo, character: offset - d.lines[lo]! }
}

function range(d: Doc, from: number, to: number) {
  const end = d.text.length
  return { start: positionAt(d, Math.min(from, end)), end: positionAt(d, Math.min(Math.max(to, from), end)) }
}

function toLsp(d: Doc, x: Diagnostic) {
  return {
    range: range(d, x.from, x.to),
    severity: x.severity === 'error' ? 1 : 2,
    source: 'loadmap',
    code: x.code,
    message: x.hint ? `${x.message}: ${x.hint}` : x.message,
  }
}

/** The statements as an outline: what the definition declares, a box with its stages and component. */
function outline(d: Doc) {
  const symbol = (s: Decl): object | null => {
    const k = s.keyword.name
    // a metric's provider block is part of the metric, not a name of its own
    if (k === 'loadmap' || k === 'points' || SCHEMA.metric!.children.includes(k)) return null
    const first = s.args[0]
    const name = first?.t === 'id' ? first.name : first?.t === 'str' ? first.value : k
    const children = (BOXES as readonly string[]).includes(k)
      ? (s.body ?? [])
          .flatMap((c) =>
            c.kind === 'decl' &&
            (c.keyword.name === 'component' || (STAGES as readonly string[]).includes(c.keyword.name))
              ? [symbol(c)]
              : [],
          )
          .filter((c) => c != null)
      : []
    return {
      name,
      detail: name === k ? undefined : k,
      kind: SYMBOL[k] ?? ((STAGES as readonly string[]).includes(k) ? 6 : 8),
      range: range(d, s.from, s.to),
      selectionRange: range(d, first?.from ?? s.keyword.from, first?.to ?? s.keyword.to),
      ...(children.length ? { children } : {}),
    }
  }
  const { doc } = parse(d.text, new Reporter(d.text))
  return doc.body.flatMap((s) => (s.kind === 'decl' ? [symbol(s)] : [])).filter((s) => s != null)
}
