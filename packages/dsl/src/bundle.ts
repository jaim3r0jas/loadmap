import { type CompileOptions, compile, linkedOf } from './compile'
import type { Diagnostic } from './diagnostics'
import { format } from './format'
import { print } from './print'

/**
 * A definition in several files as one file that draws and computes the same: its parts' statements joined, what it
 * imports written out under the names it uses, every subsystem's boxes under their dotted ids. For a host that reads
 * one file, and for the source that travels with a picture. The comments of the files are not kept. `{ error }` when
 * the definition does not compile: a flat copy of a broken model would hide where it is broken.
 */
export function flatten(
  source: string,
  o: CompileOptions = {},
): { text: string } | { error: string; diagnostics: Diagnostic[] } {
  const r = compile(source, o)
  const linked = linkedOf(r)
  if (!r.ok || !linked) return { error: 'the definition does not compile', diagnostics: r.diagnostics }
  // a library draws nothing of its own: what stands in for a model when it is checked is no text to write
  if (r.role === 'library')
    return { error: 'a library is not a definition to flatten: give its model', diagnostics: [] }
  const printed = print(linked.body, linked.source)
  const flat = format(printed)
  const text = flat.ok ? flat.text : printed
  // the one file is read again: it must stand on its own
  const again = compile(text, { functions: o.functions, catalog: o.catalog, snapshot: o.snapshot })
  if (!again.ok) return { error: 'the flat copy does not compile: a bug in loadmap', diagnostics: again.diagnostics }
  return { text }
}
