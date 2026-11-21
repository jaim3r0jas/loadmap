import { recorded } from '@loadmap/dsl/assist'
import { createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import checkout from '../../../examples/checkout/checkout.loadmap?raw'
import { LoadmapEditor, type LoadmapEditorHandle } from '../src'

let root: Root | null = null
afterEach(() => {
  root?.unmount()
  root = null
  document.body.replaceChildren()
  sessionStorage.clear()
})

const ANSWER = 'A scenario with eight pods.\n```ops\nput\n  scenario "Eight" { pods: 6; gateways: 2 }\n```'

async function mount(answers: string[]) {
  await page.viewport(1440, 900)
  const host = document.createElement('div')
  host.style.cssText = 'width: 1440px; height: 760px'
  document.body.appendChild(host)
  const ref = createRef<LoadmapEditorHandle>()
  const model = recorded(answers)
  root = createRoot(host)
  root.render(
    <LoadmapEditor ref={ref} fill initial={checkout} history assist={{ reference: '# the reference', model }} />,
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
    const versions = Object.values(handle.history()!.commits)
    await expect.poll(() => Object.values(handle.history()!.commits).some((c) => c.author === 'assistant')).toBe(true)
    expect(versions.length).toBeGreaterThanOrEqual(1)
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
    handle.setSource(`${checkout}\n# typed since\n`)
    await userEvent.click(card.getByRole('button', { name: 'Accept' }))
    await expect.element(page.getByText('The text changed since the question')).toBeVisible()
    expect(handle.source()).not.toContain('scenario "Eight"')
  })
})
