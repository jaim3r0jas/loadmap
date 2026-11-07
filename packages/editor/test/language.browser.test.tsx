import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { LoadmapEditor, type LoadmapEditorHandle } from '../src'
import { loadmapLanguage } from '../src/language'
import cache from '../src/templates/cache.loadmap?raw'

let view: EditorView | null = null
let root: Root | null = null
const matchMedia = window.matchMedia
afterEach(() => {
  view?.destroy()
  view = null
  root?.unmount()
  root = null
  window.matchMedia = matchMedia
  document.body.replaceChildren()
})

/** An editor holding `doc`, focused with the cursor at the end of `after`. */
function mount(doc: string, after: string) {
  view?.destroy()
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const anchor = doc.indexOf(after) + after.length
  view = new EditorView({
    parent,
    state: EditorState.create({ doc, selection: { anchor }, extensions: [loadmapLanguage()] }),
  })
  // CodeMirror draws only the lines in view
  view.dispatch({ effects: EditorView.scrollIntoView(anchor, { y: 'center' }) })
  view.focus()
  return view
}

/** The list is open and takes keys: CodeMirror ignores Enter for a moment after it opens. */
async function listed(first: RegExp) {
  await expect.poll(() => options()[0], { timeout: 5000 }).toMatch(first)
  await new Promise((r) => setTimeout(r, 150))
}
/** The list's help covers none of its options: beside the list, or under or over it. */
function helpClear(): string {
  const list = document.querySelector('.cm-tooltip-autocomplete > ul')!.getBoundingClientRect()
  const info = document.querySelector('.cm-completionInfo')!.getBoundingClientRect()
  if (info.left >= list.right - 1 || info.right <= list.left + 1) return 'beside'
  if (info.top >= list.bottom - 1 || info.bottom <= list.top + 1) return 'under or over'
  return 'over the options'
}
const options = () => [...document.querySelectorAll('.cm-tooltip-autocomplete li')].map((li) => li.textContent ?? '')
const line = (v: EditorView) => v.state.doc.lineAt(v.state.selection.main.head).text.trim()

describe('completion in the editor', () => {
  beforeEach(() => page.viewport(1280, 800))

  it('offers the capacity forms first and fills one in field by field', async () => {
    const v = mount(cache, 'node db "Database" "primary" {')
    await userEvent.keyboard('{Enter}capacity: ')
    await listed(/^measured/)
    await expect.poll(helpClear).toBe('beside')
    expect(options()[1]).toMatch(/^estimated/)
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(line(v)).toBe('capacity: estimated(value, "unit", "source")')
    await userEvent.keyboard('3000{Tab}queries/s{Tab}load test{Tab} # ok')
    expect(line(v)).toBe('capacity: estimated(3000, "queries/s", "load test") # ok')
  })

  it('offers the units the file uses inside the quotes', async () => {
    const v = mount(cache, 'node db "Database" "primary" {')
    await userEvent.keyboard('{Enter}capacity: measured(300, "')
    // the quote and the parenthesis close themselves
    expect(line(v)).toBe('capacity: measured(300, "")')
    await expect
      .poll(() => options().slice(0, 3), { timeout: 5000 })
      .toEqual(['coresused here', 'ops/sused here', 'queries/sused here'])
    await listed(/^cores/)
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(line(v)).toBe('capacity: measured(300, "queries/s")')
  })

  it('starts again after a division', async () => {
    mount(cache, 'rate: 2_000 * load')
    await userEvent.keyboard(' / flows.reads/p')
    await expect.poll(() => options(), { timeout: 5000 }).toContain('podsparameter')
  })

  it('stays closed in a text and after a whole operand', async () => {
    mount(cache, 'title: "Cache')
    await userEvent.keyboard(' and')
    const v = mount(`${cache}\n`, `${cache}\n`)
    await userEvent.keyboard('flow x {{ rate: 2_000 * load ')
    expect(line(v)).toBe('flow x { rate: 2_000 * load }')
    // give the list its chance to open
    await new Promise((r) => setTimeout(r, 300))
    expect(options()).toEqual([])
    // where something fits it opens on its own
    await userEvent.keyboard('* ')
    await expect.poll(() => options().length, { timeout: 5000 }).toBeGreaterThan(5)
  })
})

/** Moves the pointer onto `pos`, as a mouse does: CodeMirror's hover follows mousemove over the text. */
function pointAt(v: EditorView, pos: number) {
  const c = v.coordsAtPos(pos + 1)!
  v.contentDOM.dispatchEvent(
    new MouseEvent('mousemove', { bubbles: true, clientX: c.left, clientY: (c.top + c.bottom) / 2 }),
  )
}
const tip = (selector: string) => document.querySelector(selector)?.textContent ?? ''

