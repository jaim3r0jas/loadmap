# @loadmap/dsl

## 0.47.0

### Minor Changes

- 3c5c29f: A fan-out branch has figures of its own. `expect { flow: orders; to: smtp; lost: 1%; underTarget: 2× }` and
  `expect { flow: orders; to: smtp; p99: 1s }` hold the branch through `smtp`, not the flow: what its copies lose (what
  the fan-out turns away, and along the branch what a pass, a limit or a cache turns away, what a component fails and
  what a queue drops, as a share of the copies asked for) and the time they take from the fan-out through that stage.
  None of it is in the flow's own losses or latency: an order is not lost when its mail is. `to` may be any stage of
  the branch. In code, `model.branch(flow, to, values?, bound?)` gives the branch's `stages`, `lost` and `latency`. A
  `delay` on an edge along a branch now counts in the branch's time (it warned as unused). From `loadmap 1.8`.

  Docs: /language/building-blocks/#fan-out-and-sinks
- 1604406: A breaker with retries: a flow may have a `breaker` and its client's `retry` together, where it took one of them.
  Each attempt goes through the breaker, and a call it fails fast is a failed attempt, sent again like any other. The
  rate the breaker admits is the one at which the failures behind it reach `opens`, whatever is sent, so the retries
  still settle at their least point, as many units fail for good as without the breaker, and the stages behind it see
  what it admits, not the storm. `ev.breakers.<flow>.failedFast` counts attempts, and what is lost for good is shared
  between the stages and the calls failed fast. On the board a retry goes through the breaker as the first attempt did.
  A retry `at` a hop still takes no breaker. This lifts an error, so a file of any version reads it.

  Docs: /language/building-blocks/#lost-units
- 253c67e: Failures that are not about capacity: `fails: 2%` on a component is the share of the units its stages work on that
  fail there whatever the load, a bug, a dependency that errors or a bad deploy. A failed unit is a new loss, `failed`:
  a lost box takes it (`lost { takes: [failed] }`, and a box without `takes` takes it too), its dot goes there, the
  flow's retries send it again, it counts toward the share that opens a breaker, a fallback serves it, and
  `expect { lost }` holds it. The stages after the one that failed it are reached by the rest, in `at` too. It reads
  the load and the parameters, so a scenario can be the bad deploy. A component that fails with no lost box for it warns
  (`unseen-loss`), with the quick fix that adds the box. In TypeScript: `fails: 0.02` on the component;
  `ev.stages.<id>.fails` is the share at the values. From `loadmap 1.8`.

  Docs: /language/building-blocks/#lost-units
- 4613370: What a design costs. `cost: running * 140` on a box is what it costs a month, where `running` is the pods its pool runs
  at this load (an autoscaled pool costs what it runs), the members left across a domain, or 1; `currency: "€"` says what
  it is counted in. `ev.cost` gives the total and each component's, `compare()` puts the total in each scenario's row and
  says what the headroom costs ("…, for 2,300 € a month more"), the scenarios table has a "Cost a month" column with the
  change from the first, and `expect { cost: 5_000; underTarget: 3× }` holds a budget. In TypeScript, `currency` on the
  model and `cost: ({ running }) => running * 140` on a component. From `loadmap 1.8`.

  Docs: /language/scenarios/
- 2c8ee75: A formula reads an outage: `down.zone` is true while a part of the failure domain `zone` is out, so a formula says
  what the outage changes beyond the members it takes (`hit: down.zone ? 60% : 90%`, `fails: down.zone ? 2% : 0%`). In a
  definition with a domain, a pool or a cluster every flow passes that stands across none has the new `single-point`
  warning, and so has a box across a domain with one member: with its part out none is left. A library's box may read
  `down.<domain>` as it may say `across`. Autocomplete
  offers `down.<domain>` for each domain. From `loadmap 1.8`.

  Docs: /language/building-blocks/#failure-domains
