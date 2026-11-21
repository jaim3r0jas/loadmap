import { EditorView } from '@codemirror/view'
import type { ParamValue } from '@loadmap/core'
import { decodeShare, format } from '@loadmap/dsl'
import { createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import checkout from '../../../examples/checkout/checkout.loadmap?raw'
import { type EditorFiles, type EditorLayout, LoadmapEditor, type LoadmapEditorHandle } from '../src'

let root: Root | null = null
afterEach(() => {
  root?.unmount()
  root = null
  document.body.replaceChildren()
})

async function mount(
  o: {
    source?: string
    values?: Record<string, ParamValue>
    layout?: EditorLayout
    width?: number
    files?: EditorFiles
  } = {},
) {
  await page.viewport(o.width ?? 1440, 1000)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const ref = createRef<LoadmapEditorHandle>()
  const shared: string[] = []
  root = createRoot(host)
  root.render(
    <LoadmapEditor
      ref={ref}
      initial={o.source ?? checkout}
      files={o.files}
      values={o.values}
      layout={o.layout}
      onShare={(h) => {
        shared.push(h)
      }}
    />,
  )
  await expect.poll(() => ref.current?.loadmap()).toBeTruthy()
  await ref.current!.loadmap()!.ready()
  // the inspector loads as the code hides
  if (o.layout === 'reader') await expect.poll(() => host.querySelector('.lme-inspector')).toBeTruthy()
  const view = EditorView.findFromDOM(host.querySelector('.cm-editor') as HTMLElement)!
  return { host, handle: ref.current!, view, shared }
}

const box = (host: HTMLElement, id: string) => host.querySelector<SVGGElement>(`.lme-preview [data-node="${id}"]`)!
const input = (host: HTMLElement, key: string, n = 0) =>
  host.querySelectorAll<HTMLInputElement>(`.lme-inspector [data-key="${key}"] input[type="text"]`)[n]!

/**
 * Opens one of the preview's panels by its tab, unless it is open: only the open panel is drawn, and what it holds
 * comes a moment later. Called from inside a poll, it opens the tab again on a preview that was drawn anew.
 */
const openTab = (host: HTMLElement, title: string) => {
  const tab = [...host.querySelectorAll<HTMLButtonElement>('.lm-canvas-tabs button')].find(
    (b) => b.textContent === title,
  )
  if (tab?.getAttribute('aria-expanded') === 'false') tab.click()
}

/** Types a value into a field and presses Enter, as a reader does. */
async function type(el: HTMLInputElement, value: string) {
  await userEvent.fill(el, value)
  await userEvent.keyboard('{Enter}')
}

/** The lines two texts differ in, as "-old" and "+new" pairs. */
function changed(a: string, b: string): string[] {
  const x = a.split('\n')
  const y = b.split('\n')
  expect(y).toHaveLength(x.length)
  return x.flatMap((l, i) => (l === y[i] ? [] : [`-${l}`, `+${y[i]}`]))
}

describe('the editor for readers', () => {
  it('selects the lines of a box clicked in the diagram, and the box of the line the cursor is in', async () => {
    const { host, view } = await mount()
    await userEvent.click(box(host, 'gateway'))
    const sel = view.state.selection.main
    const lines = view.state.sliceDoc(sel.from, sel.to)
    expect(lines.startsWith('node gateway "API gateway" {')).toBe(true)
    expect(lines.endsWith('  over: "clients get 429s"\n}')).toBe(true)
    expect(view.hasFocus).toBe(true)
    await expect.poll(() => box(host, 'gateway').querySelector('.lm-selected')).not.toBeNull()
    // a box without a component has its lines too
    await userEvent.click(box(host, 'phones'))
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(
      'node phones "Phones" "app checkout"',
    )
    const at = view.state.doc.toString().indexOf('shape: cylinder')
    view.dispatch({ selection: { anchor: at }, scrollIntoView: true })
    await expect.poll(() => box(host, 'db').getAttribute('aria-pressed')).toBe('true')
  })

  it("changes a box of one copy in its with, and the definition every copy shares on the reader's word", async () => {
    const lib = [
      'loadmap 1.5',
      'library "Regions"',
      'subsystem line "Orders" {',
      '  input flow main',
      '  node workers "Workers" { pass; demand: flows.main; capacity: estimated(10, "req/s"); over: "x" }',
      '}',
      'subsystem region "Region" {',
      '  input flow main',
      '  input pods = 2',
      '  node api "API" `${pods} pods` { pass; demand: flows.main; capacity: estimated(100 * pods, "req/s"); over: "x" }',
      '  subsystem orders { like: line; with { main: main } }',
      '  api -> orders.workers',
      '}',
      '',
    ].join('\n')
    const model = [
      'loadmap 1.5',
      'import "./regions.loadmap" { region }',
      'load "x" { max: 10; default: 1 }',
      'flow eu "eu" { rate: load; route: eu.api -> eu.orders.workers; from: s }',
      'flow us "us" { rate: 2 * load; route: us.api -> us.orders.workers; from: s }',
      'node s "Start"',
      'subsystem eu "EU region" { like: region; with { main: eu; pods: 4 } }',
      'subsystem us "US region" { like: region; with { main: us } }',
      's -> eu.api',
      's -> us.api',
      '',
    ].join('\n')
    const { host, handle } = await mount({
      source: model,
      layout: 'reader',
      files: { path: 'm.loadmap', files: { 'm.loadmap': model, 'regions.loadmap': lib } },
    })
    const panel = () => host.querySelector('.lme-inspector')!
    const heading = () => panel().querySelector('h3')?.textContent
    const hint = (kind: string) => panel().querySelector(`[data-kind="${kind}"]`)?.textContent
    const label = () => input(host, 'subsystem:region/node:api/@label')
    const files = () => handle.files().files
    // read-only through the fieldset around it: the field's own disabled says nothing of that
    const locked = (el: HTMLInputElement) => el.matches(':disabled')
    // "eu.api" is no statement of any file: it is the api of the subsystem "eu" is like, in the library. What tells
    // it from "us.api" is the with of "eu": that comes first, and the definition both share is read-only
    await userEvent.click(box(host, 'eu.api'))
    await expect.poll(heading).toBe('API')
    expect(hint('copy')).toBe(
      'A box of EU region: what eu sets in its "with" comes first, a change there changes eu alone.',
    )
    expect(input(host, 'subsystem:eu/with/pods').value).toBe('4')
    expect(locked(label())).toBe(true)
    expect(hint('shared')).toBeUndefined()
    await type(input(host, 'subsystem:eu/with/pods'), '6')
    await expect.poll(() => box(host, 'eu.api').textContent, { timeout: 5000 }).toContain('6 pods')
    expect(box(host, 'us.api').textContent).toContain('2 pods')
    expect(files()['m.loadmap']).toContain('subsystem eu "EU region" { like: region; with { main: eu; pods: 6 } }')
    expect(files()['regions.loadmap']).toBe(lib)
    // a copy that does not set an input shows the default, and a change writes it in its with
    await userEvent.click(box(host, 'us.api'))
    await expect.poll(() => input(host, 'subsystem:us/with/pods')?.value).toBe('2')
    expect(panel().querySelector('[data-key="subsystem:us/with/pods"] .lme-from')?.textContent).toBe(
      'Not set for this copy: the default of region.',
    )
    await type(input(host, 'subsystem:us/with/pods'), '3')
    await expect.poll(() => box(host, 'us.api').textContent, { timeout: 5000 }).toContain('3 pods')
    expect(files()['m.loadmap']).toContain('subsystem us "US region" { like: region; with { main: us; pods: 3 } }')
    // the definition every copy shares, on the reader's word: one change in the library, both regions draw it
    host.querySelector<HTMLInputElement>('.lme-switch input')!.click()
    await expect.poll(() => locked(label())).toBe(false)
    expect(hint('shared')).toBe('Written once for 2 boxes: a change here also changes eu.api.')
    await type(label(), 'Front')
    await expect.poll(() => box(host, 'eu.api').textContent, { timeout: 5000 }).toContain('Front')
    expect(box(host, 'us.api').textContent).toContain('Front')
    await expect.poll(heading, { timeout: 5000 }).toBe('Front')
    expect(files()['regions.loadmap']).toContain('  node api "Front" `${pods} pods` { pass;')
    // a subsystem in a subsystem, from the same library: nothing of it is set per copy. Another box starts read-only
    await userEvent.click(box(host, 'us.orders.workers'))
    await expect.poll(heading).toBe('Workers')
    expect(hint('no-copy')).toBe(
      'Nothing of Workers is set for us alone: what it shows is written once for every copy.',
    )
    expect(locked(input(host, 'subsystem:line/node:workers/@label'))).toBe(true)
    // a box of the model is its own
    await userEvent.click(box(host, 's'))
    await expect.poll(heading).toBe('Start')
    expect(hint('copy')).toBeUndefined()
    expect(locked(input(host, 'node:s/@label'))).toBe(false)
  })

  it('opens without the text; a click, two changes and a link that reopens with them', async () => {
    const first = await mount({ layout: 'reader' })
    const { host, handle } = first
    expect(host.querySelector<HTMLElement>('.lme-left')!.hidden).toBe(true)
    expect(host.querySelector('.lme-inspector')!.textContent).toContain('Click a box in the diagram to change it.')
    await userEvent.click(box(host, 'gateway'))
    await expect.poll(() => host.querySelector('.lme-inspector h3')?.textContent).toBe('API gateway')
    await type(input(host, 'node:gateway/@label'), 'Edge gateway')
    await type(input(host, 'node:gateway/capacity'), '25000')
    await expect.poll(() => box(host, 'gateway').textContent).toContain('Edge gateway')
    // the preview follows the text: the gateway's capacity is now 25,000 req/s per instance
    const before = '50 % at 7.4×–13× · full at 14×–27×'
    await expect
      .poll(() => {
        openTab(host, 'Limits')
        // until the limits are drawn, nothing has changed yet
        return host.querySelector('.lm-lim[data-component="gateway"] small')?.textContent ?? before
      })
      .not.toBe(before)
    handle.loadmap()!.setValues({ load: 30 })
    await userEvent.click(page.getByRole('button', { name: 'Share', exact: true }))
    await expect.poll(() => first.shared.length).toBe(1)
    const link = await decodeShare(first.shared[0]!)
    if (!('source' in link)) throw new Error(link.error)
    expect(changed(checkout, link.source)).toEqual([
      '-node gateway "API gateway" {',
      '+node gateway "Edge gateway" {',
      '-  capacity: estimated(20_000 * gateways +- 30%, "req/s", "vendor benchmark, not load-tested")',
      '+  capacity: estimated(25_000 * gateways +- 30%, "req/s", "vendor benchmark, not load-tested")',
    ])
    expect(link.values).toEqual({ load: '30' })

    root!.unmount()
    document.body.replaceChildren()
    const again = await mount({ source: link.source, values: link.values, layout: 'reader' })
    expect(box(again.host, 'gateway').textContent).toContain('Edge gateway')
    expect(again.handle.loadmap()!.values().load).toBe(30)
    await userEvent.click(box(again.host, 'gateway'))
    await expect.poll(() => input(again.host, 'node:gateway/capacity')?.value).toBe('25000')
  })

  it('takes a change back with Undo, and shows why a change is refused', async () => {
    const { host, handle } = await mount({ layout: 'reader' })
    const undo = page.getByRole('button', { name: 'Undo' })
    expect(undo.element().getAttribute('aria-disabled')).toBe('true')
    await userEvent.click(box(host, 'workerPool'))
    await type(input(host, 'param:pods/options'), '2, 4, 8')
    // a scenario and a preset still use 6 pods
    await expect
      .poll(() => host.querySelector('[data-key="param:pods/options"] [role="alert"]')?.textContent)
      .toBe('6 is not an option of "pods"')
    expect(handle.source()).toBe(checkout)
    await type(input(host, 'param:threads/options'), '4, 8, 32')
    expect(handle.source()).toContain('param threads "Threads per pod" { options: [4, 8, 32]; default: 8 }')
    expect(undo.element().getAttribute('aria-disabled')).toBe('false')
    await userEvent.click(undo)
    expect(handle.source()).toBe(checkout)
    await expect.poll(() => input(host, 'param:threads/options').value).toBe('4, 8, 16')
  })

  it('changes the model: the load, growth and a flow', async () => {
    const { host, handle } = await mount({ layout: 'reader' })
    await userEvent.click(page.getByRole('tab', { name: 'Model' }))
    await type(input(host, 'load/max'), '200')
    await type(input(host, 'flow:orders/rate'), '50')
    expect(changed(checkout, handle.source())).toEqual([
      '-load "Users, × today" { max: 100; default: 10 }',
      '+load "Users, × today" { max: 200; default: 10 }',
      '-  rate: 40 * load',
      '+  rate: 50 * load',
    ])
  })

  it('stops changes while the text has errors', async () => {
    const { host, view } = await mount({ layout: 'reader' })
    const at = view.state.doc.toString().indexOf('flows.orders + flows.events')
    view.dispatch({ changes: { from: at, to: at + 12, insert: 'flows.order' } })
    await expect
      .poll(() => host.querySelector('.lme-inspector')!.textContent)
      .toContain('The text has errors: show the code to fix them.')
    await userEvent.click(page.getByRole('button', { name: 'Show code' }))
    expect(host.querySelector<HTMLElement>('.lme-left')!.hidden).toBe(false)
    expect(host.querySelector('.lme-inspector')).toBeNull()
  })

  it('formats a text that gets shorter, and one that gets longer', async () => {
    // the spaces and blank lines go: the common start and end of the two texts overlap
    const longer = checkout
      .replace('title: "Checkout pipeline"', 'title:    "Checkout pipeline"')
      .replace('\n\nload "Users', '\n\n\n\nload "Users')
    const { handle } = await mount({ source: longer })
    await userEvent.click(page.getByRole('button', { name: 'Format' }))
    expect(handle.source()).toBe(checkout)
    handle.setSource('let x = 1    # c\n')
    handle.format()
    expect(handle.source()).toBe('let x = 1 # c\n')
  })

  it('formats the text in one undo step', async () => {
    const messy = checkout.replace(
      'load "Users, × today" { max: 100; default: 10 }',
      'load "Users, × today" {max:100;default:10}',
    )
    const { handle, view } = await mount({ source: messy })
    await userEvent.click(page.getByRole('button', { name: 'Format' }))
    expect(handle.source()).toBe(format(messy).text)
    expect(handle.source()).toBe(checkout)
    const { undo } = await import('@codemirror/commands')
    undo(view)
    expect(handle.source()).toBe(messy)
  })

  // 960: about the docs site's column on a laptop, where the inspector must still sit beside the diagram
  for (const width of [390, 960, 1440])
    it(`lays the reader out at ${width} px, without sideways scroll`, async () => {
      const { host } = await mount({ layout: 'reader', width })
      await userEvent.click(box(host, 'gateway'))
      await expect.poll(() => host.querySelector('.lme-inspector h3')?.textContent).toBe('API gateway')
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
      const panel = host.querySelector('.lme-inspector')!.getBoundingClientRect()
      const preview = host.querySelector('.lme-preview')!.getBoundingClientRect()
      expect(panel.left >= preview.right, 'the inspector beside the diagram').toBe(width > 720)
      await page.screenshot({ path: `__screenshots__/reader-${width}.png`, element: host })
      await userEvent.click(page.getByRole('button', { name: 'Close' }))
      await expect.poll(() => host.querySelector('.lme-inspector h3')).toBeNull()
      // the button went away with the box: the focus is on the panel, not lost to the page
      expect(document.activeElement).toBe(host.querySelector('.lme-inspector'))
      expect(box(host, 'gateway').getAttribute('aria-pressed')).toBe('false')
    })
})
