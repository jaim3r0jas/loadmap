/** A font the reader can pick for the code: its family name, and where its file is (a woff2 of its Latin letters). */
export interface CodeFont {
  name: string
  url: string
}

const FONTSOURCE = 'https://cdn.jsdelivr.net/npm/@fontsource-variable'

/**
 * Fira Code and two coding fonts like it, each with ligatures, under the SIL Open Font License: their Latin letters
 * (with `±`), every weight, about 36 to 49 kB each, from fontsource on jsDelivr at a pinned version. A page that keeps
 * its own copies (or allows no other origin) gives `fonts` with its own URLs.
 */
export const CODE_FONTS: readonly CodeFont[] = [
  { name: 'Fira Code', url: `${FONTSOURCE}/fira-code@5.3.0/files/fira-code-latin-wght-normal.woff2` },
  { name: 'JetBrains Mono', url: `${FONTSOURCE}/jetbrains-mono@5.3.0/files/jetbrains-mono-latin-wght-normal.woff2` },
  { name: 'Cascadia Code', url: `${FONTSOURCE}/cascadia-code@5.3.0/files/cascadia-code-latin-wght-normal.woff2` },
]

/** The characters a Latin file holds, as fontsource cuts it: anything else is drawn in the next font of the stack. */
const LATIN =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'

/** The text sizes the reader can pick, in pixels; the code starts at 13. */
export const CODE_SIZES: readonly number[] = [11, 12, 13, 14, 16, 18, 20]
export const CODE_SIZE = 13

// one face per file, however many editors ask for it
const loading = new Map<string, Promise<boolean>>()

/**
 * Adds a font to the page, once, and loads it: only when a reader picks it, so no first load carries it. False when
 * its file did not load: the code keeps the system's monospace, and a later pick tries again.
 */
export function loadFont(font: CodeFont): Promise<boolean> {
  const known = loading.get(font.url)
  if (known) return known
  const face = new FontFace(font.name, `url(${JSON.stringify(font.url)}) format("woff2")`, {
    weight: '300 700',
    display: 'swap',
    unicodeRange: LATIN,
  })
  document.fonts.add(face)
  const loaded = face.load().then(
    () => true,
    () => {
      document.fonts.delete(face)
      loading.delete(font.url)
      return false
    },
  )
  loading.set(font.url, loaded)
  return loaded
}

/** The code's `font-family`: the font picked, then the system's monospace for what it lacks. */
export const fontStack = (font: CodeFont | undefined) =>
  font ? `${JSON.stringify(font.name)}, var(--lm-mono)` : 'var(--lm-mono)'
