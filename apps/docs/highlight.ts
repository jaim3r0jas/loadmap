// A fence's text as coloured HTML, at build time: the page is readable and coloured before any script runs, and the
// read-only CodeMirror view that later takes a snippet's place reads its tokens from these spans, so no parser reaches
// the browser.
import { StreamLanguage } from '@codemirror/language'
import { lua } from '@codemirror/legacy-modes/mode/lua'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { highlightTree, tags as t, tagHighlighter } from '@lezer/highlight'
import { parser as html } from '@lezer/html'
import { parser as javascript } from '@lezer/javascript'
import { parser as json } from '@lezer/json'
import { parser as yaml } from '@lezer/yaml'
import { loadmapStream } from '../../packages/editor/src/highlight'

interface Parser {
  parse(text: string): Parameters<typeof highlightTree>[0]
}

interface Language {
  /** What a screen reader hears before "snippet". */
  label: string
  parser?: Parser
}

const LANGUAGES: Record<string, Language> = {
  loadmap: { label: 'loadmap', parser: loadmapStream.parser },
  ts: { label: 'TypeScript', parser: javascript.configure({ dialect: 'ts' }) },
  tsx: { label: 'TypeScript', parser: javascript.configure({ dialect: 'jsx ts' }) },
  js: { label: 'JavaScript', parser: javascript.configure({ dialect: 'jsx' }) },
  json: { label: 'JSON', parser: json },
  html: { label: 'HTML', parser: html },
  yaml: { label: 'YAML', parser: yaml },
  bash: { label: 'Shell', parser: StreamLanguage.define(shell).parser },
  toml: { label: 'TOML', parser: StreamLanguage.define(toml).parser },
  lua: { label: 'Lua', parser: StreamLanguage.define(lua).parser },
  // what a command printed, a URL: nothing to colour
  text: { label: 'Text' },
}

/** The languages a fence may name: a page with another one does not build. */
export const FENCES: readonly string[] = Object.keys(LANGUAGES)

// The editor's colours (loadmapHighlight) by class, so docs.css follows the light and dark switch; the other
// languages' tokens take the nearest of the same few colours.
const CLASSES = tagHighlighter([
  { tag: t.keyword, class: 'tok-keyword' },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName)], class: 'tok-def' },
  { tag: [t.propertyName, t.attributeName], class: 'tok-property' },
  { tag: [t.string, t.special(t.string)], class: 'tok-string' },
  { tag: [t.number, t.bool, t.atom, t.null], class: 'tok-number' },
  { tag: t.comment, class: 'tok-comment' },
  { tag: [t.operator, t.standard(t.variableName), t.tagName], class: 'tok-accent' },
  { tag: [t.typeName, t.className, t.namespace], class: 'tok-property' },
])

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The text as HTML with a `<span class="tok-…">` around each token; its text content is the text, to the character. */
export function highlight(text: string, lang: string, file: string): { html: string; label: string } {
  const language = LANGUAGES[lang]
  if (!language) {
    const what = lang ? `in "${lang}"` : 'with no language'
    throw new Error(`docs: ${file} has a fence ${what} ("${text.split('\n')[0]}"): write one of ${FENCES.join(', ')}`)
  }
  if (!language.parser) return { html: esc(text), label: language.label }
  let html = ''
  let at = 0
  highlightTree(language.parser.parse(text), CLASSES, (from, to, classes) => {
    html += `${esc(text.slice(at, from))}<span class="${classes}">${esc(text.slice(from, to))}</span>`
    at = to
  })
  return { html: html + esc(text.slice(at)), label: language.label }
}
