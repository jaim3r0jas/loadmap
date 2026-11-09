import type { Readable, Writable } from 'node:stream'
import {
  type CompileResult,
  type Completion,
  compile,
  completions,
  type Definition,
  type Diagnostic,
  definition,
  format,
  hover,
  loadCatalog,
  problems,
  quickFixes,
  references,
  rename,
  type Span,
  signatureHelp,
} from '@loadmap/dsl'
import { BOXES, type Decl, parse, Reporter, STAGES } from '@loadmap/dsl/internal'

/**
 * `loadmap lsp`: the language server protocol over standard input and output, for any editor that speaks it. The
 * help is the editor's own, from @loadmap/dsl: errors and failing expectations, completion, hover with the values at
 * the defaults, signature help, formatting, quick fixes, definition, references, rename and an outline. One file at a
 * time, the whole text on each change; nothing but Node.
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
  result?: { text: string; r: CompileResult }
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
  completionProvider: { triggerCharacters: ['.', ':', '>', '(', ',', '"'] },
  hoverProvider: true,
  signatureHelpProvider: { triggerCharacters: ['(', ','] },
  definitionProvider: true,
  referencesProvider: true,
  documentHighlightProvider: true,
  documentSymbolProvider: true,
  documentFormattingProvider: true,
  codeActionProvider: { codeActionKinds: ['quickfix'] },
  renameProvider: { prepareProvider: true },
}

/** Serves until the client says exit (or goes away); resolves to the exit code: 0 after a shutdown, else 1. */
export function lsp(input: Readable = process.stdin, output: Writable = process.stdout, delay = 150): Promise<number> {
  const docs = new Map<string, Doc>()
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

  function receive(m: Message) {
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
        return { capabilities: CAPABILITIES, serverInfo: { name: 'loadmap' } }
      }
      case 'initialized':
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
        notify('textDocument/publishDiagnostics', { uri: p.textDocument.uri, diagnostics: [] })
        return undefined
      }
    }
    if (!method.startsWith('textDocument/')) return NO_METHOD
    const d = docs.get(p.textDocument?.uri)
    if (!d) return null
    const at = p.position ? offsetAt(d, p.position) : 0
    const loc = (s: Span) => ({ uri: d.uri, range: range(d, s.from, s.to) })
    switch (method) {
      case 'textDocument/completion': {
        const c = completions(d.text, at)
        return {
          isIncomplete: false,
          items: c.options.map((o, i) => ({
            label: o.label,
            kind: KIND[o.type],
            detail: o.detail,
            documentation: o.info ? { kind: client.markdown ? 'markdown' : 'plaintext', value: o.info } : undefined,
            sortText: `${String(100 - (o.boost ?? 0)).padStart(3, '0')}${String(i).padStart(4, '0')}`,
            filterText: o.label,
            insertTextFormat: o.snippet && client.snippets ? 2 : 1,
            textEdit: { range: range(d, c.from, c.to), newText: text(o) },
          })),
        }
      }
      case 'textDocument/hover': {
        const r = result(d)
        const h = hover(d.text, at, r.definition ?? d.good)
        if (!h) return null
        const stale = !r.definition && d.good && h.body.length > (hover(d.text, at)?.body.length ?? 0)
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
        const list = problems(result(d))
        const fixes = quickFixes(d.text, list)
        return list.flatMap((diag, i) =>
          diag.to < from || diag.from > to
            ? []
            : fixes[i]!.map((f) => ({
                title: f.title,
                kind: 'quickfix',
                diagnostics: [toLsp(d, diag)],
                edit: {
                  changes: { [d.uri]: f.changes.map((c) => ({ range: range(d, c.from, c.to), newText: c.insert })) },
                },
              })),
        )
      }
      case 'textDocument/definition': {
        const s = definition(d.text, at)
        return s ? loc(s) : null
      }
      case 'textDocument/references': {
        const decl = definition(d.text, at)
        const spans = references(d.text, at) ?? []
        const keep = p.context?.includeDeclaration === false ? spans.filter((s) => s.from !== decl?.from) : spans
        return keep.map(loc)
      }
      case 'textDocument/documentHighlight':
        return (references(d.text, at) ?? []).map((s) => ({ range: range(d, s.from, s.to), kind: 1 }))
      case 'textDocument/prepareRename': {
        const s = references(d.text, at)?.find((k) => k.from <= at && at <= k.to)
        return s ? { range: range(d, s.from, s.to), placeholder: d.text.slice(s.from, s.to) } : null
      }
      case 'textDocument/rename': {
        const out = rename(d.text, at, p.newName)
        if ('error' in out) throw new Refused(out.error)
        return { changes: { [d.uri]: out.changes.map((c) => ({ range: range(d, c.from, c.to), newText: c.insert })) } }
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
    // after a pause in typing, as the editor's linter does
    d.timer = setTimeout(() => {
      if (docs.get(uri) !== d) return
      // compile never throws, but a server must outlive a bug: one lost check, not the editor's help
      try {
        notify('textDocument/publishDiagnostics', {
          uri,
          version: d.version,
          diagnostics: problems(result(d)).map((x) => toLsp(d, x)),
        })
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
    if (d.result?.text !== d.text) d.result = { text: d.text, r: compile(d.text) }
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
    message: x.hint ? `${x.message}: ${x.hint}` : x.message,
  }
}

/** The statements as an outline: what the definition declares, a box with its stages and component. */
function outline(d: Doc) {
  const symbol = (s: Decl): object | null => {
    const k = s.keyword.name
    if (k === 'loadmap' || k === 'points') return null
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
