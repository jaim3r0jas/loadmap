import { EditorView } from '@codemirror/view'

/** The panel's look, in the editor's colours. */
export const panel = EditorView.theme({
  '.cm-panels': { background: 'var(--lm-surface)', color: 'var(--lm-fg)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--lm-line)' },
  '.cm-search': { fontFamily: 'inherit', fontSize: '0.9em', display: 'flex', flexWrap: 'wrap', gap: '4px 6px' },
  '.cm-search label': { display: 'inline-flex', alignItems: 'center', gap: '3px' },
  '.cm-textfield': {
    background: 'var(--lm-bg)',
    color: 'var(--lm-fg)',
    border: '1px solid var(--lm-line)',
    borderRadius: '4px',
    padding: '3px 6px',
    fontSize: '0.85rem',
  },
  '.cm-button': {
    background: 'var(--lm-surface)',
    backgroundImage: 'none',
    color: 'var(--lm-fg)',
    border: '1px solid var(--lm-line)',
    borderRadius: '4px',
    fontSize: '0.85rem',
  },
  '.cm-searchMatch': { background: 'color-mix(in srgb, var(--lm-accent) 25%, transparent)' },
  '.cm-searchMatch-selected': { background: 'color-mix(in srgb, var(--lm-accent) 50%, transparent)' },
})
