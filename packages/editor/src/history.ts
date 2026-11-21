/**
 * The history of a definition's files while it is edited: every version a commit, as git writes one (blobs, trees,
 * commits, hashed as git hashes them), held in memory and nowhere else unless the host keeps it. Back and forward step
 * along a branch, a restore is a new commit with old files (nothing is rewritten), and a branch tries another design
 * from any version. A save pushes the commits, or a bundle carries them: the ids are git's.
 */

/** Who made a version: the reader's own edits, the assistant's accepted proposal, a restore, or where the files came from. */
export type Author = 'you' | 'assistant' | 'opened' | 'restore'

/** What the assistant's commit keeps of how it was made: the trace. */
export interface Trace {
  request: string
  /** The box or flows that were selected. */
  selection?: string
  model: string
  /** The answer's operations, one a line as the model wrote them, or the files it wrote whole. */
  operations: string[]
  notes: string[]
  /** Tokens in, cached, out. */
  usage?: { input: number; output: number; cached?: number }
}

export interface Commit {
  id: string
  parent: string | null
  tree: string
  /** Every file by its path, as the blob ids hold them. */
  files: Readonly<Record<string, string>>
  /** The path of the model the diagram is drawn from. */
  entry: string
  author: Author
  message: string
  /** Seconds since 1970, as git counts them. */
  time: number
  trace?: Trace
}

export interface Branch {
  name: string
  head: string
}

/** The whole store, as plain data: what a host keeps between reloads. */
export interface HistoryData {
  version: 1
  /** Blob id → text. */
  blobs: Record<string, string>
  commits: Record<string, Omit<Commit, 'files'> & { files: Record<string, string> }>
  branches: Branch[]
  /** The branch the files are on. */
  branch: string
}

const enc = new TextEncoder()

async function sha1(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-1', bytes as BufferSource)
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** An object as git stores it: its type, its length, a NUL, its bytes. */
export function gitObject(type: 'blob' | 'tree' | 'commit', body: Uint8Array): Uint8Array {
  return concat([enc.encode(`${type} ${body.length}\0`), body])
}

export const blobBody = (text: string) => enc.encode(text)

const hexBytes = (hex: string) => Uint8Array.from(hex.match(/../g)!.map((h) => Number.parseInt(h, 16)))

/** A tree's body: its entries sorted as git sorts them (a folder as if its name ended in "/"). */
export function treeBody(entries: readonly { name: string; mode: '100644' | '40000'; id: string }[]): Uint8Array {
  const key = (e: { name: string; mode: string }) => (e.mode === '40000' ? `${e.name}/` : e.name)
  const sorted = [...entries].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))
  return concat(sorted.flatMap((e) => [enc.encode(`${e.mode} ${e.name}\0`), hexBytes(e.id)]))
}

/** The identity commits are written with: the editor, never the reader's name or address. */
export const IDENTITY = 'loadmap editor <editor@loadmap.invalid>'

export function commitBody(c: { tree: string; parent: string | null; time: number; message: string }): Uint8Array {
  const who = `${IDENTITY} ${c.time} +0000`
  const lines = [
    `tree ${c.tree}`,
    ...(c.parent ? [`parent ${c.parent}`] : []),
    `author ${who}`,
    `committer ${who}`,
    '',
    c.message,
  ]
  return enc.encode(`${lines.join('\n')}${c.message.endsWith('\n') ? '' : '\n'}`)
}

/** The ids of every blob and tree of a set of files, the root tree's last, with each tree's body for a bundle. */
export async function treeOf(files: Readonly<Record<string, string>>): Promise<{
  root: string
  blobs: Record<string, string>
  trees: Map<string, Uint8Array>
}> {
  const blobs: Record<string, string> = {}
  const trees = new Map<string, Uint8Array>()
  type Dir = { files: Map<string, string>; dirs: Map<string, Dir> }
  const top: Dir = { files: new Map(), dirs: new Map() }
  for (const [path, text] of Object.entries(files)) {
    const id = await sha1(gitObject('blob', blobBody(text)))
    blobs[path] = id
    const parts = path.split('/')
    let d = top
    for (const p of parts.slice(0, -1)) {
      if (!d.dirs.has(p)) d.dirs.set(p, { files: new Map(), dirs: new Map() })
      d = d.dirs.get(p)!
    }
    d.files.set(parts.at(-1)!, id)
  }
  const write = async (d: Dir): Promise<string> => {
    const entries: { name: string; mode: '100644' | '40000'; id: string }[] = []
    for (const [name, id] of d.files) entries.push({ name, mode: '100644', id })
    for (const [name, sub] of d.dirs) entries.push({ name, mode: '40000', id: await write(sub) })
    const body = treeBody(entries)
    const id = await sha1(gitObject('tree', body))
    trees.set(id, body)
    return id
  }
  return { root: await write(top), blobs, trees }
}

