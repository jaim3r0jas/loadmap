# Checkout

Orders and events from phones pass an API gateway, wait in Kafka, are handled by a pool of worker pods and end in
Postgres. The gateway's capacity is a vendor benchmark (± 30 %), the workers' cost per message a fit from a measured
series. It compares today with a proposal and carries a story of three steps.

<div class="island" data-island="example" data-name="checkout"></div>

The buttons export the board as it is now: a PNG, a poster with the limits and the scenarios compared, an SVG, or a
WebM of the story. The same model as text is
[`checkout.loadmap`](https://github.com/jaim3r0jas/loadmap/blob/main/examples/checkout/checkout.loadmap); the
TypeScript is in [`examples/checkout`](https://github.com/jaim3r0jas/loadmap/tree/main/examples/checkout).

From the command line, with the docs running (`pnpm dev`):

```bash
loadmap record http://localhost:5173/examples/checkout/ --out checkout.gif --story --caption
```
