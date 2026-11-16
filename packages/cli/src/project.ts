import { execFileSync } from 'node:child_process'
import { type Dirent, existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
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
  /** Where it is on disk, in full. */
  abs(path: string): string
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

export function project(file: string, cwd = process.cwd(), folder?: string): Project {
  const abs = resolve(cwd, file)
  // an editor's workspace folder is the root of what is in it; else the git checkout, the working directory, the folder
  const git = folder && inside(resolve(folder), abs) ? resolve(folder) : gitRoot(dirname(abs))
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
  const at = (p: string) => join(root, ...p.split('/'))
  return { root, path, files, shown, abs: at, options: { path, files } }
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

/** Every `.loadmap` file under a root, by its path from it: what an editor completes a path to. At most `max`. */
export function loadmapFiles(root: string, max = 2000): string[] {
  const out: string[] = []
  const walk = (dir: string, rel: string) => {
    let names: Dirent[]
    try {
      names = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const n of names) {
      if (out.length >= max) return
      if (n.isDirectory()) {
        if (n.name !== 'node_modules' && n.name !== 'dist' && !n.name.startsWith('.'))
          walk(join(dir, n.name), rel ? `${rel}/${n.name}` : n.name)
      } else if (n.name.endsWith('.loadmap')) out.push(rel ? `${rel}/${n.name}` : n.name)
    }
  }
  walk(root, '')
  return out.sort()
}

/** The catalog, when the definition or any file it reaches names it: hosts load it before they compile. */
export async function loadCatalogForFiles(source: string, o: Pick<CompileOptions, 'path' | 'files'>) {
  for (const text of Object.values(gather(source, o).files)) await loadCatalogFor(text)
}

/**
 * The model that includes a part, from the project root: a check of that model covers the part. Undefined for any
 * other file, and for a part its model does not include, which has its own mistake to report.
 */
export function ownerOf(source: string, path: string, files: (path: string) => string | undefined): string | undefined {
  const model = imports(source, path).files.find((f) => f.kind === 'part')?.path
  const text = model == null ? undefined : files(model)
  if (model == null || text == null) return undefined
  return imports(text, model).files.some((f) => f.kind === 'include' && f.path === path) ? model : undefined
}