- 3b4c2d3: A delay on an edge: `users -> lb: "HTTPS" { delay: 80ms }` is the time a hop takes whatever the load, a network round
  trip or a call to another region. It adds to the latency of every flow that goes from the one box straight to the
  other (on the edge from a flow's `from` box, of the flows that start there), so it counts toward their timeout. No
  unit is done before the delays of its way: the queues' times are fitted past them, so one queue behind a delay has
  the exact percentiles of a shifted exponential. The edge says it after its label ("HTTPS · 80 ms"), and a delay no
  flow goes along warns (`unused-delay`). It may read the load and the parameters. In TypeScript:
  `delays: [{ from: 'api', to: 'payments', delay: 0.002 }]`. From `loadmap 1.8`.

  Docs: /language/building-blocks/#latency-and-timeouts
- 0d5900f: An expect holds a moment: `expect { preset: "Sale day"; queue: topic; lag: 5min; clears: 1h }` says that when the
  preset's moment ends (its `lasts`), the oldest unit waiting in the queue has waited at most 5 minutes, and that the
  reader then empties it within an hour at the default load. Without `queue` it holds every queue. It is held on the
  pessimistic edge, and is inconclusive when it holds only at the high edge of a ±. `backlog()` gives each queue's
  `lag` and takes a `bound`. In TypeScript, `expect: [{ preset: 'Sale day', queue: 'topic', lag: 300, clears: 3600 }]`.
  From `loadmap 1.8`.

  Docs: /language/controls/
- 8b007aa: A fan-out branch that goes on: `orders -> mailQueue -> mailers -> smtp: 1` copies each order into a queue, to the
  workers that read it and on to what they call, where a branch was one stage. The copies reach every stage of the
  branch (`at.mailers.orders`), each stage runs its component and is ranked like any other, a queue on the branch fills
  when its reader is full, the dots go the whole way, and an edge joins each pair of boxes along it. A branch goes
  through queues, pools and `pass`, `cache`, `limit`, `store` and `sink` stages; it takes no split and no second
  fan-out, and it never comes back to the route. This is how the asynchronous side of a system is written: email, search
  indexing, a replica that follows a log. In TypeScript a branch is `{ stages: ['mailQueue', 'mailers', 'smtp'], share:
  1 }`, and a resolved branch carries its `stages`. From `loadmap 1.8`.

  Docs: /language/building-blocks/#fan-out-and-sinks
- 7dca4d6: A hedge on a gather: `hedge: 95%` sends a second call for each one not answered by the p95 of its own time, and the
  first of the two answers counts. What is called sees the second calls (5 % more at 95 %), and the unit's wait for the
  calls it needs is shorter in the tail: a read that waits for 8 calls of 10 ms has its p99 fall from 64 ms to 51 ms. The wait is
  summed over the survival of a hedged call, since the slowest of several has no closed form then. The second call
  takes the edge's delay too. A call that fails is not sent again by a hedge. In TypeScript, `gather({ to, needs,
  hedge: 0.95 })`. From `loadmap 1.8`.

  Docs: /language/building-blocks/#gathers
- 65f637c: A gather: one unit makes several calls at once and goes on when enough of them have answered. `gather { reads ->
  shards: 8; needs: 6 }` is a read from every shard, a quorum write, a page built from many services. The stage it calls
  sees every call (8 a read) and is ranked on that; the unit waits for the slowest call it needs, which is in its
  latency (the 6th of 8 answers, from the calls' mean time); and it fails when too few answer, a loss at the gather
  that a lost box takes and `expect { lost }` holds (a stage failing 1 % of its calls fails 7.7 % of the units that need
  all 8). A call is a copy on a branch, so the line takes what a fan-out's does, a branch that goes on included. Unlike
  a fan-out it does not end the route. In TypeScript, `gather({ to: [{ stage: 'shards', share: 8 }], needs: 6 })`. From
  `loadmap 1.8`.

  Docs: /language/building-blocks/#gathers
- 7068652: Slots held while something slow answers: `through: api -> payments` on a held component names a stretch of the way,
  and a unit holds its slot for the time it takes there (each stage's time at its utilization, and the delays between
  them), on top of `held` if there is one. A thread pool or a connection pool then runs out when the dependency slows
  down, before the box itself is busy. A flow's timeout bounds the time; a cache's hits leave the stretch at the cache;
  a stage past full counts as a million service times. `ev.components.<id>.held` and the box's detail say the whole
  time. In TypeScript: `through: ['api', 'payments']`. From `loadmap 1.8`.

  Docs: /language/building-blocks/#slots-held-for-a-while
- 59e9179: Uneven work, said as a share. `limit { keys: 400; skew: estimated(20%, "share", "the noisiest tenant") }` is a limit for
  each key: the capacity is one key's, it runs out when the hottest key does, and it turns away only what is above each
  key's own limit; the limits list says "400 keys, each its own limit: the hottest carries 20 % of what arrives"
  (`ev.components.<limit>.keys`). `busiest: estimated(32%, "share", "ring stats")` on a connection says how much its
  busiest member takes, whatever deals the work: the stage runs out when that member does. A ± on either share moves the
  crossings. In TypeScript, `limit(c, { keys, skew })` and `busiest` on a connection. From `loadmap 1.8`.

  Docs: /language/building-blocks/#rate-limits
- 47d5230: A rate limit's bucket and a quota per minute. `limit { burst: 500 }` lets everything through past the limit until the
  bucket is spent, its size over what arrives above the limit a second, then cuts to the limit. No steady figure
  changes; `ev.components.<limit>.burst` gives `{ size, passes, lasts }`, and the limits list says "A burst of 500 passes: at 3×
  all gets through for 2.5 s, then it is cut to 100 req/s". A quota counts a window of a minute too (`per: minute`),
  read at the peak as an hour is. In TypeScript, `limit(c, { burst: 500 })` and `limit(c, { per: 'minute' })`. From
  `loadmap 1.8`.

  Docs: /language/building-blocks/#rate-limits
- a1b9a99: A moment's way up walks more of what a peak meets. `cold: [appCache]` on a preset starts its moment with those caches
  cold, and `warms: 5min` on a cache is how long it takes from no hits to its `hit` ("8× at once: up to 62 % of reads is
  lost for 3 min, while the cache warms"). A limit's `burst` is spent on the way, and filled again below the limit ("6× at
  once: nothing is lost for 2.5 s, until the burst of the rate limiter is spent, then 67 % of searches as it holds"). A
  queue with a size takes everything in until it is full ("nothing is lost for 50 s, until the inbox is full"). Each step
  of `moment()` says each cache's warmth, each bucket's units and each queue's backlog. In TypeScript, `colds` beside
  `ramps` and `warms` on `cache()`. From `loadmap 1.8`.

  Docs: /language/controls/#presets
- 9c0e192: A moment's way up. `ramp: 30s` on a preset is how long the load takes to climb from the default to the preset's, and
  `ready: 90s` on an autoscaler is how long after a pod is wanted it takes work. No steady figure changes. While the
  preset is shown, the verdict says what is lost on the way: "8× in 30 s: up to 75 % of requests is lost for 100 s,
  until the eighth pod of the API is ready." `moment(model, values, preset)` from `@loadmap/core/moments` walks a fixed
  number of steps over the ramp and the moment's length and gives each flow's lost units, share and span; the page loads
  it only while such a preset is shown. In TypeScript, `ramps` beside `peaks` and `ready` in the `autoscale`. From
  `loadmap 1.8`.

  Docs: /language/controls/#presets
- 732644f: Language 1.8 is open: 1.7 shipped in @loadmap/dsl 0.46.0, so what is new to read needs a version of its own. Its first
  addition is an expectation on what is lost: `expect { flow: orders; lost: 0.1%; underTarget: 5× }` holds while the flow
  loses at most that share of what it sends for good (turned away, dropped by a queue or too slow for its timeout, after
  every retry and after what its fallback serves), up to that load multiple or, without one, at the scenario's values.
  Without a `flow` it holds for each flow. A failure names the flow, the share and where most of it goes. In code the
  same figures are `ev.lost.<flow>` (rate, share and each stage's part) and `model.lost(values, bound, flows)`. A file
  stamped before 1.8 that writes `lost` in an expect gets the error that says so, with the fix that raises its first
  line. Every definition in the repository says `loadmap 1.8`, and the corpus holds what 0.46.0 released.

  Docs: /language/how-sure/
- 1aac4d6: A queue with a size: `holds: 10_000` on a queue makes it a bounded queue, a buffer, a mailbox. Once its reader is past
  full the queue fills, and what the reader cannot take is turned away: `rejected` at the queue, so a retry sends it
  again, a lost box counts it and `expect { lost }` sees it. `full: block` turns the unit away at the stage before the
  queue instead. With a drop rule the queue takes in `holds` ÷ `olderThan` a second: what arrives above that finds it
  full, and what it took in and its reader cannot take gets too old. A queue with a size and no lost box for what it turns away has a warning.
  For a moment that `lasts`, the verdict says when the queue is full, and the board keeps no more waiting than it holds.
  In TypeScript, `queue({ partitions, holds, whenFull })`, and `backlog()` gives `full: { holds, after }`. From
  `loadmap 1.8`.

  Docs: /language/building-blocks/#queues
- 4f3a2e4: A region goes out: `domain region "Region" { parts: [eu, us] }` names a domain's parts, a box or a subsystem is `in`
  one (`in: eu`), and the Outage control takes each part out by its id (`down: eu`). With a part down its boxes are
  switched off and every split deals again: a way through the part gets nothing and the ways left take its share by
  their own, evenly when theirs are all 0. A flow with no way left is turned away at the split, and what reaches a box
  of the part with no split in front is turned away there. The N−1 line answers for each part ("With the EU out, the
  50 % target holds up to 2×"), `down: region` in an expect holds the worst of the parts, and a formula reads
  `down.eu` and `down.region`. In TypeScript, `parts` on a domain and `in: { domain, part }` on a component. From
  `loadmap 1.8`.

  Docs: /language/building-blocks/#failure-domains
- c0ac379: Retries at a hop: `retry { at: payments; times: 2 }` is the caller of payments calling again. What fails at that stage
  or after it is sent again from there, so only the stages from it on see those attempts. A flow takes one rule without
  `at` (its client's, as before) and one for each stage, and retries inside retries multiply: the attempts a stage sees
  are the product of every rule around it, and an attempt fails only when every attempt inside it does. The rules are
  solved together, the hops inside the client's. `ev.retry.<flow>.hops` gives each hop's attempts a unit, its failing
  share and what fails every attempt there; the Live panel shows the attempts at each hop; a dot sent again at a hop
  starts there. In TypeScript `retry` takes a list: `[{ times: 1 }, { at: 'payments', times: 2 }]`. A timeout stays the
  client's. From `loadmap 1.8`.

  Docs: /language/building-blocks/#retries

### Patch Changes

- Updated dependencies [3c5c29f]
- Updated dependencies [1604406]
- Updated dependencies [253c67e]
- Updated dependencies [4613370]
- Updated dependencies [3b4c2d3]
- Updated dependencies [0d5900f]
- Updated dependencies [8b007aa]
- Updated dependencies [7dca4d6]
- Updated dependencies [65f637c]
- Updated dependencies [7068652]
- Updated dependencies [59e9179]
- Updated dependencies [47d5230]
- Updated dependencies [3d5a64f]
- Updated dependencies [a1b9a99]
- Updated dependencies [9c0e192]
- Updated dependencies [732644f]
- Updated dependencies [1aac4d6]
- Updated dependencies [4f3a2e4]
- Updated dependencies [c0ac379]
  - @loadmap/core@0.47.0
  - @loadmap/layout@0.47.0

## 0.46.0

### Minor Changes

- b547540: A batch: `runs { every: 1d; within: 4h }` on a component (language 1.7; `runs: { every, within }` in TypeScript).
  What reaches it in `every` is worked off `within`, so its demand is the rate a run needs, and it runs out where a run
  misses its window, at a load multiple. Every a day or more reads each flow at its average. The limits list says how
  long a run takes of its time (`ev.components.<id>.runs.takes`).

  Docs: /language/building-blocks/#batches
- 37f77bd: A circuit breaker: `breaker { opens: 50% }` on a flow (language 1.7; `breaker: { opens }` in TypeScript). Past that
  share of its attempts failing, its callers fail calls fast. In steady state it admits the share α at which the
  failures among what it admits are `opens`, p(α·rate) = opens, found by a bracketed root search; below that it
  stays closed. What it fails fast reaches no stage: it goes to the flow's fallback, if any, and on the board fades at
  the source (`ev.breakers.<flow>`: `admitted`, `failedFast`). A flow that retries takes no breaker.

  Docs: /language/building-blocks/#lost-units
- 00a1e85: A fallback: `fallback { after: api; route: staleQuotes }` on a flow (language 1.7; `fallback: { after, route }` in
  TypeScript). What the flow fails for good, turned away or too slow after every retry, goes back to `after` and is
  served along `route`: each fallback stage sees that rate (`ev.fallbacks.<flow>.rate`) and may run out like any other.
  A lost box on the route counts none of it; one behind a fallback stage counts what that stage turns away. On the board
  a failed dot fades where it failed and a dot sets out from `after` along its edge to the fallback, which needs that
  edge (`missing-edge`). The budgets go to 74, 230 and 140 kB.

  Docs: /language/building-blocks/#lost-units
- df7d710: Language 1.7 is open: 1.6 shipped in @loadmap/dsl 0.39.0, so what is new to read needs a version of its own. Its first
  addition is the day: `7d` is seven days in seconds, as `2h` is two hours. A file stamped before 1.7 that writes one
  gets an error that says "a day (7d) is from loadmap 1.7", with the fix that raises its first line. The VS Code
  extension's grammar reads `7d` as one number. Every definition in the repository says `loadmap 1.7`, and the corpus
  holds what 0.45.0 released.

  Docs: /language/formulas/
- a993b1b: A preset can say how long its moment lasts: `preset "Black Friday" { load: 12; lasts: 2h }` (language 1.7; `peaks` in
  TypeScript). While its values are shown, the verdict says what that long leaves in each queue whose reader cannot keep
  up, and how long the reader then needs to clear it at the default load: "After 2 h of Black Friday, 1.4M events wait
  in the events topic, which at 1× clears in 5 h." `backlog(model, values, seconds)` (from `@loadmap/core/backlog`) gives it, by the sim's own rules (a
  reader drains at its component's full, priority 1 first, a drop or a merge leaves less), and the sim builds the same.

  Docs: /language/controls/#presets
- 9222ee2: A quota over a window: `limit { per: day }` (or `hour`, `month`; language 1.7; `limit('plan', { per: 'day' })` in
  TypeScript). Its capacity is what the window allows, `configured(5_000_000, "requests/day", …)`, and its demand what
  reaches it in one window, at the peak for an hour and at each flow's average for a day or a month. It runs out at a
  load multiple like any rate, and past it the limits list says how far into the window it is gone. A quota whose
  capacity is written per second warns.

  Docs: /language/building-blocks/#rate-limits
- 66323a1: A scaling curve: `fit apiScale { curve: usl; points n rate { … } }` (language 1.7; `fitScaling` from
  `@loadmap/core/scaling`) fits the Universal Scalability Law to sizes and the capacity
  measured at each: contention and coherency, so twice the pods give less than twice the capacity and past a peak less.
  Call it like a fit, `measured(apiScale(pods), "req/s", …)`. The assumptions list it with its peak, in the page and in
  `loadmap check`, and a parameter it reads that reaches past the peak warns (`past-peak`). It never applies to a
  published figure.

  Docs: /language/controls/#fitted-costs
- a4b725f: Shedding by priority: `pass { shed: priority }` (language 1.7; `pass('gw', { shed: 'priority' })` in TypeScript). Past
  capacity the pass lets through as much as ever, but the flow with the smaller `priority` number first, so priority 1
  keeps going while there is room for it. Each flow's share is on the stage (`shedBy`), and the dots, the lost boxes and
  the retries follow it.

  Docs: /language/building-blocks/#lost-units
- 0aef603: Stocks: a component that fills over time, not at a load. `fills` is what it gains a second (a disk, a topic's
  retention, a database's size), read with every flow at its new `average`, its rate over a day against its peak. With
  `keeps: 7d` it holds what it gains that long and settles at fills × keeps; with `level: measured(120, "GB", …)` it
  stands there on growth's `asOf` and grows as the load does, so it is ranked at the load multiple whose day it is full,
  with that date. Without growth such a stock is not ranked, and the verdict says why. `expect { lasts: 365d }` holds a
  time through the growth. The limits list says what a stock gains a day and how long it has left at that rate
  (`ev.components.<id>.stock`), and the editor has a starter, "Disk that fills up". All new in language 1.7.

  Docs: /language/building-blocks/#stocks
- 3f8470d: Failure domains: `domain zone "Availability zone" { count: 3 }`, `across: zone` on a pool, a cluster or a node, and
  `down: zone` in a scenario, a step, a preset or an expect (language 1.7; `domains` and `across: { domain, members }`
  in TypeScript). The model gets an Outage control, `down`. With one part out, a box's members in the fullest part are
  out: its utilization is its own times members ÷ members left, a connection deals its parts over the members left,
  and the members out are drawn as idle pods are. A published figure is then left without a benchmark, never scaled
  (`ev.components.<id>.out`: `members`, `left`).

  Docs: /language/building-blocks/#failure-domains

### Patch Changes

- 27c2c2f: `loadmap bundle` and `flatten()` keep the parentheses of a comparison that is compared again: `(mode == "a") == flag`
  was written `mode == "a" == flag`, a chain, and the flat copy did not compile. A comparison given to an input of a
  library is one value where the library compares it again (`ok == flag`), no longer a chain. A signed share of a
  capacity keeps its pair (`100 +- (-5)%`), and a plus before a minus (`+(-a)`) is written `+ -a`, never the `+-` of a
  capacity; `format()` no longer glues those two signs either, under any stamp. Parentheses that change nothing still
  go (`(a * b) + c` is `a * b + c`), and a number or a text in parentheses is copied as written.
- Updated dependencies [b547540]
- Updated dependencies [37f77bd]
- Updated dependencies [00a1e85]
- Updated dependencies [f9b0d92]
- Updated dependencies [aaa4f91]
- Updated dependencies [f89851d]
- Updated dependencies [a993b1b]
- Updated dependencies [9222ee2]
- Updated dependencies [66323a1]
- Updated dependencies [56e90eb]
- Updated dependencies [a4b725f]
- Updated dependencies [0aef603]
- Updated dependencies [3f8470d]
  - @loadmap/core@0.46.0
  - @loadmap/layout@0.46.0

## 0.45.0

### Minor Changes

- 03f7595: The Ask panel's conversations stay across reloads: `assist.conversations` (a `ConversationStore`) keeps them by a
  scope the page names, at most 20 a scope and never a proposal. A model with a small window gets what fits:
  `createAssistant` takes `window` and `smallReference`, reads the short reference under 64 000 tokens, sends the first
  question with the newest turns, keeps an answer to a quarter of the window, and says so with a `trimmed` event; the
  Ollama and LM Studio presets give a `window` of 32 000. `assist.smallReference` passes the short reference to the panel.

  Docs: /assistant/#a-conversation

### Patch Changes

- @loadmap/core@0.45.0
  - @loadmap/layout@0.45.0

## 0.44.0

### Patch Changes

- @loadmap/core@0.44.0
  - @loadmap/layout@0.44.0

## 0.43.0

### Minor Changes

- 7b3620b: `loadmap ask <file> "<request>"` asks a language model for a change to a definition and shows it as a diff; `--write`
  writes it, `--commit` commits it. The model answers with operations by name, or with whole files; the change is laid
  out, compiled and checked before anyone sees it, a refused answer goes back to the model at most twice, and a capacity
  it writes must use a number you gave or say it is the assistant's guess. `@loadmap/dsl/assist` is the same assistant
  for any host: `createAssistant`, two adapters that need only `fetch` (`openaiCompatible`, `anthropic`), the providers
  by name, and `recorded` for tests.

  Docs: /in-your-editor/#ask-a-model
- 82dc3ee: The Ask panel asks about the selected box in one press (Explain it, What runs through it, Is a flow missing?,
  Critique it), with what the engine computes for it, and **Draft this** turns an answer in words into a proposal.
  `boxFacts` in `@loadmap/dsl/assist` writes those facts.

  Docs: /api/editor/#ask
- 2dfac4c: The editor's Ask panel (`assist`): a conversation about the diagram with a model the reader picks and their own key,
  kept in the page's memory or the tab only. Its changes come as proposals the compiler has checked, drawn in the canvas
  with a diff per file and the capacities they write; Accept puts one in the text as an undo step per file and, with
  `history`, a version that keeps the request and the operations. `diffLines` in `@loadmap/dsl/assist` is the line diff
  the panel and `loadmap ask` show. The docs' editor offers it, and its policy allows the providers it lists.

  Docs: /api/editor/#ask
- 2fb0cda: An assistant can look in the reader's metrics before it writes a metric: `prometheusExplorer`, `explorersFromEnv` and
  `runExplore` in `@loadmap/providers` answer `search`, `labels` and `try`, read only and capped. `loadmap explore`
  runs one look; `loadmap ask --explore` runs the looks the model asks for and sends back what they read. The
  assistant's protocol has an `explore` block, and `contextText` says which stores the page can read.

  Docs: /live-data/#with-your-own-prometheus-or-grafana
- c50c688: Changes to a definition by name, across its files: `applyOperations()` in the new entry `@loadmap/dsl/ops` takes a
  list of operations (rename, set, unset, put, remove, connect, disconnect, move, and a part, a library or a variant
  added, renamed or removed) and applies all of them, or none when one is refused or a model that compiled no longer
  does. A removed box takes its edges and its place in routes with it; what a formula still reads of it is said. The
  language server offers two of them as refactorings (remove a statement, move it to a part of the model) and all of them
  through the command `loadmap.applyOperations`.

  Docs: /in-your-editor/#setup

### Patch Changes

- @loadmap/core@0.43.0
  - @loadmap/layout@0.43.0

## 0.42.1

### Patch Changes

- @loadmap/core@0.42.1
  - @loadmap/layout@0.42.1

## 0.42.0

### Patch Changes

- 69133ee: The editor's Box panel changes a box of one copy of a subsystem in that copy's `with`: **This copy** shows the inputs
  that reach the box, as the copy sets them or as their default, and a change writes the copy's line (or a new one, or a
  `with` block). The definition every copy shares is read-only until **Change the definition every copy shares** is
  ticked.

  Docs: /using-the-editor/#sharing-and-the-inspector
- d6c4316: The editor's Box panel shows a box that is written inside a subsystem. It said "That box is no longer in the
  definition": a box in a subsystem is one statement, perhaps in a library, for a box in every subsystem like it, and
  none is written under the id the diagram gives it (`eu.api`). The panel now finds the statement by its place, says
  which other boxes it also draws ("Written once for 2 boxes: a change here also changes us.api."), reads the parameters
  and components of the subsystems around it, and tells what the box takes from the box it is like.
- @loadmap/core@0.42.0
  - @loadmap/layout@0.42.0

## 0.41.0

### Patch Changes

- @loadmap/core@0.41.0
  - @loadmap/layout@0.41.0

## 0.40.0

### Patch Changes

- 3531ca3: The language guide (`REFERENCE.md`) explains what only the reference listed: the load, the three kinds of parameter
  (select, slider, switch) with `hint`, `enabled` and `format`, presets, `let`, a fit from measured points, thresholds and
  `assume`; a component's `name`, `short`, `plural`, `describe` and `when`, an edge's `when`, a flow's `unit` and `color`;
  queues with partitions, priority, `drop` and `merge`; fan-outs and sinks; and a whole `view { … }` block. Each
  building block has a heading of its own, and the reference lists each function with its arguments and what it gives.
- 2189dae: The reference (`REFERENCE.md`, and the help in the editors) says right what a variant replaces (a `metric` too) and which stages a node runs (`split`, `cache` and `limit` too), and lists the catalog's editions with what each changed; its example of a published figure reads the newest edition, 2027-01.
- @loadmap/core@0.40.0
  - @loadmap/layout@0.40.0

## 0.39.0

### Minor Changes

- 52c0325: Language 1.6: a capacity's ± is written `+-`, which every keyboard has: `estimated(20_000 +- 30%, "req/s")`. `±` and
  `+/-` keep reading the same, and `loadmap fmt` writes `+-` for them in a file stamped 1.6. Before 1.6 `a +- b` was
  `a + -b`, and a file stamped before it still computes so, with a warning (`plus-minus`) whose quick fixes write `±`
  (in a capacity's value) or `+ -`; from 1.6 a `+-` outside a capacity's value, or followed by more of a formula, is an
  error whose quick fix writes the sum. Completion, the inspector and the help write `+-` in a file stamped 1.6 and `±`
  before, and the VS Code extension's grammar reads `+-` as one operator. Every definition of the repository, the
  templates included, moves to 1.6.

### Patch Changes

- @loadmap/core@0.39.0
  - @loadmap/layout@0.39.0

## 0.38.1

### Patch Changes

- @loadmap/core@0.38.1
  - @loadmap/layout@0.38.1

## 0.38.0

### Minor Changes

- 7bd53ff: Catalog edition 2027-01: the figures of 2026-12, with each component's `box` the one its stage lives in. RabbitMQ is a
  cluster (a queue lives only in one); etcd, CockroachDB, OpenSearch, MongoDB, Kubernetes and Istio are nodes (a cluster
  holds nothing but queues, and a pool is its own workers). Add → From the catalog writes that box running its kind's
  stage instead of a plain node with `demand: 0`: a queue for Kafka and RabbitMQ (as many members as the run's brokers
  or nodes), a cache for Valkey, a store or a pass for a database, a pass for a proxy. It can put the box on flows'
  routes, with the edges each hop needs (an edge no route takes any more goes) and a connection rule such as
  `kafka/consumer-group`, and writes its demand in the figure's unit: for Kafka, what reaches the queue at the run's
  message size. A demand in bytes against a published capacity is brought to the figure's unit, where it was an error.
- aca02dd: **`completions()` and `completionsAcross()` move to `@loadmap/dsl/completion`**: `import { completions } from
  '@loadmap/dsl/completion'`. The main entry no longer exports them (their types `Completion` and `Completions` stay):
  while it did, every bundler kept completion in the first load of a page that imports anything from `@loadmap/dsl`, and
  the editor, which now loads it with its first list, starts about 7 kB lighter.

### Patch Changes

- bbf3d7a: Add → From the catalog asks how flows use the new box: the stage where its kind has two (flows end here, or go on),
  a queue's partitions and the rule the pool after it reads by (`kafka/consumer-group`), a cache's hit ratio, what one
  unit is worth in a figure's unit that counts no units a second (tpmC), and which flows pass it and where on each
  route. It says the demand in words, shows the lines it adds and takes out before it adds them, and says why when it
  cannot.
- ceaab31: Completion knows the model behind the cursor. Across files it reads the model linked: a route offers a subsystem,
  its boxes after `orderLine.`, and a box like a library's `postgres`; `like:` offers what the file imports or declares
  of the same kind, `with { main: … }` a flow for a flow input, and a prototype's formulas its own inputs. It leaves
  out what would not compile: a second stage in a node, a second component, `with` on a box that is like nothing,
  an `input` outside the top of a library's box or subsystem,
  head lines after the head, and what a part, a library or a variant may not hold. An empty file starts with its
  `loadmap` line, and `measure x` offers the metrics.
- a538b85: Completion ranks by what the model already says. In a route, the stages an edge joins to the last one come first; the
  others come last and draw the edge they need when picked (in VS Code too, as an additional edit). `from:` offers the
  nodes that run no stage first, an edge leaves out what is drawn already and offers where a route goes next first, and
  `partitions`, `held` and a connection's `flows` offer the flows that pass there first. A box with one queue of another
  name is offered once, by its stage, and a subsystem never next to its own boxes. Completion's code is an entry of its
  own, which the editor loads the first time the text has the focus. The language server opens the list after `{` and `[` too.
- Updated dependencies [7bd53ff]
  - @loadmap/core@0.38.0
  - @loadmap/layout@0.38.0

## 0.37.0

### Minor Changes

- 894e762: Language 1.5: one spelling each, and nothing it could do before is lost. `direction`, `rows` and `layout` live in
  `view { … }` with the other view settings. A pool is its workers: `pods`, `perPod`, `placement`, `autoscale { … }` and
  `stageLabel` are lines of the pool, and the `workers { … }` block goes. A `%` after a number is always a share
  (`30%+1` is 1.3); the remainder is `mod(a, b)`. From 1.5 these are errors, each with a quick fix: the `workers` block,
  `sub:` on a box (the second text on the first line), `label:` in an edge's block (`a -> b: "x" { when: … }`), `tag` on a
  param, `grid` in the view, `%` between two values, the old names (`target` and `full` in `expect`, `min` on a metric,
  `fill`, a connection's `max`, `layout: right`) and the view settings at the top. `===`, `!==` and `derived.x` warn as
  old spellings of `==`, `!=` and `x`. A file stamped before 1.5 compiles and computes as it did, with a warning that says
  "(an error from loadmap 1.5)"; `loadmap fmt` writes the new forms in a file stamped 1.5. The VS Code extension's
  grammar reads a `%` after a number as part of it.
- 10197af: Language 1.5 is open: 1.4 shipped in @loadmap/dsl 0.35.0, so what is new to read needs a version of its own. Every
  definition in the repository says `loadmap 1.5`, and the corpus holds what 0.36.0 released.
- 10197af: A subsystem can be drawn closed: one box that stands for everything inside it. The box takes the colour of the worst
  component inside, names the busiest one on its second line, and wears the limit when the first limit is inside, so a
  board of closed subsystems says which one to open. The reader opens one with a click on it and closes one with a click
  on its name (the frame's name is a button now, with the mark of an open folder). Language 1.5 reads `closed` in `view`
  (`view { closed: [eu, us] }`: the ones the page starts with) and in a `step` (its own; `closed: []` for every one open).
  In code: `<Loadmap closed={[…]}>`, `closed` on a story step, `setClosed(ids)` on the controller, and
  `closed` among the options of a compiled definition, which `pageOptions()` passes on. Closing changes no number: the
  dots still pass every stage inside. What closes and draws them is loaded with the first diagram that has a subsystem.
- 2e0108e: A subsystem is drawn: a frame around its boxes with its name at the top, a subsystem in another as a frame in that
  one's frame, its line in the colour of the worst box inside once one is past its target. Until now a subsystem's boxes
  stood loose on the board and its name showed nowhere. A view takes `subsystems` (`{ eu: { label: 'EU region' },
  'eu.orders': { label: 'Orders' } }`) and what one holds is named `<id>.<name>`, as in a definition's text (the box
  `eu.orders.topic` stands in `eu.orders`, which stands in `eu`); the scene lists the frames as `scene.subsystems`, and `collisions()` also reports a frame that does not hold its boxes or reaches another's.
  A `.loadmap` needs nothing new: every `subsystem` gets its frame, in any language version, and the boxes inside are
  laid out together. With tiers, a subsystem whose boxes stand in several tiers has no frame (a frame cannot cross a
  lane); the subsystems in it keep theirs. `loadmap bundle` keeps a subsystem's first line (`subsystem orderLine
  "Orders"`) so the flat copy draws the same frames.
- 9105983: Reading a diagram of subsystems: on a board that zooms, a click on a frame flies in to it, and the path to where the
  view is shows over the board ("Whole diagram › EU region › Orders"), each step a button that flies back out to it; it
  follows the view however it moved. Copies of one subsystem in a `.loadmap` name their components apart: each name two
  components share takes the names of the subsystems around them that differ ("EU region › Workers", short "the workers
  in EU region"), so the verdict and the limits say which copy runs out. Only names that two components share change;
  the boxes keep their labels.

### Patch Changes

- Updated dependencies [4f43e29]
- Updated dependencies [10197af]
- Updated dependencies [2e0108e]
  - @loadmap/layout@0.37.0
  - @loadmap/core@0.37.0

## 0.36.0

### Patch Changes

- a5811ae: `REFERENCE.md` fences every loadmap example as ` ```loadmap ` and what a command prints as ` ```text `, so a reader
  (or a model) knows what each block is. The `published` example is laid out as `loadmap fmt` writes it.
- @loadmap/core@0.36.0
  - @loadmap/layout@0.36.0

## 0.35.0

### Minor Changes

- 4122ae6: Language 1.4 reads `direction: auto` (the default said out loud: the way that fits the room larger) and `rows`, the
  rows a long diagram is folded into: `rows: 1` never folds, `rows: 2` draws two wherever there is room; without it the
  page chooses for its room. A file stamped before 1.4 has to say 1.4 to use either.
- 32d5683: Language 1.4 is open: 1.3 shipped in @loadmap/dsl 0.34.0, so what is new to read needs a version of its own. Every
  definition in the repository says `loadmap 1.4`, and the corpus holds what 0.34.0 released. `rows` takes no unit
  (`rows: 200%` is refused), and a narrow screen never folds, whatever `rows` says: columns side by side would each be
  narrower still. The options of a compiled definition may now say `direction: 'auto'` and `rows`; pass them on with
  `pageOptions()`.

### Patch Changes

- Updated dependencies [379e4b8]
- Updated dependencies [035f607]
- Updated dependencies [ce37a77]
  - @loadmap/layout@0.35.0
  - @loadmap/core@0.35.0

## 0.34.0

### Minor Changes

- 4911a7c: A long text no longer has to be one long line. From `loadmap 1.2` a line that starts with a `"…"` text continues the
  text that ends the line above it, and `loadmap fmt` breaks a text that runs past 120 columns at a space, piece under
  piece (and puts pieces that fit back on one line). The text is the same text: its value, and a share link's
  fingerprint, do not change with where it is broken.
- 59c1182: `30%+1` no longer passes in silence. A `%` straight after a number is a share, but before a value or a sign it read as
  the remainder, so `30% + 1` was 1.3 and `30%+1` was 0. That spelling is now `glued-percent`, with a quick fix for each
  meaning (`30% + 1`, `mod(30, 1)`): an error in a `loadmap 1.2` file, a warning in an older one, which computes as
  before. `mod(a, b)` is new in 1.2 and says the remainder in words; `a % b` with spaces still works.
- 75ca614: Two ways to say a thing once, from `loadmap 1.2`. `like: db` on a box takes every line and stage of the box `db` that
  this one does not write itself, so a second shard is one line. `out.<stage>` is what a fan-out sends, a second (what
  reaches it of each flow times that branch's copies), so its box says `demand: out.push` instead of repeating the
  copies of its branches. `out` is a reserved name from 1.2; a file stamped before keeps a parameter or let of that name.
- d77314a: A definition in several files, from `loadmap 1.3`, which this opens: a new definition starts with `loadmap 1.3`, and
  the templates and examples say it. A file stamped `loadmap 1`, `1.1` or `1.2` reads as it did, and one file is still
  a whole definition.
  - **Parts:** a model says `include "./shop.story.loadmap"`, the part `part of "./shop.loadmap"`. Its statements are the
    model's; it says the model's version.
  - **Libraries:** `library "…"` holds values (`let`, `fit`, `metric`, `measure`, `tier`, `published`), boxes with
    inputs and subsystems; a model takes them by name, `import "./platform.loadmap" { postgres; pool: podPool }`.
  - **Inputs:** `input pods = 3` in a library's box or subsystem, set in `with { … }` by the box that is `like:` it;
    `input flow main` takes a flow's name.
  - **Subsystems:** `subsystem orderLine "Orders" { like: pipeline; with { … } }` is several boxes as one, each named
    `orderLine.<name>`; with a `route:` of its own, a flow's route and an edge may name the subsystem.
  - **Variants:** `extends "./shop.loadmap"` is a model with other defaults and values.
  - `compile(source, { path, files })`: the host gives the files, the compiler reads none. A diagnostic and a symbol in
    another file carry `file`. New: `imports`, `gather`, `flatten`, and `definitionAcross`, `referencesAcross`,
    `renameAcross`, `hoverAcross`, `completionsAcross`.
  - A share link with more than one file is `#v2.`; one file still makes `#v1.`.
  - `loadmap check`, `pull`, `drift` and `record` read a definition with its files, inside the project root;
    `--format json` adds `file` to a diagnostic of another file. `loadmap fmt` on a model sets its parts' versions.
    New: `loadmap bundle <model.loadmap>` writes the definition as one file.
  - The language server and the VS Code extension: problems in the file they are in, definition, references and rename
    across a model's files, completion of paths, imports and inputs, a quick fix that imports a name, and the preview
    of a part (its model) and of a library (its own boxes).
  - The editor shows each file as a tab; `<LoadmapSource>` takes `files` and `path`.
  - A name with a dot (`a.b`) that is no table is now read as one name: where it names nothing, the error says so
    as before.
- bc97bf4: `%` and `×` are checked where a property says which it takes. `expect "x" { underTarget: 70% }` passed as 0.7× and
  `thresholds { target: 7× }` compiled; both are now `unit-mismatch`, with what to write instead: an error in a
  `loadmap 1.2` file, a warning marked "(an error from loadmap 1.2)" in an older one, which computes as before. A load
  multiple goes in `underTarget`, `notFull`, the load's `min`, `max` and `default`, and `load` in a preset or a step.
- 8c9bc5d: Language 1.2 is open: a new definition starts with `loadmap 1.2`, and the templates and examples say it. A file stamped
  `loadmap 1` or `loadmap 1.1` reads as it did.
- 47ab0ae: A scenario may have an id, from `loadmap 1.2`: `scenario bigger "Bigger API" { pods: 8 }`, then `scenario: bigger` in a
  step or an expect. The label is the button's text and can be reworded without touching what names the scenario; a
  reference by label still works. Rename, hover and completion follow the id.
- 825b334: A new warning, `shadowed-name`: an id that names two kinds of thing (`param pods` beside `pool pods`, where `${pods}`
  reads the parameter and `focus: pods` the box), or that is also a keyword of the language (`param merge`,
  `pool workers`). A box, its stage and its component still share one id. It needs no language version, and nothing
  computes differently. The templates and examples have ids of their own now: `workerPool`, `readCache`, `rateLimit`, …
- 335c55d: Sizes, from `loadmap 1.2`: `KB`, `MB`, `GB` and `TB` after a number count in bytes, and a demand written with one is
  brought to the size its capacity counts in. `demand: flows.alerts * 1.5KB` against `estimated(20, "MB/s", …)` is
  megabytes a second, with no `/ 1000` to forget; a size against a capacity that names none is an error.
  `loadmap check --units fail` fails the run on a unit that disagrees (`unit-mismatch`), as `--inconclusive fail` does
  for an expectation that is not sure.
- c7822a5: A `view { … }` block, from `loadmap 1.2`, holds what only changes how the page looks and plays: `speed`, `transition`,
  `fullScreen`, `fullScreenMode`, `lanes` and `grid`. They stood at the top beside what the model computes from. In a 1.2
  file a setting at the top still works and warns (`deprecated`, with a quick fix), and `loadmap fmt` moves it into the
  block, a comment above it too; a file stamped before 1.2 keeps them at the top, silently. The editor's View menu
  writes into the block.

### Patch Changes

- ae1a0e3: Four diagnostics say one thing instead of several. `rate = 40` is one error, not also "flow needs rate"; a `"…"` text
  carried onto the next line is one error at its first line, not three; a formula wrapped without parentheses says so
  once, with the fix ("put the formula in ( … )"); and an expectation that rests on a demand that is no number (a
  division by zero at the defaults) is inconclusive and says why, instead of a firm "holds up to 0×". A failure that a
  component with a real demand shows by itself stays a failure.
- 00b4a76: Several files, what was left:
  - An input set with a formula is checked against its default: the same type (`wrong-type`), and where both say a
    unit, the same one (a `unit-mismatch` warning).
  - Hover on a box that is `like` another lists the inputs it sets. The inspector lists each line the box takes from
    the other, as written there; "Write here" puts it in the box, to change it there.
  - Rename in the editor reaches every file of the model: the other tabs change too.
- @loadmap/core@0.34.0
  - @loadmap/layout@0.34.0

## 0.33.0

### Minor Changes

- af8d8d9: Every diagnostic has a code: the kind of problem (`unknown-name`, `missing-edge`, `unseen-loss`, …), which stays when
  its message is reworded. `Diagnostic` gains `code` and `data` (the names a quick fix needs), and `@loadmap/dsl` exports
  the list as `DIAGNOSTIC_CODES` (type `DiagnosticCode`); docs/dsl.md lists them under Errors. A host that builds its
  own `Diagnostic` now gives it a `code`. Quick fixes key on the code
  and read names from `data`, never from the message. The text output shows the code in brackets
  (`checkout.loadmap:24:17 error[unknown-name]: unknown flow "order"`); `loadmap check --format json` gives each
  diagnostic its `code`, `hint`, `endLine` and `endColumn`; a GitHub annotation is titled with the code, and `loadmap lsp`
  sends it. Ids in messages are quoted: `"orders" goes from "gateway" to "api", and no edge joins them`, `units of "o"
  too slow for their client at "a" vanish: …`.
- 9065003: Dots move only along edges. Every hop a flow takes needs an edge drawn the way it goes: from its `from` node to its
  first stage, along its route, on each way of a split (and where a way rejoins the route), and from a fan-out to each
  stage it copies to. A hop without one used to draw its dots straight across the diagram; now `defineView` throws
  (`flow "signups" goes from node "gateway" to node "api" with no edge between them: add edge('gateway', 'api')`) and
  the language reports an error at the hop from `loadmap 1.1` on (a warning in a file stamped before, whose dots still
  cross straight), with quick fixes that add the edge or route the flow through the boxes the
  edges already join. The edge must point the way the flow goes: one drawn the other way round no longer carries a
  route's dots (a cache's answers still go back along the edge they came in on). An edge a flow takes that its `when` hides at the defaults, in a preset or a scenario is a warning.
  To move a file over: apply the quick fix in the editor or VS Code, or add the edge `loadmap check` names.
  `model.stagesAt()` also returns each flow's ways (`paths`).
- 31404e8: Language versions with a minor: `loadmap 1.1`. `loadmap 1` reads as 1.0, the language of @loadmap/dsl 0.32, and a
  file keeps compiling as it did under the version it names: a check a later version makes strict is a warning before it
  ("… (an error from loadmap 1.1)") and an error from it on, so a hop without its edge in a `loadmap 1` file warns and
  its dots cross straight, as they did. Something a version added (`lost` boxes, numbers with units, `as` after a
  demand: 1.1) needs that version on the first line, an error with a quick fix that writes it, so a loadmap too old for
  it says "update @loadmap/dsl" instead of "unknown statement" (one from before this release reads `loadmap 1.1` that
  way already). `loadmap fmt` raises the first line to the lowest version that has everything the file uses, and never
  lowers it; `1.10` comes after `1.9`. The reference says which version added a statement, and docs/dsl.md has the rule
  and a table of versions. `LANGUAGE_VERSION` is now a string, `'1.1'`. The templates, examples and docs' definitions
  say `loadmap 1.1`.
- 91c3aad: Lost boxes: a box for what other boxes lose, counted. A unit a stage turns away (a limiter, or a pass, cache or split
  past capacity), one a queue drops as too old, or one too slow for its client used to fade where it was; with a lost box,
  its dot goes along the edge into it and fades there. In the language, `node tooMany "Turned away" { lost }` and an edge
  `limiter -> tooMany`: the edge says what goes there, and `takes: [rejected]` keeps only some losses (`rejected`,
  `dropped`, `timedOut`). In TypeScript, `lost({ from: ['limiter'], takes: ['rejected'] })`. `at.tooMany` is what is lost
  there for good, after every retry, and the box says it on its second line ("500 rejected/s"); it is drawn dashed in the
  colour of a loss (`--lm-lost-fill`, `--lm-lost-line`), and so is the edge into it. A merge loses nothing: a merged dot
  now shrinks into a ripple of its flow's colour instead of fading grey, and the legend says "merged, newest kept".
- bb279a9: New names for words that meant two things. In `expect`, `target: 7` and `full: 50` were load multiples while
  `thresholds` and `autoscale` use `target` for a utilization; they are now `underTarget: 7` and `notFull: 50`
  (`underTarget: 7×` reads well). A metric's `min` (a sample count) is `minSamples`, a workers stage's `fill` (a
  placement, not a colour) is `placement`, and a connection's `max` (a capacity) is `accepts`. The new names are from
  loadmap 1.1. In a `loadmap 1.1` file the old ones still work and warn ("target is now underTarget"), with a quick fix
  that renames them, and `loadmap fmt` rewrites them; in a `loadmap 1` file they are that version's spelling, read as
  before, with no warning. TypeScript follows: `Expectation.underTarget` and `notFull`, `ConnectionDef.accepts`,
  `workers(…, { placement })` and `PullRequest.minSamples`, with the old names kept as `@deprecated`; a resolved workers
  stage and `compile(…).measures` give `placement` and `minSamples`. A snapshot file still says `min` beside its
  `samples`. A stage without a label now takes its component's `short` when no other stage runs that component, so the
  sentences and meters say "the gateway" without a second `pass "the gateway"`.
- 53b3f54: Formulas are typed strictly, as CEL types JavaScript's syntax: a condition (the test of `? :`, each side of `&&`, `||`
  and `!`, a `when`, an `enabled`) is true or false, `< <= > >=` compare numbers, `==` and `!=` compare like with like,
  a literal compared with a select is one of its options (`mode == "c"` with options "a" and "b" is always false), both
  answers of a `? :` have one type, and comparisons don't chain ("comparisons don't chain: write 1 < load && load <
  3"). Where the definition is computed, a rate or a demand below 0 and a capacity of 0 or less are refused, and so is
  a preset's load or slider value outside its range. Each is an error from `loadmap 1.1` and a warning in a file stamped before it,
  which computes as it did. A demand that is not a number (`flows.orders / (pods - 2)` with 2 pods) warns, as a rate
  does, instead of a verdict that holds "up to 0×". New codes: `chained-comparison`, `bad-demand`. `edit()` returns at
  once for a change that leaves the text as it is.
