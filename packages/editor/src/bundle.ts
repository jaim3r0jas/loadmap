import { blobBody, commitBody, type History, treeOf } from './history'

/**
 * The history as a git bundle: one file `git clone` reads, with every commit of every branch, each branch a ref, and
 * HEAD the one the files are on. A pack (version 2) of the commits, their trees and their blobs, each deflated, after
 * the bundle's list of refs. Nothing leaves the page: the reader saves the file.
 */

const enc = new TextEncoder()
const TYPE = { commit: 1, tree: 2, blob: 3 } as const

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  // "deflate" is the zlib format git's objects are stored in
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** An object's header in a pack: its type and its size, seven bits at a time after the first four. */
function header(type: number, size: number): Uint8Array {
  const out: number[] = []
  let b = (type << 4) | (size & 15)
  let rest = size >>> 4
  while (rest) {
    out.push(b | 0x80)
    b = rest & 0x7f
    rest >>>= 7
  }
  out.push(b)
  return Uint8Array.from(out)
}

const be32 = (n: number) => Uint8Array.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255])

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/**
 * A branch's name as git takes it: letters, digits, "_" and "-" ("try 2" is "try-2"), never one already used (a second
 * "try-2" is "try-2-2").
 */
export function refName(name: string, used: Set<string>): string {
  const base = name.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'branch'
  let out = base
  for (let n = 2; used.has(out); n++) out = `${base}-${n}`
  used.add(out)
  return out
}

export async function bundle(h: History): Promise<Uint8Array> {
  const objects = new Map<string, { type: keyof typeof TYPE; body: Uint8Array }>()
  for (const c of h.commits.values()) {
    const files = h.filesOf(c)
    const t = await treeOf(files)
    for (const [id, body] of t.trees) objects.set(id, { type: 'tree', body })
    for (const [path, id] of Object.entries(t.blobs)) objects.set(id, { type: 'blob', body: blobBody(files[path]!) })
    objects.set(c.id, {
      type: 'commit',
      body: commitBody({ tree: c.tree, parent: c.parent, time: c.time, message: c.message }),
    })
  }
  const parts: Uint8Array[] = [enc.encode('PACK'), be32(2), be32(objects.size)]
  for (const o of objects.values()) parts.push(header(TYPE[o.type], o.body.length), await deflate(o.body))
  const pack = concat(parts)
  const sum = new Uint8Array(await crypto.subtle.digest('SHA-1', pack as BufferSource))
  const used = new Set<string>()
  const refs = [...h.branches.map((b) => `${b.head} refs/heads/${refName(b.name, used)}`), `${h.head.id} HEAD`]
  return concat([enc.encode(`# v2 git bundle\n${refs.join('\n')}\n\n`), pack, sum])
}
