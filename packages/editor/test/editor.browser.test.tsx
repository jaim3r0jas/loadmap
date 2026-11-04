import { undo } from '@codemirror/commands'
import { EditorView } from '@codemirror/view'
import type { ParamValue } from '@loadmap/core'
import { decodeShare } from '@loadmap/dsl'
import { createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import alerts from '../../../examples/alerts/alerts.loadmap?raw'
import checkout from '../../../examples/checkout/checkout.loadmap?raw'
import { LoadmapEditor, type LoadmapEditorHandle, TEMPLATES } from '../src'

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
    // CodeMirror draws only the lines in view: scroll to the change so its marks exist
    view.dispatch({
      changes: { from: at, to: at + from.length, insert: to },
      selection: { anchor: at },
      scrollIntoView: true,
    })
  }
  return { host, handle: ref.current!, edit, view }
}

const verdict = (host: HTMLElement) => host.querySelector('.lm-verdict')?.textContent ?? ''

describe('the editor', () => {
  it('redraws the diagram as the text changes, keeping the values', async () => {
    const { host, handle, edit } = await mount()
    handle.loadmap()!.setValues({ pods: 6 })
    expect(verdict(host)).toContain('At 10×, every component is under the 50 % target')
    edit('rate: 40 * load', 'rate: 400 * load')
    await expect
      .poll(() => verdict(host), { timeout: 5000 })
      .toContain('but the API gateway runs above the 50 % target')
    expect(handle.loadmap()!.values().pods).toBe(6)
    // ten times the orders breaks both promises: a warning on each line, the diagram still shown
    await expect.poll(() => host.querySelector('.lme-status')!.textContent).toBe('2 warnings')
    expect(host.querySelector('.lme-problems [data-severity="warning"]')!.textContent).toMatch(
      /^\d+:1 "Today keeps 7×" fails: expected at least 7×, but the 50 % target holds up to between/,
    )
    expect(host.querySelector('.lme-preview')!.hasAttribute('data-stale')).toBe(false)
    edit('"Postgres primary"', '"Main database"')
    await expect
      .poll(() => host.querySelector('.lm-lim[data-component="db"] b')?.textContent)
      .toContain('Main database')
  })

  it('marks an error in the text and keeps the last good diagram', async () => {
    const { host, edit } = await mount()
    edit('demand: flows.orders + flows.events', 'demand: flows.order + flows.events')
    await expect.poll(() => host.querySelector('.cm-lintRange-error')?.textContent).toBe('order')
    // the lint mark comes from CodeMirror, the status from React's next render
    await expect.poll(() => host.querySelector('.lme-status')!.textContent).toBe('1 error')
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

  it('shares a scenario: the link reopens with its button pressed', async () => {
    const first = await mount()
    first.host.querySelector<HTMLButtonElement>('.lm-scenarios button:nth-of-type(2)')!.click()
    await expect.poll(() => first.handle.loadmap()!.values()).toMatchObject({ gateways: 2, pods: 6 })
    const shared = await decodeShare(`#${await first.handle.shareHash()}`)
    if ('error' in shared) throw new Error(shared.error)
    expect(shared.values).toEqual({ gateways: '2', pods: '6' })
    root?.unmount()
    document.body.replaceChildren()
    const again = await mount(shared)
    const pressed = again.host.querySelector('.lm-scenarios button[aria-pressed="true"]')
    expect(pressed?.textContent).toBe('Proposed')
  })

  it('starts a new text from its own defaults', async () => {
    const { handle } = await mount()
    handle.loadmap()!.setValues({ load: 80, pods: 6 })
    handle.setSource(alerts)
    // a new text compiles and lays out from scratch: on a busy machine that takes more than the default second
    await expect.poll(() => handle.loadmap()?.values().alertPods, { timeout: 5000 }).toBe(3)
    expect(handle.loadmap()!.values()).toMatchObject({ load: 10, posPods: 3 })
  })

  it('starts from a template', async () => {
    const { host, handle } = await mount()
    const menu = host.querySelector('select[aria-label="New from template"]') as HTMLSelectElement
    expect([...menu.options].slice(1).map((o) => o.value)).toEqual(TEMPLATES.map((t) => t.id))
    // the text is as it was loaded: no question
    await userEvent.selectOptions(menu, 'queue-workers')
    await expect.poll(() => host.querySelector('.lm h2')?.textContent).toBe('Queue and workers')
    expect(handle.source()).toBe(TEMPLATES.find((t) => t.id === 'queue-workers')!.source)
    await handle.loadmap()!.ready()
    expect(host.querySelectorAll('.lme-preview [data-node]')).toHaveLength(5)
    expect(menu.value).toBe('')
  })

  it('asks before replacing edited text, and undo brings it back', async () => {
    const { host, handle, edit, view } = await mount()
    edit('"Postgres primary"', '"Main database"')
    const edited = handle.source()
    const menu = host.querySelector('select[aria-label="New from template"]') as HTMLSelectElement
    const asked: string[] = []
    const confirm = window.confirm
    try {
      window.confirm = (q) => {
        asked.push(String(q))
        return false
      }
      await userEvent.selectOptions(menu, 'web-app')
      expect(asked).toEqual(['Replace your text with “Web app and database”?'])
      expect(handle.source()).toBe(edited)
      window.confirm = () => true
      await userEvent.selectOptions(menu, 'web-app')
      expect(handle.source()).toBe(TEMPLATES[0]!.source)
      undo(view)
      expect(handle.source()).toBe(edited)
    } finally {
      window.confirm = confirm
    }
  })

  it('hides the menu with templates={false}', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    root.render(<LoadmapEditor initial={checkout} templates={false} />)
    await expect.poll(() => host.querySelector('.lme-bar')).toBeTruthy()
    expect(host.querySelector('select[aria-label="New from template"]')).toBeNull()
  })

  it('reads values from a link by the kind of each parameter', async () => {
    const source = checkout.replace(
      'param batch "Batch DB writes" { default: true }',
      'param batch "Batch DB writes" { default: true }\nparam tier "Tier" { options: ["10", "20"]; default: "10" }',
    )
    const { handle } = await mount({ source, values: { tier: '20', pods: '6', batch: 'false', load: '30' } })
    expect(handle.loadmap()!.values()).toMatchObject({ tier: '20', pods: 6, batch: false, load: 30 })
  })

  for (const theme of ['light', 'dark'] as const)
    it(`renders the ${theme} theme`, async () => {
      const { host } = await mount({ theme })
      await page.screenshot({ path: `__screenshots__/editor-${theme}.png`, element: host })
    })
})
