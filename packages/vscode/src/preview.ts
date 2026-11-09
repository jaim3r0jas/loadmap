import { randomBytes } from 'node:crypto'
import { basename } from 'node:path'
import {
  commands,
  type Disposable,
  type DocumentSymbol,
  type ExtensionContext,
  type Position,
  Range,
  Selection,
  type TextDocument,
  TextEditorRevealType,
  Uri,
  ViewColumn,
  type WebviewPanel,
  window,
  workspace,
} from 'vscode'
import { Edits } from './edits'
import { type FromPreview, ID, type ParamValue, type PreviewState, type Shown, type ToPreview } from './protocol'

export const VIEW_TYPE = 'loadmap.preview'
const BOXES = new Set(['node', 'cluster', 'pool'])
/** How long the text rests before the preview draws it again, as the server waits before it checks. */
const PAUSE = 150

/**
 * The preview beside the text: one panel, following the `.loadmap` editor in front. Edits reach it after a pause; the
 * cursor in a box's declaration picks the box, and a click on a box selects its declaration.
 */
export class Preview {
  private panel: WebviewPanel | undefined
  private doc: TextDocument | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private requests = new Map<number, (v: Shown) => void>()
  private request = 0
  private selected: string | null = null
  /** The cursor move answered last: a slower outline for an older one must not win. */
  private moves = 0
  private outline: { uri: string; version: number; boxes: Promise<DocumentSymbol[]> } | undefined
  /** Track live changes: the edits the preview has not followed yet, and the boxes it showed last. */
  private tracking = Preview.trackSetting()
  private edits = new Edits('')
  private changed: string[] = []
  private readonly listening: Disposable[] = []

