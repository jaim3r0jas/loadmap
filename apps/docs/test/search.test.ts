import { describe, expect, it } from 'vitest'
import type { Found } from '../pages'
import { excerpt, rank } from '../site/search'

const at = (u: string, h: string, t: string, p = 'Page'): Found => ({ u, p, h, t })

describe('the search', () => {
  const index = [
    at('reference/#retry', 'retry', 'Retries of a flow: times, budget.', 'Reference'),
    at('language/building-blocks/', 'Building blocks', 'A retry storm: each retry adds load; a budget caps it.'),
    at('whats-new/#0-2-0', '0.2.0', 'retry and budget arrived.', "What's new"),
    at('concepts/', 'Concepts', 'Nothing about it.'),
  ]

  it('finds the sections that hold every word, the one the heading names first', () => {
    expect(rank(index, 'retry budget').map((f) => f.u)).toEqual([
      'reference/#retry',
      'language/building-blocks/',
      'whats-new/#0-2-0',
    ])
    expect(rank(index, 'retry nothing')).toEqual([])
    expect(rank(index, '   ')).toEqual([])
  })

  it('reads a word whatever its case and accents', () => {
    expect(rank([at('a/', 'Café', 'x')], 'CAFE').length).toBe(1)
  })

  it('shows the text around the first word found, each word marked, nothing it holds read as HTML', () => {
    const text = `${'a'.repeat(100)} the <Loadmap> retry & more`
    const line = excerpt(text, 'retry lt')
    expect(line.startsWith('…')).toBe(true)
    expect(line).toContain('&lt;Loadmap&gt; <mark>retry</mark> &amp; more')
    expect(line).not.toContain('<Loadmap>')
  })
})
