// A ```loadmap live fence: the definition drawn, its source under it.
import { compile, formatDiagnostic } from '@loadmap/dsl'
import { Loadmap } from '@loadmap/react'
import { createRoot } from 'react-dom/client'

export function mount(el: HTMLElement) {
  const pre = el.querySelector('pre')!
  const source = pre.textContent ?? ''
  const r = compile(source)
  const host = document.createElement('div')
  el.prepend(host)
  if (!r.ok || !r.definition) {
    host.innerHTML = ''
    const err = document.createElement('pre')
    err.className = 'code error'
    err.textContent = r.diagnostics.map((d) => formatDiagnostic(d, source, 'example.loadmap')).join('\n')
    host.append(err)
    return
  }
  const details = document.createElement('details')
  details.innerHTML = '<summary>The definition</summary>'
  pre.replaceWith(details)
  details.append(pre)
  const { model, view, options } = r.definition
  createRoot(host).render(
    <Loadmap
      model={model}
      view={view}
      {...(options.speed != null ? { speed: options.speed } : {})}
      {...(options.direction ? { direction: options.direction } : {})}
      {...(options.assumptions.length ? { assumptions: options.assumptions } : {})}
    />,
  )
}
