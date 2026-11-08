import type { LoadmapHandle } from '@loadmap/react'
import { LoadmapSource } from '@loadmap/react/source'
import { createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, onTestFinished } from 'vitest'
import { page } from 'vitest/browser'
import source from './checkout.loadmap?raw'

let root: Root | null = null
afterEach(() => {
  root?.unmount()
  root = null
  document.body.replaceChildren()
})

function host() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  return el
}

it('draws a .loadmap text with the options it declares', async () => {
  const el = host()
  const ref = createRef<LoadmapHandle>()
  root!.render(<LoadmapSource source={source} name="checkout.loadmap" ref={ref} />)
  await expect.poll(() => ref.current).toBeTruthy()
  await ref.current!.ready()
  expect(el.querySelectorAll('[data-node]').length).toBe(5)
  expect(el.querySelector('.lm-verdict')!.textContent).toContain('API gateway')
  // the definition's own `assume:` line reaches the page, as compile() + <Loadmap {...options}> would put it
  expect(el.textContent).toContain('Load scales linearly with users')
})

it('shows the diagnostics as loadmap check prints them, and draws once the text is fixed', async () => {
  const el = host()
  const broken = source.replace('demand: flows.orders + flows.events', 'demand: flows.order + flows.events')
  root!.render(<LoadmapSource source={broken} name="checkout.loadmap" />)
  const problems = () => el.querySelector('[role="alert"]')?.textContent ?? ''
  await expect.poll(problems).toContain('checkout.loadmap:')
  expect(problems()).toContain('unknown flow "order"')
  expect(problems()).toContain('did you mean "orders"?')
  expect(el.querySelector('[data-node]')).toBeNull()

  const ref = createRef<LoadmapHandle>()
  root!.render(<LoadmapSource source={source} name="checkout.loadmap" ref={ref} />)
  await expect.poll(() => ref.current).toBeTruthy()
  await ref.current!.ready()
  expect(el.querySelector('[role="alert"]')).toBeNull()
  expect(el.querySelectorAll('[data-node]').length).toBe(5)
})

it('keeps the last version drawn while the text has an error, and the values through a change of layout only', async () => {
  const el = host()
  const ref = createRef<LoadmapHandle>()
  root!.render(<LoadmapSource source={source} ref={ref} />)
  await expect.poll(() => ref.current).toBeTruthy()
  await ref.current!.ready()
  ref.current!.setValues({ load: 30 })
  const first = ref.current
  // a comment and a blank line: the same model, so the same board and its values
  root!.render(<LoadmapSource source={`${source}\n# a note\n`} ref={ref} />)
  await expect.poll(() => ref.current?.values().load).toBe(30)
  expect(ref.current).toBe(first)

  root!.render(
    <LoadmapSource source={source.replace('flows.orders + flows.events', 'flows.order + flows.events')} ref={ref} />,
  )
  await expect.poll(() => el.querySelector('[role="alert"]')?.textContent ?? '').toContain('unknown flow "order"')
  expect(el.textContent).toContain('the last version without errors')
  expect(el.querySelectorAll('[data-node]').length).toBe(5)
  expect(ref.current?.values().load).toBe(30)
})

it('keeps the values through an edit of the model, where they still fit it; initial is for the first version', async () => {
  const el = host()
  const ref = createRef<LoadmapHandle>()
  root!.render(<LoadmapSource source={source} ref={ref} initial={{ load: 30, pods: 4 }} />)
  await expect.poll(() => ref.current).toBeTruthy()
  await ref.current!.ready()
  expect(ref.current!.values()).toMatchObject({ load: 30, pods: 4 })
  const first = ref.current

  // a new label is a new model: the board's values carry over
  root!.render(
    <LoadmapSource source={source.replace('"API gateway"', '"Edge gateway"')} ref={ref} initial={{ load: 1 }} />,
  )
  await expect.poll(() => el.querySelector('[data-node="gateway"]')?.textContent).toContain('Edge gateway')
  expect(ref.current).not.toBe(first)
  expect(ref.current!.values()).toMatchObject({ load: 30, pods: 4 })

  // an option taken away: that value goes back to its default, the others stay
  root!.render(<LoadmapSource source={source.replace('options: [2, 3, 4, 6]', 'options: [2, 3, 6]')} ref={ref} />)
  await expect.poll(() => ref.current!.values().pods).toBe(3)
  expect(ref.current!.values().load).toBe(30)
})

it("puts the page's assumptions first, and lets a prop left undefined keep the definition's option", async () => {
  const el = host()
  const ref = createRef<LoadmapHandle>()
  root!.render(<LoadmapSource source={source} ref={ref} assumptions={['Prices as of Q3.']} speed={undefined} />)
  await expect.poll(() => ref.current).toBeTruthy()
  await ref.current!.ready()
  const text = el.textContent ?? ''
  expect(text).toContain('Prices as of Q3.')
  expect(text).toContain('Load scales linearly with users')
  // checkout.loadmap says speed: 10
  expect(text).toContain('10× speed')
})

it('runs a fan-out wider than it is long down on a wide screen, unless the text says which way', async () => {
  const [w, h] = [window.innerWidth, window.innerHeight]
  await page.viewport(1440, 1000)
  onTestFinished(() => page.viewport(w, h))
  const fan = `loadmap 1
load { max: 10 }
flow req "requests" { unit: "request"; rate: 100 * load; route: api; from: client }
node client "Client"
node api "API" {
  pass
  demand: flows.req
  capacity: measured(1000, "req/s", "load test")
  over: "requests fail"
}
node a "A"
node b "B"
node c "C"
node d "D"
client -> api
api -> a
api -> b
api -> c
api -> d
`
  const ref = createRef<LoadmapHandle>()
  host()
  root!.render(<LoadmapSource source={fan} name="fan.loadmap" ref={ref} />)
  await expect.poll(() => ref.current?.board()?.scene.direction).toBe('DOWN')
  root!.render(<LoadmapSource source={`${fan}layout: right\n`} name="fan.loadmap" ref={ref} />)
  await expect.poll(() => ref.current?.board()?.scene.direction).toBe('RIGHT')
})
