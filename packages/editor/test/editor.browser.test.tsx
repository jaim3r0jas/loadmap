import { cursorCharRight, redo, undo } from '@codemirror/commands'
import { EditorView } from '@codemirror/view'
import type { ParamValue } from '@loadmap/core'
import { decodeShare } from '@loadmap/dsl'
import { createRef, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import cascadiaCode from '../../../apps/docs/site/fonts/cascadia-code.woff2?url'
import firaCode from '../../../apps/docs/site/fonts/fira-code.woff2?url'
import jetbrainsMono from '../../../apps/docs/site/fonts/jetbrains-mono.woff2?url'
import platform from '../../../docs/multi-file/platform.loadmap?raw'
import shop from '../../../docs/multi-file/shop.loadmap?raw'
import story from '../../../docs/multi-file/shop.story.loadmap?raw'
import alerts from '../../../examples/alerts/alerts.loadmap?raw'
import checkout from '../../../examples/checkout/checkout.loadmap?raw'
import { watchDots } from '../../../examples/dots'
import {
  type BarSection,
  type CodeFont,
  type EditorFiles,
  type EmbedOptions,
  LoadmapEditor,
  type LoadmapEditorHandle,
  TEMPLATES,
} from '../src'

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
    theme?: 'light' | 'dark'
    embedLink?: (hash: string, o: EmbedOptions) => string
    exportItems?: BarSection[]
    several?: EditorFiles
    onChange?: (source: string) => void
    onSave?: (files: EditorFiles) => void | Promise<void>
    fonts?: readonly CodeFont[]
  } = {},
) {
  await page.viewport(1440, 1000)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const ref = createRef<LoadmapEditorHandle>()
  root = createRoot(host)
  root.render(
    <LoadmapEditor
      ref={ref}
      initial={o.source ?? checkout}
      values={o.values}
      theme={o.theme}
      embedLink={o.embedLink}
      exportItems={o.exportItems}
      files={o.several}
      onChange={o.onChange}
      onSave={o.onSave}
      fonts={o.fonts}
    />,
  )
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

// the verdict's sentence: the preview's console says it in one line, with the whole of it as that line's title
const verdict = (host: HTMLElement) =>
  host.querySelector('.lm-canvas-verdict .lm-headline')?.getAttribute('title') ?? ''

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
const tabNames = (host: HTMLElement) => [...host.querySelectorAll('.lme-ftabs [role="tab"]')].map((t) => t.textContent)
const activeTab = (host: HTMLElement) => host.querySelector('.lme-ftab[data-active] [role="tab"]')?.textContent
/** The files' explorer, shown: it loads when first asked for. */
async function explorer(host: HTMLElement) {
  await expect.poll(() => host.querySelector('.lme-ftoggle')).toBeTruthy()
  if (!host.querySelector('.lme-tree')) host.querySelector<HTMLElement>('.lme-ftoggle')!.click()
  await expect.poll(() => host.querySelector('.lme-tree'), { timeout: 5000 }).toBeTruthy()
}
/** A file in the editor, picked in the explorer: its tab opens, or is the one shown. */
async function openFile(host: HTMLElement, path: string) {
  await explorer(host)
  host.querySelector<HTMLElement>(`.lme-tree-row[data-path="${path}"]`)!.click()
  await expect.poll(() => host.querySelector('.lme-ftab[data-active] [role="tab"]')?.getAttribute('title')).toBe(path)
}
const several = {
  path: 'shop.loadmap',
  files: { 'shop.loadmap': shop, 'shop.story.loadmap': story, 'platform.loadmap': platform },
}

describe('the editor', () => {
  it("shows a definition in several files as tabs, the diagram the model's whichever is open", async () => {
    const files = {
      path: 'shop.loadmap',
      files: { 'shop.loadmap': shop, 'shop.story.loadmap': story, 'platform.loadmap': platform },
    }
    const { host, handle, view, edit } = await mount({ source: shop, several: files })
    const tabs = () => [...host.querySelectorAll('.lme-ftabs [role="tab"]')].map((t) => t.textContent)
    const show = (path: string) => openFile(host, path)
    const status = () => host.querySelector('.lme-status')!.textContent
    const boxes = () =>
      [...host.querySelectorAll('.lme-preview [data-node]')].map((el) => el.getAttribute('data-node')).sort()
    const all = ['db', 'gateway', 'orderLine.consumers', 'orderLine.kafka', 'phones']
    // the model first; its subsystem's boxes are drawn under its id
    // the model alone has a tab; the others open from the explorer
    await expect.poll(tabs).toEqual(['shop.loadmap'])
    await expect.poll(status).toBe('No problems')
    expect(boxes()).toEqual(all)
    // the part in the editor: its own text, read through the model, the same diagram
    await show('shop.story.loadmap')
    expect(view.state.doc.toString()).toBe(story)
    await expect.poll(status).toBe('No problems')
    expect(boxes()).toEqual(all)
    // a mistake in the part is the part's: said there, the last good diagram kept
    edit('focus: orderLine.consumers }', 'focus: orderLine.nowhere }')
    await expect.poll(status, { timeout: 5000 }).toMatch(/error/)
    expect(host.querySelector('.lme-problems')!.textContent).toContain('shop.story.loadmap:')
    // back in the model, the problem is still listed, under the part's name; a click on it opens the part there
    await show('shop.loadmap')
    expect(view.state.doc.toString()).toBe(shop)
    await expect.poll(status, { timeout: 5000 }).toMatch(/error/)
    ;(host.querySelector('.lme-problems button') as HTMLElement).click()
    await expect.poll(() => view.state.doc.toString()).toContain('orderLine.nowhere')
    edit('focus: orderLine.nowhere }', 'focus: orderLine.consumers }')
    await expect.poll(status, { timeout: 5000 }).toBe('No problems')
    // the library in the editor: the diagram stays the model's
    await show('platform.loadmap')
    expect(view.state.doc.toString()).toBe(platform)
    await expect.poll(status, { timeout: 5000 }).toBe('No problems')
    expect(boxes()).toEqual(all)
    // a rename in the model reaches the part: its text changes behind its tab, and the model still compiles
    const withStep = story.replace('{ load: 1 }', '{ load: 1; focus: gateway }')
    handle.setFiles({ ...files, files: { ...files.files, 'shop.story.loadmap': withStep } })
    await expect.poll(() => view.state.doc.toString()).toBe(shop)
    await expect.poll(status, { timeout: 5000 }).toBe('No problems')
    view.dispatch({ selection: { anchor: shop.indexOf('node gateway') + 6 } })
    view.focus()
    await userEvent.keyboard('{F2}')
    await expect.poll(() => document.querySelector<HTMLInputElement>('.lm-rename input')?.value).toBe('gateway')
    await userEvent.keyboard('frontDoor{Enter}')
    await expect.poll(() => view.state.doc.toString()).toContain('node frontDoor')
    expect(handle.files().files['shop.story.loadmap']).toContain('focus: frontDoor')
    await expect.poll(status, { timeout: 5000 }).toBe('No problems')
    // undo takes the rename back in every file it reached, redo makes it again: the model compiles all the way
    undo(view)
    await expect.poll(() => view.state.doc.toString()).toBe(shop)
    expect(handle.files().files['shop.story.loadmap']).toBe(withStep)
    await expect.poll(status, { timeout: 5000 }).toBe('No problems')
    redo(view)
    await expect.poll(() => view.state.doc.toString()).toContain('node frontDoor')
    expect(handle.files().files['shop.story.loadmap']).toContain('focus: frontDoor')
    await expect.poll(status, { timeout: 5000 }).toBe('No problems')
    // only the rename's own step: other edits undone and redone around it leave the other files alone
    undo(view)
    await expect.poll(() => handle.files().files['shop.story.loadmap']).toBe(withStep)
    edit('max: 100; default: 10', 'max: 100; default: 11')
    undo(view)
    redo(view)
    expect(view.state.doc.toString()).toContain('default: 11')
    expect(handle.files().files['shop.story.loadmap']).toBe(withStep)
    undo(view)
    expect(view.state.doc.toString()).toBe(shop)
    // the rename again, for what follows
    view.dispatch({ selection: { anchor: shop.indexOf('node gateway') + 6 } })
    view.focus()
    await userEvent.keyboard('{F2}')
    await expect.poll(() => document.querySelector<HTMLInputElement>('.lm-rename input')?.value).toBe('gateway')
    await userEvent.keyboard('frontDoor{Enter}')
    await expect.poll(() => handle.files().files['shop.story.loadmap']).toContain('focus: frontDoor')
    // from the part's own tab too: undone there, it is undone in the model
    await show('shop.story.loadmap')
    undo(view)
    await expect.poll(() => view.state.doc.toString()).toBe(withStep)
    expect(handle.files().files['shop.loadmap']).toBe(shop)
    await expect.poll(status, { timeout: 5000 }).toBe('No problems')
    // a file edited after the rename keeps its name, and the editor says so
    redo(view)
    await expect.poll(() => handle.files().files['shop.loadmap']).toContain('node frontDoor')
    edit('{ load: 30; focus: orderLine.consumers }', '{ load: 31; focus: orderLine.consumers }')
    await show('shop.loadmap')
    undo(view)
    await expect.poll(() => view.state.doc.toString()).toBe(shop)
    expect(handle.files().files['shop.story.loadmap']).toContain('focus: frontDoor')
    handle.setFiles(files)
    await expect.poll(() => view.state.doc.toString()).toBe(shop)
    await expect.poll(status, { timeout: 5000 }).toBe('No problems')
    // a link carries every file, and opens the model
    const shared = await decodeShare(await handle.shareHash())
    expect(shared).toMatchObject({ source: shop, path: 'shop.loadmap', files: files.files })
    expect(handle.files()).toEqual(files)
    // one file again, the explorer hidden: no tabs, and the link every page reads
    host.querySelector<HTMLElement>('[aria-label="Hide the files"]')!.click()
    handle.setSource(checkout)
    await expect.poll(tabs).toEqual([])
    expect(await handle.shareHash()).toMatch(/^v1\./)
  })

  it('opens files from the explorer as one row of tabs; a tab closed keeps its file', async () => {
    const { host, handle, view, edit } = await mount({ source: shop, several })
    const row = () => host.querySelector('.lme-ftabs')!.getBoundingClientRect()
    // the row has its room before the tabs have loaded
    expect(row().height).toBe(30)
    await expect.poll(() => tabNames(host)).toEqual(['shop.loadmap'])
    expect(row().height).toBe(30)
    // the model's tab has no way to close it
    expect(host.querySelector('.lme-ftab-x')).toBeNull()
    await explorer(host)
    const rows = () =>
      [...host.querySelectorAll<HTMLElement>('.lme-tree-row')].map(
        (r) => `${r.dataset.path} ${r.querySelector('.lme-tree-role')?.textContent}`,
      )
    // the model first, each file with what its head says it is, and under it the subsystems it declares
    expect(rows()).toEqual([
      'shop.loadmap model',
      'shop.loadmap#orderLine subsystem',
      'platform.loadmap library',
      'platform.loadmap#pipeline subsystem',
      'shop.story.loadmap part',
    ])
    // a subsystem's row opens its file at its line
    host.querySelector<HTMLElement>('.lme-tree-row[data-path="platform.loadmap#pipeline"]')!.click()
    await expect.poll(() => activeTab(host)).toBe('platform.loadmap')
    const line = view.state.doc.lineAt(view.state.selection.main.head).text
    expect(line).toBe('subsystem pipeline "Queue and workers" {')
    expect(host.querySelector('.lme-tree-row[data-path="platform.loadmap#pipeline"] .lme-tree-name')?.textContent).toBe(
      'Queue and workers',
    )
    await openFile(host, 'shop.loadmap')
    await openFile(host, 'shop.story.loadmap')
    expect(view.state.doc.toString()).toBe(story)
    await openFile(host, 'platform.loadmap')
    // the library's tab came first, from its subsystem's row
    expect(tabNames(host)).toEqual(['shop.loadmap', 'platform.loadmap', 'shop.story.loadmap'])
    // one snug row, however many: every tab on one line, the row no taller
    const tops = [...host.querySelectorAll('.lme-ftab')].map((t) => Math.round(t.getBoundingClientRect().top))
    expect(new Set(tops).size).toBe(1)
    expect(row().height).toBe(30)
    // a mistake in a part marks its tab and its row, from any file
    await openFile(host, 'shop.story.loadmap')
    edit('focus: orderLine.consumers }', 'focus: orderLine.nowhere }')
    const dot = (inside: string) => host.querySelector(`${inside} .lme-fdot[data-mark="error"]`)
    await expect.poll(() => dot('.lme-ftab[data-active]'), { timeout: 5000 }).toBeTruthy()
    expect(dot('.lme-tree-row[data-path="shop.story.loadmap"]')).toBeTruthy()
    await openFile(host, 'shop.loadmap')
    await expect.poll(() => host.querySelectorAll('.lme-ftab .lme-fdot').length, { timeout: 5000 }).toBe(1)
    expect(host.querySelector('.lme-ftab[data-active] .lme-fdot')).toBeNull()
    await openFile(host, 'shop.story.loadmap')
    edit('focus: orderLine.nowhere }', 'focus: orderLine.consumers }')
    await expect.poll(() => host.querySelector('.lme-fdot'), { timeout: 5000 }).toBeNull()
    // the arrows, Home and End move between the tabs, the keyboard with them
    host.querySelector<HTMLElement>('.lme-ftab[data-active] [role="tab"]')!.focus()
    // the story's tab is the last: the library's is before it
    await userEvent.keyboard('{ArrowLeft}')
    await expect.poll(() => activeTab(host)).toBe('platform.loadmap')
    await expect.poll(() => document.activeElement?.textContent).toBe('platform.loadmap')
    expect(view.state.doc.toString()).toBe(platform)
    await userEvent.keyboard('{Home}')
    await expect.poll(() => activeTab(host)).toBe('shop.loadmap')
    await expect.poll(() => document.activeElement?.textContent).toBe('shop.loadmap')
    // one stop for Tab
    expect(
      [...host.querySelectorAll<HTMLElement>('.lme-ftablist button')].filter((b) => b.tabIndex === 0),
    ).toHaveLength(1)
    // a tab closed: the file stays one of the definition's, and opens again from the explorer
    host.querySelector<HTMLElement>('[aria-label="Close platform.loadmap"]')!.click()
    await expect.poll(() => tabNames(host)).toEqual(['shop.loadmap', 'shop.story.loadmap'])
    expect(handle.files().files['platform.loadmap']).toBe(platform)
    // Delete closes the tab the keyboard is on; the one beside it shows
    await userEvent.keyboard('{End}')
    await expect.poll(() => activeTab(host)).toBe('shop.story.loadmap')
    await userEvent.keyboard('{Delete}')
    await expect.poll(() => tabNames(host)).toEqual(['shop.loadmap'])
    expect(view.state.doc.toString()).toBe(shop)
    expect(handle.files()).toEqual(several)
    await openFile(host, 'platform.loadmap')
    expect(view.state.doc.toString()).toBe(platform)
  })

  it('adds, renames and removes files in the explorer, the head lines following', async () => {
    const { host, handle, view } = await mount({ source: shop, several })
    const status = () => host.querySelector('.lme-status')!.textContent
    const field = () => host.querySelector<HTMLInputElement>('.lme-tree-field input')
    const paths = () => Object.keys(handle.files().files).sort()
    await explorer(host)
    // a part moved into a folder: the model's include follows, and the part's own "part of"
    host.querySelector<HTMLElement>('[aria-label="Rename shop.story.loadmap"]')!.click()
    await expect.poll(() => field()?.value).toBe('shop.story')
    await userEvent.fill(field()!, 'parts/walk')
    await userEvent.keyboard('{Enter}')
    await expect.poll(paths).toEqual(['parts/walk.loadmap', 'platform.loadmap', 'shop.loadmap'])
    expect(view.state.doc.toString()).toContain('include "./parts/walk.loadmap"')
    expect(handle.files().files['parts/walk.loadmap']).toContain('part of "../shop.loadmap"')
    await expect.poll(status, { timeout: 5000 }).toBe('No problems')
    // the tree shows the folder, and the keyboard is on the file's row
    expect(host.querySelector('.lme-tree-row[data-folder]')?.textContent).toBe('parts')
    await expect.poll(() => (document.activeElement as HTMLElement | null)?.dataset.path).toBe('parts/walk.loadmap')
    // a name another file has is refused, said under the field; Escape leaves the file as it was
    await userEvent.keyboard('{F2}')
    await expect.poll(() => field()?.value).toBe('parts/walk')
    await userEvent.fill(field()!, 'platform')
    await userEvent.keyboard('{Enter}')
    await expect
      .poll(() => host.querySelector('.lme-tree-field [role="alert"]')?.textContent)
      .toBe('There is a platform.loadmap already')
    await userEvent.keyboard('{Escape}')
    await expect.poll(field).toBeNull()
    expect(paths()).toEqual(['parts/walk.loadmap', 'platform.loadmap', 'shop.loadmap'])
    // a variant: a file that extends the model, opened in its own tab; the model's text does not change
    const model = view.state.doc.toString()
    await userEvent.click(page.getByRole('button', { name: 'New file' }))
    await userEvent.click(page.getByRole('menuitem', { name: 'A variant of this model' }))
    await expect.poll(field).toBeTruthy()
    await userEvent.fill(field()!, 'big')
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => activeTab(host)).toBe('shop.big.loadmap')
    expect(view.state.doc.toString()).toBe(`${shop.split('\n')[0]}\nextends "./shop.loadmap"\n`)
    expect(handle.files().files['shop.loadmap']).toBe(model)
    await expect.poll(status, { timeout: 5000 }).toBe('No problems')
    // a part removed: asked first, then the file goes with the include that named it
    host.querySelector<HTMLElement>('[aria-label="Remove walk.loadmap"]')!.click()
    await expect.poll(() => host.querySelector('.lme-tree-ask p')?.textContent).toBe('Remove walk.loadmap?')
    host.querySelector<HTMLElement>('.lme-tree-ask .lme-danger')!.click()
    await expect.poll(paths).toEqual(['platform.loadmap', 'shop.big.loadmap', 'shop.loadmap'])
    expect(handle.files().files['shop.loadmap']).not.toContain('include "./parts')
    // the model has no way to remove it
    expect(host.querySelector('[aria-label="Remove shop.loadmap"]')).toBeNull()
    // Add in the bar's menu asks the name in the explorer too
    await userEvent.click(page.getByRole('button', { name: 'New', exact: true }))
    await userEvent.click(page.getByRole('menuitem', { name: 'A part of this model…' }))
    await expect.poll(field).toBeTruthy()
    await userEvent.fill(field()!, 'data')
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => activeTab(host)).toBe('shop.data.loadmap')
    expect(handle.files().files['shop.loadmap']).toContain('include "./shop.data.loadmap"')
  })

  it('redraws the diagram as the text changes, keeping the values', async () => {
    const { host, handle, edit } = await mount()
    handle.loadmap()!.setValues({ pods: 6 })
    expect(verdict(host)).toContain('At 10×, every component is under the 50 % target')
    edit('rate: 40 * load', 'rate: 400 * load')
    await expect
      .poll(() => verdict(host), { timeout: 5000 })
      .toContain('but the API gateway runs above the 50 % target')
    expect(handle.loadmap()!.values().pods).toBe(6)
    // ten times the orders breaks both promises: a warning on each line, the diagram still shown; at 6 pods the
    // first holds only at the high edge of the gateway's ±, so it is inconclusive, not a failure
    await expect.poll(() => host.querySelector('.lme-status')!.textContent).toBe('2 warnings')
    expect(host.querySelector('.lme-problems [data-severity="warning"]')!.textContent).toMatch(
      /^\d+:1 "Today keeps 7×" is inconclusive: holds at 7× only at the high edge of a ±; expected at least 7×, but the 50 % target holds up to between/,
    )
    expect(host.querySelector('.lme-preview')!.hasAttribute('data-stale')).toBe(false)
    edit('"Postgres primary"', '"Main database"')
    await expect
      .poll(
        () => {
          openTab(host, 'Limits')
          return host.querySelector('.lm-lim[data-component="db"] b')?.textContent
        },
        { timeout: 5000 },
      )
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
    first.handle.loadmap()!.setValues({ load: 25, mergeNewest: false })
    const hash = await first.handle.shareHash()
    expect(hash).toMatch(/^v1\.[\w-]+&load=25&mergeNewest=false$/)
    const shared = await decodeShare(`#${hash}`)
    if ('error' in shared) throw new Error(shared.error)
    expect(shared.source).toBe(alerts)
    root?.unmount()
    document.body.replaceChildren()
    const again = await mount(shared)
    expect(again.handle.loadmap()!.values()).toMatchObject({ load: 25, mergeNewest: false })
    expect(verdict(again.host)).toContain('At 25×')
  })

  it('copies an embed link with the options picked, or the iframe that frames it', async () => {
    const calls: [string, EmbedOptions][] = []
    const embedLink = (hash: string, o: EmbedOptions) => {
      calls.push([hash, o])
      return `https://x.test/embed/?theme=${o.theme}#${hash}`
    }
    const { host, handle } = await mount({ source: alerts, embedLink })
    handle.loadmap()!.setValues({ load: 25 })
    await userEvent.click(page.getByRole('button', { name: 'More ways to share' }))
    await userEvent.click(page.getByRole('menuitem', { name: 'Embed in a page…' }))
    // its options load as it first opens, under Share, inside the window, the keyboard on the first
    await expect.poll(() => host.querySelector('.lme-embed')).toBeTruthy()
    const pop = host.querySelector('.lme-pop')!.getBoundingClientRect()
    expect(pop.left >= 0 && pop.right <= document.documentElement.clientWidth).toBe(true)
    expect(pop.top).toBeGreaterThan(host.querySelector('.lme-share')!.getBoundingClientRect().bottom)
    await expect.poll(() => (document.activeElement as HTMLInputElement | null)?.type).toBe('radio')
    await userEvent.click(page.getByLabelText('Dark'))
    await userEvent.click(page.getByLabelText(/Play the story/))
    await userEvent.click(page.getByRole('button', { name: 'Copy link' }))
    await expect.poll(() => calls.length).toBe(1)
    const [hash, options] = calls[0]!
    // the diagram first, though alerts' full screen opens on the panels
    expect(options).toEqual({ mode: 'focus', theme: 'dark', play: true })
    expect(hash).toBe(await handle.shareHash())
    // in a box too, for when the clipboard refuses it
    const made = () => host.querySelector<HTMLInputElement>('.lme-made')?.value
    await expect.poll(made).toBe(`https://x.test/embed/?theme=dark#${hash}`)
    await userEvent.click(page.getByRole('button', { name: 'Copy <iframe>' }))
    // the link's "&" escaped inside the attribute
    await expect
      .poll(made)
      .toBe(
        `<iframe src="https://x.test/embed/?theme=dark#${hash.replace(/&/g, '&amp;')}" title="Alerts and live positions" width="100%" height="480" style="border: 0" loading="lazy" allow="fullscreen"></iframe>`,
      )
    // Escape closes it; opened again, the keyboard goes back into it
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => host.querySelector('.lme-pop:popover-open')).toBeNull()
    await userEvent.click(page.getByRole('button', { name: 'More ways to share' }))
    await userEvent.click(page.getByRole('menuitem', { name: 'Embed in a page…' }))
    await expect.poll(() => (document.activeElement as HTMLInputElement | null)?.type).toBe('radio')
  })

  it('has no embed menu without a page to frame it', async () => {
    const { host } = await mount()
    expect(host.querySelector('.lme-pop')).toBeNull()
    expect(page.getByRole('button', { name: 'More ways to share' }).query()).toBeNull()
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

  it('lists its keys under View, and finds in the text with Mod-F, beyond the lines in view', async () => {
    const { host, view } = await mount()
    const mac = /Mac|iP/.test(navigator.platform)
    await userEvent.click(page.getByRole('button', { name: 'View' }))
    await userEvent.click(page.getByRole('menuitem', { name: 'Keyboard shortcuts…' }))
    // it loads as it is first asked for
    await expect.poll(() => document.querySelector('.lme-keysheet[open]'), { timeout: 5000 }).toBeTruthy()
    const sheet = document.querySelector('.lme-keysheet')!
    expect(sheet.getAttribute('aria-labelledby')).toBeTruthy()
    expect(sheet.textContent).toContain('What fits at the cursor')
    expect(sheet.textContent).toContain(mac ? '⌘I, ⌥I or ⌃Space' : 'Ctrl+Space')
    // ⌘S on a page that keeps no copy
    expect(sheet.textContent).toContain(
      `Nothing to save: this page keeps no copy, Share does${mac ? '⌘S or ⇧⌘S' : 'Ctrl+S or Shift+Ctrl+S'}`,
    )
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => document.querySelector('.lme-keysheet')).toBeNull()
    // back in the text, where the keys work
    expect(view.hasFocus).toBe(true)
    view.dispatch({ selection: { anchor: 0 }, scrollIntoView: true })
    const last = 'kafka -> kafkaDropped'
    // the last lines are not drawn: the browser's find would miss them
    expect([...host.querySelectorAll('.cm-line')].some((l) => l.textContent?.includes(last))).toBe(false)
    const mod = mac ? 'Meta' : 'Control'
    await userEvent.keyboard(`{${mod}>}f{/${mod}}`)
    await expect.poll(() => document.querySelector('.cm-search input[name="search"]'), { timeout: 5000 }).toBeTruthy()
    await userEvent.keyboard(`${last}{Enter}`)
    await expect
      .poll(() => view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to))
      .toBe(last)
    await expect
      .poll(() => [...host.querySelectorAll('.cm-line')].some((l) => l.textContent?.includes(last)))
      .toBe(true)
  })

  it("takes ⌘S from the browser's Save Page: the page saves, or the note says what keeps the text", async () => {
    const mac = /Mac|iP/.test(navigator.platform)
    const mod = mac ? 'Meta' : 'Control'
    const note = (host: HTMLElement) => host.querySelector('.lme-note')?.textContent
    /** A key pressed on `target`, as the browser sends it: whether its default (Save Page) was prevented. */
    const press = (target: Element, init: KeyboardEventInit) => {
      const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
      target.dispatchEvent(e)
      return e.defaultPrevented
    }
    const save = { key: 's', code: 'KeyS', keyCode: 83, [mac ? 'metaKey' : 'ctrlKey']: true }

    // a page that keeps no copy: the note says so
    let { host, view } = await mount()
    view.focus()
    await userEvent.keyboard(`{${mod}>}s{/${mod}}`)
    await expect.poll(() => note(host)).toBe('This page keeps no copy, Share does')
    expect(view.state.doc.toString()).toBe(checkout)
    expect(press(view.contentDOM, save)).toBe(true)
    expect(press(view.contentDOM, { ...save, shiftKey: true })).toBe(true)
    // anywhere else in the editor: the same
    expect(press(host.querySelector('.lm-canvas-verdict')!, save)).toBe(true)
    // a layout without Latin letters: the key the layout gives the S's code
    expect(press(view.contentDOM, { ...save, key: 'ы' })).toBe(true)
    // the other platform's modifier, ⌥ with it, or the letter alone are not Save
    expect(press(view.contentDOM, { ...save, metaKey: !mac, ctrlKey: mac })).toBe(false)
    expect(press(view.contentDOM, { ...save, altKey: true })).toBe(false)
    expect(press(view.contentDOM, { key: 's', code: 'KeyS', keyCode: 83 })).toBe(false)
    // another letter, away from the text (where CodeMirror takes some: ⌘D selects the next match)
    expect(press(host.querySelector('.lm-canvas-verdict')!, { ...save, key: 'd', code: 'KeyD', keyCode: 68 })).toBe(
      false,
    )
    root?.unmount()
    document.body.replaceChildren()

    // a page that keeps a draft
    ;({ host, view } = await mount({ onChange: () => {} }))
    view.focus()
    await userEvent.keyboard(`{${mod}>}s{/${mod}}`)
    await expect.poll(() => note(host)).toBe('Kept as you type')
    root?.unmount()
    document.body.replaceChildren()

    // a page with a save of its own: every file, as they are now; one save at a time, and a held key saves once
    const saved: EditorFiles[] = []
    let done = () => {}
    ;({ host, view } = await mount({
      onSave: (f) => {
        saved.push(f)
        return new Promise<void>((r) => {
          done = r
        })
      },
    }))
    view.focus()
    view.dispatch({ changes: { from: 0, insert: '# saved\n' } })
    await userEvent.keyboard(`{${mod}>}{Shift>}s{/Shift}{/${mod}}`)
    await expect.poll(() => saved.length).toBe(1)
    expect(saved[0]!.files[saved[0]!.path]).toBe(`# saved\n${checkout}`)
    expect(note(host)).toBe('Saving…')
    expect(press(view.contentDOM, save)).toBe(true)
    expect(press(view.contentDOM, { ...save, repeat: true })).toBe(true)
    expect(saved).toHaveLength(1)
    done()
    await expect.poll(() => note(host)).toBe('Saved')
    expect(press(view.contentDOM, save)).toBe(true)
    await expect.poll(() => saved.length).toBe(2)
    root?.unmount()
    document.body.replaceChildren()

    // a save that fails says so
    ;({ host, view } = await mount({ onSave: () => Promise.reject(new Error('the branch moved')) }))
    view.focus()
    await userEvent.keyboard(`{${mod}>}s{/${mod}}`)
    await expect.poll(() => note(host)).toBe('Not saved: the branch moved')
  })

  it("sets the code's font, its size and its ligatures from View, the reader's own, each font fetched when picked", async () => {
    const keys = ['loadmap:editor:font', 'loadmap:editor:fontSize', 'loadmap:editor:ligatures']
    for (const k of keys) localStorage.removeItem(k)
    const fonts: CodeFont[] = [
      { name: 'Fira Code', url: firaCode },
      { name: 'JetBrains Mono', url: jetbrainsMono },
      { name: 'Cascadia Code', url: cascadiaCode },
    ]
    const face = (name: string) => [...document.fonts].find((f) => f.family.replaceAll('"', '') === name)
    try {
      let { host, handle, view } = await mount({ fonts })
      const scroller = () => getComputedStyle(view.scrollDOM)
      // by the end of its name: the ✓ before a checked one is drawn in CSS, which Playwright reads into it
      const named = (name: string) => new RegExp(`(^|\\s)${name}$`)
      const pick = async (role: 'menuitemradio' | 'menuitemcheckbox', name: string) => {
        await page.getByRole('button', { name: 'View' }).click()
        await page.getByRole(role, { name: named(name) }).click()
      }
      // at first the system's monospace at 13 px, ligatures on, and no font fetched
      expect(scroller().fontFamily).not.toContain('Fira Code')
      expect(scroller().fontSize).toBe('13px')
      expect(scroller().fontVariantLigatures).toBe('normal')
      expect(fonts.some((f) => face(f.name))).toBe(false)
      await page.getByRole('button', { name: 'View' }).click()
      await expect
        .element(page.getByRole('menuitemradio', { name: named('System') }))
        .toHaveAttribute('aria-checked', 'true')
      await expect.element(page.getByRole('menuitemradio', { name: '13 px' })).toHaveAttribute('aria-checked', 'true')
      await userEvent.keyboard('{Escape}')

      // a font: the code draws in it once its file is in, the text unchanged
      const before = handle.source()
      await pick('menuitemradio', 'Fira Code')
      expect(scroller().fontFamily).toMatch(/^"Fira Code", /)
      await expect.poll(() => face('Fira Code')?.status, { timeout: 5000 }).toBe('loaded')
      expect(face('JetBrains Mono')).toBeUndefined()
      expect(handle.source()).toBe(before)
      // a size, and the lines are measured again: the cursor sits on its line
      await pick('menuitemradio', '16 px')
      expect(scroller().fontSize).toBe('16px')
      view.dispatch({ selection: { anchor: view.state.doc.line(3).from } })
      await expect
        .poll(() => Math.round(view.coordsAtPos(view.state.doc.line(3).from)!.top))
        .toBe(Math.round(view.lineBlockAt(view.state.doc.line(3).from).top + view.documentTop))
      // ligatures off: "->" and "!=" as their two marks
      await pick('menuitemcheckbox', 'Ligatures')
      expect(host.querySelector('.lme-code')!.getAttribute('data-ligatures')).toBe('off')
      expect(scroller().fontVariantLigatures).toBe('none')
      expect(localStorage.getItem('loadmap:editor:font')).toBe('Fira Code')
      expect(localStorage.getItem('loadmap:editor:fontSize')).toBe('16')
      expect(localStorage.getItem('loadmap:editor:ligatures')).toBe('off')

      // kept in this browser: a new editor opens as the reader left it
      root?.unmount()
      document.body.replaceChildren()
      ;({ host, handle, view } = await mount({ fonts }))
      expect(scroller().fontFamily).toMatch(/^"Fira Code", /)
      expect(scroller().fontSize).toBe('16px')
      expect(scroller().fontVariantLigatures).toBe('none')
      // back to the defaults: nothing kept
      await pick('menuitemradio', 'System')
      await pick('menuitemradio', '13 px')
      await pick('menuitemcheckbox', 'Ligatures')
      expect(scroller().fontFamily).not.toContain('Fira Code')
      for (const k of keys) expect(localStorage.getItem(k)).toBeNull()
      root?.unmount()
      document.body.replaceChildren()

      // a font whose file does not load: the note says so, the system's font stands in
      ;({ host } = await mount({ fonts: [{ name: 'Gone Mono', url: '/no-such-font.woff2' }] }))
      await pick('menuitemradio', 'Gone Mono')
      await expect
        .poll(() => host.querySelector('.lme-note')?.textContent, { timeout: 5000 })
        .toBe("Gone Mono did not load: the system's font stands in")
      // and gives way: the system's is picked again, and the font is not kept
      expect(localStorage.getItem('loadmap:editor:font')).toBeNull()
      await page.getByRole('button', { name: 'View' }).click()
      await expect
        .element(page.getByRole('menuitemradio', { name: named('System') }))
        .toHaveAttribute('aria-checked', 'true')
      await userEvent.keyboard('{Escape}')
      // a page that offers no fonts: only the system's
      root?.unmount()
      document.body.replaceChildren()
      await mount({ fonts: [] })
      await page.getByRole('button', { name: 'View' }).click()
      expect(document.querySelectorAll('[role="group"][aria-label="Font"] [role="menuitemradio"]')).toHaveLength(1)
    } finally {
      for (const k of keys) localStorage.removeItem(k)
    }
  })

  it("draws a capacity's +- as ± while ligatures are on, and leaves the text as written", async () => {
    localStorage.removeItem('loadmap:editor:ligatures')
    try {
      // a "+-" in a text is no sign
      const source = checkout.replace('title: "Checkout pipeline"', 'title: "Checkout +- pipeline"')
      let { host, handle, view } = await mount({ source })
      const signs = () => [...host.querySelectorAll('.lme-code .lme-pm')]
      const mark = source.indexOf('gateways +- 30%') + 'gateways '.length
      // CodeMirror draws only the lines in view
      view.dispatch({ selection: { anchor: mark }, scrollIntoView: true })
      await expect.poll(() => signs().length).toBeGreaterThan(0)
      const sign = signs()[0] as HTMLElement
      expect(sign.textContent).toBe('±')
      // in the room of its two marks
      const ch = view.defaultCharacterWidth
      expect(Math.abs(sign.getBoundingClientRect().width - 2 * ch)).toBeLessThan(1)
      view.dispatch({ effects: EditorView.scrollIntoView(0) })
      await expect.poll(() => host.querySelector('.cm-line')?.textContent).toBe('loadmap 1.6')
      expect([...host.querySelectorAll('.cm-line')].some((l) => l.textContent?.includes('Checkout +- pipeline'))).toBe(
        true,
      )
      // the text keeps its marks, and the cursor steps over the sign as over one character
      expect(handle.source()).toBe(source)
      view.dispatch({ selection: { anchor: mark }, scrollIntoView: true })
      cursorCharRight(view)
      expect(view.state.selection.main.head).toBe(mark + 2)
      expect(view.state.sliceDoc(mark, mark + 2)).toBe('+-')
      // Backspace after the sign and Delete before it take one mark, as in a ligature: what is left is drawn as written
      view.focus()
      await userEvent.keyboard('{Backspace}')
      expect(view.state.sliceDoc(mark, mark + 2)).toBe('+ ')
      expect(view.state.selection.main.head).toBe(mark + 1)
      undo(view)
      view.dispatch({ selection: { anchor: mark } })
      await userEvent.keyboard('{Delete}')
      expect(view.state.sliceDoc(mark, mark + 2)).toBe('- ')
      expect(view.state.selection.main.head).toBe(mark)
      undo(view)
      expect(handle.source()).toBe(source)

      // ligatures off: the marks as written
      await page.getByRole('button', { name: 'View' }).click()
      await page.getByRole('menuitemcheckbox', { name: /Ligatures/ }).click()
      await expect.poll(() => signs().length).toBe(0)
      expect([...host.querySelectorAll('.cm-line')].some((l) => l.textContent?.includes('gateways +- 30%'))).toBe(true)
      await page.getByRole('button', { name: 'View' }).click()
      await page.getByRole('menuitemcheckbox', { name: /Ligatures/ }).click()
      await expect.poll(() => signs().length).toBeGreaterThan(0)
      root?.unmount()
      document.body.replaceChildren()

      // before 1.6 a "+-" is a plus and a minus: drawn as written
      const old = source.replace('loadmap 1.6', 'loadmap 1.5').replace('4_000 +- 30%', '4_000 ± 30%')
      ;({ host, view } = await mount({
        source: old.replace('gateways +- 30%', 'gateways ± 30%') + '\nlet sum = 3 +- 1\n',
      }))
      view.dispatch({ selection: { anchor: view.state.doc.length }, scrollIntoView: true })
      await expect
        .poll(() => [...host.querySelectorAll('.cm-line')].some((l) => l.textContent?.includes('let sum = 3 +- 1')))
        .toBe(true)
      expect(signs()).toHaveLength(0)
    } finally {
      localStorage.removeItem('loadmap:editor:ligatures')
    }
  })

  it('starts from a template', async () => {
    const { host, handle } = await mount()
    await userEvent.click(page.getByRole('button', { name: 'New' }))
    // the list loads as the menu first opens
    // the templates, and Add → From the catalog, a part, a library, a variant
    await expect.poll(() => host.querySelectorAll('[role="menuitem"]').length).toBe(TEMPLATES.length + 4)
    const names = [...host.querySelectorAll('[role="menuitem"]')].map((i) => i.firstChild?.textContent)
    expect(names).toEqual([
      ...TEMPLATES.map((t) => t.title),
      'From the catalog…',
      'A part of this model…',
      'A library…',
      'A variant of this model…',
    ])
    // each with its line, said after its name
    const queue = page.getByRole('menuitem', { name: 'Queue and workers' })
    await expect.element(queue).toHaveAccessibleDescription('An API that queues jobs for a pool of workers.')
    // the text is as it was loaded: no question
    await userEvent.click(queue)
    await expect.poll(() => host.querySelector('.lm h2')?.textContent).toBe('Queue and workers')
    expect(handle.source()).toBe(TEMPLATES.find((t) => t.id === 'queue-workers')!.source)
    await handle.loadmap()!.ready()
    expect(host.querySelectorAll('.lme-preview [data-node]')).toHaveLength(5)
    expect(host.querySelector('.lme-menu:popover-open')).toBeNull()
  })

  it('asks before replacing edited text, and undo brings it back', async () => {
    const { handle, edit, view } = await mount()
    edit('"Postgres primary"', '"Main database"')
    const edited = handle.source()
    const pick = async () => {
      await userEvent.click(page.getByRole('button', { name: 'New' }))
      await userEvent.click(page.getByRole('menuitem', { name: 'Web app and database' }))
    }
    const asked: string[] = []
    const confirm = window.confirm
    try {
      window.confirm = (q) => {
        asked.push(String(q))
        return false
      }
      await pick()
      await expect.poll(() => asked).toEqual(['Replace your text with “Web app and database”?'])
      expect(handle.source()).toBe(edited)
      window.confirm = () => true
      await pick()
      // the starter's text loads when it is picked
      await expect.poll(() => handle.source()).toBe(TEMPLATES[0]!.source)
      undo(view)
      expect(handle.source()).toBe(edited)
    } finally {
      window.confirm = confirm
    }
  })

  it('draws the caret in the theme’s text colour, light on a dark theme', async () => {
    for (const theme of ['dark', 'light'] as const) {
      const { host } = await mount({ theme })
      const caret = getComputedStyle(host.querySelector('.cm-content')!).caretColor
      // the text's colour, as the editor's root computes it
      expect(caret).toBe(getComputedStyle(host.querySelector('.lme')!).color)
      const [r, g, b] = caret.match(/\d+/g)!.map(Number)
      const light = (r! + g! + b!) / 3 > 128
      expect(light, theme).toBe(theme === 'dark')
      root?.unmount()
      root = null
      document.body.replaceChildren()
    }
  })

  it('hides New with templates={false}, catalog={false} and nothing else in it', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    root.render(<LoadmapEditor initial={checkout} templates={false} catalog={false} />)
    await expect.poll(() => host.querySelector('.lme-bar')).toBeTruthy()
    expect(page.getByRole('button', { name: 'New' }).query()).toBeNull()
    expect(page.getByRole('button', { name: 'Export' }).query()).toBeTruthy()
  })

  it('folds View, New and Export into one menu in a narrow column, the bar one row', async () => {
    const { host } = await mount({
      embedLink: (hash) => `https://x.test/embed/#${hash}`,
      exportItems: [{ label: 'Image', items: [{ label: 'PNG', onSelect: () => {} }] }],
    })
    const shown = (name: string) => page.getByRole('button', { name, exact: true }).query()?.checkVisibility() ?? false
    const stops = () => [...host.querySelectorAll<HTMLElement>('.lme-tools button')].filter((b) => b.tabIndex === 0)
    const middle = (e: Element) => {
      const r = e.getBoundingClientRect()
      return Math.round(r.top + r.height / 2)
    }
    // the column's width, not the window's: below 560 px of the editor's own content
    for (const width of [900, 640, 520, 420, 320]) {
      host.style.width = `${width}px`
      const narrow = width < 560
      await expect.poll(() => shown('More')).toBe(narrow)
      // one row: the status and every control on one line
      const row = [host.querySelector('.lme-status')!, ...host.querySelectorAll<HTMLElement>('.lme-bar button')]
        .filter((e) => !e.closest('[popover]') && e.checkVisibility())
        .map(middle)
      expect(Math.max(...row) - Math.min(...row), `${width}`).toBeLessThanOrEqual(1)
      // one stop for Tab, on a control that shows
      expect(stops().length, `${width}`).toBe(1)
      await expect.poll(() => stops()[0]!.checkVisibility()).toBe(true)
      for (const name of ['Hide code', 'Format', 'New', 'Export']) expect(shown(name), `${width} ${name}`).toBe(!narrow)
      if (narrow) {
        await userEvent.click(page.getByRole('button', { name: 'More', exact: true }))
        for (const name of ['Hide code', 'Format', 'Web app and database', 'Download .loadmap', 'PNG'])
          await expect.element(page.getByRole('menuitem', { name, exact: true })).toBeVisible()
        await userEvent.keyboard('{Escape}')
      }
      expect(shown('Share'), `${width}`).toBe(true)
    }
    // the keyboard on Export as the column narrows: it moves to the bar's stop, not to the page
    // a column resizes over frames: the bar's observer sees each width
    const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    host.style.width = '900px'
    await expect.poll(() => shown('Export')).toBe(true)
    await frames()
    ;(page.getByRole('button', { name: 'Export' }).element() as HTMLElement).focus()
    host.style.width = '400px'
    await expect.poll(() => document.activeElement?.getAttribute('aria-label')).toBe('More')
    // a menu open as its button goes closes
    host.style.width = '900px'
    await frames()
    await userEvent.click(page.getByRole('button', { name: 'New' }))
    await expect.poll(() => host.querySelector('.lme-menu:popover-open')).toBeTruthy()
    await frames()
    host.style.width = '400px'
    await expect.poll(() => host.querySelector('.lme-menu:popover-open')).toBeNull()
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

describe('the editor filling its container', () => {
  async function fill(
    width: number,
    o: {
      split?: number
      onSplit?: (n: number) => void
      onPanel?: (p: string) => void
      panel?: 'pinned' | 'auto'
      panelWidth?: number
      onPanelWidth?: (px: number) => void
      layout?: 'code' | 'reader'
      start?: string
      embedLink?: (hash: string, o: EmbedOptions) => string
      newItems?: BarSection[]
      exportItems?: BarSection[]
      actions?: ReactNode
      several?: EditorFiles
    } = {},
  ) {
    await page.viewport(Math.max(1440, width), 900)
    const host = document.createElement('div')
    host.style.cssText = `width: ${width}px; height: 700px`
    document.body.appendChild(host)
    const ref = createRef<LoadmapEditorHandle>()
    root = createRoot(host)
    root.render(
      <LoadmapEditor
        ref={ref}
        fill
        initial={o.several ? o.several.files[o.several.path]! : checkout}
        files={o.several}
        split={o.split}
        onSplit={o.onSplit}
        onPanel={o.onPanel}
        panel={o.panel}
        panelWidth={o.panelWidth}
        onPanelWidth={o.onPanelWidth}
        layout={o.layout}
        start={o.start && <a href="/">{o.start}</a>}
        embedLink={o.embedLink}
        newItems={o.newItems}
        exportItems={o.exportItems}
        actions={o.actions}
      />,
    )
    await expect.poll(() => ref.current?.loadmap()).toBeTruthy()
    await ref.current!.loadmap()!.ready()
    return { host, handle: ref.current! }
  }
  const box = (host: HTMLElement, s: string) => host.querySelector(s)!.getBoundingClientRect()
  /** Where the diagram's boxes are drawn, all of them. */
  const drawn = (host: HTMLElement) => {
    const r = [...host.querySelectorAll('.lme-preview [data-node]')].map((n) => n.getBoundingClientRect())
    return {
      left: Math.min(...r.map((b) => b.left)),
      right: Math.max(...r.map((b) => b.right)),
      top: Math.min(...r.map((b) => b.top)),
      bottom: Math.max(...r.map((b) => b.bottom)),
    }
  }

  it('gives the tabs a row of their own over the text, and the explorer a column the canvas makes room for', async () => {
    const { host } = await fill(1440, { several })
    // under the panel's head, over the text: a row of its own, never squeezed out
    expect(box(host, '.lme-ftabs').height).toBe(30)
    expect(box(host, '.lme-ftabs').top).toBeCloseTo(box(host, '.lme-pane-head').bottom, 0)
    expect(box(host, '.lme-code').top).toBeCloseTo(box(host, '.lme-ftabs').bottom, 0)
    expect(box(host, '.lme-code').bottom).toBeCloseTo(box(host, '.lme-left').bottom, 0)
    const code = box(host, '.lme-code').width
    await explorer(host)
    // the explorer's column is added to the panel: the text keeps its width, the canvas starts where the panel ends
    expect(box(host, '.lme-files').width).toBe(220)
    await expect.poll(() => box(host, '.lme-code').width).toBeCloseTo(code, 0)
    expect(box(host, '.lme-files').top).toBeCloseTo(box(host, '.lme-ftabs').top, 0)
    expect(box(host, '.lme-files').bottom).toBeCloseTo(box(host, '.lme-code').bottom, 0)
    await expect.poll(() => box(host, '.lme-canvas').left).toBeCloseTo(box(host, '.lme-left').right, 0)
    // the View menu hides it again
    await userEvent.click(page.getByRole('button', { name: 'View', exact: true }))
    await userEvent.click(page.getByRole('menuitemcheckbox', { name: 'Files' }))
    await expect.poll(() => host.querySelector('.lme-files')).toBeNull()
    await expect.poll(() => box(host, '.lme-left').width).toBeCloseTo(440, 0)
  })

  it('shows a phone the open files in a row a thumb high, and the files over the text', async () => {
    const { host } = await fill(390, { several })
    expect(box(host, '.lme-ftabs').height).toBe(40)
    expect(box(host, '.lme-code').top).toBeCloseTo(box(host, '.lme-ftabs').bottom, 0)
    await explorer(host)
    // over the text, as wide as the phone, each row a thumb high
    expect(box(host, '.lme-files').width).toBe(390)
    expect(box(host, '.lme-tree-row').height).toBe(44)
    // a pick opens the file and shows its text
    host.querySelector<HTMLElement>('.lme-tree-row[data-path="shop.story.loadmap"]')!.click()
    await expect.poll(() => host.querySelector('.lme-files')).toBeNull()
    expect(activeTab(host)).toBe('shop.story.loadmap')
    // the tabs scroll, they never wrap
    const tops = [...host.querySelectorAll('.lme-ftab')].map((t) => Math.round(t.getBoundingClientRect().top))
    expect(new Set(tops).size).toBe(1)
  })

  it('switches the lanes’ fills and the dot grid from the View menu, and gives a lane its own colour', async () => {
    localStorage.removeItem('loadmap:editor:grid')
    const { host, handle } = await fill(1400, { layout: 'reader' })
    const lanes = () =>
      [...host.querySelectorAll('.lme-preview .lm-tier')].map((g) => g.querySelector<SVGRectElement>('[data-lane]'))
    // by a part of its name: the ✓ before a checked one is drawn in CSS, which Playwright reads into it
    const item = (name: string) => page.getByRole('menuitemcheckbox', { name: new RegExp(name) })
    const view = async (name: string) => {
      await page.getByRole('button', { name: 'View' }).click()
      await item(name).click()
    }
    // on the grid, every lane lets the dots through
    expect(host.querySelector('.lme-canvas')!.hasAttribute('data-grid')).toBe(false)
    expect(lanes().map((r) => r && getComputedStyle(r).fillOpacity)).toEqual(['0.55', '0.55', '0.55'])
    await page.getByRole('button', { name: 'View' }).click()
    await expect.element(item('Lane fills')).toHaveAttribute('aria-checked', 'true')
    await expect.element(item('Dot grid')).toHaveAttribute('aria-checked', 'true')
    await userEvent.keyboard('{Escape}')
    // the grid is the reader's, kept in this browser: the text stays as it is
    const before = handle.source()
    await view('Dot grid')
    expect(handle.source()).toBe(before)
    expect(localStorage.getItem('loadmap:editor:grid')).toBe('off')
    await expect.poll(() => host.querySelector('.lme-canvas')!.getAttribute('data-grid')).toBe('off')
    expect(getComputedStyle(lanes()[0]!).fillOpacity).toBe('1')
    // the lanes' fills write a line of the text, and switched back take it out
    await view('Lane fills')
    expect(handle.source()).toContain('\n  lanes: striped\n')
    await expect.poll(() => lanes().map((r) => !!r)).toEqual([false, true, false])
    await view('Lane fills')
    await view('Dot grid')
    expect(handle.source()).toBe(before)
    // the model's tab: a colour of its own for the data lane, light then dark, and Reset takes both out
    await userEvent.click(host.querySelector('.lme-preview [data-node="gateway"]')!)
    await page.getByRole('tab', { name: 'Model' }).click()
    const picker = (n: number) =>
      host.querySelectorAll<HTMLInputElement>('[data-key="tier:data"] input[type="color"]')[n]!
    const pick = (n: number, c: string) => {
      picker(n).value = c
      picker(n).dispatchEvent(new Event('change'))
    }
    pick(0, '#e6f2ec')
    await expect.poll(() => handle.source()).toContain('tier data "Data" { fill: "#e6f2ec" }')
    pick(1, '#1c2b26')
    await expect.poll(() => handle.source()).toContain('tier data "Data" { fill: "#e6f2ec"; fillDark: "#1c2b26" }')
    await expect.poll(() => lanes()[2]?.style.fill).toBe('light-dark(rgb(230, 242, 236), rgb(28, 43, 38))')
    // Reset goes away as it is pressed: the focus stays on the lane
    const reset = host.querySelector<HTMLButtonElement>('[data-key="tier:data"] button')!
    reset.focus()
    reset.click()
    await expect.poll(() => handle.source()).toBe(before)
    expect(document.activeElement).toBe(host.querySelector('[data-key="tier:data"]'))
    // a dark colour alone: light keeps the theme's shade
    pick(1, '#1c2b26')
    await expect.poll(() => handle.source()).toContain('tier data "Data" { fillDark: "#1c2b26" }')
    await expect.poll(() => lanes()[2]?.getAttribute('fill')).toBe('var(--lm-tier-base)')
  })

  it('draws the diagram as a canvas between the code’s panel and the side panel’s rail, the code’s edge resizing it', async () => {
    const moved: number[] = []
    const { host } = await fill(1200, { split: 0.5, onSplit: (n) => moved.push(n), start: 'Back' })
    expect(host.querySelector('.lme-bar > a')!.textContent).toBe('Back')
    expect(box(host, '.lme').height).toBe(700)
    // nothing scrolls: the canvas fills what the bar leaves, the panels scroll in their own box
    const preview = host.querySelector<HTMLElement>('.lme-preview')!
    expect(preview.scrollHeight).toBeLessThanOrEqual(preview.clientHeight)
    expect(Math.abs(box(host, '.lme-left').width - 600)).toBeLessThan(2)
    // the canvas starts where the code ends and stops at the rail: nothing floats over it from the sides
    expect(box(host, '.lme-canvas').left).toBeCloseTo(box(host, '.lme-left').right, 0)
    expect(box(host, '.lme-canvas').right).toBeCloseTo(box(host, '.lme-rail[data-side="end"]').left, 0)
    // the whole diagram, in the room the code and the panel's rail leave
    await expect.poll(() => drawn(host).left, { timeout: 5000 }).toBeGreaterThan(box(host, '.lme-left').right)
    expect(drawn(host).right).toBeLessThan(box(host, '.lme-rail').left)
    expect(drawn(host).top).toBeGreaterThan(box(host, '.lme-bar').bottom)
    expect(drawn(host).bottom).toBeLessThan(box(host, '.lme').bottom)
    // the load floats over the canvas's top, and the diagram fits under it; the panel keeps the design
    expect(drawn(host).top).toBeGreaterThan(box(host, '.lme-over-top .lm-loadbar').bottom)
    expect(host.querySelector('.lme-over-top .lm-load input[type=range]')).toBeTruthy()
    expect(host.querySelector('.lme-panel .lm-load')).toBeNull()
    const edge = page.getByRole('separator', { name: 'Resize the code' })
    await expect.element(edge).toHaveAttribute('aria-valuenow', '600')
    ;(edge.element() as HTMLElement).focus()
    await userEvent.keyboard('{Shift>}{ArrowLeft}{/Shift}')
    await expect.element(edge).toHaveAttribute('aria-valuenow', '536')
    await userEvent.keyboard('{Home}')
    await expect.element(edge).toHaveAttribute('aria-valuenow', '360')
    expect(moved.map((n) => Math.round(n * 1200))).toEqual([536, 360])
    // back to where the page put it
    await userEvent.dblClick(edge)
    await expect.element(edge).toHaveAttribute('aria-valuenow', '600')
  })

  it('paints sharp, round dots through every change of size', async () => {
    const { host } = await fill(1400)
    const dots = watchDots(host.querySelector('.lme-preview canvas')!)
    const sharp = { pixels: true, round: true }
    await expect.poll(dots, { timeout: 5000 }).toEqual(sharp)
    // the code's panel
    ;(page.getByRole('separator', { name: 'Resize the code' }).element() as HTMLElement).focus()
    await userEvent.keyboard('{Home}')
    await expect.poll(dots).toEqual(sharp)
    // the side panel
    ;(page.getByRole('separator', { name: 'Resize the panel' }).element() as HTMLElement).focus()
    await userEvent.keyboard('{End}')
    await expect.poll(dots).toEqual(sharp)
    await userEvent.click(page.getByRole('button', { name: 'Hide the panel' }))
    await expect.poll(dots).toEqual(sharp)
    // the window
    host.style.width = '1000px'
    await expect.poll(dots).toEqual(sharp)
  })

  it('paints sharp, round dots on a phone’s diagram, shown after the code', async () => {
    const { host } = await fill(400)
    const dots = watchDots(host.querySelector('.lme-preview canvas')!)
    await userEvent.click(page.getByRole('tab', { name: 'Diagram' }))
    await expect.poll(dots, { timeout: 5000 }).toEqual({ pixels: true, round: true })
  })

  /** A page's own things in the bar, as the docs' editor gives them. */
  const picked: string[] = []
  const site = {
    embedLink: (hash: string) => `https://x.test/embed/#${hash}`,
    newItems: [{ label: 'Examples', items: [{ label: 'Alerts', onSelect: () => picked.push('Alerts') }] }],
    exportItems: [{ label: 'Image', items: [{ label: 'PNG', onSelect: () => picked.push('PNG') }] }],
    actions: (
      <button type="button" className="lm-btn lme-quiet lme-icon" aria-label="Help">
        ?
      </button>
    ),
  }
  /** Opens a menu of the bar, finds each item named, and closes it again with Escape. */
  async function reach(menu: string, items: string[]) {
    const button = page.getByRole('button', { name: menu, exact: true })
    await userEvent.click(button)
    for (const name of items) await expect.element(page.getByRole('menuitem', { name, exact: true })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(button).toHaveAttribute('aria-expanded', 'false')
  }

  it('keeps the bar one row of one height from 720 to 2560 px, every action in reach', async () => {
    const heights = new Set<number>()
    for (const width of [2560, 1440, 1280, 1000, 950, 800, 720]) {
      const { host } = await fill(width, { ...site, start: 'Back' })
      const bar = box(host, '.lme-bar')
      heights.add(bar.height)
      // every control on one line, as tall as the others, inside the bar
      const controls = [...host.querySelectorAll<HTMLElement>('.lme-bar button, .lme-bar a')]
        .filter((c) => !c.closest('[popover]') && c.getClientRects().length > 0)
        .map((c) => c.getBoundingClientRect())
      const rows = new Set(controls.filter((c) => c.height > 24).map((c) => `${c.top - bar.top}:${c.height}`))
      expect(rows, `${width}`).toEqual(new Set(['7.5:32']))
      expect(Math.max(...controls.map((c) => c.right)), `${width}`).toBeLessThanOrEqual(bar.right)
      expect(host.querySelector('.lme-title')!.textContent).toBe('Checkout pipeline')
      expect(page.getByRole('button', { name: 'Share', exact: true }).element()).toBeVisible()
      await reach('New', ['Web app and database', 'Alerts'])
      await reach('Export', ['Download .loadmap', 'PNG'])
      await reach('More ways to share', ['Copy link', 'Embed in a page…'])
      expect(page.getByRole('button', { name: 'Help' }).element()).toBeVisible()
      root?.unmount()
      root = null
      document.body.replaceChildren()
    }
    expect([...heights]).toEqual([48])
  })

  it('runs a page’s item from its menu, and closes the menu', async () => {
    picked.length = 0
    const { host } = await fill(1200, site)
    await userEvent.click(page.getByRole('button', { name: 'Export' }))
    await userEvent.click(page.getByRole('menuitem', { name: 'PNG' }))
    expect(picked).toEqual(['PNG'])
    expect(host.querySelector('.lme-menu:popover-open')).toBeNull()
  })

  it('opens a menu from the keyboard, moves in it with the arrows and letters, and Escape gives the focus back', async () => {
    await fill(1200, site)
    const named = () => document.activeElement?.firstChild?.textContent
    const button = page.getByRole('button', { name: 'New' }).element() as HTMLElement
    button.focus()
    await userEvent.keyboard('{Enter}')
    // the templates load first: the keyboard waits for them
    await expect.poll(named).toBe('Web app and database')
    await userEvent.keyboard('{ArrowDown}')
    expect(named()).toBe('Reads on replicas')
    await userEvent.keyboard('{End}')
    expect(named()).toBe('Alerts')
    await userEvent.keyboard('{ArrowDown}')
    expect(named()).toBe('Web app and database')
    await userEvent.keyboard('{ArrowUp}')
    expect(named()).toBe('Alerts')
    await userEvent.keyboard('{Home}')
    await userEvent.keyboard('q')
    expect(named()).toBe('Queue and workers')
    await userEvent.keyboard('{Escape}')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(button)
    // ↑ opens it on its last item; Tab closes it and goes on
    await userEvent.keyboard('{ArrowUp}')
    await expect.poll(named).toBe('Alerts')
    await userEvent.keyboard('{Tab}')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement?.closest('[popover]')).toBeNull()
  })

  it('makes the bar’s tools one stop for Tab, the arrows moving between them', async () => {
    const { host } = await fill(1200, site)
    const tools = host.querySelector<HTMLElement>('[role="toolbar"]')!
    const stops = () => [...tools.querySelectorAll<HTMLElement>('button')].filter((b) => b.tabIndex === 0)
    expect(stops().map((b) => b.textContent)).toEqual(['View'])
    const name = () => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent
    stops()[0]!.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(name()).toBe('New')
    await userEvent.keyboard('{ArrowRight}')
    expect(name()).toBe('Export')
    await userEvent.keyboard('{ArrowRight}')
    expect(name()).toBe('Help')
    await userEvent.keyboard('{End}')
    expect(name()).toBe('More ways to share')
    await userEvent.keyboard('{ArrowRight}')
    expect(name()).toBe('View')
    await userEvent.keyboard('{ArrowLeft}')
    expect(name()).toBe('More ways to share')
    // Tab comes back to the last one used
    expect(stops().map((b) => b.getAttribute('aria-label'))).toEqual(['More ways to share'])
  })

  it('sets both panels beside the canvas, never over it, at every desktop width, the diagram fitted between', async () => {
    for (const width of [2560, 1440, 1280, 1000]) {
      const { host } = await fill(width)
      const canvas = box(host, '.lme-canvas')
      const pinned = width >= 1280
      const end = box(host, pinned ? '.lme-panel' : '.lme-rail[data-side="end"]')
      expect(host.querySelector<HTMLElement>('.lme-panel')!.dataset.mode, `${width}`).toBe(pinned ? 'pinned' : 'auto')
      expect(canvas.left, `${width}`).toBeCloseTo(box(host, '.lme-left').right, 0)
      expect(canvas.right, `${width}`).toBeCloseTo(end.left, 0)
      expect(canvas.left - box(host, '.lme').left, `${width}`).toBe(440)
      await expect.poll(() => drawn(host).left, { timeout: 5000 }).toBeGreaterThan(canvas.left)
      expect(drawn(host).right, `${width}`).toBeLessThan(canvas.right)
      // no page scroll: the editor is its container's height, each panel scrolls in its own box
      expect(box(host, '.lme').height).toBe(700)
      expect(document.scrollingElement!.scrollHeight).toBeLessThanOrEqual(innerHeight)
      root?.unmount()
      root = null
      document.body.replaceChildren()
    }
  })

  it('folds the side panel onto its rail and pins it again from there, the keyboard following', async () => {
    const panels: string[] = []
    const { host } = await fill(1400, { onPanel: (p) => panels.push(p) })
    const panel = host.querySelector<HTMLElement>('.lme-panel')!
    expect(panel.dataset.mode).toBe('pinned')
    expect(panel.hidden).toBe(false)
    expect(panel.textContent).toContain('Verdict')
    expect(panel.querySelector('h2')!.textContent).toBe('Panel')
    ;(page.getByRole('button', { name: 'Hide the panel' }).element() as HTMLElement).focus()
    await userEvent.keyboard('{Enter}')
    expect(panels).toEqual(['auto'])
    expect(panel.hidden).toBe(true)
    // the button went with the panel: the keyboard is on the rail
    const rail = host.querySelector<HTMLButtonElement>('.lme-rail[data-side="end"]')!
    await expect.poll(() => document.activeElement).toBe(rail)
    // the diagram takes the room the panel leaves
    await expect.poll(() => drawn(host).right, { timeout: 5000 }).toBeGreaterThan(box(host, '.lme').right - 340)
    // a wide editor pins it again from the rail, and the keyboard goes into it, from a key or a click alike: the rail
    // goes
    expect(rail.getAttribute('aria-label')).toBe('Pin the panel')
    await userEvent.keyboard('{Enter}')
    expect(panels).toEqual(['auto', 'pinned'])
    expect(panel.dataset.mode).toBe('pinned')
    await expect.poll(() => panel.contains(document.activeElement)).toBe(true)
    await userEvent.click(page.getByRole('button', { name: 'Hide the panel' }))
    await userEvent.click(host.querySelector<HTMLButtonElement>('.lme-rail[data-side="end"]')!)
    expect(panel.dataset.mode).toBe('pinned')
    await expect.poll(() => panel.contains(document.activeElement)).toBe(true)
  })

  it('opens the panel over the canvas from its rail where it cannot pin', async () => {
    const { host } = await fill(1000)
    const panel = host.querySelector<HTMLElement>('.lme-panel')!
    expect(panel.dataset.mode).toBe('auto')
    expect(panel.hidden).toBe(true)
    const rail = host.querySelector<HTMLButtonElement>('.lme-rail[data-side="end"]')!
    rail.focus()
    await userEvent.keyboard('{Enter}')
    expect(panel.hidden).toBe(false)
    expect(rail.getAttribute('aria-expanded')).toBe('true')
    expect(host.querySelector('.lme-panel .lme-resize')).toBeNull()
    // from the keyboard the focus goes into the panel, and Escape gives it back to the rail
    await expect.poll(() => panel.contains(document.activeElement)).toBe(true)
    await userEvent.keyboard('{Escape}')
    expect(panel.hidden).toBe(true)
    expect(document.activeElement).toBe(rail)
    await userEvent.click(rail)
    expect(panel.hidden).toBe(false)
    // its own button closes it too, and gives the keyboard to the rail
    await userEvent.click(page.getByRole('button', { name: 'Hide the panel' }))
    expect(panel.hidden).toBe(true)
    await expect.poll(() => document.activeElement).toBe(rail)
  })

  it('folds the code onto a rail, and the diagram fits the room it leaves', async () => {
    const { host } = await fill(1400)
    await expect.poll(() => drawn(host).left, { timeout: 5000 }).toBeGreaterThan(box(host, '.lme-left').right)
    const before = drawn(host)
    await userEvent.click(page.getByRole('button', { name: 'Hide code' }))
    expect(host.querySelector<HTMLElement>('.lme-left')!.hidden).toBe(true)
    const rail = host.querySelector<HTMLElement>('.lme-rail[data-side="start"]')!
    expect(rail.textContent).toBe('Code')
    expect(box(host, '.lme-canvas').left).toBeCloseTo(rail.getBoundingClientRect().right, 0)
    // fitted again: wider, and further left
    await expect
      .poll(() => drawn(host).right - drawn(host).left, { timeout: 5000 })
      .toBeGreaterThan(before.right - before.left)
    expect(drawn(host).left).toBeGreaterThan(rail.getBoundingClientRect().right)
    await userEvent.click(page.getByRole('button', { name: 'Show code' }))
    expect(host.querySelector<HTMLElement>('.lme-left')!.hidden).toBe(false)
  })

  it('counts the text’s problems on the code’s rail', async () => {
    const { host, handle } = await fill(1400, { layout: 'reader' })
    handle.setSource(handle.source().replace('title: "Checkout pipeline"', 'title: "Checkout pipeline'))
    const rail = host.querySelector<HTMLElement>('.lme-rail[data-side="start"]')!
    await expect.poll(() => rail.dataset.tier).toBe('over')
    expect(rail.textContent).toMatch(/^\d+ errors? · Code$/)
    // the count is in its name too
    expect(rail.getAttribute('aria-label')).toMatch(/^Show code \(\d+ errors?\)$/)
  })

  it('keeps a panel the reader folded shut; only where it cannot pin does a hover open it, and a click keep it open', async () => {
    const { host } = await fill(1400, { layout: 'reader' })
    const panel = host.querySelector<HTMLElement>('.lme-panel')!
    // a box clicked while the code is hidden: its fields in the panel
    await userEvent.click(host.querySelector<SVGGElement>('.lme-preview [data-node="gateway"]')!)
    await expect.poll(() => panel.querySelector('.lme-inspector h3')?.textContent).toBe('API gateway')
    await userEvent.click(page.getByRole('button', { name: 'Hide the panel' }))
    const rail = host.querySelector<HTMLButtonElement>('.lme-rail[data-side="end"]')!
    // React makes its enter and leave from over and out
    const hover = () => {
      rail.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse' }))
      rail.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }))
    }
    // folded, and it stays so whatever the editor renders next, a hover included: a wide editor unfolds on a click
    hover()
    await new Promise((r) => setTimeout(r, 400))
    expect(panel.hidden).toBe(true)
    host.style.width = '1000px'
    // laid out again for 1000 px: the code's most is 60 % of it
    await expect
      .poll(() => host.querySelector('[aria-label="Resize the code"]')?.getAttribute('aria-valuemax'))
      .toBe('600')
    rail.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse' }))
    hover()
    await expect.poll(() => panel.hidden).toBe(false)
    rail.click()
    expect(panel.hidden).toBe(false)
  })

  it('keeps the values the reader set when the editor turns narrow, and the keyboard where it can see', async () => {
    const { host, handle } = await fill(1200)
    handle.loadmap()!.setValues({ load: 30 })
    host.style.width = '600px'
    await expect.poll(() => host.querySelector('.lme-switch')).toBeTruthy()
    await expect.poll(() => handle.loadmap()?.values().load).toBe(30)
    host.style.width = '1200px'
    await expect.poll(() => host.querySelector('.lme-pane-head')).toBeTruthy()
    await expect.poll(() => handle.loadmap()?.values().load).toBe(30)
    // a button that goes hands the keyboard to what comes in its place
    host.querySelector<HTMLButtonElement>('[aria-label="Hide code"]')!.focus()
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => document.activeElement?.matches('.lme-rail[data-side="start"]')).toBe(true)
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => document.activeElement?.closest('.lme-code')).toBeTruthy()
  })

  it('resizes the side panel by its edge, and keeps the canvas 320 px between the two', async () => {
    const widths: number[] = []
    const { host } = await fill(1100, { panel: 'pinned', onPanelWidth: (px) => widths.push(px) })
    expect(host.querySelector<HTMLElement>('.lme-panel')!.dataset.mode).toBe('pinned')
    const edge = page.getByRole('separator', { name: 'Resize the panel' })
    await expect.element(edge).toHaveAttribute('aria-valuenow', '340')
    ;(edge.element() as HTMLElement).focus()
    // its edge is on its left: the arrow to the left widens it
    await userEvent.keyboard('{ArrowLeft}')
    await expect.element(edge).toHaveAttribute('aria-valuenow', '356')
    await userEvent.keyboard('{Home}')
    await expect.element(edge).toHaveAttribute('aria-valuenow', '300')
    // 1100 − 360 for the code at its least − 320 for the canvas
    await userEvent.keyboard('{End}')
    await expect.element(edge).toHaveAttribute('aria-valuenow', '420')
    expect(widths).toEqual([356, 300, 420])
    expect(Math.round(box(host, '.lme-panel').width)).toBe(420)
    // the code then takes what is left beside the canvas's 320 px
    const code = page.getByRole('separator', { name: 'Resize the code' })
    ;(code.element() as HTMLElement).focus()
    await userEvent.keyboard('{End}')
    await expect.element(code).toHaveAttribute('aria-valuenow', '360')
    await userEvent.dblClick(edge)
    await expect.element(edge).toHaveAttribute('aria-valuenow', '340')
    expect(Math.round(box(host, '.lme-canvas').width)).toBe(1100 - 360 - 340)
  })

  it('starts the side panel at the width a page kept, and puts it back there on a double-click', async () => {
    const { host } = await fill(1400, { panelWidth: 400 })
    expect(Math.round(box(host, '.lme-panel').width)).toBe(400)
    expect(Math.round(box(host, '.lme-canvas').right)).toBe(Math.round(box(host, '.lme-panel').left))
    const edge = page.getByRole('separator', { name: 'Resize the panel' })
    ;(edge.element() as HTMLElement).focus()
    await userEvent.keyboard('{End}')
    await expect.element(edge).toHaveAttribute('aria-valuenow', '480')
    await userEvent.dblClick(edge)
    await expect.element(edge).toHaveAttribute('aria-valuenow', '400')
  })

  it('opens the side panel over the canvas at its own width where it cannot pin, whatever a page passes', async () => {
    const { host } = await fill(1000, { panelWidth: 420 })
    await userEvent.click(host.querySelector<HTMLButtonElement>('.lme-rail[data-side="end"]')!)
    expect(Math.round(box(host, '.lme-panel').width)).toBe(420)
    root?.unmount()
    document.body.replaceChildren()
    const broken = await fill(1400, { panelWidth: Number.NaN })
    expect(Math.round(box(broken.host, '.lme-panel').width)).toBe(340)
  })

  it('hides the load bar’s legend only where the canvas is narrow', async () => {
    const legend = (host: HTMLElement) =>
      host.querySelector('.lme-over .lm-loadbar legend')!.getBoundingClientRect().width
    const { host } = await fill(2560)
    expect(legend(host)).toBeGreaterThan(20)
    root?.unmount()
    document.body.replaceChildren()
    const narrow = await fill(1000)
    expect(legend(narrow.host)).toBeLessThanOrEqual(1)
  })

  it('shows a phone the text or the diagram, switched at the bottom, the other buttons in a sheet', async () => {
    const { host } = await fill(400)
    expect(host.querySelector('.lme-resize')).toBeNull()
    expect(host.querySelector<HTMLElement>('.lme-preview')!.hidden).toBe(true)
    // the switch sits below the text, at the bottom of the editor
    expect(box(host, '.lme-switch').bottom).toBe(box(host, '.lme').bottom)
    await userEvent.click(page.getByRole('tab', { name: 'Diagram' }))
    expect(host.querySelector<HTMLElement>('.lme-left')!.hidden).toBe(true)
    expect(host.querySelector<HTMLElement>('.lme-preview')!.hidden).toBe(false)
    // the panels in a sheet over the diagram's bottom, the diagram above it
    await expect.poll(() => host.querySelector('.lme-sheet')).toBeTruthy()
    await expect.poll(() => drawn(host).bottom, { timeout: 5000 }).toBeLessThan(box(host, '.lme-sheet').top)
    // drawn, and its code loaded, only when ⋯ opens it
    const sheet = () => host.querySelector<HTMLDialogElement>('dialog.lme-actions')
    expect(sheet()).toBeNull()
    await userEvent.click(page.getByRole('button', { name: 'More' }))
    await expect.poll(() => sheet()?.open).toBe(true)
    await userEvent.click(page.getByRole('button', { name: 'Format' }))
    await expect.poll(sheet).toBeNull()
    // the focus back on what opened it
    await expect.poll(() => document.activeElement?.getAttribute('aria-label')).toBe('More')
    expect(page.getByRole('button', { name: 'Share' }).element()).toBeTruthy()
  })

  it('holds every action of the bar in the phone’s sheet, the templates a page of their own', async () => {
    picked.length = 0
    const { host } = await fill(400, site)
    const sheet = () => host.querySelector<HTMLDialogElement>('dialog.lme-actions')
    const more = page.getByRole('button', { name: 'More' })
    await userEvent.click(more)
    for (const name of ['Hide code', 'Format', 'Download .loadmap', 'PNG', 'Embed in a page…', 'Help', 'Close'])
      await expect.element(page.getByRole('button', { name, exact: true })).toBeVisible()
    await userEvent.click(page.getByRole('button', { name: 'From a template' }))
    expect(sheet()?.open).toBe(true)
    await expect.element(page.getByRole('button', { name: 'Web app and database' })).toBeVisible()
    await userEvent.click(page.getByRole('button', { name: 'From a template' }))
    await userEvent.click(page.getByRole('button', { name: 'Examples' }))
    await userEvent.click(page.getByRole('button', { name: 'Alerts' }))
    expect(picked).toEqual(['Alerts'])
    await expect.poll(sheet).toBeNull()
    // the embed's options open from it too, under the bar
    await userEvent.click(more)
    await userEvent.click(page.getByRole('button', { name: 'Embed in a page…' }))
    await expect.poll(() => host.querySelector('.lme-pop:popover-open .lme-embed')).toBeTruthy()
    const pop = host.querySelector('.lme-pop')!.getBoundingClientRect()
    expect(pop.top).toBeGreaterThan(box(host, '.lme-bar').bottom)
    expect(pop.left >= 0 && pop.right <= document.documentElement.clientWidth).toBe(true)
  })

  it('brings a phone’s sheet up for each box tapped while the code is hidden, and the handle answers Enter', async () => {
    const { host } = await fill(400, { layout: 'reader' })
    await expect.poll(() => host.querySelector('.lme-sheet')).toBeTruthy()
    const sheet = host.querySelector<HTMLElement>('.lme-sheet')!
    const grab = host.querySelector<HTMLButtonElement>('.lme-grab')!
    // opened with nothing picked, it rests at peek
    expect(sheet.dataset.detent).toBe('peek')
    const tapBox = (id: string) => userEvent.click(host.querySelector<SVGGElement>(`.lme-preview [data-node="${id}"]`)!)
    await tapBox('gateway')
    await expect.poll(() => sheet.dataset.detent).toBe('half')
    expect(sheet.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toBe('Box')
    // lowered, or on another tab: the next box brings it up again
    await userEvent.click(sheet.querySelector<HTMLButtonElement>('[role="tab"]:nth-child(3)')!)
    grab.focus()
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => sheet.dataset.detent).toBe('peek')
    await tapBox('workerPool')
    await expect.poll(() => sheet.dataset.detent).toBe('half')
    expect(sheet.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toBe('Box')
    // a cancelled touch is no tap
    const o = { bubbles: true, pointerId: 9, pointerType: 'touch', isPrimary: true }
    grab.dispatchEvent(new PointerEvent('pointerdown', o))
    grab.dispatchEvent(new PointerEvent('pointercancel', o))
    await new Promise((r) => setTimeout(r, 100))
    expect(sheet.dataset.detent).toBe('half')
  })

  it('rests the phone’s sheet at peek, half or full: tapped, stepped with the keys, or dragged', async () => {
    const { host } = await fill(400)
    await userEvent.click(page.getByRole('tab', { name: 'Diagram' }))
    await expect.poll(() => host.querySelector('.lme-sheet')).toBeTruthy()
    const sheet = host.querySelector<HTMLElement>('.lme-sheet')!
    const grab = host.querySelector<HTMLButtonElement>('.lme-grab')!
    const at = () => sheet.dataset.detent
    // at peek: the verdict and the load slider
    expect(at()).toBe('peek')
    expect(sheet.querySelector('.lme-peek .lm-range input[type="range"]')).toBeTruthy()
    // the slider's marks too, inside the sheet
    const marks = sheet.querySelector('.lme-peek .lm-marks')!.getBoundingClientRect()
    expect(marks.bottom + 20).toBeLessThanOrEqual(sheet.getBoundingClientRect().bottom)
    await userEvent.click(grab)
    expect(at()).toBe('half')
    expect(sheet.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toBe('Verdict')
    grab.focus()
    await userEvent.keyboard('{ArrowUp}')
    expect(at()).toBe('full')
    // dragged down most of the way, it lands at peek
    const g = grab.getBoundingClientRect()
    const o = { bubbles: true, pointerId: 7, pointerType: 'touch', isPrimary: true }
    grab.dispatchEvent(new PointerEvent('pointerdown', { ...o, clientX: g.x + 50, clientY: g.y + 10 }))
    for (let i = 1; i <= 8; i++)
      grab.dispatchEvent(new PointerEvent('pointermove', { ...o, clientX: g.x + 50, clientY: g.y + 10 + i * 60 }))
    grab.dispatchEvent(new PointerEvent('pointerup', { ...o, clientX: g.x + 50, clientY: g.y + 490 }))
    await expect.poll(at).toBe('peek')
    // the diagram fits above the sheet wherever it rests
    await userEvent.click(grab)
    await expect.poll(() => drawn(host).bottom, { timeout: 5000 }).toBeLessThan(sheet.getBoundingClientRect().top)
  })
})