- 4cb38e2: The language checks units where the text says them. `flows.x` and `at.stage.x` are units a second, a number with a
  unit is what it says, a fit returns its y (`points rate cores` gives cores), and `demand: … as "cores"` declares the
  rest. A demand per second against a capacity that counts something (`"cores"`), the reverse, or two counts in different
  words (`"cores"` against `"connections"`) is a warning, and so is a component without a demand line whose capacity is
  not per second, an `as` its formula contradicts, and an empty unit. The schema gives the properties that are times,
  shares or rates their unit (`held`, `service`, `timeout`, `p99`, `olderThan`, `hit`, `share`, `rate`, …), so
  `held: 80%` warns too, and the reference says each one's. A bare number is any unit: every definition from before
  compiles as it did, without a new warning. The editor and the VS Code grammar colour `as` as a keyword.
- 5da4dd3: Numbers with units in the language. A number may carry its unit straight after it: `ms`, `s`, `min` and `h` count in
  seconds (`held: 20ms` is `held: 0.02`, `timeout: 5s` no longer fails), `%` makes a share (`hit: 80%`), and `×` (or
  `x`) marks a load multiple. A `%` is a share only where no value follows it, so `10 % 3` is still the remainder and
  `± 30%` means what it did. A word glued to a number that is not a unit (`5sec`) is one error that lists the units. The
  inspector changes such a number as written and keeps its unit; the editor and the VS Code grammar colour the unit as
  part of the number. The examples, the templates and the reference write durations and shares this way instead of
  saying the unit in a comment.
