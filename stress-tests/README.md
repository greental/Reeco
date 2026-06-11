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
```

Optional environment variables:

- `API_URL` — defaults to `http://localhost:3000`.
- `STRESS_CONCURRENCY` — defaults to `50`.
- `STRESS_REQUESTS` — defaults to `200`.

## What these scripts measure

- Read-heavy endpoint latency under concurrency.
- Cold vs warm cache behavior for aggregation/anomaly endpoints.
- Cache invalidation sanity after an order write.
- Redis-disabled fallback can be checked by running the same scripts with the server started using `REDIS_ENABLED=false`.