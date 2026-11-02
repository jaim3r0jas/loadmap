# loadmap

<p class="lead">An architecture diagram whose parts are live. Dots show the load flowing through the system, controls change the load and the design, and a ranked list shows which part runs out first, and at what multiple of today's load.</p>

<div class="island" data-island="example" data-name="checkout" data-exports="false"></div>

This is the checkout pipeline in [the examples](/examples/checkout/). Move the load, switch to the proposed design, or
press **Start** in the story bar. Every number in the verdict comes from a capacity that says where it came from: measured,
estimated (with how sure), or fitted from measurements.

## What it is for

- **Deciding.** Set today beside a proposal and see which one buys more headroom, and roughly when each runs out.
- **Explaining.** Share a link, put a GIF in a pull request, walk a design review through a story.
- **Keeping it true.** `loadmap check` fails a build when a change loses the headroom a model promises.

## Start

```bash
npm i @loadmap/react react react-dom
```

[Getting started](/getting-started/) has a model on your page in a few minutes. You can also write a model as text
in [the editor](/editor/), or start from [a template](/templates/).
