# Project-Owned Stress Tests

These checks are intentionally separate from the official assignment tests in `tests/`.

Do **not** modify `tests/`; it remains the authoritative external test suite. The scripts here are for local engineering confidence around performance, cache behavior, and operational tradeoffs.

## Prerequisites

```bash
docker-compose up -d
npm run db:migrate
npm run data:import
npm run build
npm start
```

For Redis cache validation, start the server with Redis enabled:

```bash
REDIS_ENABLED=true CACHE_TTL_SECONDS=60 CACHE_MAX_ENTRIES=500 npm start
```

## Commands

```bash
npm run stress:api
npm run stress:cache
npm run stress:test
npm run stress:generate-data
DATA_DIR=data_stress npm run data:import
DATA_DIR=data_stress npm run stress:validate-data
DATA_DIR=data_stress npm run stress:validate-api
```

The project-owned stress checks use Vitest, matching the style of the legacy
assignment tests while staying outside the official `tests/` folder.

`stress:generate-data` writes a deterministic large fixture under `data_stress/`.
The default profile generates 200,000 orders, 2,000 suppliers, 20,000 products,
300 categories, and `manifest.json`. The generated order rows include intentional
malformed ingestion rows plus business anomalies so the import fallback and API
anomaly endpoints can be validated against known minimums.

Generated CSV files and `manifest.json` are ignored by Git. Keep the official
assignment `data/` and `tests/` folders untouched; use `DATA_DIR=data_stress`
when importing the large local fixture.

`stress:api` is fixture-aware: it discovers a real supplier from
`/api/suppliers?limit=1` instead of hard-coding `sup_042`, so it works against
both the official fixture and generated `data_stress` IDs like
`stress_sup_0001`.

`stress:cache` starts two local server processes after `npm run build`: one with
`REDIS_ENABLED=false` and one with `REDIS_ENABLED=true`. It gives special focus
to the assignment's required aggregation cache target, `/api/orders/stats`, then
prints a disabled-vs-enabled comparison table. The application cache remains
cold/lazy by design; warm-up requests happen inside the test harness so the
reported warm metrics are clear without adding production startup warming.

Optional environment variables:

- `API_URL` — defaults to `http://localhost:3000`.
- `STRESS_CONCURRENCY` — defaults to `50`.
- `STRESS_REQUESTS` — defaults to `200`.

## What these scripts measure

- Read-heavy endpoint latency under concurrency.
- Required aggregation cache behavior for `GET /api/orders/stats`.
- Cold vs warm cache behavior for aggregation/anomaly endpoints.
- Cache invalidation sanity after an order write.
- Redis-disabled fallback can be checked by running the same scripts with the server started using `REDIS_ENABLED=false`.