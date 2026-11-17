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

async function mount(initial = SOURCE) {
  await page.viewport(1440, 1000)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const ref = createRef<LoadmapEditorHandle>()
  root = createRoot(host)
  root.render(<LoadmapEditor ref={ref} initial={initial} />)
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
    expect(text).toContain('published kafkaFigure kafka {\n  edition: "2027-01"')
    expect(text).toContain('cluster kafka "Apache Kafka" {')
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

// a shop with a gateway in front of a pool: where a topic, a cache or a database goes on a route
const SHOP = `loadmap 1.5
title: "Shop"
load { max: 10 }

flow orders "orders" { from: phones; rate: 100 * load; route: gateway -> consumers }

node phones "Phones"
node gateway "Gateway" { pass; capacity: estimated(1000, "req/s"); over: "phones wait" }
pool consumers "Consumers" { pods: 2; perPod: 4; capacity: estimated(1000, "req/s"); over: "a backlog grows" }

phones -> gateway
gateway -> consumers
`

describe('how flows use a box from the catalog', () => {
  it('puts a Kafka topic on a route, in front of the pool that drains it as a consumer group', async () => {
    const { host, view } = await mount(SHOP)
    await open()
    await userEvent.click(page.getByRole('button', { name: /^Apache Kafka/ }))
    await userEvent.click(page.getByRole('checkbox', { name: 'orders' }))
    await expect.element(page.getByRole('combobox', { name: 'Where on the route of orders' })).toHaveValue('1')
    await userEvent.fill(page.getByRole('spinbutton', { name: 'Partitions per flow' }), '12')
    await userEvent.selectOptions(page.getByRole('combobox', { name: 'Read by the next pool' }), 'kafka/consumer-group')
    const dialog = page.getByRole('dialog').element()
    // the demand in the figure's unit, at the message size of its run, and the text before it is added
    expect(dialog.querySelector('.lme-catalog-demand')?.textContent).toBe(
      'Demand: what reaches it × 1KB, the message size of the published run, in MB/s.',
    )
    await expect.element(page.getByLabelText('The text it writes')).toHaveTextContent('demand: at.kafka * 1KB')
    // the edge it now stands in goes
    expect([...dialog.querySelectorAll('.lme-catalog-text del')].map((d) => d.textContent)).toContain(
      'gateway -> consumers',
    )
    await page.screenshot({ path: 'catalog-kafka.png', element: dialog })
    await userEvent.click(page.getByRole('button', { name: 'Add as a new box' }))
    const text = view.state.doc.toString()
    expect(text).toContain('route: gateway -> kafka -> consumers }')
    expect(text).toContain('queue { partitions { orders: 12 } }')
    expect(text).toContain('connection kafkaConsumers {\n  hop: kafka -> consumers\n  rule: "kafka/consumer-group"\n}')
    // the board ranks it by its published figure
    await expect
      .poll(() => host.querySelector('.lm-lim[data-component="kafka"] .lm-tag[data-kind="published"]'), {
        timeout: 5000,
      })
      .toBeTruthy()
  })

  it('a cache answers its hit ratio; a database ends a flow, or lets it go on', async () => {
    const { view } = await mount(SHOP)
    await open()
    await userEvent.click(page.getByRole('button', { name: /^Valkey/ }))
    await userEvent.fill(page.getByRole('spinbutton', { name: 'Hit ratio, %' }), '90')
    await userEvent.click(page.getByRole('checkbox', { name: 'orders' }))
    await expect.element(page.getByLabelText('The text it writes')).toHaveTextContent('cache { hit: 0.9 }')
    await page.screenshot({ path: 'catalog-valkey.png', element: page.getByRole('dialog').element() })
    await userEvent.click(page.getByRole('button', { name: /^CockroachDB/ }))
    await userEvent.click(page.getByRole('checkbox', { name: 'orders' }))
    // last on the route: flows end there
    await expect.element(page.getByRole('radio', { name: 'Flows end here' })).toBeChecked()
    await userEvent.selectOptions(page.getByRole('combobox', { name: 'Where on the route of orders' }), '1')
    await expect.element(page.getByRole('radio', { name: 'Flows go on' })).toBeChecked()
    // tpmC is no rate of units: what one is worth
    await userEvent.fill(page.getByRole('spinbutton', { name: 'What one unit a second is, in tpmC' }), '60')
    await expect.element(page.getByLabelText('The text it writes')).toHaveTextContent('demand: at.cockroachdb * 60')
    await userEvent.click(page.getByRole('button', { name: 'Add as a new box' }))
    expect(view.state.doc.toString()).toContain('route: gateway -> cockroachdb -> consumers }')
  })

  it('says why it cannot add, and adds nothing', async () => {
    const { view } = await mount(SHOP)
    const before = view.state.doc.toString()
    await open()
    await userEvent.click(page.getByRole('button', { name: /^Apache Kafka/ }))
    await userEvent.fill(page.getByRole('textbox', { name: 'Id' }), 'gateway')
    await expect.element(page.getByRole('alert')).toHaveTextContent('Not added: the text has a "gateway" already.')
    // aria-disabled: a DOM click, as a Playwright click waits for an enabled button
    ;(page.getByRole('button', { name: 'Add as a new box' }).element() as HTMLButtonElement).click()
    expect(view.state.doc.toString()).toBe(before)
  })
})
