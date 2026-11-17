# A shop with live data

A shop that only pretends to run, with Prometheus and Grafana beside it, and a loadmap diagram that reads it while it
is open. https://jaim3r0jas.github.io/loadmap/live-data/ walks through it.

```bash
docker compose up                                # the shop, Prometheus (9090) and Grafana (3000, no login)
export LOADMAP_PROMETHEUS_URL=http://localhost:9090
npx @loadmap/cli pull shop.loadmap --window 2m --step 10s   # writes shop.snapshot.json
npx @loadmap/cli check shop.loadmap --snapshot shop.snapshot.json
pnpm install && pnpm dev                         # from a clone: the live page, on http://localhost:5173
```

| File             | What                                                                             |
| ---------------- | -------------------------------------------------------------------------------- |
| `simulator.ts`   | The shop: visits, orders, database queries and worker CPU, served on `/metrics`  |
| `compose.yaml`   | The shop, Prometheus scraping it, and Grafana with a dashboard already there     |
| `shop.loadmap`   | The model: its rates and the workers' CPU are measures read from Prometheus      |
| `live.tsx`       | The page: pulls the measures every 10 seconds and draws the model with them      |
| `vite.config.ts` | Passes the page's `/prometheus` on to Prometheus, so the address stays out of it |
