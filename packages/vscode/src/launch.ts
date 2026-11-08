import { isAbsolute, join } from 'node:path'

/** How the client starts the server: the bundled one on VS Code's Node, or a `loadmap` command it runs with `lsp`. */
export type Launch = { module: string } | { command: string; args: string[]; cwd?: string }

/**
 * The bundled server unless `loadmap.server.path` names a command: a bare name (`loadmap`) is looked up on the PATH,
 * a relative path starts at the (first) workspace folder. A workspace nobody trusted always gets the bundled server:
 * its own settings are never read for this (`restrictedConfigurations`), and a path from the user's settings would
 * still run a program out of that workspace's folder.
 */
export function launch(
  setting: string | undefined,
  extension: string,
  folder: string | undefined,
  trusted: boolean,
): Launch {
  const path = setting?.trim()
  if (!path || !trusted) return { module: join(extension, 'dist', 'server.cjs') }
  const bare = !/[\\/]/.test(path)
  const command = bare || isAbsolute(path) || !folder ? path : join(folder, path)
  return { command, args: ['lsp'], ...(folder ? { cwd: folder } : {}) }
}
