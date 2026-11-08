# Checkout

Orders and events from phones pass an API gateway, wait in Kafka, are handled by a pool of worker pods and end in
Postgres. The gateway's capacity is a vendor benchmark (± 30 %), the workers' cost per message a fit from a measured
series. It compares today with a proposal, turns load into dates with a growth rate, and carries a story of three
steps. Its boxes stand in three tiers, and events older than a minute are dropped under backlog.

**Try:** **▶ Play** the story · click **7.4×** under the slider, where the gateway reaches its target · drag the
diagram, pinch or Ctrl-scroll to zoom, and **Fit** to see it whole.

<div class="island" data-island="example" data-name="checkout" data-editor="../../editor/"></div>

The buttons export the board as it is now: a PNG, a poster with the limits and the scenarios compared, an SVG, or a
WebM of the story. The same model as text is
[`checkout.loadmap`](https://github.com/jaim3r0jas/loadmap/blob/main/examples/checkout/checkout.loadmap); the
TypeScript is in [`examples/checkout`](https://github.com/jaim3r0jas/loadmap/tree/main/examples/checkout).

From the command line, with the docs running (`pnpm dev`):

```bash
loadmap record http://localhost:5173/examples/checkout/ --out checkout.gif --story --caption
```

## Keeping it true

The model promises headroom in each scenario. `loadmap check checkout.loadmap` prints
`checkout.loadmap: 2 expectations hold`, or fails the build that loses one, with its line:

```
@include(examples/checkout/checkout.loadmap, "expect ", "# the walk")
```
