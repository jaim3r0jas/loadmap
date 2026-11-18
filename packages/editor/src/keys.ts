import { startCompletion } from '@codemirror/autocomplete'
import { selectParentSyntax } from '@codemirror/commands'
import { type Extension, Prec } from '@codemirror/state'
import { EditorView, keymap, runScopeHandlers } from '@codemirror/view'

const MAC = typeof navigator !== 'undefined' && /Mac|iP/.test(navigator.platform)

/**
 * The keys held with Alt (⌥) find their binding by the key pressed, on any layout. On a Mac, ⌥ with a letter types a
 * character or starts a dead key (⌥I starts ˆ on a US layout), and CodeMirror never looks past what was typed when only
 * ⌥ is held: `Alt-i`, `Shift-Alt-f` and `Shift-Alt-m` would never run. A dead key (`key: 'Dead'`) is missed on every
 * platform. Only there, and only when nothing took the key, the keymap is asked again with the letter or digit the
 * layout puts on that key (`keyCode`, as CodeMirror itself does elsewhere; its place, `event.code`, when the browser
 * gives none), and only a binding that takes it stops what the key would type: ⌥L is still @ on a German Mac.
 */
const altKeys = Prec.lowest(
  EditorView.domEventHandlers({
    keydown(event, view) {
      // Ctrl-Alt is AltGr on Windows, and ⌘ or Ctrl with ⌥ already find their binding by the key
      if (!event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return false
      // anywhere but a Mac, CodeMirror already tried the layout's letter for a key that typed one
      const typed = [...event.key].length === 1 && event.key !== ' '
      if (typed && !MAC) return false
      const c = event.keyCode
      const fromLayout = (c >= 65 && c <= 90) || (c >= 48 && c <= 57) ? String.fromCharCode(c).toLowerCase() : null
      const place = /^(?:Key([A-Z])|Digit(\d))$/.exec(event.code)
      const key = fromLayout ?? place?.[1]?.toLowerCase() ?? place?.[2]
      if (!key) return false
      const printed = new KeyboardEvent('keydown', {
        key,
        code: event.code,
        keyCode: key.toUpperCase().charCodeAt(0),
        altKey: true,
        shiftKey: event.shiftKey,
        cancelable: true,
      })
      // true stops the dead key, or the character, from reaching the text
      return runScopeHandlers(view, printed, 'editor')
    },
  }),
)

/**
 * The editor's own keys beside CodeMirror's: the ⌥ keys above, and ⌘I on a Mac for what fits at the cursor, as VS
 * Code's Trigger Suggest (macOS takes ⌃Space to switch the input source). Selecting the block around, CodeMirror's ⌘I,
 * moves to VS Code's Expand Selection there. Not part of `loadmapLanguage()`: a host's editor keeps its own keys.
 */
export const editorKeys: Extension = [
  Prec.highest(
    keymap.of([
      { mac: 'Mod-i', run: startCompletion, preventDefault: true },
      { mac: 'Ctrl-Shift-Mod-ArrowRight', run: selectParentSyntax, preventDefault: true },
    ]),
  ),
  altKeys,
]
