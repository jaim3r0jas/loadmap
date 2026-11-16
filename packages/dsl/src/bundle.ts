import { type CompileOptions, compile, type Front, front } from './compile'
import { type Diagnostic, Reporter } from './diagnostics'
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
  if (!r.ok) return { error: 'the definition does not compile', diagnostics: r.diagnostics }
  const f: Front = { report: new Reporter(source), doc: { body: [] }, role: 'model' }
  try {
    front(source, o, f)
  } catch {
    // it compiled a moment ago: nothing to say here that compile did not
  }
  if (!f.linked) return { error: 'the definition does not compile', diagnostics: r.diagnostics }
  const flat = format(print(f.linked.body, f.report.source))
  const text = flat.ok ? flat.text : print(f.linked.body, f.report.source)
  // the one file is read again: it must stand on its own
  const again = compile(text, { functions: o.functions, catalog: o.catalog, snapshot: o.snapshot })
  if (!again.ok) return { error: 'the flat copy does not compile: a bug in loadmap', diagnostics: again.diagnostics }
  return { text }
}
