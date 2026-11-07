import { CATALOG, type TemplateEntry } from './catalog'
import { MenuItem } from './Menu'
import type { Template } from './templates'

/** The starters in New, each with its line: loaded when the menu first opens, so the editor's first load lacks the list. */
export default function Starters({
  templates,
  sheet,
  onPick,
}: {
  templates: readonly Template[] | undefined
  sheet?: boolean
  onPick: (t: Template | TemplateEntry) => void
}) {
  return (templates ?? CATALOG).map((t) => (
    <MenuItem key={t.id} hint={t.summary} sheet={sheet} onSelect={() => onPick(t)}>
      {t.title}
    </MenuItem>
  ))
}
