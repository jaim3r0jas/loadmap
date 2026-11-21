import type { imports, Role, relativePath, resolvePath } from './files'
import type { parse } from './parser'

/**
 * The files of a definition as texts: a file added beside the model, renamed or removed, with the head lines that name
 * it. What these read of the language is handed in: the editor's explorer then imports nothing of the compiler itself,
 * and the pages that never show it keep their chunks as they were.
 */
export interface Dsl {
  imports: typeof imports
  resolvePath: typeof resolvePath
  relativePath: typeof relativePath
  /** For the subsystems each file declares. */
  parse: typeof parse
  MAX_FILES: number
  LANGUAGE_VERSION: string
}

/** A definition's files as the editor holds them: the path of its model and every file's text by its path. */
export interface FileSet {
  path: string
  files: Readonly<Record<string, string>>
}

/** What the explorer can add beside a model. */
export type NewKind = 'part' | 'library' | 'variant'

/**
 * One operation on the files, as the texts it leaves: all of it is text, so the compiler reads the result as it reads
 * anything typed. Paths are the ones before the rename.
 */
export interface FileChange {
  /** Files whose text changes: a head line written, rewritten or taken out. */
  texts?: Record<string, string>
  /** A new file. */
  add?: { path: string; text: string }
  rename?: { from: string; to: string }
  remove?: string
  /** What the editor says once it is done. */
  note: string
}

const nameOf = (path: string) => path.split('/').at(-1)!
const stem = (path: string) => path.replace(/\.loadmap$/, '')

/** What a file is, said in its head. */
export const roleOf = (dsl: Dsl, text: string, path: string): Role => dsl.imports(headOf(text), path).role

/**
 * A file's head as text: its first lines, up to the first that is no head line (the "loadmap" line, include, import
 * with its names, part of, library, extends), no comment and not empty. What a file is and the files it names are
 * all in there: a line further down that looks like one is the body's, and is left alone.
 */
