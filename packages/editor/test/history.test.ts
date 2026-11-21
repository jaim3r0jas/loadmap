import { describe, expect, it } from 'vitest'
import { blobBody, gitObject, History, treeOf } from '../src/history'

const clock = () => {
  let t = 1_790_000_000
  return () => t++
}

describe('the history', () => {
  it('hashes a file as git does', async () => {
    // `printf 'hello\n' | git hash-object --stdin`
    const id = [
      ...new Uint8Array(await crypto.subtle.digest('SHA-1', gitObject('blob', blobBody('hello\n')) as BufferSource)),
    ]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    expect(id).toBe('ce013625030ba8dba906f756967f9e9ca394464a')
    // a folder is a tree of its own: `git mktree` of a.loadmap and lib/b.loadmap
    const t = await treeOf({ 'a.loadmap': 'a\n', 'lib/b.loadmap': 'b\n' })
    expect(t.trees.size).toBe(2)
    expect(t.blobs['a.loadmap']).toBe('78981922613b2afb6025042ff6bd878ac1994e85')
  })

  it('makes a commit only when the files changed, and steps back and forth along them', async () => {
    const h = await History.start({ 'm.loadmap': 'one\n' }, 'm.loadmap', { clock: clock() })
    const first = h.head
    expect(await h.commit({ 'm.loadmap': 'one\n' }, 'm.loadmap', 'you', 'nothing')).toBeNull()
    const second = await h.commit({ 'm.loadmap': 'two\n' }, 'm.loadmap', 'you', 'Typed')
    const third = await h.commit({ 'm.loadmap': 'three\n' }, 'm.loadmap', 'assistant', 'Add a scenario', {
      request: 'Add a scenario',
      model: 'recorded',
      operations: ['put scenario "X" {}'],
      notes: ['Added scenario X'],
    })
    expect(h.line().map((c) => c.message)).toEqual(['Add a scenario', 'Typed', 'Opened'])
    expect(h.step(third!.id, -1)?.id).toBe(second!.id)
    expect(h.step(first.id, 1)?.id).toBe(second!.id)
    expect(h.step(third!.id, 1)).toBeNull()
    expect(h.head.trace?.request).toBe('Add a scenario')
  })

  it('restores with a new commit, and branches from any version', async () => {
    const h = await History.start({ 'm.loadmap': 'one\n' }, 'm.loadmap', { clock: clock() })
    const first = h.head
    await h.commit({ 'm.loadmap': 'two\n' }, 'm.loadmap', 'you', 'Typed')
    const back = await h.restore(first.id)
    expect(h.filesOf(back!)).toEqual({ 'm.loadmap': 'one\n' })
    expect(h.line()).toHaveLength(3)
    const b = h.branchFrom(first.id)
    expect(b).toEqual({ name: 'try 2', head: first.id })
    await h.commit({ 'm.loadmap': 'other\n' }, 'm.loadmap', 'you', 'Tried')
    expect(h.line().map((c) => c.message)).toEqual(['Tried', 'Opened'])
    expect(h.switchTo('main')?.message).toBe('Restored "Opened"')
  })

  it('says which commit last changed a file', async () => {
    const h = await History.start({ 'a.loadmap': 'a\n', 'b.loadmap': 'b\n' }, 'a.loadmap', { clock: clock() })
    await h.commit({ 'a.loadmap': 'a2\n', 'b.loadmap': 'b\n' }, 'a.loadmap', 'you', 'A')
    await h.commit({ 'a.loadmap': 'a2\n', 'b.loadmap': 'b2\n' }, 'a.loadmap', 'you', 'B')
    expect(h.lastChanged('a.loadmap')?.message).toBe('A')
    expect(h.lastChanged('b.loadmap')?.message).toBe('B')
  })

  it('is kept as plain data and read back, refusing what does not hold together', async () => {
    const h = await History.start({ 'm.loadmap': 'one\n' }, 'm.loadmap', { clock: clock() })
    await h.commit({ 'm.loadmap': 'two\n' }, 'm.loadmap', 'you', 'Typed')
    const again = History.fromData(JSON.parse(JSON.stringify(h.toData())))
    expect(again?.line().map((c) => c.message)).toEqual(['Typed', 'Opened'])
    expect(
      History.fromData({
        version: 1,
        blobs: {},
        commits: { x: { files: { a: 'nope' } } },
        branches: [],
        branch: 'main',
      }),
    ).toBeUndefined()
    expect(History.fromData('nonsense')).toBeUndefined()
  })

  it('makes commits asked for at once one after the other, each on the one before', async () => {
    const h = await History.start({ 'm.loadmap': 'one\n' }, 'm.loadmap', { clock: clock() })
    const [a, b] = await Promise.all([
      h.commit({ 'm.loadmap': 'two\n' }, 'm.loadmap', 'you', 'A'),
      h.commit({ 'm.loadmap': 'three\n' }, 'm.loadmap', 'you', 'B'),
    ])
    expect(b!.parent).toBe(a!.id)
    expect(h.line().map((c) => c.message)).toEqual(['B', 'A', 'Opened'])
  })

  it('refuses stored data with a commit, a parent or a branch that does not hold together', async () => {
    const h = await History.start({ 'm.loadmap': 'one\n' }, 'm.loadmap', { clock: clock() })
    await h.commit({ 'm.loadmap': 'two\n' }, 'm.loadmap', 'you', 'Typed')
    const good = JSON.parse(JSON.stringify(h.toData())) as any
    const broken = (f: (d: any) => void) => {
      const d = structuredClone(good)
      f(d)
      return History.fromData(d)
    }
    expect(broken(() => {})).toBeDefined()
    const commits = (d: any) => Object.values(d.commits) as { files?: unknown; parent: string | null }[]
    expect(broken((d) => delete commits(d)[0]!.files)).toBeUndefined()
    expect(broken((d) => (commits(d).find((c) => c.parent)!.parent = 'gone'))).toBeUndefined()
    expect(broken((d) => d.branches.push({ head: 'x' }))).toBeUndefined()
  })
})
