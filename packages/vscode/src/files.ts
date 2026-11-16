import { readFileSync, realpathSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { gather } from '@loadmap/dsl'
import { type TextDocument, workspace } from 'vscode'

/** A document's place among the files of its definition: its own path and every file the definition reaches. */
export interface Bundle {
  /** The document's own path, from the root. */
  self: string
  /** The file to open: the model, also when the document is one of its parts. */
  path: string
  /** Every file by its path from the root, the document's own text included. */
  files: Record<string, string>
  /** Where a file of the bundle is on disk. */
  fsPath(path: string): string
}

const inside = (root: string, file: string) => file === root || file.startsWith(root.endsWith(sep) ? root : root + sep)

/**
 * The files a `.loadmap` document names, read as the editor has them: an open document before the disk. The root is
 * the workspace folder the document is in, else its own folder; nothing outside it is read. Undefined for a document
 * that is no file (an untitled one): it is read alone.
 */
export function bundleOf(doc: TextDocument): Bundle | undefined {
  if (doc.uri.scheme !== 'file') return undefined
  const file = doc.uri.fsPath
  const folder = workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath
  const root = folder && inside(folder, file) ? folder : dirname(file)
  const self = relative(root, file).split(sep).join('/')
  const fsPath = (path: string) => join(root, ...path.split('/'))
  let real: string | undefined
  const files = (path: string): string | undefined => {
    const at = fsPath(path)
    const open = workspace.textDocuments.find((d) => d.uri.scheme === 'file' && d.uri.fsPath === at)
    if (open) return open.getText()
    try {
      // a link that leads out of the folder is a way out of it
      real ??= realpathSync(root)
      return path.endsWith('.loadmap') && inside(real, realpathSync(at)) ? readFileSync(at, 'utf8') : undefined
    } catch {
      return undefined
    }
  }
  const g = gather(doc.getText(), { path: self, files })
  return { self, path: g.path, files: g.files, fsPath }
}
