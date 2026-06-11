# Architecture

## Overview

This implementation is a small full-stack procurement dashboard built around the provided PostgreSQL database and CSV fixtures.

The project intentionally keeps the architecture simple and assignment-focused:

```text
src/
  backend/   Express + TypeScript REST API, PostgreSQL repositories, SSE events
  frontend/  Static browser dashboard served by the same Express app
  shared/    Reserved for shared types/utilities if the project grows
data/        Provided CSV fixtures, treated as read-only source data
tests/       Provided assignment test suite, not modified
tools/       Local scripts for migration, import, smoke tests, and test orchestration
```

The backend listens on port `3000` by default and exposes all API routes under `/api`. The same Express process serves the static dashboard from `src/frontend/static`.

## Backend structure

- `src/backend/app.ts` creates the Express app, mounts JSON parsing, API routes, static frontend assets, and a consistent 404 handler.
- `src/backend/server.ts` loads configuration and starts the HTTP server.
- `src/backend/routes/api.ts` owns request parsing, validation, response shaping, and route-level error handling.
- `src/backend/repositories/*Repository.ts` isolates SQL and persistence logic by domain:
  - orders, filtering, stats, anomalies, and optimistic updates
  - suppliers and supplier performance metrics
  - products and recursive category filtering
  - jobs and background bulk processing
- `src/backend/db/*` contains connection pooling, migrations, and CSV import.
- `src/backend/realtime/events.ts` implements Server-Sent Events broadcasting.

The API uses parameterized SQL for user-provided values. Dynamic SQL is limited to allowlisted sort fields and sort directions in `src/backend/routes/api.ts` / `src/backend/repositories/ordersRepository.ts`.

## Database schema

The schema is defined in `src/backend/db/migrations/001_initial_schema.sql`.

### Core tables

- `suppliers`
  - `id` primary key from the CSV.
  - Nullable `rating`, `email`, and `country` preserve incomplete master data.
  - `active` records the current supplier state.
- `categories`
  - `id` primary key.
  - `parent_id` references `categories(id)` and allows null roots.
- `products`
  - `id` primary key.
  - `category_id` is intentionally not a strict foreign key because the source data contains products pointing to a missing category (`cat_200`).
  - `sku` is not unique because the source data includes duplicate SKUs.
- `orders`
  - `id` primary key.
  - Foreign keys to suppliers and products.
  - Preserves source fields including nullable `warehouse` and free-text `notes`.
  - `version` supports optimistic/concurrent update semantics.
- `jobs` and `job_items`
  - Track asynchronous bulk actions and per-order success/failure status.

## Import strategy

CSV import is implemented in `src/backend/db/import.ts`.

The import pipeline follows the data-quality principle documented in `docs/DATA_QUALITY_FINDINGS.md`: preserve suspicious data and flag it later, rather than rejecting or rewriting it during ingestion.

Important choices:

- Tables are truncated before import so tests can reset to a known baseline.
- CSV files are streamed to avoid loading all rows into memory at once.
- Inserts are batched for practical import time with 50,000 orders.
- Empty strings are converted to `NULL` where the domain supports missing values.
- Category rows are inserted first with null parents, then valid parent links are updated after all categories are known.
- Products with missing category references are preserved.
- Order `notes` are stored as text and returned as JSON strings; the frontend escapes before rendering.

## Indexing strategy

Indexes are defined in `src/backend/db/migrations/002_indexes.sql` and target the test-critical access patterns:

- Order filtering and sorting:
  - `status`, `priority`, `supplier_id`, `product_id`, `warehouse`, `created_at`, `updated_at`, `total_price`
  - compound indexes for common combinations such as status/date, status/priority, and supplier/status
- Order stats and anomaly scans:
  - join indexes on supplier/product IDs
  - expression index for grouping empty/null warehouses as `unassigned`
- Product lookup:
  - `category_id` for category filtering
  - `LOWER(name)` for case-insensitive product search
- Category recursion:
  - `parent_id` for descendant traversal
- Jobs:
  - status and job/item lookup indexes for polling and progress updates

The design prefers PostgreSQL query performance and indexes first. Redis is provided by Docker Compose and is used only as an optional API response cache when explicitly enabled.

## Redis response cache

Redis is available at `redis://localhost:6379` from the provided `docker-compose.yml`. The backend keeps this cache optional:

- `REDIS_ENABLED=false` means cache calls are no-ops and API behavior stays PostgreSQL-only.
- `REDIS_ENABLED=true` connects to the existing Redis service using `REDIS_URL`.
- `CACHE_TTL_SECONDS`, `CACHE_MAX_ENTRIES`, and `CACHE_NAMESPACE` control cache lifetime, app-level LRU size, and key prefixing.

