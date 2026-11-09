---
'@loadmap/providers': minor
'@loadmap/dsl': minor
'@loadmap/cli': minor
'@loadmap/vscode': patch
---

A metric can read from Elasticsearch or OpenSearch: `elasticsearch { index: "auth-*"; query: '{"term": {"service":
"{{ args.service }}"}}'; agg: rate }` reads an index as a date histogram at the step, documents per second (`rate`,
the default) or per step (`count`), or the `avg`, `sum`, `min` or `max` of a `field`; `time` names the time field.
A measure's argument goes into the query JSON escaped. The checker refuses a field aggregation without a field, a
count with one, a query that is not JSON and an index that is not a name or a pattern. `elasticsearch()` in
`@loadmap/providers` sends the search; a window where nothing matches is missing, not zero. `loadmap pull` takes
`LOADMAP_ELASTICSEARCH_URL` with `LOADMAP_ELASTICSEARCH_API_KEY` (or a user and password). Both providers move a user
and password written in the address into the header.