describe('hover and signature help in the editor', () => {
  beforeEach(() => page.viewport(1280, 800))

  it('shows what a name is and its value at the defaults, from the last good compile while the text is broken', async () => {
    const v = mount(cache, 'demand: flows.re')
    pointAt(v, cache.indexOf('flows.reads') + 7)
    await expect.poll(() => tip('.lm-hover'), { timeout: 5000 }).toContain('2,000 a second at the defaults (load 1×).')
    expect(tip('.lm-hover-head')).toBe('flow reads "reads"')
    // break the text: the values stay, from the version without errors, and say so
    v.dispatch({ changes: { from: 0, to: 'loadmap 1'.length, insert: 'loadmap 1\nrate oops' } })
    v.dispatch({ effects: EditorView.scrollIntoView(v.state.doc.toString().indexOf('flows.reads'), { y: 'center' }) })
    v.contentDOM.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))
    await expect.poll(() => document.querySelector('.lm-hover')).toBeNull()
    pointAt(v, v.state.doc.toString().indexOf('flows.reads') + 7)
    await expect
      .poll(() => tip('.lm-hover'), { timeout: 5000 })
      .toContain('Values from the last version without errors.')
    expect(tip('.lm-hover')).toContain('2,000 a second')
    // another text in its place (a template): the old values are not its own
    const other = cache.replace('2_000 * load', '9_000 * load').replace('loadmap 1', 'loadmap 1\nrate oops')
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: other } })
    v.contentDOM.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))
    await expect.poll(() => document.querySelector('.lm-hover')).toBeNull()
    v.dispatch({ effects: EditorView.scrollIntoView(other.indexOf('flows.reads'), { y: 'center' }) })
    pointAt(v, other.indexOf('flows.reads') + 7)
    await expect.poll(() => tip('.lm-hover-head'), { timeout: 5000 }).toBe('flow reads "reads"')
    expect(tip('.lm-hover')).not.toContain('a second')
  })

  it("names a builtin's arguments over the cursor and marks the one being written", async () => {
    const v = mount(`${cache}\n`, `${cache}\n`)
    await userEvent.keyboard('let x = pow(')
    await expect.poll(() => tip('.lm-signature .lm-hover-head'), { timeout: 5000 }).toBe('pow(x, y)')
    expect(tip('.lm-signature-active')).toBe('x')
    // typing within one argument keeps the same tooltip, moving to the next one draws it again
    await userEvent.keyboard('2')
    const kept = document.querySelector('.lm-signature')
    await userEvent.keyboard('5')
    expect(document.querySelector('.lm-signature')).toBe(kept)
    await userEvent.keyboard(', ')
    await expect.poll(() => tip('.lm-signature-active')).toBe('y')
    // out of the parentheses (the editor closed them): nothing to show
    v.dispatch({ selection: { anchor: v.state.doc.length } })
    await expect.poll(() => document.querySelector('.lm-signature')).toBeNull()
  })
})

describe('completion on a phone', () => {
  it("moves through a snippet's fields with the ⇥ key, a phone keyboard having no Tab", async () => {
    // a touch screen, as a phone has: the row of keys shows over the keyboard
    window.matchMedia = (q: string) =>
      q.includes('pointer: coarse')
        ? ({
            matches: true,
            media: q,
            onchange: null,
            addEventListener() {},
            removeEventListener() {},
            addListener() {},
            removeListener() {},
            dispatchEvent: () => false,
          } as MediaQueryList)
        : matchMedia.call(window, q)
    await page.viewport(400, 800)
    const host = document.createElement('div')
    host.style.cssText = 'width: 400px; height: 760px'
    document.body.appendChild(host)
    const ref = createRef<LoadmapEditorHandle>()
    root = createRoot(host)
    root.render(<LoadmapEditor ref={ref} fill initial={cache} />)
    await expect.poll(() => host.querySelector('.cm-editor')).toBeTruthy()
    const v = EditorView.findFromDOM(host.querySelector('.cm-editor') as HTMLElement)!
    const anchor = cache.indexOf('node db "Database" "primary" {') + 'node db "Database" "primary" {'.length
    v.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(anchor, { y: 'center' }) })
    v.focus()
    await expect.poll(() => host.querySelector('.lme-keys')).toBeTruthy()
    await userEvent.keyboard('{Enter}capacity: ')
    await listed(/^measured/)
    await expect.poll(helpClear).toBe('under or over')
    await userEvent.keyboard('{Enter}3000')
    const tab = host.querySelector('.lme-keys [aria-label="Indent"]') as HTMLElement
    // a DOM click: the row keeps the text's focus, as a tap does
    tab.click()
    await userEvent.keyboard('req/s')
    tab.click()
    await userEvent.keyboard('load test')
    expect(line(v)).toBe('capacity: measured(3000, "req/s", "load test")')
    // the last tap leaves the call: what is typed next goes after it
    tab.click()
    await userEvent.keyboard(' # ok')
    expect(line(v)).toBe('capacity: measured(3000, "req/s", "load test") # ok')
  })
})