/** A line of the message: the request's first line, cut at 72 characters. */
export function subject(text: string): string {
  const line = text.split('\n')[0]!.trim()
  return line.length > 72 ? `${line.slice(0, 71)}…` : line
}

export class History {
  blobs = new Map<string, string>()
  commits = new Map<string, Commit>()
  branches: Branch[] = []
  branch = 'main'

  constructor(private clock: () => number = () => Math.floor(Date.now() / 1000)) {}

  /** A history that starts from these files: one commit, "Opened". */
  static async start(
    files: Readonly<Record<string, string>>,
    entry: string,
    o: { message?: string; clock?: () => number } = {},
  ) {
    const h = new History(o.clock)
    const first = await h.make(files, entry, null, 'opened', o.message ?? 'Opened')
    h.branches = [{ name: 'main', head: first.id }]
    return h
  }

  /** The commit the branch is at. */
  get head(): Commit {
    const b = this.branches.find((x) => x.name === this.branch)!
    return this.commits.get(b.head)!
  }

  private async make(
    files: Readonly<Record<string, string>>,
    entry: string,
    parent: string | null,
    author: Author,
    message: string,
    trace?: Trace,
  ): Promise<Commit> {
    const t = await treeOf(files)
    for (const [path, id] of Object.entries(t.blobs)) this.blobs.set(id, files[path]!)
    const time = this.clock()
    const id = await sha1(gitObject('commit', commitBody({ tree: t.root, parent, time, message })))
    const c: Commit = {
      id,
      parent,
      tree: t.root,
      files: t.blobs,
      entry,
      author,
      message,
      time,
      ...(trace && { trace }),
    }
    this.commits.set(id, c)
    return c
  }

  /** The files a commit holds. */
  filesOf(c: Commit): Record<string, string> {
    return Object.fromEntries(Object.entries(c.files).map(([p, id]) => [p, this.blobs.get(id)!]))
  }

  /** Whether these files are the head's. */
  same(files: Readonly<Record<string, string>>): boolean {
    const now = this.filesOf(this.head)
    const a = Object.keys(files)
    return a.length === Object.keys(now).length && a.every((p) => now[p] === files[p])
  }

  /** The commits asked for, one after the other: two at once would take the same parent. */
  private queue: Promise<unknown> = Promise.resolve()

  /**
   * A new version on the branch: none when the files are the head's. The reader's own edits are committed this way
   * before the assistant's lands, so the assistant's commit holds only what it did. Commits are made in the order
   * they are asked for, each on the one before.
   */
  commit(
    files: Readonly<Record<string, string>>,
    entry: string,
    author: Author,
    message: string,
    trace?: Trace,
  ): Promise<Commit | null> {
    const next = this.queue.then(async () => {
      if (this.same(files) && this.head.entry === entry) return null
      const c = await this.make(files, entry, this.head.id, author, message, trace)
      this.branches = this.branches.map((b) => (b.name === this.branch ? { ...b, head: c.id } : b))
      return c
    })
    this.queue = next.catch(() => undefined)
    return next
  }

  /** The commits of the branch, newest first. */
  line(branch = this.branch): Commit[] {
    const out: Commit[] = []
    for (
      let c = this.commits.get(this.branches.find((b) => b.name === branch)?.head ?? '');
      c;
      c = c.parent ? this.commits.get(c.parent) : undefined
    )
      out.push(c)
    return out
  }

  /** The files of an older version, as a new commit on top: nothing is rewritten. */
  async restore(id: string): Promise<Commit | null> {
    const c = this.commits.get(id)
    if (!c) return null
    return this.commit(this.filesOf(c), c.entry, 'restore', `Restored "${subject(c.message)}"`)
  }

