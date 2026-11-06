import { type CompileOptions, compile, type Definition, formatDiagnostic } from '@loadmap/dsl'
import { fingerprint, pageOptions } from '@loadmap/dsl/internal'
import { useEffect, useMemo, useRef } from 'react'
import { Loadmap, type LoadmapProps, type Theme, usePageTheme } from './Loadmap'
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
 * that did. A separate entry: a page built from code never loads the compiler.
 */
export function LoadmapSource({
  source,
  name = 'input.loadmap',
  functions,
  theme,
  assumptions,
  ...props
}: LoadmapSourceProps) {
  // read when the text compiles, so an object made on every render recompiles nothing
  const fns = useRef(functions)
  fns.current = functions
  const key = useMemo(() => fingerprint(source), [source])
  // biome-ignore lint/correctness/useExhaustiveDependencies: the same tokens are the same model, and the values stay
  const compiled = useMemo(() => ({ source, r: compile(source, fns.current ? { functions: fns.current } : {}) }), [key])
  const good = useRef<Definition | null>(null)
  if (compiled.r.ok && compiled.r.definition) good.current = compiled.r.definition
  const def = good.current
  // a prop passed as undefined leaves the definition's option alone
  const set = Object.fromEntries(Object.entries(props).filter(([, v]) => v !== undefined))
  const lines = def && [...(assumptions ?? []), ...def.options.assumptions]
  return (
    <>
      {!compiled.r.ok && (
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
          theme={theme}
          {...(lines?.length ? { assumptions: lines } : {})}
        />
      )}
    </>
  )
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