  constructor(private readonly context: ExtensionContext) {
    context.subscriptions.push(
      window.registerWebviewPanelSerializer(VIEW_TYPE, {
        deserializeWebviewPanel: async (panel, state?: PreviewState) => {
          const doc = state?.uri
            ? await workspace.openTextDocument(Uri.parse(state.uri)).then(undefined, () => {})
            : undefined
          this.attach(panel)
          if (doc) this.follow(doc)
        },
      }),
      workspace.onDidChangeTextDocument((e) => {
        if (!this.follows(e.document) || !e.contentChanges.length) return
        if (this.tracking) this.edits.apply(e.contentChanges, e.document.getText(), e.document.version)
        this.later()
      }),
      workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('loadmap.preview.trackChanges')) this.track(Preview.trackSetting())
      }),
      window.onDidChangeActiveTextEditor((editor) => {
        if (this.panel && editor?.document.languageId === 'loadmap') this.follow(editor.document)
      }),
      window.onDidChangeTextEditorSelection((e) => {
        if (this.panel && this.follows(e.textEditor.document)) void this.select(e.selections[0]!.active)
      }),
      { dispose: () => this.panel?.dispose() },
    )
  }

  /** Opens the preview of `doc` (or brings it to the front), beside the text or in its place. */
  show(doc: TextDocument, side: boolean) {
    const column = side ? ViewColumn.Beside : (window.activeTextEditor?.viewColumn ?? ViewColumn.Active)
    if (this.panel) this.panel.reveal(column, true)
    else
      this.attach(
        window.createWebviewPanel(
          VIEW_TYPE,
          'Preview',
          { viewColumn: column, preserveFocus: true },
          { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [this.root] },
        ),
      )
    this.follow(doc)
  }

  /** What the preview shows, from the webview itself; undefined without a preview, or one that does not answer. */
  async shown(): Promise<Shown | undefined> {
    if (!this.panel) return undefined
    const request = ++this.request
    const shown = await new Promise<Shown | undefined>((resolve) => {
      this.requests.set(request, resolve)
      this.post({ type: 'state?', request })
      // hidden while it loads, or gone
      setTimeout(() => resolve(undefined), 2000)
    })
    this.requests.delete(request)
    return shown
  }

  /** The text a share link carries, and the values the preview holds for it (none without a preview). */
  async shared(): Promise<{ doc: TextDocument; values: Record<string, ParamValue> } | undefined> {
    const active = window.activeTextEditor?.document
    const doc = this.panel && this.doc ? this.doc : active?.languageId === 'loadmap' ? active : undefined
    if (!doc) return undefined
    return { doc, values: this.follows(doc) ? ((await this.shown())?.values ?? {}) : {} }
  }

  /** The document the preview shows and the box selected on it, for a pick made over the preview. */
  async target(): Promise<{ doc: TextDocument; box?: string } | undefined> {
    const doc = this.doc
    if (!this.panel || !doc) return undefined
    const box = (await this.shown())?.selected
    return box ? { doc, box } : { doc }
  }

  /** The boxes the preview showed last as changed by an edit. */
  get tracked(): readonly string[] {
    return this.changed
  }

  static trackSetting(): boolean {
    return workspace.getConfiguration('loadmap').get<boolean>('preview.trackChanges') === true
  }

  private track(on: boolean) {
    if (on === this.tracking) return
    this.tracking = on
    // the edits made while it did not track are not followed; the next one is, from what the preview draws now
    this.edits.reset(this.doc?.getText() ?? '', false)
    this.post({ type: 'track', on })
  }

  private get root() {
    return Uri.joinPath(this.context.extensionUri, 'dist', 'webview')
  }

  private attach(panel: WebviewPanel) {
    this.panel = panel
    panel.iconPath = Uri.joinPath(this.context.extensionUri, 'icons', 'loadmap.png')
    panel.webview.options = { enableScripts: true, localResourceRoots: [this.root] }
    panel.webview.html = this.html(panel)
    this.listening.push(
      panel.webview.onDidReceiveMessage((m: FromPreview) => this.receive(m)),
      panel.onDidDispose(() => {
        this.panel = undefined
        this.doc = undefined
        clearTimeout(this.timer)
        for (const d of this.listening.splice(0)) d.dispose()
      }),
    )
  }

  /** The document the preview follows, by its uri: VS Code may hand out a new object for a file opened again. */
  private follows(doc: TextDocument) {
    return !!this.doc && doc.uri.toString() === this.doc.uri.toString()
  }

  private follow(doc: TextDocument) {
    this.doc = doc
    this.edits.reset(doc.getText())
    this.selected = null
    this.moves++
    if (this.panel) this.panel.title = `Preview ${basename(doc.uri.path)}`
    this.send()
    this.post({ type: 'select', id: null })
  }

  private later() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.send(), PAUSE)
  }

  private send() {
    if (!this.doc) return
    this.post({
      type: 'source',
      uri: this.doc.uri.toString(),
      source: this.doc.getText(),
      name: basename(this.doc.uri.path),
      version: this.doc.version,
      edits: this.edits.take(),
    })
  }

  private post(m: ToPreview) {
    void this.panel?.webview.postMessage(m)
  }

  /**
   * The boxes of the document, from the language server's outline: their ids and where they are declared. Asked once
   * for each version of the text, not on every move of the cursor.
   */
  private boxes(): Promise<DocumentSymbol[]> {
    const doc = this.doc
    if (!doc) return Promise.resolve([])
    const uri = doc.uri.toString()
    if (this.outline?.uri !== uri || this.outline.version !== doc.version) {
      const asked = commands.executeCommand<DocumentSymbol[] | undefined>(
        'vscode.executeDocumentSymbolProvider',
        doc.uri,
      )
      this.outline = {
        uri,
        version: doc.version,
        boxes: Promise.resolve(asked).then((all) => (all ?? []).filter((s) => BOXES.has(s.detail))),
      }
    }
    return this.outline.boxes
  }

  private async select(at: Position) {
    const move = ++this.moves
    const box = (await this.boxes()).find((s) => s.range.contains(at))
    if (move !== this.moves) return
    const id = box?.name ?? null
    if (id === this.selected) return
    this.selected = id
    this.post({ type: 'select', id })
  }

  private async receive(m: FromPreview) {
    if (m?.type === 'ready') {
      this.post({ type: 'track', on: this.tracking })
      this.send()
    } else if (m?.type === 'tracked' && Number.isSafeInteger(m.version)) {
      // a late answer about the document shown before follows nothing here
      if (m.uri !== this.doc?.uri.toString()) return
      this.edits.tracked(m.version)
      this.changed = Array.isArray(m.boxes)
        ? m.boxes.filter((b): b is string => typeof b === 'string' && ID.test(b))
        : []
    } else if (m?.type === 'state' && typeof m.request === 'number') {
      const values: Record<string, ParamValue> = {}
      for (const [k, v] of Object.entries(m.values && typeof m.values === 'object' ? m.values : {}))
        if (ID.test(k) && ['number', 'string', 'boolean'].includes(typeof v)) values[k] = v
      const boxes = Array.isArray(m.boxes)
        ? m.boxes.filter((b): b is string => typeof b === 'string' && ID.test(b))
        : []
      const selected = typeof m.selected === 'string' && ID.test(m.selected) ? m.selected : null
      this.requests.get(m.request)?.({ values, boxes, selected })
    } else if (m?.type === 'reveal' && typeof m.id === 'string' && ID.test(m.id)) {
      const doc = this.doc
      const box = (await this.boxes()).find((s) => s.name === m.id)
      if (!doc || !box) return
      const shown = window.visibleTextEditors.find((e) => this.follows(e.document))
      const editor = await window.showTextDocument(doc, {
        viewColumn: shown?.viewColumn ?? ViewColumn.One,
        preserveFocus: false,
      })
      editor.selection = new Selection(box.range.start, box.range.end)
      editor.revealRange(new Range(box.range.start, box.range.start), TextEditorRevealType.AtTop)
    }
  }

  /**
   * The page: the bundle from the extension's own files, and a policy that lets nothing else in. No eval, no inline
   * script but the nonce'd entry, no network: the text is the user's, a shared definition is untrusted input.
   */
  private html(panel: WebviewPanel) {
    const w = panel.webview
    const nonce = randomBytes(16).toString('base64')
    const main = w.asWebviewUri(Uri.joinPath(this.root, 'main.js'))
    const csp = [
      "default-src 'none'",
      `script-src 'nonce-${nonce}' ${w.cspSource}`,
      `style-src ${w.cspSource} 'unsafe-inline'`,
      `img-src ${w.cspSource} data: blob:`,
      `font-src ${w.cspSource}`,
      `connect-src ${w.cspSource}`,
      'worker-src blob:',
    ].join('; ')
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style nonce="${nonce}">
  html, body, #root { height: 100%; margin: 0; padding: 0; overflow: hidden; }
  body { background: var(--vscode-editor-background); }
  /* the problems at their height, the board in the rest */
  #root { display: flex; flex-direction: column; }
  #root > .lm { --lm-root-bg: var(--vscode-editor-background); flex: none; }
  #root > .lm[data-full="fill"] { flex: 1; min-height: 0; height: auto; }
  /* what an edit changed, tracked: a glow that fades; with reduced motion it stays still until it goes */
  #root [data-node][data-changed] { animation: lmv-changed 1.6s ease-out; }
  @keyframes lmv-changed { 0%, 35% { filter: drop-shadow(0 0 6px var(--lm-accent)); } to { filter: none; } }
  @media (prefers-reduced-motion: reduce) { #root [data-node][data-changed] { animation: none; filter: drop-shadow(0 0 4px var(--lm-accent)); } }
  .lmv-empty { font: 13px var(--vscode-font-family); color: var(--vscode-descriptionForeground); padding: 16px; }
</style>
</head>
<body>
<div id="root"></div>
<script type="module" nonce="${nonce}" src="${main}"></script>
</body>
</html>`
  }
}
