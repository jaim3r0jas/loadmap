/**
 * A provider's address, ready to ask: a user and password written in it move into the header (fetch refuses them in a
 * URL, and repeats the URL saying so). The text is never repeated in an error: it may hold a password.
 */
export function endpoint(
  name: string,
  url: string,
  auth: { user?: string; password?: string; header?: string },
): { base: URL; headers: Record<string, string> } {
  let base: URL
  try {
    base = new URL(url.endsWith('/') ? url : `${url}/`)
  } catch {
    throw new Error(`loadmap: the ${name} address is not a URL`)
  }
  const user = auth.user ?? (base.username ? decodeURIComponent(base.username) : undefined)
  const password = auth.password ?? decodeURIComponent(base.password)
  base.username = ''
  base.password = ''
  const headers: Record<string, string> = { accept: 'application/json' }
  if (auth.header) headers.authorization = auth.header
  else if (user != null) headers.authorization = `Basic ${btoa(`${user}:${password}`)}`
  return { base, headers }
}

/** Why a request did not reach the server: the network error's code, never its message, which may name the host. */
export function unreachable(name: string, err: unknown): { error: string } {
  const code = (err as { cause?: { code?: unknown } })?.cause?.code
  return { error: `${name} cannot be reached${typeof code === 'string' ? ` (${code})` : ''}` }
}
