// Runs inside VS Code (the e2e harness, test/e2e/run.ts): the shipped extension, its bundled server, every feature
// through VS Code's own commands, as a user's editor reaches them.
import { strict as assert } from 'node:assert'
import { join } from 'node:path'
import { decodeShare } from '@loadmap/dsl'
import {
  CompletionItemKind,
  type CompletionList,
  commands,
  DiagnosticSeverity,
  type DocumentSymbol,
  env,
  extensions,
  type Hover,
  type Location,
  languages,
  type Position,
  Selection,
  type SignatureHelp,
  type TextDocument,
  type TextEdit,
  Uri,
  type WorkspaceEdit,
  window,
  workspace,
} from 'vscode'

const folder = workspace.workspaceFolders![0]!.uri.fsPath
const tests: [string, () => Promise<void>][] = []
const test = (name: string, f: () => Promise<void>) => tests.push([name, f])

/** Waits for `f` to give something, for at most `ms` (a server starting on a busy machine). */
async function until<T>(f: () => T | undefined | Promise<T | undefined>, what: string, ms = 20_000): Promise<T> {
  for (let waited = 0; ; waited += 100) {
    const v = await f()
    if (v !== undefined) return v
    if (waited > ms) throw new Error(`no ${what} after ${ms} ms`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

async function open(name: string): Promise<TextDocument> {
  const doc = await workspace.openTextDocument(Uri.file(join(folder, name)))
  await window.showTextDocument(doc)
  return doc
}

/** The position `k` characters into the first `needle` of the document. */
function at(doc: TextDocument, needle: string, k = 0): Position {
  const i = doc.getText().indexOf(needle)
  assert.ok(i >= 0, `"${needle}" is not in ${doc.fileName}`)
  return doc.positionAt(i + k)
}

/** Asks a provider until the server answers it (the first requests can come before it is up). */
const ask = <T>(command: string, ...args: unknown[]) =>
  until(async () => {
    const r = await commands.executeCommand<T>(command, ...args)
    return r == null || (Array.isArray(r) && r.length === 0) ? undefined : r
  }, command)

test('a .loadmap file is loadmap, and opening one starts the extension', async () => {
  const doc = await open('checkout.loadmap')
  assert.equal(doc.languageId, 'loadmap')
  await until(() => (extensions.getExtension('jaim3r0jas.loadmap')?.isActive ? true : undefined), 'activation')
})

/** Appends `text` to the document and waits for the server's diagnostics on it; the file is reverted after. */
async function diagnose(doc: TextDocument, text: string) {
  await window.activeTextEditor!.edit((e) => e.insert(doc.positionAt(doc.getText().length), text))
  try {
    return await until(() => {
      const d = languages.getDiagnostics(doc.uri).filter((x) => x.source === 'loadmap')
      return d.length ? d : undefined
    }, 'diagnostics')
  } finally {
    await commands.executeCommand('workbench.action.files.revert')
    await until(() => (languages.getDiagnostics(doc.uri).length ? undefined : true), 'diagnostics cleared')
  }
}

test('an error as you type', async () => {
  const doc = await open('checkout.loadmap')
  const list = await diagnose(doc, '\nnode broken { pass { volume: 5 } }\n')
  const error = list.find((d) => d.severity === DiagnosticSeverity.Error && d.message.includes('volume'))
  assert.ok(error, list.map((d) => d.message).join('\n'))
  assert.equal(error.range.start.line, doc.lineCount)
})

test('a failing expectation as a warning', async () => {
  const doc = await open('checkout.loadmap')
  const list = await diagnose(doc, '\nexpect "Keeps 1000×" { target: 1000 }\n')
  assert.ok(
    list.some((d) => d.severity === DiagnosticSeverity.Warning && d.message.includes('Keeps 1000×')),
    list.map((d) => d.message).join('\n'),
  )
})

test('completion from the server', async () => {
  const doc = await open('checkout.loadmap')
  const list = await ask<CompletionList>('vscode.executeCompletionItemProvider', doc.uri, at(doc, '{ max: 100', 2))
  const labels = list.items.filter((i) => i.kind === CompletionItemKind.Property).map((i) => i.label)
  assert.ok(labels.includes('step'), `properties offered: ${labels.join(', ')}`)
})

test('hover with what a name is', async () => {
  const doc = await open('checkout.loadmap')
  const hovers = await ask<Hover[]>('vscode.executeHoverProvider', doc.uri, at(doc, 'pods "Worker', 1))
  const text = hovers.flatMap((h) => h.contents.map((c) => (typeof c === 'string' ? c : c.value))).join('\n')
  assert.match(text, /param pods "Worker pods"/)
  assert.match(text, /2, 3, 4 or 6/)
})

test('the arguments of a call', async () => {
  const doc = await open('checkout.loadmap')
  const help = await ask<SignatureHelp>('vscode.executeSignatureHelpProvider', doc.uri, at(doc, 'estimated(', 10))
  assert.match(help.signatures[0]!.label, /^estimated\(/)
})

test('definition, references and rename', async () => {
  const doc = await open('checkout.loadmap')
  const use = at(doc, 'enabled: batch', 10)
  const defs = await ask<Location[]>('vscode.executeDefinitionProvider', doc.uri, use)
  assert.equal(defs[0]!.range.start.line, at(doc, 'param batch').line)
  const refs = await ask<Location[]>('vscode.executeReferenceProvider', doc.uri, use)
  assert.ok(refs.length >= 2)
  const edit = await ask<WorkspaceEdit>('vscode.executeDocumentRenameProvider', doc.uri, use, 'batched')
  assert.equal(edit.get(doc.uri).length, refs.length)
})

test('an outline of the declarations', async () => {
  const doc = await open('checkout.loadmap')
  const symbols = await ask<DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', doc.uri)
  const names = symbols.map((s) => s.name)
  for (const n of ['pods', 'gateway', 'Proposed']) assert.ok(names.includes(n), `${n} not in ${names.join(', ')}`)
})

test('Format Document lays it out as loadmap fmt does', async () => {
  const doc = await open('messy.loadmap')
  const edits = await ask<TextEdit[]>('vscode.executeFormatDocumentProvider', doc.uri, {
    tabSize: 2,
    insertSpaces: true,
  })
  // VS Code hands the whole-text edit back as the smallest changes: apply them
  await window.activeTextEditor!.edit((e) => {
    for (const x of edits) e.replace(x.range, x.newText)
  })
  assert.equal(doc.getText(), 'loadmap 1\nload "Users" { max: 10; default: 2 }\n')
})

test("loadmap.server.path runs a project's own loadmap, and a fixed path brings it back", async () => {
  const config = workspace.getConfiguration('loadmap')
  const doc = await open('checkout.loadmap')
  const hoverText = async () => {
    const hovers = await ask<Hover[]>('vscode.executeHoverProvider', doc.uri, at(doc, 'pods "Worker', 1))
    return hovers.flatMap((h) => h.contents.map((c) => (typeof c === 'string' ? c : c.value))).join('\n')
  }
  try {
    // a path to nothing: the extension says so instead of failing quietly
    await config.update('server.path', join(folder, 'no-such-loadmap'), true)
    await new Promise((r) => setTimeout(r, 1500))
    // the CLI's own command (built by pnpm build): the same help, from another process
    await config.update('server.path', process.env.LOADMAP_BIN, true)
    assert.match(await hoverText(), /param pods "Worker pods"/)
  } finally {
    await config.update('server.path', undefined, true)
  }
  assert.match(await hoverText(), /param pods "Worker pods"/)
})

/** What the preview shows, from the webview itself (the extension's API). */
const shown = () =>
  extensions
    .getExtension<{ preview: { shown(): Promise<{ boxes: string[]; selected: string | null } | undefined> } }>(
      'jaim3r0jas.loadmap',
    )!
    .exports.preview.shown()

test('the preview draws the file beside it, under its content security policy', async () => {
  await open('checkout.loadmap')
  await commands.executeCommand('loadmap.showPreviewToSide')
  const s = await until(
    async () => {
      const x = await shown()
      return x?.boxes.length ? x : undefined
    },
    'boxes drawn',
    30_000,
  )
  assert.deepEqual([...s.boxes].sort(), ['db', 'gateway', 'kafka', 'phones', 'workers'])
})

test('the cursor in a declaration picks its box; an edit is drawn', async () => {
  const doc = await open('checkout.loadmap')
  const editor = window.activeTextEditor!
  const p = at(doc, 'node db', 6)
  editor.selection = new Selection(p, p)
  await until(async () => ((await shown())?.selected === 'db' ? true : undefined), 'db selected')
  // a box added: the preview draws it after the pause
  await editor.edit((e) => e.insert(doc.positionAt(doc.getText().length), '\nnode extra "Extra"\n'))
  await until(async () => ((await shown())?.boxes.includes('extra') ? true : undefined), 'the new box drawn')
  await commands.executeCommand('workbench.action.files.revert')
})

test('Copy Share Link puts the text in a link to the live editor', async () => {
  const doc = await open('checkout.loadmap')
  await commands.executeCommand('loadmap.copyShareLink')
  const link = await env.clipboard.readText()
  assert.ok(link.startsWith('https://jaim3r0jas.github.io/loadmap/editor/#v1.'), link.slice(0, 80))
  const shared = await decodeShare(link.slice(link.indexOf('#')))
  assert.ok('source' in shared && shared.source === doc.getText())
})

export async function run() {
  const failed: string[] = []
  for (const [name, f] of tests) {
    try {
      await f()
      console.log(`  ✓ ${name}`)
    } catch (err) {
      console.log(`  ✗ ${name}\n${String((err as Error).stack ?? err).replace(/^/gm, '      ')}`)
      failed.push(name)
    }
  }
  if (failed.length) throw new Error(`${failed.length} of ${tests.length} failed: ${failed.join('; ')}`)
}
