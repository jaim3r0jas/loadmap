# Search

Clients search a product catalog through a rate limiter, an autoscaled API and a cache in front of a search index.
The four building blocks in one system: the limiter turns away what is over its limit, and what it turns away is gone
from every box after it; the API adds pods up to its most; the cache answers most searches, so only the misses reach
the index; and the clients retry a search the limiter turned away, which past the limit multiplies what it sees. It
is laid out stable: no step or control moves a box, since the pool already draws every pod it may run.

**Try:** **▶ Play**: at 30× the retries multiply at the limiter · click **Cold cache** in the design, and the index
takes over · zoom into the API: the faded pods are the ones it may add.

<div class="island" data-island="example" data-name="search" data-editor="../../editor/"></div>

**search.loadmap ↓** is the same model as text
([on GitHub](https://github.com/jaim3r0jas/loadmap/blob/main/examples/search/search.loadmap)). Open it in VS Code
with the loadmap extension for a live preview beside the text, or in Neovim or Helix:
[In your editor](/in-your-editor/).

## Keeping it true

`loadmap check search.loadmap` prints `search.loadmap: 2 expectations hold`, or fails the build that loses one:

```
@include(examples/search/search.loadmap, "expect ", "step ")
```