- fcbf7ec: A loss the definition plans and no lost box counts is a warning: what a limiter turns away (`what "limiter" turns away
  vanishes: give it a lost box that counts it`), what a flow's `drop` rule drops, what its `timeout` fails. The quick fix
  "Add a lost box for what limiter loses" adds `node limiterRejected "Turned away" { lost { takes: [rejected] } }` after
  the box and the edge into it. A pass, cache or split past capacity warns nothing. The examples, the templates and the
  docs' definitions have their lost boxes.

### Patch Changes

- 189d8db: One mistake, one mark, where it is. A flow's timeout without latency is marked at its `timeout:` line, and a lost box
  on a flow's route at its name there, instead of at the first line of the file (core says which property of the flow an
  error is about). The marks a mistake caused further on are gone: an unknown function no longer also says its arguments
  must be constants; a misspelt keyword (`nod api`) no longer marks every use of `api`; a second stage in a node, a bare
  capacity, a value that does not parse and a list with a wrong word (`takes: [rejectd]`) are marked once, without "is
  declared twice", "needs capacity" or "loses nothing" after them, and a timeout the model refuses no longer also warns
  that what it times out vanishes.
- 8b8bfca: A unit is lost once. A flow with a `drop` rule and a `timeout` counted what its queue dropped again as timed out, so a
  lost box (and `at.<box>`) could show more units a second than the flow sends; with `retry` the dropped units were sent
  again too. Now a dropped unit is lost at its queue, never sent again and never too slow, as the dots already showed.
  The losses are counted way by way: a split's ways and a cache's answers no longer share one "got through" figure, a
  queue on several ways drops on each, and a pass, limit or cache that reads a dropping queue turns away only what still
  reaches it, in the dots too. Checking the lost boxes walks each flow's ways once.
