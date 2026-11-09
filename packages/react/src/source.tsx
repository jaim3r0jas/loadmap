import {
  type CompileOptions,
  compile,
  type Definition,
  formatDiagnostic,
  loadCatalogFor,
  loadedCatalog,
  needsCatalog,
  sharedValues,
} from '@loadmap/dsl'
import { fingerprint, pageOptions } from '@loadmap/dsl/internal'
import { type Ref, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loadmap, type LoadmapHandle, type LoadmapProps, type Theme, usePageTheme } from './Loadmap'
import { injectStyles } from './styles'

export interface LoadmapSourceProps extends Omit<LoadmapProps<any>, 'model' | 'view'> {
  /** The `.loadmap` text. Compiled again when its tokens change: spaces, line breaks and comments change nothing. */
  source: string
  /** The file the diagnostics name, as `loadmap check` does. Default "input.loadmap". */
  name?: string
  /** A host's own functions for the formulas, as `compile(…, { functions })` takes them; read when the text compiles. */
  functions?: CompileOptions['functions']
}

/**
 * A `.loadmap` text drawn as `<Loadmap>`, with the options it declares (the page's props win; its `assumptions` come
 * first). While the text does not compile: its diagnostics, as `loadmap check` prints them, above the last version
 * that did. A new version keeps the values the board shows (the load, a scenario's, the controls) where they still
 * fit it, as the editor does; `initial` is for the first. A separate entry: a page built from code never loads the
 * compiler.
 */
export function LoadmapSource({
  source,
  name = 'input.loadmap',
  functions,
  theme,
  assumptions,
  initial,
  ref,
  ...props
}: LoadmapSourceProps) {
  // read when the text compiles, so an object made on every render recompiles nothing
  const fns = useRef(functions)
  fns.current = functions
  const key = useMemo(() => fingerprint(source), [source])
  const waiting = useCatalog(source)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the same tokens are the same model, and the values stay
  const compiled = useMemo(
    () => (waiting ? null : { source, r: compile(source, fns.current ? { functions: fns.current } : {}) }),
    [key, waiting],
  )
  const good = useRef<Definition | null>(null)
  if (compiled?.r.ok && compiled.r.definition) good.current = compiled.r.definition
  const def = good.current
  // the board's values, read as a new definition replaces it, so an edit does not reset the sliders
  const board = useRef<LoadmapHandle | null>(null)
  const drawn = useRef<{ def: Definition | null; values: Readonly<Record<string, unknown>> }>({
    def: null,
    values: initial ?? {},
  })
  if (def !== drawn.current.def) {
    if (drawn.current.def && board.current) drawn.current.values = board.current.values()
    drawn.current.def = def
  }
  const handle = useCallback(
    (h: LoadmapHandle | null) => {
      board.current = h
      pass(ref, h)
    },
    [ref],
  )
  // a prop passed as undefined leaves the definition's option alone
  const set = Object.fromEntries(Object.entries(props).filter(([, v]) => v !== undefined))
  const lines = def && [...(assumptions ?? []), ...def.options.assumptions]
  return (
    <>
      {compiled && !compiled.r.ok && (
        <Problems theme={theme} stale={def != null}>
          {compiled.r.diagnostics.map((d) => formatDiagnostic(d, compiled.source, name)).join('\n')}
        </Problems>
      )}
      {def && (
        <Loadmap
          model={def.model}
          view={def.view}
          {...pageOptions(def.options)}
          {...set}
          ref={handle}
          initial={sharedValues(def.model, drawn.current.values)}
          theme={theme}
          {...(lines?.length ? { assumptions: lines } : {})}
        />
      )}
    </>
  )
}

/** True while a text with a `published` statement waits for the catalog, which loads once, on the first such text. */
export function useCatalog(source: string): boolean {
  const waiting = needsCatalog(source) && !loadedCatalog()
  // loaded or not, the text then compiles: without the catalog it says so where the text names it
  const [tried, setTried] = useState(false)
  useEffect(() => {
    if (waiting) void loadCatalogFor(source).then(() => setTried(true))
  }, [waiting, source])
  return waiting && !tried
}

/** Hands the board to the page's own ref, an object or a function. */
function pass(ref: Ref<LoadmapHandle> | undefined, h: LoadmapHandle | null) {
  if (typeof ref === 'function') ref(h)
  else if (ref) ref.current = h
}

function Problems({ theme, stale, children }: { theme?: Theme; stale: boolean; children: string }) {
  const look = usePageTheme(theme)
  useEffect(() => injectStyles(), [])
  return (
    <div className="lm" data-theme={look === 'auto' ? undefined : look}>
      <pre className="lm-problems" role="alert">
        {children}
      </pre>
      {stale && <p className="lm-note">The diagram below is the last version without errors.</p>}
    </div>
  )
}
