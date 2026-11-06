// A ```loadmap live fence: the definition drawn, its source under it, and a link that opens it in the editor.
import { compile, encodeShare, formatDiagnostic } from '@loadmap/dsl'
import { pageOptions } from '@loadmap/dsl/internal'
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
  const editor = el.dataset.editor
  if (editor)
    encodeShare(source).then((hash) => {
      const p = document.createElement('p')
      p.className = 'edit'
      const a = document.createElement('a')
      a.href = `${editor}?code#${hash}`
      a.textContent = 'Edit in the editor ⤢'
      p.append(a)
      details.before(p)
    })
  const { model, view, options } = r.definition
  createRoot(host).render(<Loadmap model={model} view={view} {...pageOptions(options)} />)
}