- Updated dependencies [189d8db]
- Updated dependencies [9065003]
- Updated dependencies [31404e8]
- Updated dependencies [91c3aad]
- Updated dependencies [8b8bfca]
- Updated dependencies [bb279a9]
  - @loadmap/core@0.33.0
  - @loadmap/layout@0.33.0

## 0.32.0

### Minor Changes

- f2c3fd3: Catalog edition 2026-12: how callers connect to each component, from its documentation, as connection rules with
  their sources (`kafka/consumer-group`, `valkey/cluster-slots`, `etcd/raft-leader`, …), and the documented defaults
  of PostgreSQL's and MySQL's `max_connections` as figures taken by name only. A connection's `rule` takes a rule's
  assign and owner where it writes none and cites its source; `rule(kafka, 'kafka/consumer-group')` in TypeScript,
  `rule: "kafka/consumer-group"` in the language, with autocomplete. Edition 2026-11 stays as it was.
- c302028: Connections count what they hold open: `open` is the connections each member of the pool on the hop keeps to the
  other side, and `max` the most that side accepts. Together they make a limit named by the connection, "Connections
  to db": the members running times what each keeps open, added up over every connection into the stage, so an
  autoscaled pool that opens more as it grows runs out at a load. `open` and `max` in the language too.
- 9cc0ccd: Connections in the language: `connection group { hop: topic -> pool; assign: exclusive; capacityPer: pod }`, with
  `owner`, `parts`, `members` and `flows: [orders]`, as `connections` does in TypeScript. What the model refuses about a
  connection is shown on its line; autocomplete, hover, rename and the outline know connections and the flows they list.
  A flow a connection lists twice counts once.
