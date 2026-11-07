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
import { type EmbedOptions, LoadmapEditor, type LoadmapEditorHandle, TEMPLATES } from '../src'

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
      .poll(() => host.querySelector('.lm-lim[data-component="db"] b')?.textContent, { timeout: 5000 })
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

  it('copies an embed link with the options picked, or the iframe that frames it', async () => {
    const calls: [string, EmbedOptions][] = []
    const embedLink = (hash: string, o: EmbedOptions) => {
      calls.push([hash, o])
      return `https://x.test/embed/?theme=${o.theme}#${hash}`
    }
    const { host, handle } = await mount({ source: alerts, embedLink })
    handle.loadmap()!.setValues({ load: 25 })
    await userEvent.click(page.getByText('Copy embed link'))
    // its options load as it first opens; it opens toward the side with room, inside the window
    await expect.poll(() => host.querySelector('.lme-pop')).toBeTruthy()
    const pop = host.querySelector('.lme-pop')!.getBoundingClientRect()
    expect(pop.left >= 0 && pop.right <= document.documentElement.clientWidth).toBe(true)
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
  })

  it('has no embed menu without a page to frame it', async () => {
    const { host } = await mount()
    expect(host.querySelector('.lme-embed')).toBeNull()
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

describe('the editor filling its container', () => {
  async function fill(
    width: number,
    o: {
      split?: number
      onSplit?: (n: number) => void
      onPanel?: (p: string) => void
      panel?: 'pinned' | 'auto'
      layout?: 'code' | 'reader'
      start?: string
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
        initial={checkout}
        split={o.split}
        onSplit={o.onSplit}
        onPanel={o.onPanel}
        panel={o.panel}
        layout={o.layout}
        start={o.start && <a href="/">{o.start}</a>}
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

  it('draws the diagram as a canvas, the code floating over its left in a card its edge resizes', async () => {
    const moved: number[] = []
    const { host } = await fill(1200, { split: 0.5, onSplit: (n) => moved.push(n), start: 'Back' })
    expect(host.querySelector('.lme-bar > a')!.textContent).toBe('Back')
    expect(box(host, '.lme').height).toBe(700)
    // nothing scrolls: the canvas fills what the bar leaves, the panels scroll in their own box
    const preview = host.querySelector<HTMLElement>('.lme-preview')!
    expect(preview.scrollHeight).toBeLessThanOrEqual(preview.clientHeight)
    expect(Math.abs(box(host, '.lme-left').width - 600)).toBeLessThan(2)
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

  it('pins the panel on a wide editor, and unpinned keeps it on a rail it opens from', async () => {
    const panels: string[] = []
    const { host } = await fill(1400, { onPanel: (p) => panels.push(p) })
    const panel = host.querySelector<HTMLElement>('.lme-panel')!
    expect(panel.dataset.mode).toBe('pinned')
    expect(panel.hidden).toBe(false)
    expect(panel.textContent).toContain('Verdict')
    await userEvent.click(page.getByRole('button', { name: 'Unpin' }))
    expect(panels).toEqual(['auto'])
    expect(panel.hidden).toBe(true)
    // the diagram takes the room the panel leaves
    await expect.poll(() => drawn(host).right, { timeout: 5000 }).toBeGreaterThan(box(host, '.lme').right - 340)
    const rail = host.querySelector<HTMLButtonElement>('.lme-rail')!
    rail.focus()
    await userEvent.keyboard('{Enter}')
    expect(panel.hidden).toBe(false)
    expect(rail.getAttribute('aria-expanded')).toBe('true')
    // from the keyboard the focus goes into the panel, and Escape gives it back to the rail
    await expect.poll(() => panel.contains(document.activeElement)).toBe(true)
    await userEvent.keyboard('{Escape}')
    expect(panel.hidden).toBe(true)
    expect(document.activeElement).toBe(rail)
    await userEvent.click(rail)
    expect(panel.hidden).toBe(false)
    await userEvent.click(page.getByRole('button', { name: 'Pin' }))
    expect(panels).toEqual(['auto', 'pinned'])
    expect(panel.dataset.mode).toBe('pinned')
  })

  it('hides the code to a tab, and the diagram fits the room it leaves', async () => {
    const { host } = await fill(1400)
    await expect.poll(() => drawn(host).left, { timeout: 5000 }).toBeGreaterThan(box(host, '.lme-left').right)
    const before = drawn(host)
    await userEvent.click(page.getByRole('button', { name: 'Hide code' }))
    expect(host.querySelector<HTMLElement>('.lme-left')!.hidden).toBe(true)
    // fitted again: wider, and further left
    await expect
      .poll(() => drawn(host).right - drawn(host).left, { timeout: 5000 })
      .toBeGreaterThan(before.right - before.left)
    expect(drawn(host).left).toBeGreaterThan(box(host, '.lme-tab').right)
    await userEvent.click(page.getByRole('button', { name: 'Show code' }))
    expect(host.querySelector<HTMLElement>('.lme-left')!.hidden).toBe(false)
  })

  it('keeps a panel the reader folded shut, and a hover that opened it open through a click', async () => {
    const { host } = await fill(1400, { layout: 'reader' })
    const panel = host.querySelector<HTMLElement>('.lme-panel')!
    // a box clicked while the code is hidden: its fields in the panel
    await userEvent.click(host.querySelector<SVGGElement>('.lme-preview [data-node="gateway"]')!)
    await expect.poll(() => panel.querySelector('.lme-inspector h3')?.textContent).toBe('API gateway')
    await userEvent.click(page.getByRole('button', { name: 'Unpin' }))
    // folded, and it stays so whatever the editor renders next
    await new Promise((r) => setTimeout(r, 300))
    expect(panel.hidden).toBe(true)
    const rail = host.querySelector<HTMLButtonElement>('.lme-rail')!
    // the pointer that pressed Unpin is over the rail now: it leaves, then comes back
    // (React makes its enter and leave from over and out)
    rail.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse' }))
    rail.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }))
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
    await expect.poll(() => host.querySelector('.lme-card-head')).toBeTruthy()
    await expect.poll(() => handle.loadmap()?.values().load).toBe(30)
    // a button that goes hands the keyboard to what comes in its place
    host.querySelector<HTMLButtonElement>('[aria-label="Hide code"]')!.focus()
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => document.activeElement?.className).toBe('lme-tab')
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => document.activeElement?.closest('.lme-code')).toBeTruthy()
  })

  it('never lets the code card take the diagram’s last 240 px beside a pinned panel', async () => {
    const { host } = await fill(1100, { panel: 'pinned' })
    expect(host.querySelector<HTMLElement>('.lme-panel')!.dataset.mode).toBe('pinned')
    const edge = page.getByRole('separator', { name: 'Resize the code' })
    ;(edge.element() as HTMLElement).focus()
    await userEvent.keyboard('{End}')
    // 1100 − 340 for the panel − 2 × 16 around the card − 240 for the diagram
    await expect.element(edge).toHaveAttribute('aria-valuenow', '488')
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
    const sheet = host.querySelector<HTMLDialogElement>('dialog.lme-actions')!
    expect(sheet.open).toBe(false)
    await userEvent.click(page.getByRole('button', { name: 'More' }))
    expect(sheet.open).toBe(true)
    await userEvent.click(page.getByRole('button', { name: 'Format' }))
    expect(sheet.open).toBe(false)
    // the focus back on what opened it
    await expect.poll(() => document.activeElement?.getAttribute('aria-label')).toBe('More')
    expect(page.getByRole('button', { name: 'Share' }).element()).toBeTruthy()
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
    await tapBox('workers')
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
