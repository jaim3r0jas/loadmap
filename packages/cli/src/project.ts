import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { type CompileOptions, gather, imports, loadCatalogFor } from '@loadmap/dsl'

/**
 * A definition on disk with the files it may name. The project root is the git checkout the file is in, else the
 * working directory, else the file's own folder; a path in a head starts from the file or from that root, and nothing
 * outside the root is ever read: `loadmap check` runs on pull requests, on text their author controls.
 */
export interface Project {
  root: string
  /** The file's own path from the root, with "/". */
  path: string
  /** A file of the project by its path from the root: undefined when there is none, or it is outside. */
  files(path: string): string | undefined
  /** Where a file of the project is on disk, as the terminal should show it. */
  shown(path: string): string
  /** What compile() takes. */
  options: Pick<CompileOptions, 'path' | 'files'>
}

/** The folder with `.git` above `from`, if any. */
function gitRoot(from: string): string | undefined {
  for (let dir = from; ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.git'))) return dir
    if (dirname(dir) === dir) return undefined
  }
}

const inside = (root: string, file: string) => file === root || file.startsWith(root.endsWith(sep) ? root : root + sep)

export function project(file: string, cwd = process.cwd()): Project {
  const abs = resolve(cwd, file)
  const git = gitRoot(dirname(abs))
  const root = git ?? (inside(resolve(cwd), abs) ? resolve(cwd) : dirname(abs))
  const path = relative(root, abs).split(sep).join('/')
  let real: string | undefined
  const cache = new Map<string, string | undefined>()
  const files = (p: string): string | undefined => {
    if (cache.has(p)) return cache.get(p)
    let text: string | undefined
    try {
      const at = join(root, ...p.split('/'))
      // a link that leads out of the project is a way out of it
      real ??= realpathSync(root)
      if (p.endsWith('.loadmap') && inside(real, realpathSync(at))) text = readFileSync(at, 'utf8')
    } catch {
      text = undefined
    }
    cache.set(p, text)
    return text
  }
  const shown = (p: string) => relative(cwd, join(root, ...p.split('/'))) || p
  return { root, path, files, shown, options: { path, files } }
}

/**
 * The files of a project as they are at a git ref: what the base of a pull request is compiled with, so a change is
 * compared with the base's own libraries. A file the ref does not have is not there.
 */
export function filesAt(p: Project, ref: string): (path: string) => string | undefined {
  const cache = new Map<string, string | undefined>()
  return (path) => {
    if (cache.has(path)) return cache.get(path)
    let text: string | undefined
    try {
      text = path.endsWith('.loadmap')
        ? execFileSync('git', ['show', `${ref}:./${path}`], {
            cwd: p.root,
            encoding: 'utf8',
            maxBuffer: 16 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'ignore'],
          })
        : undefined
    } catch {
      text = undefined
    }
    cache.set(path, text)
    return text
  }
}

/** The catalog, when the definition or any file it reaches names it: hosts load it before they compile. */
export async function loadCatalogForFiles(source: string, o: Pick<CompileOptions, 'path' | 'files'>) {
  for (const text of Object.values(gather(source, o).files)) await loadCatalogFor(text)
}

/** The model a part or a variant belongs to, from the project root; undefined for a model or a library. */
export function ownerOf(source: string, path: string): string | undefined {
  const head = imports(source, path)
  return head.files.find((f) => f.kind === 'part' || f.kind === 'extends')?.path
}