- 7f55166: Connections on the stage they reach: `assign: 'key'` sends each unit to the part its key hashes to, partition i of
  each flow on member i mod `members`, and the busiest member bounds the stage; `skew` puts a share of a flow on its
  hottest part, and the sim sends that share of the dots there; `assign: 'leader'` sends every unit to one member. A
  published capacity keeps its number, and the limits list says why. In the language a cluster's queue takes the
  cluster's members. A connection's spread reads the flows' rates only when several share a stage.

### Patch Changes

- Updated dependencies [f2c3fd3]
- Updated dependencies [c302028]
- Updated dependencies [9cc0ccd]
- Updated dependencies [53b93be]
- Updated dependencies [7f55166]
- Updated dependencies [55c4e7f]
  - @loadmap/core@0.32.0
  - @loadmap/layout@0.32.0

## 0.31.0

### Minor Changes

- 0ab6855: Every expectation ends pass, fail or inconclusive (`check()` gives `outcome` and `reasons`; `ok` is a pass).
  Inconclusive is an answer that rests on what is not known: it holds at the high edge of a ± but not at the low one, a
  component has no published benchmark, or measured data it reads is missing or too thin. `expect { …; severity: warn
  }` is reported and never fails a run. `loadmap check` reports an inconclusive expectation as a warning (it failed
  before when only a ± or a missing benchmark decided it); `--inconclusive fail` fails on it. `--pull` reads the
  measures first and checks against them, `--snapshot <file>` against a snapshot already written, `--dry-run` reports
  everything and exits 0, `--json <file>` (and `--format json`) writes the run's result keyed by the commit, and under
  GitHub Actions a table of the expectations goes into the job summary.
- 9cf2028: A metric can read from Elasticsearch or OpenSearch: `elasticsearch { index: "auth-*"; query: '{"term": {"service":
  "{{ args.service }}"}}'; agg: rate }` reads an index as a date histogram at the step, documents per second (`rate`,
  the default) or per step (`count`), or the `avg`, `sum`, `min` or `max` of a `field`; `time` names the time field.
  A measure's argument goes into the query JSON escaped. The checker refuses a field aggregation without a field, a
  count with one, a query that is not JSON and an index that is not a name or a pattern. `elasticsearch()` in
  `@loadmap/providers` sends the search; a window where nothing matches is missing, not zero. `loadmap pull` takes
  `LOADMAP_ELASTICSEARCH_URL` with `LOADMAP_ELASTICSEARCH_API_KEY` (or a user and password). Both providers move a user
  and password written in the address into the header.
- de327ef: Latency as an output: `service` on a component (the seconds a unit takes when nothing waits) makes each stage it runs
  a queue whose time grows as service ÷ (1 − utilization); a flow's time through is the sum of its stages, fitted to a
  gamma per way and mixed over its ways, and `ev.latency` gives its mean, p50, p95 and p99. An expectation holds a
  percentile under a time, `{ flow: orders; p99: 0.5; target: 8 }`, on the pessimistic edge; `loadmap check --base`
  shows each flow's p99 against its base, and the Live panel each flow's p99.
- 0fb5d08: The language maps a model onto measured data, and `loadmap pull` reads it. A `metric` is a query written once
  (`prometheus { query: '…{{ args.job }}…' }`, with a `stat` and a `min` of samples); a `measure` is one use of it,
  with its arguments and a `fallback`, and its id is a capacity or a number as its fallback is (`capacity: apiCapacity`,
  `rate: orderRate * load`). A `fit` with `x` and `y` naming two measures is fitted from their series. `compile(source,
  { snapshot: fromSnapshot(parseSnapshot(text)) })` reads a snapshot; without one every measure is its fallback, and
  `compile(…).measures` lists each query with its arguments filled in. The checker names an unknown metric, an argument
  a query needs or never uses, a fallback that is neither a capacity nor a number; completion, hover, rename and the VS
  Code grammar know the new statements. The new `@loadmap/providers` reads Prometheus (`/api/v1/query_range`, one
  series per query, errors as data) and writes the snapshot (`pull`); `loadmap pull x.loadmap [--window 7d] [--step
  5m] [--to …]` writes `x.snapshot.json` next to the definition, with the address and the credentials from
  `LOADMAP_PROMETHEUS_URL` and `LOADMAP_PROMETHEUS_TOKEN` (or a user and password), never from the text.
- b9b71c3: A component can count slots instead of a rate: `held` (seconds a unit holds a connection, a session, a thread) makes
  its demand the slots in use by Little's law, what reaches its stages times `held`, one time for every flow or one per
  flow; `on` names the stages for a pool beside the limit that runs them. `held: 0.02` or `held { orders: 0.02 }` in the
  language. The `slots` measurements set its capacity and its time held.
- 0097fc9: A `split` stage sends each unit on one way of several, by share: a read/write split, shards, regions, an A/B test,
  failover. In the language, one `flow -> stage -> …: share` line per way inside `split { … }` on a box; in TypeScript,
  `split({ to: [{ stages: ['primary'], share: 0.2 }, …] })`. A flow's shares add up to 1 (formulas of the parameters
  allowed) and a flow the split does not name goes straight on; a way that ends in a store, a sink or a fan-out ends
  there, any other goes on with the route after the split. The model works out each flow's ways (`ev.paths`), and what
  reaches each stage, the demand, the rejections and the retries add up over them; the dots each take one way, drawn by
  share, and a model without a split draws exactly what it drew before. The search example's index is now two shards
  behind a coordinator.
- ed5d6d2: Timeouts: `timeout` on a flow (seconds) fails the share of its units slower than it, from the latency of its way; with
  `retry` they are sent again, which loads every stage and slows it further, settled at the least fixed point. The
  retry solve now holds that share while it settles the attempts, and stops at the least fixed point where a share
  can meet the attempts twice. `ev.latency[f].timedOut`, a Live meter, and the sim fades that share of dots as timed
  out. `timeout: 2` in the language.

### Patch Changes

- Updated dependencies [11b78ee]
- Updated dependencies [0ab6855]
- Updated dependencies [717b95e]
- Updated dependencies [de327ef]
- Updated dependencies [b9b71c3]
- Updated dependencies [0097fc9]
- Updated dependencies [ed5d6d2]
  - @loadmap/core@0.31.0
  - @loadmap/layout@0.31.0

## 0.30.1

### Patch Changes

- 9bd542b: The VS Code extension tracks live changes and adds from the catalog, as the editor does: an eye over the preview
  (`loadmap.preview.trackChanges`) brings the boxes each edit changed into view and marks them, and **loadmap: Add from
  the Catalog…** (a command, a preview button, a code action in a box) picks a component and one of its published runs,
  then writes a `published` statement and a new box or the box's capacity. What an edit changed now comes from
  `@loadmap/dsl/internal`, which the editor and the extension share.
