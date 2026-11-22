import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { bundle, refName } from '../src/bundle'
import { History } from '../src/history'

const clock = () => {
  let t = 1_790_000_000
  return () => t++
}

let dir: string | undefined
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8' }).trim()

describe('the history as a git bundle', () => {
  it('is a file git clones, every version a commit, every branch a ref, on the branch the files are on', async () => {
    const h = await History.start({ 'm.loadmap': 'one\n' }, 'm.loadmap', { clock: clock() })
    await h.commit({ 'm.loadmap': 'two\n', 'lib/l.loadmap': 'lib\n' }, 'm.loadmap', 'you', 'Typed')
    const second = h.head
    await h.commit({ 'm.loadmap': 'three\n', 'lib/l.loadmap': 'lib\n' }, 'm.loadmap', 'you', 'Typed again')
    // a second branch from the second version, then the files on it
    h.branchFrom(second.id)
    await h.commit({ 'm.loadmap': 'other\n', 'lib/l.loadmap': 'lib\n' }, 'm.loadmap', 'you', 'Tried another way')
    dir = mkdtempSync(join(tmpdir(), 'loadmap-bundle-'))
    writeFileSync(join(dir, 'model.bundle'), await bundle(h))
    git(dir, 'clone', '-q', 'model.bundle', 'out')
    const out = join(dir, 'out')
    expect(readFileSync(join(out, 'm.loadmap'), 'utf8')).toBe('other\n')
    expect(readFileSync(join(out, 'lib/l.loadmap'), 'utf8')).toBe('lib\n')
    expect(git(out, 'log', '--format=%s').split('\n')).toEqual(['Tried another way', 'Typed', 'Opened'])
    // the same ids as the history's: git computes what the page computed
    expect(git(out, 'rev-parse', 'HEAD')).toBe(h.head.id)
    expect(git(out, 'fsck', '--strict')).toBe('')
    const branches = git(out, 'branch', '-r', '--format=%(refname:short)')
    expect(branches).toContain('origin/main')
    expect(branches).toContain('origin/try-2')
  })

  it('names each branch as git takes it, never twice the same', () => {
    const used = new Set<string>()
    expect(refName('main', used)).toBe('main')
    expect(refName('try 2', used)).toBe('try-2')
    expect(refName('try/2', used)).toBe('try-2-2')
    expect(refName('../..', used)).toBe('branch')
    // HEAD would mean two things in the clone
    expect(refName('HEAD', used)).toBe('HEAD-branch')
  })
})
