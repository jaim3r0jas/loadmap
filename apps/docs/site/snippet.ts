// A snippet as a read-only CodeMirror view: the cursor goes in (to select, to move with the keyboard, to select all of
// it and nothing else) and nothing edits. Loaded only once a snippet is near the window; until then, and without
// scripts, the page shows the coloured <pre> the build wrote.
import { EditorState, RangeSetBuilder } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'

// The <pre>'s own box (docs.css, pre.code), so the view takes its place without moving the page.
const theme = EditorView.theme({
  '&': {
    font: '0.84rem / 1.55 var(--mono)',
    background: 'var(--code)',
    border: '1px solid var(--line)',
    borderRadius: '8px',
  },
  '&.cm-focused': { outline: '2px solid var(--accent)', outlineOffset: '1px' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: 'inherit', borderRadius: 'inherit' },
  '.cm-content': { padding: '12px 0', caretColor: 'var(--fg)' },
  '.cm-line': { padding: '0 16px' },
})

/**
 * The tokens the build coloured, as marks: the text never changes, so they never go stale, and no parser is loaded.
 */
function tokens(code: Element) {
  const marks = new RangeSetBuilder<Decoration>()
  let at = 0
  for (const node of code.childNodes) {
    const length = node.textContent?.length ?? 0
    if (node instanceof HTMLElement && length) marks.add(at, at + length, Decoration.mark({ class: node.className }))
    at += length
  }
  return marks.finish()
}

/** Puts the view after the `<pre>`, which stays (hidden) as the text the copy button and an island read. */
export function mount(pre: HTMLElement) {
  const code = pre.querySelector('code') ?? pre
  const host = document.createElement('div')
  pre.after(host)
  new EditorView({
    parent: host,
    state: EditorState.create({
      doc: pre.textContent ?? '',
      extensions: [
        EditorState.readOnly.of(true),
        // whatever a browser lets through (a drop, an input method) changes nothing either
        EditorState.changeFilter.of(() => false),
        EditorView.contentAttributes.of({
          'aria-label': `${pre.dataset.label ?? 'Code'} snippet`,
          'aria-readonly': 'true',
          // editable for the caret, but a phone keeps its keyboard down
          inputmode: 'none',
        }),
        EditorView.decorations.of(tokens(code)),
        theme,
      ],
    }),
  })
  pre.hidden = true
}