- @loadmap/core@0.30.1
  - @loadmap/layout@0.30.1

## 0.30.0

### Patch Changes

- Updated dependencies [1f11726]
  - @loadmap/core@0.30.0
  - @loadmap/layout@0.30.0

## 0.29.0

### Minor Changes

- a71e332: Every tier lane is filled: the first, third… in the new theme token `--lm-tier-base`, the others in `--lm-tier`, with
  the lane shades and headers a step apart in both themes. `lanes: striped` (`lanes: 'striped'` in the view) brings back
  every other lane clear. A tier can have a colour of its own, `tier data "Data" { fill: "#e6f2ec"; fillDark: "#1c2b26" }`
  (`fill` and `fillDark` beside its `label` in TypeScript); without `fillDark`, dark keeps the colour's hue as dark as the
  theme's lanes, and `fillDark` alone leaves light the theme's. In a definition a colour is hex, `rgb()` or `hsl()`:
  `compile` refuses anything else, such as a `url(…)` that would fetch from a shared link, and now also what only looks
  like one (`"#12345"`, `"rgb(1)"`), for flows' colours too. Exports write a lane's own colours in rgb, as they write the
  theme's tokens.

  In the editor, **View** switches the lanes' fills and the canvas's dot grid (`grid: false`, read only by the editor),
  which now shows through the lanes; the model's tab gives each lane a light and a dark colour, and Reset takes them out.
  Each is one edit of the text: `setProperty` writes, changes or takes out a property of the definition or of a tier.

### Patch Changes

- Updated dependencies [a71e332]
  - @loadmap/layout@0.29.0
  - @loadmap/core@0.29.0

## 0.28.0

### Patch Changes

- 4a9b36b: The editor adds from the catalog: New → Add → From the catalog picks a component, the conditions of one of its
  published runs and shows the figure they give, with its source, or says there is none. It writes text only: a
  `published` statement, and a new box or the selected box's capacity. `catalog={false}` leaves it out. In the reader layout, the inspector shows a
  published statement's conditions as the values its runs used. A constant `demand: 0` now compiles (it read as missing,
  and `demand: 5` failed to evaluate).
- @loadmap/core@0.28.0
  - @loadmap/layout@0.28.0

## 0.27.0

### Minor Changes

- 4346ee1: The `.loadmap` language takes published figures: `published brokersRef kafka { edition: "2026-11"; brokers: 3; … }`
  names a component of the catalog and the conditions of its run, and `capacity: brokersRef` uses the figure. The
  checker names a component, condition, edition or figure that does not exist (and which component covers `redis`),
  warns when the conditions written match no published run, and says when a later edition has other figures;
  autocomplete offers the components, their conditions and the values their runs used, hover the figure with its
  conditions and source. The catalog loads only for a text that names it: `loadCatalog()` (and `needsCatalog(text)`)
  from `@loadmap/dsl`; `<LoadmapSource>`, the editor, the CLI and the language server load it themselves.

### Patch Changes

- Updated dependencies [6408be2]
- Updated dependencies [4346ee1]
  - @loadmap/core@0.27.0
  - @loadmap/layout@0.27.0

## 0.26.1

### Patch Changes

- @loadmap/core@0.26.1
  - @loadmap/layout@0.26.1

## 0.26.0

### Patch Changes

- @loadmap/core@0.26.0
  - @loadmap/layout@0.26.0

## 0.25.0

### Patch Changes

- 1d0cc1f: Tiers are drawn as lanes. Each tier has a header at its start, a strip across the top (running down, and on a phone, a
  column on the left, the name reading up), with its name in capitals; a line between the lanes, and every other lane
  shaded. A name wider than its lane takes two lines, and every header on that board takes two; only past two lines is it
  cut short with "…". The layout reserves the header's room, so no box or edge label sits under one: `collisions()`
  checks the whole header. Export, posters and the editor draw the same lanes.

  `SceneTier` has `head` (the header's box), `lines` (each line of the name with its spot; a line that comes or goes in
  a morph fades) and `spacing`, in place of `text` and `spot`. Four theme tokens colour the lanes: `--lm-tier` (a shaded
  lane), `--lm-tier-head`, `--lm-tier-fg` (the name) and `--lm-tier-line` (the dividers).
- Updated dependencies [1d0cc1f]
  - @loadmap/layout@0.25.0
  - @loadmap/core@0.25.0

## 0.24.0

### Patch Changes

- @loadmap/core@0.24.0
  - @loadmap/layout@0.24.0

## 0.23.0

### Minor Changes

- d8fa10d: Each scenario, story step, preset and choice of a select or switch is laid out on its own by default (`layout:
  'compact'` on the view, `layout: compact` in a `.loadmap`), over every load and every value of the range controls, and
  the boxes move from one to the next: a long story no longer pays for its largest step in every step. Dragging the load
  or a range control still never moves a box, and a step looks the same whichever came before. `layout: stable` keeps
  the old promise that no phase moves a box. In a stable layout, an edge whose `when` turns on partway up the load range
  no longer moves the boxes when the load reaches it.

  In the language the direction is now `direction: right | down`; `layout: right` and `layout: down` still work, with a
  warning, and `loadmap fmt` rewrites them. A `<Loadmap>` page loads 0.4 kB more; its budget is 51.5 kB.
