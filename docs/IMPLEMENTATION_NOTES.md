# Implementation Notes

## Assignment constraints verified

- Source code for the application should live under `src/`.
- Backend REST API endpoints must live under `/api`.
- The server must listen on port `3000` by default.
- Assignment tests are the authoritative spec when README and tests disagree.
- Do not modify `tests/` or `data/` during implementation.
- Work should proceed in small vertical slices, with relevant tests run before each slice commit.

## Infrastructure verified

`docker-compose.yml` provides:

- PostgreSQL 16 on `localhost:5432`
  - user: `postgres`
  - password: `postgres`
  - database: `order_ops`
- Redis 7 on `localhost:6379`

Redis is available, but should be postponed until performance or coordination needs justify it.

## Data files verified

CSV row counts, excluding headers:

| File | Rows |
| --- | ---: |
| `data/orders.csv` | 50,000 |
| `data/suppliers.csv` | 500 |
| `data/products.csv` | 5,000 |
| `data/categories.csv` | 195 |

Known data risks from the assignment brief:

- Empty/null warehouses.
- Negative quantities.
- Price mismatches.
- Inactive suppliers with orders.
- Timestamp anomalies.
- Circular category relationships.
- XSS-like payloads in notes.

## Test commands verified

The tests live under `tests/` and expose these scripts:

| Purpose | Command from `tests/` |
| --- | --- |
| All tests | `npm test` |
| Basic CRUD | `npm run test:basic` |
| Filtering/search | `npm run test:filter` |
| Aggregations | `npm run test:agg` |
| Anomalies | `npm run test:anomaly` |
| Bulk operations | `npm run test:bulk` |
| Concurrency | `npm run test:concurrent` |
| Performance | `npm run test:perf` |
| Realtime | `npm run test:realtime` |
| Security | `npm run test:security` |
| Grade | `npm run grade` |

Root wrapper scripts should be added in a later setup slice so agents can run these from the repository root.

## Implementation direction

- Backend first; frontend should wait until backend tests are mostly green.
- Prefer simple Node.js TypeScript backend with PostgreSQL.
- Prefer PostgreSQL indexes and SQL queries first; add Redis only if tests require caching/coordination.
- Use parameterized SQL and allowlists for dynamic query parts from the start.
- Add repeatable DB migration/import/reset commands before relying on test results, because tests mutate order state.

## Current backend status

- Backend API slices are implemented through CRUD, filtering, aggregations, anomaly detection, bulk operations, concurrency controls, and realtime events.
- CSV import was optimized to use bulk loading instead of row-by-row inserts, keeping the full test suite practical to rerun.
- Latest verified full-suite command: `npm run build && npm run server:smoke && npm test`.
- Next recommended slice: frontend dashboard/order-management UI, with final packaging/docs polish after the UI is usable.
