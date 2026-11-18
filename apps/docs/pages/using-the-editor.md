# Using the editor

A `.loadmap` definition and its live diagram. Errors show under the line as you type, and the diagram keeps the
last version that compiled. Your text is kept in this browser as a draft. [Open the editor](/editor/): this page is
also its **Help**.

## The canvas and the panels

The diagram fills the window: drag it to move it, zoom with the wheel or a pinch (or + and −), and **Fit** brings
the whole of it back. The text floats on its left: drag its edge to resize it, and **‹** hides it. The verdict, the
controls and the other panels stand on the right: **Unpin** folds them onto a rail that opens when you point at it.
This browser remembers how you leave them.

On a phone, **Diagram** and **Code** at the bottom switch between the two. The panels rest in a sheet over the
diagram's bottom: the verdict and the load at first, more as you drag or tap it up. Typing, a row over the keyboard
has Suggest, Format, Undo, an indent, braces, quotes, Rename, Find and Done; **⋯** has the rest.

A click on a box selects its lines in the text, and the cursor in a box's lines rings the box. **Format**
(Shift+Alt+F) lays the text out the one way, as `loadmap fmt` does.

## Files and tabs

A model in several files opens on its model, each file in a tab of one row: close a tab and the file stays, and a dot
marks a file with errors. The files' explorer beside the text is a tree by folder: it opens a file as a tab, and adds,
renames and removes files, the `include`, `import`, `part of` and `extends` lines that name them following. Under
each file it lists the subsystems the file declares, one in another indented under it; a click (or Enter) opens the
file at that subsystem's line. Rename reaches every file of the model, and Undo takes a rename back in all of them.

## Writing with help

**Ctrl+Space** (on a Mac **⌘I** or ⌥I, on any keyboard layout: macOS takes ⌃Space to switch the input source) lists
what can go at the cursor: the statements and properties of the block it is in, the names a formula can read, the
stages a route can take next. A statement typed at the start of a line completes as a snippet, Tab moving through
its places.

Hover over a word to read what it is: a statement or a property with its reference, a name with its value at the
defaults, a published figure with its conditions and source. Inside a call, the arguments it takes show as you type
them. An error's tooltip offers its quick fixes (the name meant, a missing property, a capacity for a bare number, a
lost box for a loss nothing counts), and the other uses of the name under the cursor are marked.

Ctrl+F (⌘F) finds and replaces, F12 goes to where a name is declared and F2 renames it. **View → Keyboard shortcuts**
lists every key; Esc then Tab leaves the text. There is nothing to save: the page keeps your draft as you type, so ⌘S
(Ctrl+S) only says so, unless the files came from GitHub (below). **View** also sets the code's font (the system's,
Fira Code, JetBrains Mono or Cascadia Code, each fetched only when you pick it), its size, and its ligatures (`->`
drawn as one arrow, a capacity's `+-` as `±`, the text as written); this browser keeps them.

## Tracking live changes

**Track live changes**, a button in the code panel, follows your edits on the board: once an edit is drawn and the
text rests half a second, the board brings the boxes it changed into view and marks them with a short glow (a box
whose lines the edit is in, one a changed line names, one that is new or another size, the ends of an edge that came
or went). Off, the view stays where you left it.

## Adding from the catalog

**New → Add → From the catalog** adds a component with a published figure: pick the component and one of its runs,
and its conditions; it writes the `published` statement and a new box of the component's kind running its stage, or
gives the selected box that capacity. It then asks how flows use the box: the stage where its kind has two (flows end
here, or go on), a queue's partitions and the rule the pool after it reads by (`kafka/consumer-group`), a cache's hit
ratio, and which flows pass it and where on each route. It says the demand in words and shows the lines it adds and
takes out before it adds them. [Published figures](/language/published/) has the catalog and its editions.

## Opening and saving on GitHub

**New** starts from a template or an example, and **Export** downloads the text or an image. **New → Open from
GitHub…** opens a model from a repository (`owner/name`, or the address of a folder or a `.loadmap` file in it) with
the files it names. A public repository opens as it is; a private one asks for a token in place: the dialog links
to GitHub's form, filled in, and the token stays in the page (or this tab, if you say so), never in a link or this
browser's lasting storage. A private repository's files stay in this tab too, apart from your draft. A link can open
one as well: `/editor/?repo=owner/name&path=models/shop.loadmap` (`&ref=` for another branch), for instance from a
repository's README:

```text
[Open in the loadmap editor](https://jaim3r0jas.github.io/loadmap/editor/?repo=owner/name&path=models/shop.loadmap)
```

The repository's name in the bar says how many files you changed; it opens **Changes**: each file's diff, **Undo**
for one or all. **Save to GitHub…** there (or ⌘S) writes them as a commit on a new branch of the repository, and opens
a pull request into the branch they came from if you ask; the next save adds a commit to that branch. It needs a
token that may write (Contents, and Pull requests for the pull request), asked for in place; nothing is written before
you press **Save to GitHub**. Where the site has its GitHub App, **Sign in with GitHub** gets the token in a popup
instead: it reaches only the repositories the app is installed on, for 8 hours.

## Sharing, and the inspector

**Share** puts the whole definition and the values you set into a link and copies it; its **▾** has **Embed in a
page…**, for a frame in another page ([Embedding](/embedding/)). The link opens with the text hidden: the diagram, and
an inspector in the panel. Click a box to change its label, its capacity and the parameters it reads, or open
**Model** for the title, the load, growth and the flows. Each change is a small edit of the text, so **Undo** takes it
back, the link carries it, and **Show code** shows what changed. For a box `like` another, the inspector lists each
line it takes from the other, as written there; **Write here** puts it in the box, to change it there.

[The language](/language/) · [Reference](/reference/) · [Examples](/examples/)
