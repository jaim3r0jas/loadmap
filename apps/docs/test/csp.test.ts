import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { editorPolicy, inlineHashes, withPolicy } from '../csp'

const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <script>try{document.documentElement.dataset.theme='dark'}catch(e){}</script>
    <script type="module" crossorigin src="/assets/client.js"></script>
  </head>
  <body></body>
</html>`

describe("the editor's Content-Security-Policy", () => {
  it('allows the inline scripts by their hash, and no other', () => {
    const body = "try{document.documentElement.dataset.theme='dark'}catch(e){}"
    expect(inlineHashes(PAGE)).toEqual([`'sha256-${createHash('sha256').update(body).digest('base64')}'`])
    const policy = editorPolicy(PAGE)
    expect(policy).toContain(`script-src 'self' ${inlineHashes(PAGE)[0]}`)
    expect(policy).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline/)
  })

  it("lets the network reach the site, GitHub's API and raw files, and what a host adds, and nothing else", () => {
    const connect = editorPolicy(PAGE, ['https://auth.example.workers.dev'])
      .split('; ')
      .find((d) => d.startsWith('connect-src'))
    expect(connect).toBe(
      "connect-src 'self' https://api.github.com https://raw.githubusercontent.com https://auth.example.workers.dev",
    )
    expect(editorPolicy(PAGE)).toContain("object-src 'none'")
  })

  it('goes first in <head>, before anything it governs', () => {
    const html = withPolicy(PAGE)
    expect(html.indexOf('http-equiv="Content-Security-Policy"')).toBeLessThan(html.indexOf('<script'))
    expect(html.indexOf('<head>')).toBeLessThan(html.indexOf('http-equiv'))
  })
})
