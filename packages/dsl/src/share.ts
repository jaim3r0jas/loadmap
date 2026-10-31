import type { ParamValue } from '@loadmap/core'

/**
 * A definition in a link: `#v1.` + base64url(deflate-raw(source)), then the values that differ from the defaults
 * (`&load=30&pods=6`). The hash never reaches a server, and the source carries its own language version, so old links
 * keep opening. Compression is the platform's CompressionStream: no dependency.
 */
const PREFIX = 'v1.'

/** A link is refused when its source would unpack to more than this: a small link must not fill the memory. */
export const MAX_SHARED_BYTES = 1_000_000

export async function encodeShare(source: string, values: Readonly<Record<string, ParamValue>> = {}): Promise<string> {
  const packed = await pipe(new TextEncoder().encode(source), new CompressionStream('deflate-raw'))
  const rest = new URLSearchParams(Object.entries(values).map(([k, v]) => [k, String(v)])).toString()
  return `${PREFIX}${base64url(packed)}${rest ? `&${rest}` : ''}`
}

/**
 * `values` are the texts the link holds: only the model knows whether "20" is a number or the option "20", so the
 * page reads them by each parameter's kind.
 */
export type Shared = { source: string; values: Record<string, string> } | { error: string }

/** Reads a link's hash (with or without its "#"). Never throws: a broken link gives `{ error }`. */
export async function decodeShare(hash: string): Promise<Shared> {
  const h = hash.replace(/^#/, '')
  const amp = h.indexOf('&')
  const head = amp < 0 ? h : h.slice(0, amp)
  if (!head.startsWith(PREFIX)) return { error: 'this link holds no loadmap definition' }
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
  return { source, values }
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
