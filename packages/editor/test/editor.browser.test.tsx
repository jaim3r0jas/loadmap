import { EditorView } from '@codemirror/view'
import type { ParamValue } from '@loadmap/core'
import { decodeShare } from '@loadmap/dsl'
import { createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import alerts from '../../../examples/alerts/alerts.loadmap?raw'
import checkout from '../../../examples/checkout/checkout.loadmap?raw'
import { LoadmapEditor, type LoadmapEditorHandle } from '../src'

let root: Root | null = null
afterEach(() => {
  root?.unmount()
  root = null
  document.body.replaceChildren()
})

async function mount(o: { source?: string; values?: Record<string, ParamValue>; theme?: 'light' | 'dark' } = {}) {
  await page.viewport(1440, 1000)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const ref = createRef<LoadmapEditorHandle>()
  root = createRoot(host)
  root.render(<LoadmapEditor ref={ref} initial={o.source ?? checkout} values={o.values} theme={o.theme} />)
  await expect.poll(() => ref.current?.loadmap()).toBeTruthy()
  await ref.current!.loadmap()!.ready()
  const view = EditorView.findFromDOM(host.querySelector('.cm-editor') as HTMLElement)!
  const edit = (from: string, to: string) => {
    const at = view.state.doc.toString().indexOf(from)
    view.dispatch({ changes: { from: at, to: at + from.length, insert: to } })
  }
  return { host, handle: ref.current!, edit }
}

const verdict = (host: HTMLElement) => host.querySelector('.lm-verdict')?.textContent ?? ''

describe('the editor', () => {
  it('redraws the diagram as the text changes, keeping the values', async () => {
    const { host, handle, edit } = await mount()
    handle.loadmap()!.setValues({ pods: 6 })
    expect(verdict(host)).toContain('At 10×, every component is under the 50 % target')
    edit('rate: 40 * load', 'rate: 400 * load')
    await expect.poll(() => verdict(host)).toContain('but API gateway runs above the 50 % target')
    expect(handle.loadmap()!.values().pods).toBe(6)
    edit('"Postgres primary"', '"Main database"')
    await expect
      .poll(() => host.querySelector('.lm-lim[data-component="db"] b')?.textContent)
      .toContain('Main database')
  })

  it('marks an error in the text and keeps the last good diagram', async () => {
    const { host, edit } = await mount()
    edit('demand: flows.orders + flows.events', 'demand: flows.order + flows.events')
    await expect.poll(() => host.querySelector('.cm-lintRange-error')?.textContent).toBe('order')
    expect(host.querySelector('.lme-status')!.textContent).toBe('1 error')
    expect(host.querySelector('.lme-problems')!.textContent).toContain('unknown flow "order"did you mean "orders"?')
    expect(host.querySelector('.lme-preview')!.hasAttribute('data-stale')).toBe(true)
    expect(verdict(host)).toContain('At 10×')
    edit('flows.order +', 'flows.orders +')
    await expect.poll(() => host.querySelector('.lme-preview')!.hasAttribute('data-stale')).toBe(false)
  })

  it('shares a link that opens the same definition at the same values', async () => {
    const first = await mount({ source: alerts })
    first.handle.loadmap()!.setValues({ load: 25, merge: false })
    const hash = await first.handle.shareHash()
    expect(hash).toMatch(/^v1\.[\w-]+&load=25&merge=false$/)
    const shared = await decodeShare(`#${hash}`)
    if ('error' in shared) throw new Error(shared.error)
    expect(shared.source).toBe(alerts)
    root?.unmount()
    document.body.replaceChildren()
    const again = await mount(shared)
    expect(again.handle.loadmap()!.values()).toMatchObject({ load: 25, merge: false })
    expect(verdict(again.host)).toContain('At 25×')
  })

  for (const theme of ['light', 'dark'] as const)
    it(`renders the ${theme} theme`, async () => {
      const { host } = await mount({ theme })
      await page.screenshot({ path: `__screenshots__/editor-${theme}.png`, element: host })
    })
})