- be481d6: Snippets, quick fixes, go to definition, references and rename. A statement typed at the start of a line completes as
  a snippet built from the schema: its id and label, its required properties, and for a box a stage and a capacity.
  `quickFixes(source, diagnostics)` gives each diagnostic's fixes as text changes: the did-you-mean applied (a name, a
  property, a scenario), a missing required property added in the block's own layout, a bare number made
  `estimated(…)` or `measured(…)` in the file's unit, a stray ":" before an edge's block dropped. `definition` and
  `references(source, offset)` find where a name is declared and every place it is written, and `rename(source, offset,
  name)` renames it everywhere: a box's id with the stage and the component that take it, a scenario's label quoted
  where it must be; it refuses a name that is not one, is reserved or taken, and a result that would not compile.

  In the editor: a diagnostic's tooltip offers its fixes, F12 or a click with Cmd or Ctrl goes to the declaration, the
  other uses of the name under the cursor are marked, and F2 (or Rename over a phone's keyboard) opens a field to rename
  it. The editor's budget is 170 kB.

### Patch Changes

- Updated dependencies [d8fa10d]
  - @loadmap/layout@0.23.0
  - @loadmap/core@0.23.0

## 0.22.0

### Minor Changes

- ce0027b: Hover and signature help. `hover(source, offset, definition?)` says what a word is: a statement or a property (its
  doc from the schema), a builtin (its arguments), a name the definition declares, with its values at the defaults when
  given the compiled definition: a flow's rate and route, what of it reaches a stage, a component's utilization, demand
  against capacity, how sure the capacity is and where it reaches the target and runs out, a `let`'s value, a
  parameter's choices, a tier's boxes, what a scenario sets. The values come from the compiled model's own evaluation,
  never from evaluating text. `signatureHelp(source, offset)` names the arguments of the builtin or fit the cursor is
  in, and which one it is writing.

  The editor shows both: a hover over a word (while the text has an error, with the values of the last version without
  one, and a line that says so), and over the cursor inside a call its arguments, the one being written marked, on a
  phone too. Completion, hover and signature help are one entry of the packed dsl, so a page that only reads a
  definition never loads them.

### Patch Changes

- @loadmap/core@0.22.0
  - @loadmap/layout@0.22.0

## 0.21.0

### Minor Changes

- 2506c27: Completion knows where the cursor is. A capacity offers `measured`, `estimated` and `configured` first, as snippets
  that fill in value, unit and source field by field; after its value comes `± 30%`; its unit offers the units the file
  already uses. A box's `demand` offers the flows that reach it first, `at.<stage>.` only the flows that pass that stage,
  a route the stages next along an edge first, a `when` the switches. Nothing that reads itself is offered (a `let`'s own
  name, a component's own `util`), nor a property the block already sets, nor anything inside a comment or a plain text;
  a template's `${…}` completes by where the template is. A scenario, preset or step offers a parameter's options, and so does the parameter's own `default`; `tier:` offers the
  tiers, wherever they are declared.
  Builtins come with their arguments and a line of help. Completion reads the parse alone, never runs the model, so it
  costs a small part of a compile on every keystroke: `completions(source, offset)` no longer takes a compile result.

  A block left open while typing (`flow q {` without its `}`) ends at the next top-level line instead of taking the rest
  of the file, so the diagnostics and completions below it stay right; a file whose braces balance reads as before.

  The editor closes brackets and quotes as they are typed, and opens the list after `(`, `,`, an operator or a quote. Tab
  moves through a snippet's fields and then out of the call; on a phone the ⇥ key over the keyboard does the same. Where
  there is no room beside the list (a phone), its help goes under the list instead of over the options after the one
  selected.

### Patch Changes

- @loadmap/core@0.21.0
  - @loadmap/layout@0.21.0

## 0.20.0

### Patch Changes

- @loadmap/core@0.20.0
  - @loadmap/layout@0.20.0

## 0.19.1

### Patch Changes

- @loadmap/core@0.19.1
  - @loadmap/layout@0.19.1

## 0.19.0

### Patch Changes

- @loadmap/core@0.19.0
  - @loadmap/layout@0.19.0

## 0.18.0

### Patch Changes

- @loadmap/core@0.18.0
  - @loadmap/layout@0.18.0

## 0.17.1

### Patch Changes

- @loadmap/core@0.17.1
  - @loadmap/layout@0.17.1

## 0.17.0

### Patch Changes

- @loadmap/core@0.17.0
  - @loadmap/layout@0.17.0

## 0.16.0

### Patch Changes

- @loadmap/core@0.16.0
  - @loadmap/layout@0.16.0

## 0.15.0

### Patch Changes

- @loadmap/core@0.15.0
  - @loadmap/layout@0.15.0

## 0.14.0

### Patch Changes

- 7886094: A diagram without `layout` (or `direction`) runs right, or down when it fans out wider than it is long: when its
  widest layer has more boxes than its longest chain. The layers are counted as ELK draws them: every edge counts,
  whatever its `when` (so the load and the phases never turn it), a loop is cut where the flow comes back, a sink or
  store that feeds nothing stands in the last layer, and a box with no edge is left out. `directionOf(view)` gives it
  (from `@loadmap/layout` and `@loadmap/react`), and `layout()` runs by it when no direction is given; narrow screens
  still run down.
- Updated dependencies [7886094]
  - @loadmap/layout@0.14.0
  - @loadmap/core@0.14.0

## 0.13.0

### Minor Changes

- 2d8c547: The boxes nothing feeds stand first along the flow, and a sink or store that feeds nothing stands last. Tiers cut the
  diagram into bands across the flow (edge, services, data): `tier edge "Edge"` declares one, in the order the flow
  meets them, and `tier: edge` puts a box in it (`tiers: { edge: { label: 'Edge' } }` in the view and `tier: 'edge'`
  on a box in TypeScript). A box without a tier stands in the tier of the boxes that feed it. Each tier is a band behind
  its boxes, every other one shaded, with its label in the margin before them: across the top running right, up the
  left side running down and on a phone. `Scene.tiers` holds the bands; `collisions()` checks their labels too.

### Patch Changes

- Updated dependencies [2d8c547]
  - @loadmap/layout@0.13.0
  - @loadmap/core@0.13.0

## 0.12.0

### Patch Changes

- Updated dependencies [497f671]
  - @loadmap/core@0.12.0
  - @loadmap/layout@0.12.0

## 0.11.0

### Minor Changes

- 6561c3d: A loadmap made to be framed. `<Loadmap fill>` (and `<LoadmapSource fill>`) fills its container laid out as full screen is, in `fullScreenMode`, for good: no full screen button, nothing scrolls; for a page of its own in an iframe, whose layout follows the frame as full screen follows the screen. `sharedValues(model, values)` in `@loadmap/dsl` reads a shared link's values by each parameter's kind and keeps only what still fits the model, as the editor does. `<LoadmapEditor embedLink={(hash, o) => url}>` puts "Copy embed link" beside "Share link": a menu that picks what the embed shows (`EmbedOptions`: the diagram, the default, or the panels too, the theme, the story played when it comes into view) and copies the link, or an `<iframe>` with it. The docs site has the page those links open, at `/embed/`, and a page on embedding in ClickUp and any page.

### Patch Changes

- @loadmap/core@0.11.0
  - @loadmap/layout@0.11.0

## 0.10.0

### Patch Changes

- @loadmap/core@0.10.0
  - @loadmap/layout@0.10.0

## 0.9.0

### Minor Changes

- 7c5d7b3: Play tells the story on the diagram: the whole diagram first, then for each step a close-up on what it changes (the box
  it points at and any box it reshapes, several framed together), the change, and the whole diagram again for the step's
  `seconds`, with a short title on the board. A step's new `title` (`StoryStepDef.title`, `title:` in `.loadmap`) names
  it there; without one the title says what changes ("Users 1× → 20×"). The camera runs on the engine's clock and moves
  the view, never the board; with reduced motion it cuts. The component that runs out first wears a ring and a tag that
  breathe while the story plays and once it is past the target.

  `ref.playStory()` plays it on the engine's clock (`step()` advances it); `recordVideo({ story: true })` and
  `loadmap record --story` record it that way, from the defaults, the same options giving the same file. The controller
  gains `lm.cue`. A render React makes of older values no longer hands the engine their numbers.

### Patch Changes

- Updated dependencies [7c5d7b3]
  - @loadmap/core@0.9.0
  - @loadmap/layout@0.9.0

## 0.8.0

### Patch Changes

- 25a0575: The README starts from `<LoadmapSource>` (`@loadmap/react/source`) for drawing a definition on a page, and says what
  `compile()` and `formatDiagnostic()` give for a page that does it itself.
- @loadmap/core@0.8.0
  - @loadmap/layout@0.8.0

## 0.7.0

### Patch Changes

- 1ad72b9: The package carries the language guide and the whole reference, `dist/REFERENCE.md`, so a person or an agent working
  from `node_modules` finds it next to the types. The README has a "Test a model" section: `expect` lines,
  `npx @loadmap/cli check`, and a script that prints the verdict and each component's utilization. The docs site
  publishes `llms.txt` and `llms-full.txt` (the reference, and one model that uses every statement).
- @loadmap/core@0.7.0
  - @loadmap/layout@0.7.0

## 0.6.0

### Patch Changes

- 1640a0e: Two slips get one error with the fix instead of a puzzle. A box whose only component lines are optional ones
  (`describe`, `name`, `short`, `plural`, `when`), with no demand, capacity or over, gets one error on that line
  instead of three "the component needs …": for a plain-text `describe`, put it on the first line, `node users "Users"
  "people on the shop"`. And `a -> b: { … }` says to drop the ":" before the block (a fan-out branch, that it takes its
  copies after ":"), then checks the block's lines as usual.
- 9fe4c1a: A flow whose rate is a constant (`rate: 20 / 86_400`, or `rate: 40` in TypeScript) compiles and runs: it stays the
  same at any load. An error raised while computing a flow now points at that flow, not at the formula that happened
  to read it first; a preset or a scenario that breaks it keeps pointing at the preset or the scenario. An error that
  only loadmap's own code can cause, such as a TypeError, says it is a bug in loadmap and how to report it, with the
  original text as the hint, instead of showing loadmap's internal names; one from a host function is that function's.
- Updated dependencies [9fe4c1a]
  - @loadmap/core@0.6.0
  - @loadmap/layout@0.6.0

## 0.5.0

### Minor Changes

- c1651c6: Full screen fits the screen without scrolling. The diagram stays on top, as wide as the screen; under it the verdict in
  one line (the load, how far the target holds, the first limit, how sure its capacity is) and the panels `fullScreen`
  lists in a compact form, side by side in a box the screen sizes: Live as small meters, where it runs out a line per
  component, the controls a line each, headroom as a sparkline, compare its first table, the assumptions a count. Rows
  that do not fit are left out whole and counted; each compact panel, "Why" and the assumptions open the panel whole over
  the diagram (its button closes it, and Esc in the overlay; the browser's own full screen takes Esc for itself). A phone
  shows one panel at a time under tabs, and pans the diagram in its own box. Nothing the load changes moves the board.

  A switch beside Close, or the F key, turns full screen into focus: the diagram, the story under it, and the verdict and
  the load slider when `fullScreen` lists them. `<Loadmap fullScreenMode="focus">` and `fullScreenMode: focus` in a
  `.loadmap` open full screen there (type `FullScreenMode`, default `'panels'`); the editor, the docs and the CLI viewer
  pass it on. The story bar gets Play: each step for its `seconds`, as `loadmap record --story` plays it, until the last
  or a value of the reader's own; its text keeps the room of the longest step.

  The controller has the state: `fullScreen`, `toggleFullScreen()`, `fullScreenMode`, `setFullScreenMode()`,
  `storyPlaying`, `setStoryPlaying()`. `<Loadmap>`'s `.lm-side` is now also `.lm-drawer`; a page of its own keeps its
  `.lm-side` under the board, in a box that scrolls on its own. `.lm-corner` is gone: nothing scrolls Close away.
- 9280b78: The diagram moves to a new structure instead of swapping it: when a scenario, a story step or a control adds pods,
  brokers or partitions, the boxes that stay move and resize to their new places with their edges, what goes fades out,
  and what is new fades in, its edges drawing in last. `<Loadmap transition={0.8}>` sets how many seconds it takes (0
  cuts), and `transition: 0.8` in a `.loadmap` does the same in the editor, the docs and `loadmap record`; with reduced
  motion it always cuts, and so does a board paused with nothing stepping it. The load never moves the diagram, as
  before. The move runs on the engine's clock, so a recording shows it and stays the same file, byte for byte;
  `handle.ready()` waits for each of its frames to be drawn, `board().scene` is the frame drawn, and `reset()` ends a
  move. A `Scene`'s parts carry `fade` (and a new edge `draw`) only while it moves.

### Patch Changes

- Updated dependencies [9280b78]
  - @loadmap/layout@0.5.0
  - @loadmap/core@0.5.0

## 0.4.0

### Minor Changes

- bca623f: Full screen shows the diagram as wide as the screen, and below it every panel of the page: the verdict, Live and
  where it runs out beside the controls, then the headroom chart, the scenarios compared and what it assumes; the whole
  view scrolls, and the diagram never moves with the load. `<Loadmap fullScreen={['verdict', 'live', 'controls']}>`
  keeps only the panels it lists (`LOADMAP_PANELS`, type `LoadmapPanel`), and `fullScreen: [verdict, live, controls]`
  in a `.loadmap` does the same in the editor, the docs and `loadmap record`. A diagram in a narrow column turns to run
  left to right in full screen. Scrolled down to the panels, Close waits in the corner. `<Loadmap>` now wraps each
  panel in a `div.lm-panel` (`data-panel` names it), and `.lm-more` is gone: CSS that selected a panel as a child of
  `.lm-side` needs `.lm-panel` in between.

### Patch Changes

- @loadmap/core@0.4.0
  - @loadmap/layout@0.4.0

## 0.3.1

### Patch Changes

- @loadmap/core@0.3.1
  - @loadmap/layout@0.3.1

## 0.3.0

### Minor Changes

- 294378d: Light editing for readers: `<LoadmapEditor layout="reader">` shows the diagram with an inspector (a box's label,
  capacity and parameters; the model's load, growth and flows), each change a small edit of the text, and a shared link
  opens that way on the docs site. `format()` and `loadmap fmt` (`--check` for CI) lay a definition out the one way.
  `<Loadmap onNodeClick selected>`; in the editor a click on a box selects its lines, and **Format** (Shift+Alt+F).

### Patch Changes

- Updated dependencies [294378d]
  - @loadmap/core@0.3.0
  - @loadmap/layout@0.3.0

## 0.2.0

### Minor Changes

- 2a8118b: Building blocks: a cache stage (hits answered and sent back), an autoscaled workers pool (min, max, target; a pods
  meter), a rate limiter (`limit` with a `configured` capacity) and retries that settle past capacity (`retry` with a
  budget). `at.<stage>.<flow>` reads what reaches a stage, a component without a demand takes it, and four new
  templates show each block.

### Patch Changes

- Updated dependencies [2a8118b]
  - @loadmap/core@0.2.0
  - @loadmap/layout@0.2.0

## 0.1.1

### Patch Changes

- Published from GitHub Actions with npm trusted publishing: every package now carries a provenance statement that ties
  it to its commit and workflow.
- Updated dependencies
  - @loadmap/core@0.1.1
  - @loadmap/layout@0.1.1
