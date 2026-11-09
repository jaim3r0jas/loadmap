import type { Published } from '@loadmap/core'
import { loadCatalog } from '@loadmap/dsl'
import { addPublished, BOXES, type Decl, latestEdition, parse } from '@loadmap/dsl/internal'
import {
  env,
  type QuickInputButton,
  QuickInputButtons,
  type QuickPickItem,
  Range,
  Selection,
  type TextDocument,
  TextEditorRevealType,
  ThemeIcon,
  Uri,
  ViewColumn,
  WorkspaceEdit,
  window,
  workspace,
} from 'vscode'
import { componentRows, type Run, runs } from './runs'

/** Where a pick goes: the document, and the box whose capacity it may become. */
export interface Target {
  doc: TextDocument
  box?: string
}

const TITLE = 'Add from the Catalog'
const SOURCE: QuickInputButton = { iconPath: new ThemeIcon('link-external'), tooltip: 'Open the source' }

/**
 * Add from the catalog, as the docs' editor does: a component, one of its published runs (the figure, its conditions
 * and its source), then a new box or the selected box's capacity. It writes text only, worked out by the dsl from the
 * text as it is when the pick is made: the smallest edit, refused with the reason when the definition would gain an
 * error.
 */
export async function addFromCatalog({ doc, box }: Target): Promise<void> {
  const components = await loadCatalog().then(
    (e) => Object.values(e[latestEdition(e)]!.components),
    () => undefined,
  )
  if (!components) {
    void window.showErrorMessage('loadmap: the catalog did not load.')
    return
  }
  let component: Published | undefined
  let run: Run | undefined
  for (let step = 1; ; ) {
    if (step === 1) {
      const r = await quickPick(componentRows(components), {
        step,
        title: TITLE,
        placeholder: 'Search components by name, id or what it is',
      })
      if (!r || r === 'back') return
      component = r.component
      step = 2
    } else if (step === 2) {
      const c = component!
      const r = await quickPick(
        runs(c).map((x) => ({ ...x, run: x, buttons: x.url ? [SOURCE] : [] })),
        { step, title: `${TITLE}: ${c.name}`, placeholder: 'Pick the run whose conditions match yours', back: true },
      )
      if (!r) return
      if (r === 'back') step = 1
      else {
        run = r.run
        step = 3
      }
    } else {
      const c = component!
      const label = box ? labelOf(doc.getText(), box) : undefined
      const into = [
        ...(box
          ? [{ label: `Use for ${label ?? box}`, description: 'sets its capacity', into: { box } as const }]
          : []),
        { label: 'Add as a new box', description: '', into: 'new' as const },
      ]
      const r = await quickPick(into, {
        step,
        title: `${TITLE}: ${c.name}, ${run!.label}`,
        placeholder: run!.more.length ? run!.more.join('; ') : 'Where it goes',
        back: true,
      })
      if (!r) return
      if (r === 'back') {
        step = 2
        continue
      }
      await write(doc, { component: c, ...run!.pick, into: r.into })
      return
    }
  }
}

/** The pick written into the document, then its box selected. */
async function write(doc: TextDocument, pick: Parameters<typeof addPublished>[1]) {
  // worked out from the text as it is now: nothing awaits between it and the edit
  const r = addPublished(doc.getText(), pick)
  if ('error' in r) {
    void window.showWarningMessage(`loadmap: not added: ${r.error}.`)
    return
  }
  const edit = new WorkspaceEdit()
  for (const ch of r.changes)
    edit.replace(doc.uri, new Range(doc.positionAt(ch.from), doc.positionAt(ch.to)), ch.insert)
  if (!(await workspace.applyEdit(edit))) {
    void window.showWarningMessage('loadmap: the text could not be changed: nothing was added.')
    return
  }
  const shown = window.visibleTextEditors.find((e) => e.document.uri.toString() === doc.uri.toString())
  const editor = await window.showTextDocument(doc, { viewColumn: shown?.viewColumn ?? ViewColumn.One })
  const d = declaration(doc.getText(), r.box)
  if (d) {
    editor.selection = new Selection(doc.positionAt(d.from), doc.positionAt(d.to))
    editor.revealRange(
      new Range(editor.selection.start, editor.selection.end),
      TextEditorRevealType.InCenterIfOutsideViewport,
    )
  }
  const name = pick.component.name
  window.setStatusBarMessage(
    `loadmap: ${pick.into === 'new' ? `added ${name}` : `${name}'s published figure is in use`}`,
    5000,
  )
}

/** The boxes the text declares, each with its id. */
function boxes(source: string): (Decl & { id: string })[] {
  return parse(source).doc.body.flatMap((s) =>
    s.kind === 'decl' && (BOXES as readonly string[]).includes(s.keyword.name) && s.args[0]?.t === 'id'
      ? [{ ...s, id: s.args[0].name }]
      : [],
  )
}

/** A box's declaration in the text, by its id. */
const declaration = (source: string, id: string) => boxes(source).find((d) => d.id === id)

/** The boxes of the document version asked last: a code action is asked on every move of the cursor. */
let parsed: { uri: string; version: number; boxes: (Decl & { id: string })[] } | undefined

/** The box whose declaration holds an offset of the document. */
export function boxAt(doc: TextDocument, offset: number): string | undefined {
  const uri = doc.uri.toString()
  if (parsed?.uri !== uri || parsed.version !== doc.version)
    parsed = { uri, version: doc.version, boxes: boxes(doc.getText()) }
  return parsed.boxes.find((d) => d.from <= offset && offset <= d.to)?.id
}

/** "Order queue (orderQueue)": a box's label, as its declaration writes it. */
function labelOf(source: string, id: string): string | undefined {
  const label = declaration(source, id)?.args[1]
  return label?.t === 'str' ? `${label.value} (${id})` : undefined
}

/**
 * One step of the picker: the item picked, 'back', or undefined when it was closed. A row's button opens its source.
 */
function quickPick<T extends QuickPickItem & { url?: string }>(
  items: T[],
  o: { step: number; title: string; placeholder: string; back?: boolean },
): Promise<T | 'back' | undefined> {
  const q = window.createQuickPick<T>()
  q.items = items
  q.title = o.title
  q.step = o.step
  q.totalSteps = 3
  q.placeholder = o.placeholder
  q.matchOnDescription = true
  q.matchOnDetail = true
  q.ignoreFocusOut = true
  q.buttons = o.back ? [QuickInputButtons.Back] : []
  return new Promise((resolve) => {
    q.onDidAccept(() => {
      // Enter before the rows are there picks nothing
      const picked = q.selectedItems[0]
      if (!picked) return
      resolve(picked)
      q.hide()
    })
    q.onDidTriggerButton((b) => {
      if (b === QuickInputButtons.Back) resolve('back')
      q.hide()
    })
    q.onDidTriggerItemButton((e) => {
      if (e.item.url) void env.openExternal(Uri.parse(e.item.url))
    })
    q.onDidHide(() => {
      resolve(undefined)
      q.dispose()
    })
    q.show()
  })
}
