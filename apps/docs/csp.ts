// The editor's Content-Security-Policy. GitHub Pages sends no headers a site chooses, so it is a <meta> in the page,
// put there at build (Vite's dev server injects scripts and a socket of its own). A <meta> policy cannot say
// frame-ancestors, report-uri or sandbox; what it can, it says: scripts from the site only (the theme's inline script
// by its hash), and the network to GitHub's API and raw files only, where the editor reads and saves repositories.
import { createHash } from 'node:crypto'

/** Every inline script of the page, by the hash a policy allows it with. */
export function inlineHashes(html: string): string[] {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
    (m) => `'sha256-${createHash('sha256').update(m[1]!, 'utf8').digest('base64')}'`,
  )
}

/** The policy for the editor's page; `connect` adds origins it may call (a sign-in endpoint). */
export function editorPolicy(html: string, connect: readonly string[] = []): string {
  return [
    "default-src 'self'",
    `script-src 'self' ${inlineHashes(html).join(' ')}`.trim(),
    // the editor and the diagram put their rules in <style> elements as they load
    "style-src 'self' 'unsafe-inline'",
    // exports draw into a canvas through blob: and data: images; the layout runs in a worker of the site's
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    ['connect-src', "'self'", 'https://api.github.com', 'https://raw.githubusercontent.com', ...connect].join(' '),
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ')
}

/** The page with its policy first in <head>, before anything it governs. */
export function withPolicy(html: string, connect: readonly string[] = []): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${editorPolicy(html, connect)}" />`
  return html.replace(/<head>/, `<head>\n    ${meta}`)
}