export function headOf(text: string): string {
  let end = 0
  let inside = false
  for (const line of text.split('\n')) {
    if (!inside && !/^\s*($|#|(loadmap|include|import|extends|library|part\s+of)\b)/.test(line)) break
    for (const ch of line.replace(/"[^"]*"|#.*/g, '')) inside = ch === '{' ? true : ch === '}' ? false : inside
    end += line.length + 1
  }
  return text.slice(0, end)
}

/** A head line that names a file: what stands before the path, then the path as written. */
const NAMES = /^([ \t]*(?:include|import|extends|part[ \t]+of)[ \t]+)"([^"\n]*)"/gm

/**
 * The text of the file at `self` with the paths its head writes read again: `to` says where a named file is now, and
 * `selfNow` where this one is. A path keeps its way of writing (from this file, or from the root) and is left as it
 * is when nothing it says moved.
 */
function repath(dsl: Dsl, text: string, self: string, to: (target: string) => string, selfNow = self): string {
  const head = headOf(text)
  const paths = head.replace(NAMES, (line, before: string, written: string) => {
    const r = dsl.resolvePath(self, written)
    if ('error' in r) return line
    const target = to(r.path)
    const folder = (p: string) => p.split('/').slice(0, -1).join('/')
    if (target === r.path && folder(self) === folder(selfNow)) return line
    return `${before}"${written.startsWith('/') ? `/${target}` : dsl.relativePath(selfNow, target)}"`
  })
  return paths + text.slice(head.length)
}

/** The path a typed name stands for: "story", "lib/platform" or either with ".loadmap". */
export function pathFor(name: string): { path: string } | { error: string } {
  const parts = stem(name.trim()).split('/')
  if (parts.some((p) => !/^[\w-]+(\.[\w-]+)*$/.test(p)))
    return { error: 'A file name is letters, digits, ".", "-" and "_", with "/" between folders' }
  return { path: `${parts.join('/')}.loadmap` }
}

/** A new file beside the model, and for a part or a library the line in the model's head that names it. */
export function newFile(dsl: Dsl, all: FileSet, kind: NewKind, name: string): FileChange | { error: string } {
  const typed = name.trim()
  if (!/^[\w-]+$/.test(typed)) return { error: 'A file name is letters, digits, "-" and "_"' }
  if (Object.keys(all.files).length >= dsl.MAX_FILES)
    return { error: `A definition has at most ${dsl.MAX_FILES} files` }
  const folder = all.path.split('/').slice(0, -1)
  const base = stem(nameOf(all.path))
  const file = kind === 'library' ? `${typed}.loadmap` : `${base}.${typed}.loadmap`
  const path = [...folder, file].join('/')
  if (Object.hasOwn(all.files, path)) return { error: `There is a ${file} already` }
  const model = all.files[all.path] ?? ''
  const version = /^loadmap (\d+(?:\.\d+)?)/.exec(model)?.[1] ?? dsl.LANGUAGE_VERSION
  const text =
    kind === 'part'
      ? `loadmap ${version}\npart of "./${base}.loadmap"\n`
      : kind === 'variant'
        ? `loadmap ${version}\nextends "./${base}.loadmap"\n`
        : `loadmap ${dsl.LANGUAGE_VERSION}\nlibrary "${typed}"\n`
  // a variant names its model; the model never names its variants
  if (kind === 'variant') return { add: { path, text }, note: `Added ${file}` }
  const line = kind === 'part' ? `include "./${file}"` : `import "./${file}" { }`
  return {
    add: { path, text },
    texts: { [all.path]: underHead(model, line) },
    note: `Added ${file}`,
  }
}

/** A head line written under the model's last one: the "loadmap" line, then every include and import. */
export function underHead(model: string, line: string): string {
  const lines = model.split('\n')
  let last = 0
  for (let i = 1; i < lines.length; i++) {
    if (!/^(include|import)\b/.test(lines[i]!)) break
    while (
      i < lines.length - 1 &&
      lines[i]!.includes('{') &&
      !lines
        .slice(last + 1, i + 1)
        .join('')
        .includes('}')
    )
      i++
    last = i
  }
  const at = lines.slice(0, last + 1).join('\n').length
  return `${model.slice(0, at)}\n${line}${model.slice(at)}`
}

/** A file under another path: every include, import, part of and extends that names it follows, and its own paths. */
export function renameFile(dsl: Dsl, all: FileSet, from: string, name: string): FileChange | { error: string } {
  const next = pathFor(name)
  if ('error' in next) return next
  const to = next.path
  if (to === from) return { note: '' }
  if (Object.hasOwn(all.files, to)) return { error: `There is a ${to} already` }
  if (!Object.hasOwn(all.files, from)) return { error: `There is no ${from}` }
  const texts: Record<string, string> = {}
  for (const [p, text] of Object.entries(all.files)) {
    const now = repath(dsl, text, p, (t) => (t === from ? to : t), p === from ? to : p)
    if (now !== text) texts[p] = now
  }
  return {
    texts,
    rename: { from, to },
    note: `${nameOf(from)} is now ${nameOf(to) === nameOf(from) ? to : nameOf(to)}`,
  }
}

/**
 * A file taken out, with the lines that only named it: an include, and an import that takes nothing. An import with
 * names stays, an error where it is written: what it took has to go first, and only the reader knows how.
 */
export function removeFile(dsl: Dsl, all: FileSet, path: string): FileChange | { error: string } {
  if (path === all.path) return { error: 'The model stays: the diagram is drawn from it' }
  if (!Object.hasOwn(all.files, path)) return { error: `There is no ${path}` }
  const texts: Record<string, string> = {}
  const left: string[] = []
  for (const [p, text] of Object.entries(all.files)) {
    if (p === path) continue
    let now = text
    for (const m of [...headOf(text).matchAll(NAMES)].reverse()) {
      const r = dsl.resolvePath(p, m[2]!)
      if ('error' in r || r.path !== path) continue
      const start = m.index
      const after = now.slice(start + m[0].length)
      const kind = m[1]!.trim().split(/\s/)[0]
      const rest =
        kind === 'include' ? /^[ \t]*(?:#[^\n]*)?(?:\n|$)/.exec(after) : /^[ \t]*\{\s*\}[ \t]*(?:\n|$)/.exec(after)
      if ((kind === 'include' || kind === 'import') && rest)
        now = now.slice(0, start) + now.slice(start + m[0].length + rest[0].length)
      else if (!left.includes(nameOf(p))) left.push(nameOf(p))
    }
    if (now !== text) texts[p] = now
  }
  const name = nameOf(path)
  return {
    texts,
    remove: path,
    note: left.length ? `Removed ${name}; ${left.join(', ')} still names it` : `Removed ${name}`,
  }
}
