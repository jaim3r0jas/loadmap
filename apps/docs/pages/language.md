@include(docs/dsl.md, "# The .loadmap language", "### Formulas")

## The guide, page by page

- [Controls and values](/language/controls/): the load, the controls a reader changes, presets, named formulas,
  fitted costs and the thresholds.
- [Formulas](/language/formulas/): values, units, sizes and the functions a formula may call.
- [Scenarios and stories](/language/scenarios/): designs side by side, growth into dates, and a walk through the model.
- [How sure, and what must hold](/language/how-sure/): a capacity's ±, and the expectations `loadmap check` tests.
- [Published figures](/language/published/): a capacity from the component catalog, and its editions.
- [Measured data](/language/measured-data/): numbers from Prometheus and Elasticsearch, through a snapshot.
- [Building blocks](/language/building-blocks/): caches, autoscaling, rate limits, retries, lost units, queues,
  fan-outs and sinks, splits, slots, connections, latency and timeouts.
- [The view](/language/view/): the diagram's direction, tiers, lanes and full screen.
- [Several files](/language/several-files/): parts, libraries, variants and subsystems.
- [In code](/language/in-code/): compiling a definition from TypeScript, and formatting it.
- [Errors and versions](/language/errors/): every diagnostic's code, and what each version of the language added.

Write it in VS Code, Neovim, Helix or any editor with a language server: [In your editor](/in-your-editor/). Every
statement and property is listed in [the reference](/reference/), and [Checks in CI](/checks/) tests a model on every
pull request.