  /** A new branch from a version, and the files on it. Its name is free: "try 2", "try 3", … */
  branchFrom(id: string, name?: string): Branch | null {
    if (!this.commits.has(id)) return null
    let n = name?.trim() || ''
    for (let k = 2; !n || this.branches.some((b) => b.name === n); k++) n = `try ${k}`
    const b = { name: n, head: id }
    this.branches = [...this.branches, b]
    this.branch = n
    return b
  }

  /** Another branch, its head's files the ones to show. */
  switchTo(name: string): Commit | null {
    if (!this.branches.some((b) => b.name === name)) return null
    this.branch = name
    return this.head
  }

  /** The commit before (`-1`) or after (`+1`) one, on the branch. */
  step(id: string, by: -1 | 1): Commit | null {
    const line = this.line()
    const i = line.findIndex((c) => c.id === id)
    if (i < 0) return null
    return line[i - by] ?? null
  }

  /** The commit that last changed a file, from the branch's head: the trace of a line starts there. */
  lastChanged(path: string): Commit | null {
    const line = this.line()
    for (let i = 0; i < line.length; i++) {
      const c = line[i]!
      const before = line[i + 1]
      if (!before || before.files[path] !== c.files[path]) return c
    }
    return null
  }

  /**
   * An editor's history: read back from the tab's storage under `key`, else started from the files; the files as they
   * are now a version on top when they changed since.
   */
  static async open(f: { path: string; files: Readonly<Record<string, string>> }, key?: string): Promise<History> {
    let saved: unknown = null
    try {
      saved = key ? JSON.parse(sessionStorage.getItem(key) ?? 'null') : null
    } catch {
      saved = null
    }
    const h = History.fromData(saved) ?? (await History.start(f.files, f.path))
    await h.commit(f.files, f.path, 'you', 'Edited')
    return h
  }

  /** Mirrored to the tab's storage under `key`; a full or blocked storage keeps it for this page only. */
  keep(key?: string): void {
    if (!key) return
    try {
      sessionStorage.setItem(key, JSON.stringify(this.toData()))
    } catch {
      // kept in memory alone
    }
  }

  toData(): HistoryData {
    const blobs: Record<string, string> = {}
    for (const [id, t] of this.blobs) blobs[id] = t
    const commits: HistoryData['commits'] = {}
    for (const [id, c] of this.commits) commits[id] = { ...c, files: { ...c.files } }
    return { version: 1, blobs, commits, branches: this.branches, branch: this.branch }
  }

  /** A store read back; anything that does not hold together is refused (undefined), never half read. */
  static fromData(d: unknown, clock?: () => number): History | undefined {
    if (typeof d !== 'object' || d === null) return undefined
    const x = d as Partial<HistoryData>
    if (x.version !== 1 || typeof x.blobs !== 'object' || !x.blobs || typeof x.commits !== 'object' || !x.commits)
      return undefined
    if (!Array.isArray(x.branches) || typeof x.branch !== 'string') return undefined
    const h = new History(clock)
    for (const [id, t] of Object.entries(x.blobs)) {
      if (typeof t !== 'string') return undefined
      h.blobs.set(id, t)
    }
    const AUTHORS = new Set(['you', 'assistant', 'opened', 'restore'])
    const text = (v: unknown) => typeof v === 'string'
    for (const [id, c] of Object.entries(x.commits)) {
      const ok =
        c &&
        typeof c === 'object' &&
        c.id === id &&
        text(c.tree) &&
        text(c.entry) &&
        text(c.message) &&
        typeof c.time === 'number' &&
        AUTHORS.has(c.author) &&
        (c.parent === null || text(c.parent)) &&
        typeof c.files === 'object' &&
        c.files !== null &&
        Object.values(c.files).every((b) => typeof b === 'string' && h.blobs.has(b))
      if (!ok) return undefined
      h.commits.set(id, c as Commit)
    }
    // every parent is there: a line can be walked to its start
    for (const c of h.commits.values()) if (c.parent !== null && !h.commits.has(c.parent)) return undefined
    const branches = x.branches.filter(
      (b): b is Branch => !!b && typeof b === 'object' && text(b.name) && text(b.head) && h.commits.has(b.head),
    )
    if (branches.length !== x.branches.length || !branches.length) return undefined
    h.branches = branches
    h.branch = branches.some((b) => b.name === x.branch) ? x.branch : branches[0]!.name
    return h
  }
}
