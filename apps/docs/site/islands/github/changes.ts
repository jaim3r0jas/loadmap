// What the reader changed of what came from GitHub, file by file: the list "Changes" shows, and what a save writes.
// No network, no DOM: the editor's page counts the changes as the reader types.
import { own, type RepoTab } from './tab'

export type ChangeKind = 'changed' | 'added' | 'removed'

export interface Change {
  path: string
  kind: ChangeKind
  /** The text as it came (none for an added file) and as it is (none for a removed one). */
  before?: string
  after?: string
}

/** Every file whose text differs from the commit's, by path. */
export function changes(t: RepoTab): Change[] {
  const { originals } = t.origin
  const paths = [...new Set([...Object.keys(originals), ...Object.keys(t.files)])].sort()
  const out: Change[] = []
  for (const path of paths) {
    const before = own(originals, path)
    const after = own(t.files, path)
    if (before === after) continue
    const kind: ChangeKind = before === undefined ? 'added' : after === undefined ? 'removed' : 'changed'
    out.push({ path, kind, ...(before !== undefined && { before }), ...(after !== undefined && { after }) })
  }
  return out
}

/** How many files differ from the commit's: what the bar's button says, counted as the reader types. */
export function changedCount(t: RepoTab): number {
  const { originals } = t.origin
  let n = 0
  for (const p of Object.keys(t.files)) if (own(originals, p) !== t.files[p]) n++
  for (const p of Object.keys(originals)) if (!Object.hasOwn(t.files, p)) n++
  return n
}

/** "1 file changed", "3 files changed". */
export const changedText = (n: number) => `${n} file${n === 1 ? '' : 's'} changed`
