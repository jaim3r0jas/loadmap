import { commands, type ExtensionContext, window, workspace } from 'vscode'
import { LanguageClient, type ServerOptions, TransportKind } from 'vscode-languageclient/node'
import { launch } from './launch'

let client: LanguageClient | undefined
/** Starts and restarts run one after another: two at once would leave a server nobody stops. */
let queue: Promise<void> = Promise.resolve()

/**
 * The language server for `.loadmap` files: the bundled `loadmap lsp` (or the command `loadmap.server.path` names),
 * started when the first one opens. A new path, or trust given to the workspace, starts it again.
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
  await restart()
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
