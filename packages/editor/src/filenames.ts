/** The worst a file's problems are, for its mark on a tab and in the explorer. */
export type FileMark = 'error' | 'warning'

/** What a mark says to a reader who does not see it. */
export const MARK_TEXT = { error: 'has errors', warning: 'has warnings' } as const

/**
 * Each path's name as a tab or a problem shows it: the file's own name, with its folder in front only where two files
 * share the name.
 */
export function shortNames(paths: readonly string[]): Map<string, { folder: string; name: string }> {
  const count = new Map<string, number>()
  const nameOf = (p: string) => p.split('/').at(-1)!
  for (const p of paths) count.set(nameOf(p), (count.get(nameOf(p)) ?? 0) + 1)
  return new Map(
    paths.map((p) => {
      const name = nameOf(p)
      const clash = count.get(name)! > 1 && p.includes('/')
      return [p, { folder: clash ? p.slice(0, -name.length) : '', name }]
    }),
  )
}

/** The icons of the tabs and the explorer (16 px line icons, as `ICON`): with them, off the editor's first load. */
export const FICON = {
  files: 'M2.5 3.5h11v9h-11zM6.5 3.5v9',
  x: 'M4.5 4.5l7 7M11.5 4.5l-7 7',
  plus: 'M8 3.5v9M3.5 8h9',
  pencil: 'M3 13l.6-2.6 7-7 2 2-7 7zM9.4 4.6l2 2',
  bin: 'M3.5 4.5h9M6.5 4.5V3h3v1.5M4.6 4.5l.6 8.5h5.6l.6-8.5',
} as const
