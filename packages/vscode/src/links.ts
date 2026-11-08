/** An http(s) link to an editor, without its own fragment; nothing else (a `file:`, a `command:`) is ever opened. */
export function editorUrl(value: string | undefined): string | undefined {
  try {
    const u = new URL(value ?? '')
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return undefined
    u.hash = ''
    return u.href
  } catch {
    return undefined
  }
}
