# Asking a model

The editor's **Ask** panel asks a language model for a change to the diagram, in your words. The answer comes as a
proposal that the compiler has checked, drawn in the canvas, and goes into the text only when you accept it. Nothing
reaches the model before you send, and nothing reaches the text before you accept.

[Open the editor](/editor/) and press **Ask** among the panels.

## A model and a key

Pick a provider (Anthropic, DeepSeek, OpenAI, OpenRouter, Groq, Mistral, Gemini, or Ollama or LM Studio on your own
computer) and a model, and paste your own key. The key stays in this page's memory; **Keep for this tab** keeps it
until the tab closes, and **Forget** drops it. It is never in a link, in this browser's lasting storage, or sent
anywhere but to the provider you picked.

- **Sign in with OpenRouter** makes a key for you in a popup, instead of pasting one.
- **Remember it for my account**, when you are connected to GitHub through the site's app: your choice of provider and
  model and your key are kept for you, so your next visit, or another device, finds them set. See below.
- A model on your own computer needs no key. Start Ollama with `OLLAMA_ORIGINS` naming this site (for LM Studio,
  allow CORS in its server settings).

## Where your key is kept

Ticked, **Remember it for my account** keeps your choice and your key with this site's service (a Cloudflare Worker,
`apps/github-auth` in the repository), encrypted with its own secret and filed under your GitHub account. It is
read back only for a question that needs it, from a browser you connected, and goes from there to your provider alone.
The service's owner can read a key it keeps: untick the box to keep the key in this page (or this tab) only.
**Forget** removes it from your account too.

A repository you opened from GitHub can have its own: in the panel's settings, pick the repository's name in place of
**Your default**, then its provider and model, and **A different key for this repository** or your key for that
provider. While it is open, its own is in force, and the panel says so (**from owner/name**, or **your default**). It
is filed under GitHub's id of the repository, so a rename keeps it, and nothing is written to the repository:
collaborators each set their own. **Use your default here** forgets it. Once set, the settings fold to one line;
**Settings** opens them again. Revoking the loadmap editor app on GitHub ends the service's access within
8 hours; **Disconnect** forgets the connection in this browser.

## What it sends

The model reads the language reference (this site's [llms-full.txt](/llms-full.txt)), your files, and what the engine
computes from them: each component's use, the first limit, the expectations. With a box selected, the question is
about it first, and the model gets that box's facts: its use, demand and capacity, where the capacity came from, and
what reaches it. The files of a private repository leave the page only once you say so, once per repository.

## A proposal

The model answers with changes by name (set a field, put a statement, connect two boxes, rename across files), and
the compiler checks them before you see anything. A change that breaks the definition goes back to the model with
the error, at most twice; you see only what compiles.

The proposal says what it does, shows a diff per file, lists the capacities it wrote, and says what moves (the first
limit, before and after). Each capacity says where its numbers came from: **given** when you wrote them, **read from
your metrics** when a look found them, and **the assistant's guess** otherwise, written as an estimate. The canvas
draws the proposal: the boxes it adds dashed, those it changes outlined. **Before** and **After** switch between the
files and the proposal.

**Accept** puts it in the text, one undo step per file, and keeps a version in the Timeline with your request, the
model and its changes. **Reject** drops it. A proposal about text you changed since you asked is refused: ask again.

With a box selected, **Explain it**, **What runs through it**, **Is a flow missing?** and **Critique it** ask about
it in one press. An answer in words offers **Draft this**, which asks for the change it advised.

## A conversation

The panel is a conversation: a follow-up goes with what was asked and answered before it, and the answer comes as it
is written. Answers are drawn from their Markdown (lists, tables, code); the panel never runs what a model writes, never
loads an image from an answer (its link is shown instead), and opens only `http` and `https` links. A proposal stays in
the conversation where it came, and once decided a line says what became of it.

The whole diagram has a conversation, and so does each box you ask about: a question with a box selected goes in that
box's, which starts with nothing from the others. **Conversation** switches between them, and **New conversation**
starts the one shown again, empty.

## The Timeline, and saving

Every version of the files is kept as a git commit, as git writes one: what you keep, every accepted proposal, every
⌘S. The **Timeline** draws any version in the canvas, restores it, or branches from it. **Download** saves the whole
history as one file `git clone` reads. A repository opened from GitHub can save every version as its own commit, and
**New → Save to a new repository…** makes a repository in your account with the whole history.

## Your metrics

The model can look at your own metrics before it writes a metric for the diagram. Run the bridge on your computer:

```bash
LOADMAP_PROMETHEUS_URL=https://prometheus.example LOADMAP_PROMETHEUS_TOKEN=… npx @loadmap/cli bridge
```

It prints a code. Type it beside **Connect** in the Ask panel and press it. The bridge serves this site alone, only to
a page given its code, and keeps the address and the token: the page sees what was read, never where from.

When the model asks to look (the metrics whose names hold some words, a metric's labels, what a query gives over a
window), the looks wait on a card: **Run**, **Run, and allow for this session**, or **Not now**. What they read goes
back to the model as data. A measure you accept is read at once, and the canvas draws the files with it ("Drawn with
your metrics"); **Draw with them** reads every measure again. The text stays as written.

## On the command line

The same assistant runs without a page:

```bash
DEEPSEEK_API_KEY=… npx @loadmap/cli ask shop.loadmap "add a cache in front of the database"
```

It prints the proposal and its diff; `--write` writes it, `--commit` commits it, `--box <id>` asks about a box, and
`--explore` lets the model look in the store `loadmap pull` reads. `loadmap explore search <words>` (or `labels`,
`try`) makes one look yourself. The model is the one the environment names (`LOADMAP_AI_PROVIDER`, `LOADMAP_AI_MODEL`
and the provider's key), or `--provider` and `--model`.

## Which model

`apps/eval` in the repository holds over forty requests against the examples, each with what a good answer must do, and
some that look in a recorded store first. Its workflow runs them against a model with a key from the repository's
secrets and writes a table: which cases pass, how many repairs they took, what they cost. No run has filled the table
yet; until one does, pick a capable model, and prefer one that writes the operations well.
