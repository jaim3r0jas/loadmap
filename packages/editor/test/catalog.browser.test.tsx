import { EditorView } from '@codemirror/view'
import { createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { LoadmapEditor, type LoadmapEditorHandle } from '../src'

const SOURCE = `loadmap 1
title: "Events"
load { max: 10 }

flow events "events" { unit: "MB"; from: producers; rate: 150 * load; route: workers }

node producers "Producers"
node workers "Workers" {
  pass
  demand: flows.events
  capacity: estimated(900, "MB/s")
  over: "a backlog grows"
}

producers -> workers
`

let root: Root | null = null
afterEach(() => {
  root?.unmount()
  root = null
  document.body.replaceChildren()
})

async function mount() {
  await page.viewport(1440, 1000)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const ref = createRef<LoadmapEditorHandle>()
  root = createRoot(host)
  root.render(<LoadmapEditor ref={ref} initial={SOURCE} />)
  await expect.poll(() => ref.current?.loadmap()).toBeTruthy()
  await ref.current!.loadmap()!.ready()
  const view = EditorView.findFromDOM(host.querySelector('.cm-editor') as HTMLElement)!
  return { host, view }
}

const open = async () => {
  await userEvent.click(page.getByRole('button', { name: 'New' }))
  await userEvent.click(page.getByRole('menuitem', { name: 'From the catalog…' }))
  await expect.element(page.getByRole('dialog', { name: 'Add from the catalog' })).toBeVisible()
}

describe('the catalog picker', () => {
  it('shows a published figure with its conditions and source, and adds it as a new box', async () => {
    const { host, view } = await mount()
    await open()
    await userEvent.click(page.getByRole('button', { name: /^Apache Kafka/ }))
    const figure = page.getByRole('dialog').element().querySelector('.lme-figure')!
    expect(figure.textContent).toContain('605 MB/s published, a best case: peak throughput, produced and consumed')
    expect(figure.querySelector('a')?.getAttribute('href')).toBe(
      'https://www.confluent.io/blog/kafka-fastest-messaging-system/',
    )
    // a configuration no run matches: no number
    await userEvent.selectOptions(page.getByRole('combobox', { name: 'Brokers' }), '3 brokers')
    await userEvent.selectOptions(page.getByRole('combobox', { name: 'Message size' }), 'message size 100 B')
    await expect.poll(() => figure.textContent).toContain('No published benchmark')
    await userEvent.selectOptions(page.getByRole('combobox', { name: 'Message size' }), 'message size 1 KB')
    await userEvent.click(page.getByRole('button', { name: 'Add as a new box' }))
    const text = view.state.doc.toString()
    expect(text).toContain('published kafkaFigure kafka {\n  edition: "2026-11"')
    expect(text).toContain('node kafka "Apache Kafka" {')
    // the assumptions name it, published and linked
    await expect
      .poll(() => [...host.querySelectorAll('.lm-facts li')].map((li) => li.textContent).join('\n'), { timeout: 5000 })
      .toContain('Apache Kafka: 605 MB/s, published')
  })

  it("puts the figure on the box selected, as the box's capacity", async () => {
    const { host, view } = await mount()
    // the cursor in a box's lines selects it
    const at = view.state.doc.toString().indexOf('pass')
    view.focus()
    view.dispatch({ selection: { anchor: at } })
    await open()
    await userEvent.click(page.getByRole('button', { name: /^Apache Kafka/ }))
    await userEvent.click(page.getByRole('button', { name: 'Use for Workers' }))
    expect(view.state.doc.toString()).toContain('  capacity: kafkaFigure\n')
    await expect
      .poll(() => host.querySelector('.lm-lim[data-component="workers"] .lm-tag[data-kind="published"]'), {
        timeout: 5000,
      })
      .toBeTruthy()
  })
})
