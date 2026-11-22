import { EditorView } from '@codemirror/view'
import { recorded } from '@loadmap/dsl/assist'
import { createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import checkout from '../../../examples/checkout/checkout.loadmap?raw'
import { type EditorData, LoadmapEditor, type LoadmapEditorHandle } from '../src'

let root: Root | null = null
afterEach(() => {
  root?.unmount()
  root = null
  document.body.replaceChildren()
  sessionStorage.clear()
})

const ANSWER = 'A scenario with eight pods.\n```ops\nput\n  scenario "Eight" { pods: 6; gateways: 2 }\n```'

async function mount(answers: string[], data?: EditorData) {
  await page.viewport(1440, 900)
  const host = document.createElement('div')
  host.style.cssText = 'width: 1440px; height: 760px'
  document.body.appendChild(host)
  const ref = createRef<LoadmapEditorHandle>()
  const model = recorded(answers)
  root = createRoot(host)
  root.render(
    <LoadmapEditor
      ref={ref}
      fill
      initial={checkout}
      history
      assist={{ reference: '# the reference', model, ...(data && { data }) }}
    />,
  )
  await expect.poll(() => ref.current?.loadmap()).toBeTruthy()
  await ref.current!.loadmap()!.ready()
  await expect.poll(() => ref.current!.history()).toBeTruthy()
  await userEvent.click(page.getByRole('button', { name: 'Ask', exact: true }))
  return { host, handle: ref.current!, model }
}

async function ask(words: string) {
  await userEvent.fill(page.getByLabelText('Ask about the diagram'), words)
  await userEvent.click(page.getByRole('button', { name: 'Ask', exact: true }).last())
}

describe('the Ask panel', () => {
  it('shows a proposal drawn in the canvas, and accepts it as a version of the history', async () => {
    const { handle, model } = await mount([ANSWER])
    await ask('Add a scenario with six pods and two gateways')
    const card = page.getByRole('region', { name: 'Proposal' })
    await expect.element(card.getByText('Added scenario Eight'), { timeout: 5000 }).toBeVisible()
    await expect
      .poll(() => document.querySelector('.lme-stale')?.textContent, { timeout: 5000 })
      .toContain('Showing the proposal.')
    // nothing reached the text before the reader accepts
    expect(handle.source()).not.toContain('scenario "Eight"')
    expect(model.requests[0]!.system).toContain('# the reference')
    await userEvent.click(card.getByRole('button', { name: 'Accept' }))
    await expect.poll(() => handle.source()).toContain('scenario "Eight" { pods: 6; gateways: 2 }')
    await expect.poll(() => Object.values(handle.history()!.commits).some((c) => c.author === 'assistant')).toBe(true)
    const mine = Object.values(handle.history()!.commits).find((c) => c.author === 'assistant')!
    expect(mine.trace).toMatchObject({ request: 'Add a scenario with six pods and two gateways', model: 'recorded' })
  })

  it('drops a proposal on Reject, and refuses one the text moved away from', async () => {
    const { handle } = await mount([ANSWER, ANSWER])
    await ask('Add a scenario')
    const card = page.getByRole('region', { name: 'Proposal' })
    await userEvent.click(card.getByRole('button', { name: 'Reject' }))
    await expect.element(card).not.toBeInTheDocument()
    expect(handle.source()).not.toContain('scenario "Eight"')
    await ask('Add a scenario')
    await expect.element(card).toBeVisible()
    // the reader types meanwhile
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!
    view.dispatch({ changes: { from: view.state.doc.length, insert: '\n# typed since\n' } })
    await userEvent.click(card.getByRole('button', { name: 'Accept' }))
    await expect
      .poll(() => document.querySelector('.lme-ask .lme-hint')?.textContent)
      .toContain('The text changed since the question')
    expect(handle.source()).not.toContain('scenario "Eight"')
  })

  it('marks what the proposal adds and changes, and switches Before and After', async () => {
    const answer =
      '```ops\nset db.short to "the store"\nput\n  node cache "Cache" {\n    pass\n    demand: flows.orders\n    capacity: estimated(9_000, "req/s", "assistant\'s guess")\n    over: "orders wait"\n  }\n```'
    await mount([answer])
    await ask('Shorten the database name and add a cache')
    const card = page.getByRole('region', { name: 'Proposal' })
    await expect.element(card.getByText('Added node cache'), { timeout: 5000 }).toBeVisible()
    await expect
      .poll(() => document.querySelector('.lme-preview [data-node="db"]')?.getAttribute('data-proposed'), {
        timeout: 5000,
      })
      .toBe('changed')
    await userEvent.click(card.getByRole('button', { name: 'Before' }))
    await expect
      .poll(() => document.querySelector('.lme-stale')?.textContent ?? '')
      .not.toContain('Showing the proposal')
    expect(document.querySelector('[data-proposed]')).toBeNull()
    await userEvent.click(card.getByRole('button', { name: 'After' }))
    await expect
      .poll(() => document.querySelector('.lme-stale')?.textContent, { timeout: 5000 })
      .toContain('Showing the proposal')
    // the new box is marked once the canvas draws it, however long its layout takes
    await expect
      .poll(() => document.querySelector('.lme-preview [data-node="cache"]')?.getAttribute('data-proposed'), {
        timeout: 5000,
      })
      .toBe('added')
    await expect.element(card.getByRole('button', { name: 'After' })).toHaveAttribute('aria-pressed', 'true')
    // leaving the proposal another way takes its marks, and the card says what the canvas shows
    await userEvent.click(page.getByRole('button', { name: 'Back to now' }))
    await expect.poll(() => document.querySelector('[data-proposed]')).toBeNull()
    await expect.element(card.getByRole('button', { name: 'Before' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('asks about the selected box in one press, then drafts what it advised', async () => {
    const { host, handle, model } = await mount([
      'The database takes every order once and every visit twice; it runs out at 3.1× today.',
      '```ops\nput\n  scenario "Replica" { pods: 6 }\n```',
    ])
    await userEvent.click(host.querySelector<SVGGElement>('.lme-preview [data-node="db"]')!)
    await userEvent.click(page.getByRole('button', { name: 'Explain it' }))
    await expect.poll(() => model.requests.length, { timeout: 5000 }).toBe(1)
    const first = model.requests[0]!
    expect(first.messages.at(-1)?.content).toContain('Explain db')
    // what the engine says of the box goes with the question
    expect(first.context).toMatch(/Its component, [^(]+ \(db\): use/)
    await expect
      .poll(() => document.querySelector('.lme-ask')?.textContent ?? '', { timeout: 5000 })
      .toContain('it runs out at 3.1× today')
    await userEvent.click(page.getByRole('button', { name: 'Draft this' }))
    const card = page.getByRole('region', { name: 'Proposal' })
    await expect.element(card.getByText('Added scenario Replica'), { timeout: 5000 }).toBeVisible()
    expect(model.requests[1]!.messages.at(-1)?.content).toContain('Draft the change you suggest')
    // the draft is about the box the advice was about, even with the selection gone
    expect(model.requests[1]!.context).toMatch(/Its component, [^(]+ \(db\): use/)
    await expect.element(page.getByRole('button', { name: 'Draft this' })).not.toBeInTheDocument()
    // the version keeps the question that led to the change
    await userEvent.click(card.getByRole('button', { name: 'Accept' }))
    await expect
      .poll(() => Object.values(handle.history()!.commits).find((c) => c.author === 'assistant')?.trace, {
        timeout: 5000,
      })
      .toMatchObject({ request: expect.stringContaining('Explain db'), selection: 'db' })
  })

  it("connects the reader's metrics, runs the looks they allow, and draws an accepted measure with them", async () => {
    const looked: unknown[] = []
    const pulled: string[][] = []
    let down = true
    const data: EditorData = {
      where: 'a test bridge',
      connect: async () => ({ explore: ['prometheus'], measure: ['prometheus'] }),
      explore: async (calls) => {
        // the first press finds the bridge gone: the reader hears it, the model does not
        if (down) {
          down = false
          throw new Error('the bridge went away')
        }
        looked.push(calls)
        return 'search orders:\n  shop_orders_total (counter): Orders placed'
      },
      pull: async (measures) => {
        pulled.push(measures.map((x) => x.id))
        const origin = {
          provider: 'prometheus',
          query: measures[0]!.query,
          from: '2026-11-21T23:00:00Z',
          to: '2026-11-22T00:00:00Z',
          fetched: '2026-11-22T00:00:00Z',
          samples: 60,
        }
        return {
          format: 'loadmap-snapshot',
          version: 1,
          fetched: '2026-11-22T00:00:00Z',
          from: origin.from,
          to: origin.to,
          measurements: { orderRate: { value: 7, unit: 'orders/s', origin } },
        }
      },
    }
    const change = [
      '```ops',
      'put',
      '  metric orders "Orders placed" {',
      "    prometheus { query: 'sum(rate(shop_orders_total[1m]))' }",
      '  }',
      '  measure orderRate orders { fallback: 10; unit: "orders/s" }',
      '```',
    ].join('\n')
    const { model } = await mount(['```explore\nsearch orders\n```', change], data)
    // nothing is asked of the page before the reader connects
    await userEvent.click(page.getByRole('button', { name: 'Connect' }))
    await expect.element(page.getByText('Your metrics: prometheus, through a test bridge.')).toBeVisible()
    await ask('Measure the orders')
    expect(model.requests[0]!.context).toContain("The reader's prometheus: you may ask to explore it.")
    const looks = page.getByRole('region', { name: 'Looks in your metrics' })
    await expect.element(looks.getByText('search orders')).toBeVisible()
    expect(looked).toEqual([])
    await userEvent.click(looks.getByRole('button', { name: 'Run', exact: true }))
    await expect
      .poll(() => document.querySelector('.lme-ask')?.textContent ?? '')
      .toContain('The looks did not run: the bridge went away')
    expect(model.requests).toHaveLength(1)
    await userEvent.click(looks.getByRole('button', { name: 'Run', exact: true }))
    const card = page.getByRole('region', { name: 'Proposal' })
    await expect.element(card.getByText('Accept'), { timeout: 5000 }).toBeVisible()
    expect(looked).toEqual([[{ tool: 'search', arg: 'orders' }]])
    expect(model.requests[1]!.messages.at(-1)!.content).toContain('shop_orders_total (counter): Orders placed')
    await userEvent.click(card.getByRole('button', { name: 'Accept' }))
    // the measure it added is read at once, and the diagram drawn with it
    await expect.poll(() => pulled, { timeout: 5000 }).toEqual([['orderRate']])
    await expect
      .poll(() => document.querySelector('.lme-stale')?.textContent ?? '', { timeout: 5000 })
      .toContain('Drawn with your metrics, read at 00:00 UTC.')
    await expect.poll(() => document.querySelector('.lme-ask')?.textContent ?? '').toContain('1 of 1 measures read')
  })
})
