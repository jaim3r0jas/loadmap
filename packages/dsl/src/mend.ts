import type { CompileResult } from './compile'
import type { TextChange } from './edit'
import { quickFixes } from './fixes'

/**
 * The text with every error mended that one quick fix alone mends (a misspelt name, an old spelling): free, before
 * the model is asked again. Undefined when there is none.
 */
export function fixedText(text: string, r: CompileResult): { text: string; notes: string[] } | undefined {
  const own = r.diagnostics.filter((d) => d.file == null && d.severity === 'error')
  if (!own.length) return undefined
  const fixes = quickFixes(text, own)
  const changes: TextChange[] = []
  const notes: string[] = []
  for (const list of fixes) {
    if (list.length !== 1) continue
    const f = list[0]!
    if (f.changes.some((c) => changes.some((d) => c.from < d.to && d.from < c.to))) continue
    changes.push(...f.changes)
    notes.push(`Fixed: ${f.title}`)
  }
  if (!changes.length) return undefined
  const next = [...changes]
    .sort((a, b) => b.from - a.from)
    .reduce((t, c) => t.slice(0, c.from) + c.insert + t.slice(c.to), text)
  return { text: next, notes }
}
