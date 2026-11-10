# @loadmap/providers

## 0.31.0

### Minor Changes

- 9cf2028: A metric can read from Elasticsearch or OpenSearch: `elasticsearch { index: "auth-*"; query: '{"term": {"service":
  "{{ args.service }}"}}'; agg: rate }` reads an index as a date histogram at the step, documents per second (`rate`,
  the default) or per step (`count`), or the `avg`, `sum`, `min` or `max` of a `field`; `time` names the time field.
  A measure's argument goes into the query JSON escaped. The checker refuses a field aggregation without a field, a
  count with one, a query that is not JSON and an index that is not a name or a pattern. `elasticsearch()` in
  `@loadmap/providers` sends the search; a window where nothing matches is missing, not zero. `loadmap pull` takes
  `LOADMAP_ELASTICSEARCH_URL` with `LOADMAP_ELASTICSEARCH_API_KEY` (or a user and password). Both providers move a user
  and password written in the address into the header.
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

### Patch Changes

- Updated dependencies [11b78ee]
- Updated dependencies [0ab6855]
- Updated dependencies [717b95e]
- Updated dependencies [de327ef]
- Updated dependencies [b9b71c3]
- Updated dependencies [0097fc9]
- Updated dependencies [ed5d6d2]
  - @loadmap/core@0.31.0
