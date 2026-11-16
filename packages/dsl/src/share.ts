import type { Model, ParamValue, Values } from '@loadmap/core'

/**
 * A definition in a link: `#v1.` + base64url(deflate-raw(source)), then the values that differ from the defaults
 * (`&load=30&pods=6`). The hash never reaches a server, and the source carries its own language version, so old links
 * keep opening. Compression is the platform's CompressionStream: no dependency.
 *
 * A definition in several files is `#v2.` + base64url(deflate-raw(JSON)), the JSON being `{ entry, files }`: the path
 * of the file to open and every file by its path. One file keeps making `#v1.`, which every page already out there
 * reads.
 */
const PREFIX = 'v1.'
const PREFIX_FILES = 'v2.'
/** As many files as a definition may have (files.ts): said again here, so reading a link does not load the parser. */
const MAX_FILES = 64
/** A path from the project root, as the compiler looks files up: no "./", no "..", no empty part. */
const isPath = (p: string) =>
  p.endsWith('.loadmap') && !p.includes('\\') && p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..')

/** The files of a definition: the one to open, and each by its path from the project root. */
export interface SharedFiles {
  path: string
  files: Readonly<Record<string, string>>
}

/** A link is refused when its source would unpack to more than this: a small link must not fill the memory. */
export const MAX_SHARED_BYTES = 1_000_000

export async function encodeShare(
  source: string,
  values: Readonly<Record<string, ParamValue>> = {},
  bundle?: SharedFiles,
): Promise<string> {
  const others = bundle ? Object.keys(bundle.files).filter((p) => p !== bundle.path) : []
  const text = others.length
    ? JSON.stringify({ entry: bundle!.path, files: { ...bundle!.files, [bundle!.path]: source } })
    : source
  const packed = await pipe(new TextEncoder().encode(text), new CompressionStream('deflate-raw'))
  const rest = new URLSearchParams(Object.entries(values).map(([k, v]) => [k, String(v)])).toString()
  return `${others.length ? PREFIX_FILES : PREFIX}${base64url(packed)}${rest ? `&${rest}` : ''}`
}

/**
 * `values` are the texts the link holds: only the model knows whether "20" is a number or the option "20", so the
 * page reads them by each parameter's kind.
 */
export type Shared =
  | {
      source: string
      values: Record<string, string>
      /** For a definition in several files: the path of `source`, and every file of the link by its path. */
      path?: string
      files?: Record<string, string>
    }
  | { error: string }

/** Reads a link's hash (with or without its "#"). Never throws: a broken link gives `{ error }`. */
export async function decodeShare(hash: string): Promise<Shared> {
  const h = hash.replace(/^#/, '')
  const amp = h.indexOf('&')
  const head = amp < 0 ? h : h.slice(0, amp)
  const several = head.startsWith(PREFIX_FILES)
  if (!several && !head.startsWith(PREFIX)) return { error: 'this link holds no loadmap definition' }
  let bytes: Uint8Array
  try {
    bytes = unbase64url(head.slice(PREFIX.length))
  } catch {
    return { error: 'this link is cut or garbled' }
  }
  let source: string
  try {
    const raw = await pipe(bytes, new DecompressionStream('deflate-raw'), MAX_SHARED_BYTES)
    source = new TextDecoder('utf-8', { fatal: true }).decode(raw)
  } catch (err) {
    return { error: err instanceof TooLarge ? err.message : 'this link is cut or garbled' }
  }
  const values = Object.fromEntries(new URLSearchParams(amp < 0 ? '' : h.slice(amp + 1)))
  if (!several) return { source, values }
  const bundle = filesOf(source)
  return bundle ? { source: bundle.files[bundle.path]!, values, ...bundle } : { error: 'this link is cut or garbled' }
}

/** The files of a `#v2.` link, each under a path that is one: a link is untrusted, and so is every path in it. */
function filesOf(json: string): { path: string; files: Record<string, string> } | undefined {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return undefined
  }
  if (typeof data !== 'object' || data === null) return undefined
  const { entry, files } = data as { entry?: unknown; files?: unknown }
  if (typeof entry !== 'string' || typeof files !== 'object' || files === null) return undefined
  const out: Record<string, string> = {}
  const paths = Object.keys(files)
  if (paths.length > MAX_FILES) return undefined
  for (const p of paths) {
    const text = (files as Record<string, unknown>)[p]
    if (typeof text !== 'string' || !isPath(p)) return undefined
    // defined, not assigned: a file called "__proto__" is a file
    Object.defineProperty(out, p, { value: text, enumerable: true, writable: true, configurable: true })
  }
  return Object.hasOwn(out, entry) ? { path: entry, files: out } : undefined
}

class TooLarge extends Error {}

async function pipe(input: Uint8Array, through: TransformStream<BufferSource, Uint8Array>, max = Infinity) {
  const writer = through.writable.getWriter()
  // the write settles only as the output is read; errors surface through the reader below
  writer.write(input as BufferSource).catch(() => {})
  writer.close().catch(() => {})
  const reader = through.readable.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel()
      throw new TooLarge(`this link unpacks to more than ${max / 1e6} MB`)
    }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.byteLength
  }
  return out
}

function base64url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function unbase64url(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('not base64url')
  const bin = atob(s.replaceAll('-', '+').replaceAll('_', '/'))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

/**
 * The values that still fit the model: known names, options that still exist, numbers within range. A text (from a
 * link) is read by the parameter's kind, so "20" can be the number 20 or the option "20".
 */
export function sharedValues(model: Model, v: Readonly<Record<string, unknown>>): Partial<Values<any>> {
  const out: Record<string, unknown> = {}
  for (const { id, def } of model.params) {
    if (!Object.hasOwn(v, id)) continue
    const x = v[id]
    if (def.kind === 'select') {
      const o = (def.options as unknown[]).find((o) => o === x || String(o) === String(x))
      if (o !== undefined) out[id] = o
    }
    if (def.kind === 'switch' && (x === true || x === 'true' || x === false || x === 'false'))
      out[id] = x === true || x === 'true'
    if (def.kind === 'range' || def.kind === 'load') {
      const n = typeof x === 'number' ? x : typeof x === 'string' && x.trim() !== '' ? Number(x) : Number.NaN
      if (Number.isFinite(n)) out[id] = Math.min(def.max, Math.max(def.min, n))
    }
  }
  return out as Partial<Values<any>>
}
