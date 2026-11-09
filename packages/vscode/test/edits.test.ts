import { describe, expect, it } from 'vitest'
import { type Change, Edits } from '../src/edits'

const text = 'node a "A"\nnode b "B"\n'

/** One change made to `was`: the change as VS Code gives it, and the text it makes. */
const change = (was: string, from: number, to: number, insert: string): [Change, string] => [
  { rangeOffset: from, rangeLength: to - from, text: insert },
  was.slice(0, from) + insert + was.slice(to),
]

describe('the edits the preview follows', () => {
  it('starts with a whole new text, then gives where each edit is, in the offsets of the text now', () => {
    const e = new Edits(text)
    expect(e.take()).toBeNull()
    const [c1, t1] = change(text, 17, 18, 'Bee')
    e.apply([c1], t1, 2)
    expect(e.take()).toEqual([{ from: 17, to: 20, version: 2 }])
    // an edit before it moves it along
    const [c2, t2] = change(t1, 6, 6, 'aa')
    e.apply([c2], t2, 3)
    expect(e.take()).toEqual([
      { from: 19, to: 22, version: 2 },
      { from: 6, to: 8, version: 3 },
    ])
    expect(t2.slice(19, 22)).toBe('Bee')
  })

  it('drops what the preview followed, and keeps what came after', () => {
    const e = new Edits(text)
    e.take()
    const [c1, t1] = change(text, 6, 7, 'x')
    e.apply([c1], t1, 2)
    const [c2, t2] = change(t1, 17, 18, 'y')
    e.apply([c2], t2, 3)
    e.tracked(2)
    expect(e.take()).toEqual([{ from: 17, to: 18, version: 3 }])
  })

  it('counts nothing that keeps the tokens: Format re-indenting, a comment', () => {
    const e = new Edits(text)
    e.take()
    const [c1, t1] = change(text, 0, 0, '  ')
    e.apply([c1], t1, 2)
    const [c2, t2] = change(t1, t1.length, t1.length, '# a note\n')
    e.apply([c2], t2, 3)
    expect(e.take()).toEqual([])
  })

  it('maps an edit inside one removed to where the removal was', () => {
    const e = new Edits(text)
    e.take()
    const [c1, t1] = change(text, 17, 18, 'Bee')
    e.apply([c1], t1, 2)
    const [c2, t2] = change(t1, 11, t1.length, 'node c "C"\n')
    e.apply([c2], t2, 3)
    expect(e.take()).toEqual([
      { from: 11, to: 22, version: 2 },
      { from: 11, to: 22, version: 3 },
    ])
  })

  it('follows the next edit at once when tracking turns on over the text shown', () => {
    const e = new Edits(text)
    e.take()
    const [c1, t1] = change(text, 6, 7, 'x')
    e.apply([c1], t1, 2)
    e.reset(t1, false)
    expect(e.take()).toEqual([])
    const [c2, t2] = change(t1, 17, 18, 'y')
    e.apply([c2], t2, 3)
    expect(e.take()).toEqual([{ from: 17, to: 18, version: 3 }])
  })

  it('starts over when the whole text is replaced', () => {
    const e = new Edits(text)
    e.take()
    const [c1, t1] = change(text, 6, 7, 'x')
    e.apply([c1], t1, 2)
    const [c2, t2] = change(t1, 0, t1.length, 'node z "Z"\n')
    e.apply([c2], t2, 3)
    expect(e.take()).toBeNull()
    expect(e.take()).toEqual([])
  })
})
