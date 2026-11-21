import { EditorView } from '@codemirror/view'
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

async function mount(key?: string) {
  await page.viewport(1440, 900)
  const host = document.createElement('div')
  host.style.cssText = 'width: 1440px; height: 760px'
  document.body.appendChild(host)
  const ref = createRef<LoadmapEditorHandle>()
  root = createRoot(host)
  root.render(<LoadmapEditor ref={ref} fill initial={checkout} history={key ? { key } : true} />)
  await expect.poll(() => ref.current?.loadmap()).toBeTruthy()
  await ref.current!.loadmap()!.ready()
  await expect.poll(() => ref.current!.history()).toBeTruthy()
  return { host, handle: ref.current! }
}

/** Typing, as the reader would: a change of the text in the editor, not a whole new text. */
function type(host: HTMLElement, from: string, to: string) {
  const view = EditorView.findFromDOM(host.querySelector('.cm-editor') as HTMLElement)!
  const at = view.state.doc.toString().indexOf(from)
  view.dispatch({ changes: { from: at, to: at + from.length, insert: to } })
}

const versions = () => page.getByRole('list', { name: 'Versions on main' })
const count = () => versions().getByRole('button').elements().length

async function openTimeline() {
  await userEvent.click(page.getByRole('button', { name: 'Timeline' }))
  await expect.poll(count).toBe(1)
}

describe('the history in the editor', () => {
  it('keeps a version, draws the one before, and restores it as a new version', async () => {
    const { host, handle } = await mount()
    await openTimeline()
    type(host, 'title: "Checkout pipeline"', 'title: "Checkout, edited"')
    await userEvent.fill(page.getByPlaceholder('What you changed'), 'A new title')
    await userEvent.click(page.getByRole('button', { name: 'Keep this version' }))
    await expect.poll(count).toBe(2)
    await expect.element(versions().getByText('A new title')).toBeVisible()
    // Back draws the version before in the canvas; the text stays
    await userEvent.click(page.getByRole('button', { name: 'Back', exact: true }))
    await expect.element(page.getByText('Showing an older version.')).toBeVisible()
    expect(handle.source()).toContain('Checkout, edited')
    // Restore makes it the files again, with a version on top
    await userEvent.click(versions().getByText('Opened'))
    await userEvent.click(page.getByRole('button', { name: 'Restore this version' }))
    await expect.poll(() => handle.source()).toContain('title: "Checkout pipeline"')
    await expect.poll(count).toBe(3)
    await expect.element(versions().getByText('Restored "Opened"')).toBeVisible()
  })

  it('branches from an older version and keeps both lines', async () => {
    const { host, handle } = await mount()
    await openTimeline()
    type(host, 'title: "Checkout pipeline"', 'title: "One"')
    await userEvent.click(page.getByRole('button', { name: 'Keep this version' }))
    await expect.poll(count).toBe(2)
    await userEvent.click(versions().getByText('Opened'))
    await userEvent.click(page.getByRole('button', { name: 'Branch from here' }))
    await expect.poll(() => handle.history()?.branch).toBe('try 2')
    expect(handle.source()).toContain('title: "Checkout pipeline"')
    expect(handle.history()!.branches.map((b) => b.name)).toEqual(['main', 'try 2'])
  })

  it('keeps the history in the tab under its key, and reads it back', async () => {
    const first = await mount('test-history')
    await openTimeline()
    type(first.host, 'title: "Checkout pipeline"', 'title: "Kept"')
    await userEvent.click(page.getByRole('button', { name: 'Keep this version' }))
    await expect.poll(() => sessionStorage.getItem('test-history')).toContain('title: \\"Kept\\"')
    root!.unmount()
    document.body.replaceChildren()
    const again = await mount('test-history')
    // the kept versions, and the files it opened with now as a version on top of them
    await expect.poll(() => Object.keys(again.handle.history()!.commits).length).toBe(3)
  })
})
