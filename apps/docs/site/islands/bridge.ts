// The reader's own metrics, through `loadmap bridge` on their computer. The page asks it nothing before the reader
// presses Connect in the Ask panel with the code the bridge printed, and every look the model asks for waits for
// their press: the bridge holds the store's address and credentials, the page sees only what was read.
import type { EditorData } from '@loadmap/editor'

const BRIDGE = 'http://localhost:7788'
/** The code the reader typed: sent with every call, kept in this page alone. */
let code = ''

async function call<T>(path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BRIDGE}${path}`, {
      headers: { 'x-loadmap-code': code, ...(body !== undefined && { 'content-type': 'application/json' }) },
      ...(body !== undefined && { method: 'POST', body: JSON.stringify(body) }),
    })
  } catch {
    throw new Error(
      'No loadmap bridge answered on localhost:7788: run `npx @loadmap/cli bridge` there, with LOADMAP_PROMETHEUS_URL set.',
    )
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new Error(`The bridge refused: ${data.error ?? `it answered ${res.status}`}.`)
  return data as T
}

export const bridge: EditorData = {
  where: 'loadmap bridge on this computer',
  code: 'The code loadmap bridge printed',
  connect: async (given) => {
    code = given ?? ''
    return call<{ explore: string[]; measure: string[] }>('/')
  },
  explore: async (calls) => (await call<{ text: string }>('/explore', { calls })).text,
  // the last hour, a point a minute: what the diagram is drawn with
  pull: async (measures) => {
    const to = new Date()
    const from = new Date(to.getTime() - 3_600_000)
    return call('/pull', { measures, from: from.toISOString(), to: to.toISOString(), step: 60 })
  },
}
