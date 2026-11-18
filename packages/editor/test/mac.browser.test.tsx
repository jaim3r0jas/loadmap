import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import cache from '../src/templates/cache.loadmap?raw'

/**
 * The keys of a Mac. CodeMirror reads the platform as it loads, so this file says it is a Mac first and loads the editor
 * after: each browser test file runs in a page of its own.
 */
Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel', configurable: true })
let cm: typeof import('@codemirror/view') & typeof import('@codemirror/state')
let language: typeof import('../src/language')
let keys: typeof import('../src/keys')
beforeAll(async () => {
  const [view, state] = await Promise.all([import('@codemirror/view'), import('@codemirror/state')])
  cm = { ...view, ...state }
  ;[language, keys] = await Promise.all([import('../src/language'), import('../src/keys')])
})

let view: import('@codemirror/view').EditorView | null = null
afterEach(() => {
  view?.destroy()
  view = null
  document.body.replaceChildren()
})

/** An editor holding the cache template with the editor's keys and `more`, focused on a new line in its database box. */
function mount(more: import('@codemirror/state').Extension = []) {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const after = 'node db "Database" "primary" {'
  const doc = cache.replace(after, `${after}\n  `)
  const anchor = doc.indexOf(after) + after.length + 3
  view = new cm.EditorView({
    parent,
    state: cm.EditorState.create({
      doc,
      selection: { anchor },
      extensions: [more, language.loadmapLanguage(), keys.editorKeys],
    }),
  })
  view.dispatch({ effects: cm.EditorView.scrollIntoView(anchor, { y: 'center' }) })
  view.focus()
  return view
}

/** A key pressed with ⌥, as the browser reports it. */
function press(v: import('@codemirror/view').EditorView, init: KeyboardEventInit) {
  const e = new KeyboardEvent('keydown', { altKey: true, bubbles: true, cancelable: true, ...init })
  v.contentDOM.dispatchEvent(e)
  return e
}

const options = () => [...document.querySelectorAll('.cm-tooltip-autocomplete li')].map((li) => li.textContent ?? '')

/** The list opened at the cursor, under the line or over it. */
async function listedAtCaret(v: import('@codemirror/view').EditorView) {
  await expect.poll(() => options().join(' '), { timeout: 5000 }).toContain('demand')
  const caret = v.coordsAtPos(v.state.selection.main.head)!
  const list = document.querySelector('.cm-tooltip-autocomplete')!.getBoundingClientRect()
  expect(Math.abs(list.left - caret.left)).toBeLessThan(48)
  expect(Math.min(Math.abs(list.top - caret.bottom), Math.abs(list.bottom - caret.top))).toBeLessThan(12)
}

describe('what fits at the cursor, on a Mac', () => {
  it('opens with ⌥I where ⌥I starts a dead key, and keeps the dead key out of the text', async () => {
    await page.viewport(1280, 800)
    const v = mount()
    const text = v.state.doc.toString()
    // ⌥I starts ˆ on a US Mac: the key says Dead, its place says I
    expect(press(v, { key: 'Dead', code: 'KeyI', keyCode: 73 }).defaultPrevented).toBe(true)
    await listedAtCaret(v)
    expect(v.state.doc.toString()).toBe(text)
  })

  // on another platform ⌘I is no binding: this test also says the page took itself for a Mac
  it('opens with ⌘I, as in VS Code', async () => {
    await page.viewport(1280, 800)
    const v = mount()
    await userEvent.keyboard('{Meta>}i{/Meta}')
    await listedAtCaret(v)
  })
})

describe('keys held with ⌥, on a Mac', () => {
  it("find their binding by the layout's letter, and the keys no binding takes still type", () => {
    const ran: string[] = []
    const v = mount(
      cm.keymap.of([
        { key: 'Shift-Alt-f', run: () => ran.push('format') > 0 },
        { key: 'Alt-m', run: () => ran.push('m') > 0 },
      ]),
    )
    // ⇧⌥F types Ï on a US Mac
    expect(press(v, { key: 'Ï', code: 'KeyF', keyCode: 70, shiftKey: true }).defaultPrevented).toBe(true)
    // M on a French layout sits where a US keyboard has ;
    expect(press(v, { key: 'µ', code: 'Semicolon', keyCode: 77 }).defaultPrevented).toBe(true)
    expect(ran).toEqual(['format', 'm'])
    // ⌥L is @ on a German Mac
    expect(press(v, { key: '@', code: 'KeyL', keyCode: 76 }).defaultPrevented).toBe(false)
    expect(ran).toEqual(['format', 'm'])
  })
})
