import { readFileSync } from 'node:fs'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { lsp } from '../src'

const cache = readFileSync(new URL('../../editor/src/templates/cache.loadmap', import.meta.url), 'utf8')
const uri = 'file:///work/cache.loadmap'

/** A client on the other end of the streams: frames requests, reads responses and notifications. */
function client() {
  const input = new PassThrough()
  const output = new PassThrough()
  const exit = lsp(input, output, 10)
  const pending = new Map<number, (m: any) => void>()
  const notes: any[] = []
  let waiters: (() => void)[] = []
  let buffer = Buffer.alloc(0)
  output.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk])
    for (;;) {
      const end = buffer.indexOf('\r\n\r\n')
      if (end < 0) return
      const length = Number(/Content-Length: (\d+)/.exec(buffer.subarray(0, end).toString())![1])
      if (buffer.length < end + 4 + length) return
      const m = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString('utf8'))
      buffer = buffer.subarray(end + 4 + length)
      if (m.id != null && pending.has(m.id)) pending.get(m.id)!(m)
      else notes.push(m)
      for (const w of waiters) w()
      waiters = []
    }
  })
  const write = (m: object) => {
    const json = JSON.stringify({ jsonrpc: '2.0', ...m })
    input.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`)
  }
  let id = 0
  const c = {
    exit,
    notes,
    request: (method: string, params: object = {}) =>
      new Promise<any>((resolve) => {
        pending.set(++id, resolve)
        write({ id, method, params })
      }),
    notify: (method: string, params: object = {}) => write({ method, params }),
    /** The next diagnostics published for `uri`. */
    diagnostics: async () => {
      for (;;) {
        const i = notes.findIndex((n) => n.method === 'textDocument/publishDiagnostics')
        if (i >= 0) return notes.splice(i, 1)[0].params
        await new Promise<void>((r) => waiters.push(r))
      }
    },
    end: () => input.end(),
  }
  return c
}

/** The protocol position of the character `k` into the first `needle` of `text`. */
function pos(text: string, needle: string, k = 0) {
  const i = text.indexOf(needle) + k
  const before = text.slice(0, i).split('\n')
  return { line: before.length - 1, character: before.at(-1)!.length }
}

let open: ReturnType<typeof client> | undefined
afterEach(() => open?.end())

async function started(text = cache, capabilities: object = {}) {
  const c = client()
  open = c
  const init = await c.request('initialize', { processId: null, rootUri: null, capabilities })
  c.notify('initialized')
  c.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'loadmap', version: 1, text } })
  return { c, init }
}

describe('loadmap lsp', () => {
  it('says what it can do, and publishes the errors after each change', async () => {
    const { c, init } = await started()
    expect(init.result.capabilities).toMatchObject({ hoverProvider: true, renameProvider: { prepareProvider: true } })
    expect((await c.diagnostics()).diagnostics).toEqual([])
    const broken = cache.replace('demand: flows.reads', 'demand: flows.read')
    c.notify('textDocument/didChange', { textDocument: { uri, version: 2 }, contentChanges: [{ text: broken }] })
    const d = await c.diagnostics()
    expect(d).toMatchObject({ uri, version: 2 })
    expect(d.diagnostics).toEqual([
      {
        range: { start: pos(broken, 'flows.read', 6), end: pos(broken, 'flows.read', 10) },
        severity: 1,
        source: 'loadmap',
        message: 'unknown flow "read": did you mean "reads"?',
      },
    ])
    // its fix, as a code action
    const actions = await c.request('textDocument/codeAction', {
      textDocument: { uri },
      range: d.diagnostics[0].range,
      context: { diagnostics: d.diagnostics },
    })
    expect(actions.result).toEqual([
      expect.objectContaining({
        title: 'Change to "reads"',
        kind: 'quickfix',
        edit: { changes: { [uri]: [{ range: d.diagnostics[0].range, newText: 'reads' }] } },
      }),
    ])
  })

  it('completes with snippets, ranked, replacing the word', async () => {
    const text = cache.replace('node db "Database" "primary" {', 'node db "Database" "primary" {\n  capacity: ')
    const { c } = await started(text)
    const r = await c.request('textDocument/completion', {
      textDocument: { uri },
      position: pos(text, 'capacity: \n', 10),
    })
    const items = [...r.result.items].sort((a: any, b: any) => a.sortText.localeCompare(b.sortText))
    expect(items[0]).toMatchObject({
      label: 'measured',
      kind: 3,
      insertTextFormat: 2,
      textEdit: { newText: 'measured(${1:value}, "${2:unit}", "${3:source}")${0}' },
    })
  })

  it('hovers with the values at the defaults, and names the arguments of a call', async () => {
    const { c } = await started()
    const h = await c.request('textDocument/hover', { textDocument: { uri }, position: pos(cache, 'flows.reads', 7) })
    expect(h.result.contents.value).toBe(
      '```loadmap\nflow reads "reads"\n```\n\n2,000 a second at the defaults (load 1×).\n\nRoute: api → cache → db.\n\nOne unit: read.',
    )
    expect(h.result.range).toEqual({ start: pos(cache, 'flows.reads', 6), end: pos(cache, 'flows.reads', 11) })
    const s = await c.request('textDocument/signatureHelp', {
      textDocument: { uri },
      position: pos(cache, '"queries/s"', 2),
    })
    expect(s.result).toMatchObject({ signatures: [{ label: 'estimated(value, unit, source)' }], activeParameter: 1 })
  })

  it('finds, highlights and renames names, and refuses a taken one', async () => {
    const { c } = await started()
    const at = { textDocument: { uri }, position: pos(cache, 'pods * 1', 1) }
    expect((await c.request('textDocument/definition', at)).result).toEqual({
      uri,
      range: { start: pos(cache, 'param pods', 6), end: pos(cache, 'param pods', 10) },
    })
    expect(
      (await c.request('textDocument/references', { ...at, context: { includeDeclaration: true } })).result,
    ).toHaveLength(4)
    expect(
      (await c.request('textDocument/references', { ...at, context: { includeDeclaration: false } })).result,
    ).toHaveLength(3)
    expect((await c.request('textDocument/documentHighlight', at)).result).toHaveLength(4)
    expect((await c.request('textDocument/prepareRename', at)).result).toMatchObject({ placeholder: 'pods' })
    const renamed = await c.request('textDocument/rename', { ...at, newName: 'apiPods' })
    expect(renamed.result.changes[uri]).toHaveLength(4)
    const taken = await c.request('textDocument/rename', { ...at, newName: 'hit' })
    expect(taken.error).toEqual({ code: -32803, message: '"hit" is taken' })
  })

  it('formats, and outlines what the definition declares', async () => {
    const messy = cache.replace(
      'load "Traffic, × today" { max: 50; default: 1 }',
      'load   "Traffic, × today"  {max:50;default:1}',
    )
    const { c } = await started(messy)
    const f = await c.request('textDocument/formatting', {
      textDocument: { uri },
      options: { tabSize: 2, insertSpaces: true },
    })
    expect(f.result).toHaveLength(1)
    expect(f.result[0].newText).toBe(cache)
    const symbols = (await c.request('textDocument/documentSymbol', { textDocument: { uri } })).result
    expect(symbols.map((s: any) => s.name)).toEqual(
      expect.arrayContaining(['pods', 'hit', 'Today', 'reads', 'clients', 'api', 'cache', 'db']),
    )
    expect(symbols.find((s: any) => s.name === 'db').children.map((s: any) => s.name)).toEqual(['store'])
  })

  it('counts positions in UTF-16 and frames in bytes, past text that is not ASCII', async () => {
    const text = cache
      .replace('# no demand line', '# no 🚦 démand line')
      .replace('title: "Cache in front of a database"', 'title: "Caché × 🗄️"')
    const { c } = await started(text)
    const d = await c.request('textDocument/definition', {
      textDocument: { uri },
      position: pos(text, 'at.db.reads', 3),
    })
    expect(d.result.range.start).toEqual(pos(text, 'node db', 5))
  })

  it('answers what it does not know with an error, and exits 0 after a shutdown', async () => {
    const { c } = await started()
    expect((await c.request('workspace/symbol', { query: '' })).error).toMatchObject({ code: -32601 })
    expect((await c.request('$/somethingNew')).error).toMatchObject({ code: -32601 })
    expect((await c.request('shutdown')).result).toBeNull()
    // after shutdown only exit
    expect(
      (await c.request('textDocument/hover', { textDocument: { uri }, position: { line: 0, character: 0 } })).error,
    ).toMatchObject({
      code: -32600,
    })
    c.notify('exit')
    expect(await c.exit).toBe(0)
  })

  it('sends plain text to a client that reads no snippets or Markdown', async () => {
    const text = cache.replace('node db "Database" "primary" {', 'node db "Database" "primary" {\n  capacity: ')
    const plain = {
      textDocument: {
        completion: { completionItem: { snippetSupport: false, documentationFormat: ['plaintext'] } },
        hover: { contentFormat: ['plaintext'] },
      },
    }
    const { c } = await started(text, plain)
    const r = await c.request('textDocument/completion', {
      textDocument: { uri },
      position: pos(text, 'capacity: \n', 10),
    })
    const measured = r.result.items.find((i: any) => i.label === 'measured')
    expect(measured).toMatchObject({ insertTextFormat: 1, textEdit: { newText: 'measured(value, "unit", "source")' } })
    expect(measured.documentation.kind).toBe('plaintext')
    const h = await c.request('textDocument/hover', { textDocument: { uri }, position: pos(text, 'flows.reads', 7) })
    expect(h.result.contents).toEqual({
      kind: 'plaintext',
      value: expect.stringMatching(/^flow reads "reads"\n\nRoute: /),
    })
  })

  it('exits 1 when its output breaks, instead of crashing', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const exit = lsp(input, output, 10)
    output.destroy(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))
    expect(await exit).toBe(1)
  })

  it('exits 1 when the client goes away without a shutdown', async () => {
    const { c } = await started()
    c.end()
    expect(await c.exit).toBe(1)
  })
})