The cache module lives in `src/backend/cache/responseCache.ts` and provides:

- deterministic cache key generation
- JSON value serialization
- TTL-backed Redis values
- app-level LRU-style eviction using a Redis sorted set of recently touched keys
- namespace-version invalidation for write events
- graceful fallback if Redis is disabled or unavailable

Cached endpoints are currently focused on read-heavy queries:

- `GET /api/orders/stats`
- `GET /api/orders/anomalies`
- `GET /api/suppliers/:id/performance`

Write invalidation is intentionally coarse-grained and safe: successful `PATCH /api/orders/:id` and completed bulk jobs increment the cache namespace version and clear the LRU set. This avoids serving stale procurement aggregates while keeping invalidation simple for the assignment.

## API behavior

Implemented endpoint groups:

- Orders CRUD and filtering:
  - `GET /api/orders`
  - `GET /api/orders/:id`
  - `PATCH /api/orders/:id`
- Aggregations:
  - `GET /api/orders/stats`
  - `GET /api/suppliers/:id/performance`
- Anomaly detection:
  - `GET /api/orders/anomalies`
- Bulk operations:
  - `POST /api/orders/bulk-action`
  - `GET /api/jobs/:id`
- Realtime events:
  - `GET /api/events`
- Suppliers/products:
  - `GET /api/suppliers`
  - `GET /api/suppliers/:id`
  - `GET /api/products`
  - `GET /api/products?category=...`

Errors use the assignment shape:

```json
{ "error": "Human-readable error message", "code": "ERROR_CODE" }
```

List endpoints use the expected paginated response shape with `data`, `total`, `limit`, and `offset`.

## Concurrency model

### Single-order updates

`PATCH /api/orders/:id` updates only when the order is not cancelled and when at least one requested mutable field would actually change. The SQL update increments `version` and returns the updated row in a single statement.

For simultaneous conflicting updates, one request updates the row and the other receives a conflict-style response because the guarded update no longer matches.

### Bulk overlap

Bulk jobs persist requested IDs in `job_items`. Processing uses a database transaction and `FOR UPDATE SKIP LOCKED` over pending job items, so workers avoid double-claiming the same job item. Order updates are set-based and guarded against cancelled orders.

The assignment runs in a single Node process, so an in-process background worker is enough. A production version would move this to a durable worker/queue such as BullMQ, SQS, or PostgreSQL advisory-lock workers.

## Background processing

Bulk operations return `202 Accepted` quickly with a job ID. `JobsRepository.createBulkJob` writes the job and its items, then schedules processing with `setImmediate`.

The processor:

1. Locks pending job items.
2. Updates eligible orders for `approve` / `reject`, or validates order existence for `flag`.
3. Marks item rows as completed or failed.
4. Updates aggregate job progress on `jobs`.
5. Publishes a `bulk_completed` realtime event.

This avoids blocking the request path for large batches and gives the UI/tests a polling endpoint for progress.

## Realtime events

Realtime events use Server-Sent Events in `src/backend/realtime/events.ts`.

- Clients connect to `GET /api/events`.
- Events are emitted for:
  - `order_updated`
  - `bulk_completed`
- Optional `supplier_id` query filtering is supported. Order update events include `supplier_id`, allowing filtered clients to receive only matching supplier activity.

SSE was chosen over WebSockets because the assignment only needs server-to-client broadcast, and SSE is simpler to implement and test without additional dependencies.

## Frontend structure

The frontend is a dependency-free static dashboard in `src/frontend/static`:

- `index.html` defines the dashboard shell.
- `styles.css` provides responsive layout and status styling.
- `app.js` calls the REST API, renders dashboard metrics, handles filters/pagination/sorting, supports order detail updates, shows supplier performance, runs bulk actions, polls jobs, and displays SSE activity.

Although the README allows React, the submitted app keeps the UI static to minimize build complexity and dependencies while still demonstrating the required procurement workflows.

## Security considerations

- SQL inputs are parameterized.
- Sort columns and directions are allowlisted.
- JSON body size is capped at `1mb`.
- Notes and other user-controlled text are escaped in the frontend before insertion into HTML.
- API responses are JSON for API routes.

## Tradeoffs and future improvements

- Background jobs are in-process. This is sufficient for the assignment, but not durable across process restarts.
- Aggregations are computed directly from PostgreSQL when Redis cache is disabled; Redis can cache hot aggregate/anomaly/supplier-performance responses when enabled.
- There is no authentication/authorization because it is outside the assignment tests.
- The frontend is static JavaScript rather than React to keep the implementation focused and low-risk.
- Supplier/category/product master-data cleanup is documented, but not enforced during import because the tests require preserving source data.