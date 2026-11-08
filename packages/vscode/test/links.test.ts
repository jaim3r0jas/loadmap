import { describe, expect, it } from 'vitest'
import { editorUrl } from '../src/links'

describe('the editor a share link opens', () => {
  it('is an http(s) link, its own fragment dropped', () => {
    expect(editorUrl('https://jaim3r0jas.github.io/loadmap/editor/')).toBe(
      'https://jaim3r0jas.github.io/loadmap/editor/',
    )
    expect(editorUrl('http://localhost:5173/editor/#old')).toBe('http://localhost:5173/editor/')
  })

  it('is nothing else', () => {
    for (const bad of [undefined, '', 'editor', 'file:///etc/passwd', 'command:workbench.action.quit', 'javascript:1'])
      expect(editorUrl(bad)).toBeUndefined()
  })
})
