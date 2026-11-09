import { undo } from '@codemirror/commands'
import { EditorView } from '@codemirror/view'
import type { ParamValue } from '@loadmap/core'
import { decodeShare } from '@loadmap/dsl'
import { createRef, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import alerts from '../../../examples/alerts/alerts.loadmap?raw'
import checkout from '../../../examples/checkout/checkout.loadmap?raw'
import { watchDots } from '../../../examples/dots'
import { type BarSection, type EmbedOptions, LoadmapEditor, type LoadmapEditorHandle, TEMPLATES } from '../src'

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
    // ten times the orders breaks both promises: a warning on each line, the diagram still shown; at 6 pods the
    // first holds only at the high edge of the gateway's ±, so it is inconclusive, not a failure
    await expect.poll(() => host.querySelector('.lme-status')!.textContent).toBe('2 warnings')
    expect(host.querySelector('.lme-problems [data-severity="warning"]')!.textContent).toMatch(
      /^\d+:1 "Today keeps 7×" is inconclusive: holds at 7× only at the high edge of a ±; expected at least 7×, but the 50 % target holds up to between/,
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

  it('starts from a template', async () => {
    const { host, handle } = await mount()
    await userEvent.click(page.getByRole('button', { name: 'New' }))
    // the list loads as the menu first opens
    // the templates, and Add → From the catalog
    await expect.poll(() => host.querySelectorAll('[role="menuitem"]').length).toBe(TEMPLATES.length + 1)
    const names = [...host.querySelectorAll('[role="menuitem"]')].map((i) => i.firstChild?.textContent)
    expect(names).toEqual([...TEMPLATES.map((t) => t.title), 'From the catalog…'])
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

  it('switches the lanes’ fills and the dot grid from the View menu, and gives a lane its own colour', async () => {
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
    // each switch writes a line of the text, and switched back takes it out
    const before = handle.source()
    await view('Dot grid')
    expect(handle.source()).toContain('\ngrid: false\n')
    await expect.poll(() => host.querySelector('.lme-canvas')!.getAttribute('data-grid')).toBe('off')
    expect(getComputedStyle(lanes()[0]!).fillOpacity).toBe('1')
    await view('Lane fills')
    expect(handle.source()).toContain('\nlanes: striped\n')
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
