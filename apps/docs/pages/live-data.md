# Live data

A model's numbers can come from the metrics a team already has. This page starts a small shop with Prometheus and
Grafana beside it, reads its traffic into a model with `loadmap pull`, and then draws a diagram that reads it every
few seconds while it is open. Everything is in
[`examples/shop-live`](https://github.com/jaim3r0jas/loadmap/tree/main/examples/shop-live).

## 1. A shop with data

```bash
git clone https://github.com/jaim3r0jas/loadmap && cd loadmap/examples/shop-live
docker compose up
```

That starts three containers, and a minute later there is data to read:

| Where                 | What                                                                             |
| --------------------- | -------------------------------------------------------------------------------- |
| http://localhost:3000 | Grafana, without a login: the **Shop** dashboard, already there                  |
| http://localhost:9090 | Prometheus, scraping the shop every 5 seconds                                    |
| http://localhost:9464 | The shop's `/metrics`: requests by service, database queries, worker CPU         |

The shop is `simulator.ts`, one file with no dependencies: visitors browse, one in twenty orders, workers handle the
orders and everything ends in a database. Its traffic rises and falls over ten minutes, a day in small, so the
dashboard and the diagram have something to follow.

## 2. A model that reads it

A **metric** is a query written once, a **measure** one use of it with the value the model uses until there is data.
The queries are the ones a Grafana panel runs: copy a panel's PromQL into a metric.

```loadmap
@include(examples/shop-live/shop.loadmap, "# what the shop exports", "flow visits")
```

The flows run at `visitRate * load` and `orderRate * load`, so 1× is the shop as it is now, and the slider asks what
happens at twice or ten times that. The workers' demand is `workerCores(flows.orders)`: a cost per order fitted from
the two series, not a number someone typed. [The language guide](/language/#measured-data) has every statement.

## 3. Read it once

```bash
export LOADMAP_PROMETHEUS_URL=http://localhost:9090
npx @loadmap/cli pull shop.loadmap --window 2m --step 10s
npx @loadmap/cli check shop.loadmap --snapshot shop.snapshot.json
```

```text
shop.snapshot.json: 4 of 4 measurements, 2026-11-17T06:05:00Z to 2026-11-17T06:07:00Z
  ✓ visitRate: 193.2 visits/s (13 samples)
  ✓ orderRate: 9.6 orders/s (13 samples)
  ✓ coresNow: 0.5 cores (13 samples)
  ✓ queryRate: 627.7 queries/s (13 samples)
shop.loadmap: 1 expectation holds
```

`pull` writes a **snapshot**: a JSON file with each measurement's value, its points and where they came from. The
model reads the file and never the store, so a check in CI, a recording and a page say the same thing. Nothing in a
definition fetches anything: the address and the credentials come from the environment, so a shared link cannot make
anyone's browser call a server. [Recording and CI](/recording/#pull) has `pull`, `check --pull` and `drift`.

## 4. A diagram that follows the shop

```bash
pnpm install          # at the root of the clone
pnpm --filter @loadmap/example-shop-live dev
```

Open http://localhost:5173: the diagram's rates are the shop's, and they move with the Grafana dashboard. The page
does what `loadmap pull` does, on a timer: it asks Prometheus for the definition's measures, builds a snapshot, and
compiles the text again with it. The reader's scenario and load stay as they left them.

```tsx
@include(examples/shop-live/live.tsx, "import { compile")
```

Three things make it work:

- **`pull` runs in a browser.** `@loadmap/providers` uses `fetch` and nothing of Node. `compile(source).measures` is
  the list of queries; `compile(source, { snapshot: fromSnapshot(snapshot) })` is the model with what they returned.
- **The page asks its own origin.** `vite.config.ts` passes `/prometheus` on to the real address, so Prometheus needs
  no CORS setting. In production the same proxy is where a token goes: never put a credential in a page.
- **A measurement that fails is missing, not zero.** The model then uses the definition's own value for it, and the
  assumptions under the diagram say why.

## With your own Prometheus or Grafana

Point `LOADMAP_PROMETHEUS_URL` at your server (with `LOADMAP_PROMETHEUS_TOKEN`, or a user and password), replace the
queries in the metrics with yours, and keep the fallbacks: they are what a pull request from a fork, or a day when
Prometheus is away, computes with. Grafana itself is not read: a metric holds the query a panel shows, and the
provider asks the store behind it (Prometheus, or Elasticsearch and OpenSearch with an `elasticsearch` block).
