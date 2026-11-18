import { Prec } from '@codemirror/state'
import { EditorView, runScopeHandlers } from '@codemirror/view'

/**
 * The keys held with Alt (⌥) find their binding by the key pressed, on any layout. On a Mac, ⌥ with a letter types a
 * character or starts a dead key (⌥I starts ˆ on a US layout), and CodeMirror never looks past what was typed
 * when only ⌥ is held: `Alt-i`, `Shift-Alt-f` and `Shift-Alt-m` would never run. A dead key (`key: 'Dead'`) is
 * missed on every platform. When nothing took the key, the keymap is asked again with the letter or digit of its place
 * on a US keyboard (`event.code`), and only a binding that takes it stops what the key would type: ⌥L is still @ on a German Mac.
 */
export const altKeys = Prec.lowest(
  EditorView.domEventHandlers({
    keydown(event, view) {
      // Ctrl-Alt is AltGr on Windows, and ⌘ or Ctrl with ⌥ already find their binding by the key
      if (!event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return false
      const m = /^(?:Key([A-Z])|Digit(\d))$/.exec(event.code)
      if (!m) return false
      const key = m[1]?.toLowerCase() ?? m[2]!
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
