<div class="home-hero"><div class="home-pitch">

<p class="home-name">loadmap</p>

# Know which part runs out first

<p class="lead">An architecture diagram whose parts are live. Dots show the load flowing through the system, controls change the load and the design, and a ranked list shows which part runs out first, and at what multiple of today's load.</p>

<p class="home-actions"><a class="button primary" href="getting-started/">Get started</a> <a class="button" href="editor/">Open the editor</a></p>

```bash
npm i @loadmap/react react react-dom
```

</div><div class="home-board">

<div class="island" data-island="hero"></div>

<p class="home-caption">The checkout pipeline, live: drag the load, or switch to Proposed. <a href="examples/checkout/">Its page</a> has every panel.</p>

</div></div>

## How it works

<div class="home-steps"><div class="home-step">

<p class="home-step-title"><span class="home-step-n">1</span> Describe the system</p>

```loadmap
@include(apps/docs/pages/shop.loadmap, "flow orders", "node shop")
```

<p class="home-step-note">From <code>shop.loadmap</code>, with the API in front of the database.</p>

</div><div class="home-step">

<p class="home-step-title"><span class="home-step-n">2</span> See it run</p>

```text
At 1×, every component is under the
50 % target. It holds up to 7.5×; the
database is the first limit.
```

<p class="home-step-note">Every capacity says where it came from: measured, estimated (with how sure), published or fitted.</p>

</div><div class="home-step">

<p class="home-step-title"><span class="home-step-n">3</span> Keep it true</p>

```text
$ loadmap check shop.loadmap
shop.loadmap: 1 expectation holds
```

<p class="home-step-note">On a pull request it says what the change does to the first limit.</p>

</div></div>

## What it does

<div class="home-caps">
<a class="home-cap" href="language/"><span class="home-cap-icon" aria-hidden="true">&lt;/&gt;</span><span><b>TypeScript or text</b>A model in code or in the <code>.loadmap</code> language, drawn the same.</span></a>
<a class="home-cap" href="language/scenarios/"><span class="home-cap-icon" aria-hidden="true">↗</span><span><b>Scenarios and growth</b>Today beside a proposal, and when each runs out.</span></a>
<a class="home-cap" href="language/how-sure/"><span class="home-cap-icon" aria-hidden="true">±</span><span><b>How sure</b>A capacity's ± makes every answer a range.</span></a>
<a class="home-cap" href="language/published/"><span class="home-cap-icon" aria-hidden="true">▤</span><span><b>Published benchmarks</b>A component's figure from the catalog, with its source.</span></a>
<a class="home-cap" href="live-data/"><span class="home-cap-icon" aria-hidden="true">∿</span><span><b>Live data</b>Capacities and costs read from Prometheus or Elasticsearch.</span></a>
<a class="home-cap" href="checks/"><span class="home-cap-icon" aria-hidden="true">✓</span><span><b>Checks in CI</b>A build fails when a change loses the headroom promised; drift says what moved in the data.</span></a>
<a class="home-cap" href="recording/"><span class="home-cap-icon" aria-hidden="true">▶</span><span><b>Recordings</b>A GIF, a video or a poster for a pull request or a slide.</span></a>
<a class="home-cap" href="embedding/"><span class="home-cap-icon" aria-hidden="true">⧉</span><span><b>Share and embed</b>A link that carries the whole model, or a frame in a page.</span></a>
<a class="home-cap" href="in-your-editor/"><span class="home-cap-icon" aria-hidden="true">&gt;_</span><span><b>In your editor</b>VS Code, any editor with a language server, or this site's.</span></a>
<a class="home-cap" href="for-agents/"><span class="home-cap-icon" aria-hidden="true">✦</span><span><b>For agents</b>The whole reference in one file, and a checker that answers in words.</span></a>
</div>

## Examples

<ul class="cards home-examples">
<li><a href="examples/checkout/"><b>Checkout</b><span>Orders through a gateway, a queue, workers and Postgres.</span></a></li>
<li><a href="examples/alerts/"><b>Alerts</b><span>Two topics on shared brokers, then a fan-out to the receivers.</span></a></li>
<li><a href="examples/search/"><b>Search</b><span>Clients that retry, a rate limiter, an autoscaled API and a cache.</span></a></li>
<li><a href="examples/regions/"><b>Two regions</b><span>Each region a subsystem, in several files: what happens to one when the other is lost.</span></a></li>
</ul>

Each is laid out to read in a minute, with a story to play; [All examples](/examples/) has twelve starters to make
your own.

## Start

[Getting started](/getting-started/) has a model on your page in a few minutes. You can also write a model as text,
in [the editor](/editor/) or [in your own](/in-your-editor/), and [What's new](/whats-new/) has every release.
