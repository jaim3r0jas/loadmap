import { encodeShare } from '@loadmap/dsl'
import {
  CodeAction,
  CodeActionKind,
  type CodeActionProvider,
  ConfigurationTarget,
  commands,
  type ExtensionContext,
  env,
  languages,
  Uri,
  window,
  workspace,
} from 'vscode'
import { LanguageClient, type ServerOptions, TransportKind } from 'vscode-languageclient/node'
import { addFromCatalog, boxAt, type Target } from './catalog'
import { launch } from './launch'
import { editorUrl } from './links'
import { Preview } from './preview'

let client: LanguageClient | undefined
/** Starts and restarts run one after another: two at once would leave a server nobody stops. */
let queue: Promise<void> = Promise.resolve()

/**
 * The language server for `.loadmap` files: the bundled `loadmap lsp` (or the command `loadmap.server.path` names),
 * started when the first one opens. A new path, or trust given to the workspace, starts it again. The preview (which
 * can track live changes), the links to the docs' editor, and Add from the catalog.
 */
export async function activate(context: ExtensionContext) {
  const restart = () => {
    queue = queue
      .then(async () => {
        const old = client
        client = undefined
        // a client that never started cannot stop either: the new one starts all the same
        await old?.stop().catch(() => {})
        await start(context)
      })
      .catch(() => {})
    return queue
  }
  context.subscriptions.push(
    commands.registerCommand('loadmap.restartServer', restart),
    workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('loadmap.server.path')) void restart()
    }),
    workspace.onDidGrantWorkspaceTrust(() => void restart()),
  )
  const preview = new Preview(context)
  const loadmapEditor = () => {
    const e = window.activeTextEditor
    if (e?.document.languageId === 'loadmap') return e.document
    void window.showInformationMessage('loadmap: open a .loadmap file first.')
    return undefined
  }
  /** The docs' editor with the text (and the preview's values) in the link's hash, which never reaches a server. */
  const link = async () => {
    const s = await preview.shared()
    if (!s) {
      void window.showInformationMessage('loadmap: open a .loadmap file first.')
      return undefined
    }
    const config = workspace.getConfiguration('loadmap')
    const set = config.get<string>('editorUrl')
    const url = editorUrl(set)
    if (set && !url)
      void window.showWarningMessage("loadmap.editorUrl is not an http(s) link: the docs' own editor opens.")
    const base = url ?? editorUrl(config.inspect<string>('editorUrl')?.defaultValue)!
    return `${base}#${await encodeShare(s.doc.getText(), s.values)}`
  }
  context.subscriptions.push(
    commands.registerCommand('loadmap.showPreview', () => {
      const doc = loadmapEditor()
      if (doc) preview.show(doc, false)
    }),
    commands.registerCommand('loadmap.showPreviewToSide', () => {
      const doc = loadmapEditor()
      if (doc) preview.show(doc, true)
    }),
    commands.registerCommand('loadmap.copyShareLink', async () => {
      const url = await link()
      if (!url) return
      await env.clipboard.writeText(url)
      void window.showInformationMessage('loadmap: the link is on the clipboard. It holds the whole text.')
    }),
    commands.registerCommand('loadmap.openInEditor', async () => {
      const url = await link()
      if (url) await env.openExternal(Uri.parse(url))
    }),
    commands.registerCommand('loadmap.trackChanges', () => track(true)),
    commands.registerCommand('loadmap.stopTrackingChanges', () => track(false)),
    // from a code action: the document and the box; else the cursor's box in the editor, or the preview's selection
    commands.registerCommand('loadmap.addFromCatalog', async (at?: { uri: string; box: string }) => {
      const e = window.activeTextEditor
      const doc = at
        ? workspace.textDocuments.find((d) => d.uri.toString() === at.uri)
        : e?.document.languageId === 'loadmap'
          ? e.document
          : undefined
      const target: Target | undefined = doc
        ? { doc, box: at?.box ?? boxAt(doc, doc.offsetAt(e!.selection.active)) }
        : await preview.target()
      if (target) await addFromCatalog(target)
      else void window.showInformationMessage('loadmap: open a .loadmap file first.')
    }),
    languages.registerCodeActionsProvider('loadmap', catalogAction, {
      providedCodeActionKinds: [CodeActionKind.RefactorRewrite],
    }),
  )
  await restart()
  // for tests and other extensions: what the preview shows
  return { preview: { shown: () => preview.shown(), tracked: () => preview.tracked } }
}

/** Track live changes on or off, where the setting is set: a workspace's own value wins over the user's. */
function track(on: boolean) {
  const config = workspace.getConfiguration('loadmap')
  const inWorkspace = config.inspect<boolean>('preview.trackChanges')?.workspaceValue !== undefined
  return config.update(
    'preview.trackChanges',
    on,
    inWorkspace ? ConfigurationTarget.Workspace : ConfigurationTarget.Global,
  )
}

/** In a box's declaration: its capacity from a published figure, through Add from the catalog. */
const catalogAction: CodeActionProvider = {
  provideCodeActions(doc, range) {
    const box = boxAt(doc, doc.offsetAt(range.start))
    if (!box) return []
    const action = new CodeAction(`Use a published figure for ${box}…`, CodeActionKind.RefactorRewrite)
    action.command = {
      command: 'loadmap.addFromCatalog',
      title: action.title,
      arguments: [{ uri: doc.uri.toString(), box }],
    }
    return [action]
  },
}

async function start(context: ExtensionContext) {
  const l = launch(
    workspace.getConfiguration('loadmap').get<string>('server.path'),
    context.extensionPath,
    workspace.workspaceFolders?.[0]?.uri.fsPath,
    workspace.isTrusted,
  )
  const server: ServerOptions =
    'module' in l
      ? { module: l.module, transport: TransportKind.stdio }
      : // a `.cmd` shim (node_modules/.bin on Windows) only starts through the shell, which splits an unquoted path
        process.platform === 'win32'
        ? { command: `"${l.command}"`, args: l.args, options: { cwd: l.cwd, shell: true } }
        : { command: l.command, args: l.args, options: { cwd: l.cwd } }
  const c = new LanguageClient('loadmap', 'loadmap', server, { documentSelector: [{ language: 'loadmap' }] })
  client = c
  try {
    await c.start()
  } catch (err) {
    const what = 'command' in l ? `"${l.command} lsp" (loadmap.server.path)` : 'the bundled server'
    void window.showErrorMessage(`loadmap: ${what} did not start: ${err instanceof Error ? err.message : err}`)
  }
}

export async function deactivate() {
  await queue
  await client?.stop()
}
