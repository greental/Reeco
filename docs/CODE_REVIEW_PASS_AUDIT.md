# Code Review Pass Audit

This audit maps `docs/reeco_code_review_report_for_cline.md` to the current repository state after the remediation slices.

## Verification summary

- Official assignment suite: **passed** via `npm test` with the built server running.
- Stress dataset checks: **passed** during the stress slice against generated `data_stress` data.
- `npm run grade`: attempted, but blocked because the provided `tests/package.json` references `node grade.js` and `tests/grade.js` is not present in this checkout.

## Highest-priority task status

| Review task | Status | Evidence / notes |
|---|---|---|
| Add a real React + TypeScript dashboard | Fixed | `src/frontend/App.tsx`, typed `src/frontend/api/*`, `src/frontend/types/api.ts`, Vite config, React deps, and production build in `dist/frontend`. Legacy static files remain as fallback only. |
| Fix optimistic locking for order patch | Fixed | `PatchOrderSchema` accepts/requires `version`/`expectedVersion`; repository distinguishes missing, cancelled, and version conflict; concurrency suite passed. |
| Make bulk jobs durable/resumable | Mostly fixed | Jobs are persisted as `queued`, claimed from Postgres with `FOR UPDATE SKIP LOCKED`, processed in `CHUNK_SIZE = 500` chunks, and stale `processing` jobs can be recovered. It is still an in-process worker rather than a separate production worker service. |
| Add schema validation for API inputs | Fixed | `src/backend/routes/api.ts` uses Zod schemas for order query, patch body, and bulk action payloads. |
| Add centralized Express error middleware | Fixed | `src/backend/http/errorMiddleware.ts` normalizes malformed JSON and unexpected errors to JSON responses. |
| Improve frontend request behavior | Partially fixed | React dashboard uses `AbortController` for dashboard loads. Remaining opportunity: explicitly debounce SSE-driven refreshes and minimize refetch scope. |
| Add scripts/tooling | Partially fixed | `build`, `typecheck`, `frontend:dev`, and `frontend:build` exist. A dedicated `lint` script and React test setup are still not present. |

## Per-finding audit

| Severity | Finding area | Status | Notes |
|---:|---|---|---|
| 5 | React app placeholder | Fixed | Replaced with real React dashboard in `src/frontend/App.tsx`. |
| 5 | Static JS dashboard architecture | Fixed / legacy fallback remains | Main submitted UI is React + TypeScript. `src/frontend/static` remains for dev fallback only. |
| 4 | Frontend tooling | Partially fixed | Vite/React build and typecheck exist. Missing `lint`; no React test setup. |
| 5 | True optimistic locking | Fixed | Expected version is required for PATCH and stale versions return conflict semantics. |
| 4 | Same-value patch guard | Fixed | Same-value update behavior is covered by tests and no longer misreported as cancelled. |
| 4 | Patch failure reason split | Fixed | Missing order, cancelled order, and version conflict are distinct outcomes. |
| 4 | Manual query parsing / validation | Fixed | Zod validates sort/order/date/pagination/body values. Some old helper functions remain but main routes use schemas. |
| 4 | Bulk job `setImmediate` durability risk | Mostly fixed | Jobs are queued in DB and worker claims queued jobs. Still process-local execution, but persisted/recoverable. |
| 4 | Bulk job large transaction | Fixed | Job items are processed in 500-item chunks with progress refresh per chunk. |
| 4 | Flag action no visible state | Fixed | Orders include `flagged`; flag action sets `orders.flagged = true`. |
| 3 | Order list supplier/product names | Open / low-risk | `list` still returns `NULL::text AS supplier_name` and only joins products for search. Tests pass, but dashboard/list polish could improve by always joining names. |
| 3 | Static serving from source folder | Fixed | Production serves Vite build from `dist/frontend`; source static fallback remains for non-production. |
| 3 | Central error middleware | Fixed | Added JSON error middleware. |
| 3 | Server graceful shutdown | Open | `tools/stop-server.sh` exists for local cleanup, but `server.ts` does not fully close HTTP/Postgres/Redis/in-flight jobs on signals. |
| 3 | Redis failed client retry | Not verified / likely open | Optional cache works and stress cache passes, but explicit reset/retry policy was not audited as fully fixed. |
| 3 | Cache miss coalescing | Open | No explicit in-flight promise deduplication by cache key was verified. |
| 3 | SSE frontend refresh spam | Partially fixed | React migration improved request ownership; explicit SSE debounce remains a possible improvement. |
| 3 | SSE multi-process limitation | Documented tradeoff | Architecture docs describe assignment single-process assumptions; Redis pub/sub was not implemented. |
| 3 | Frontend request races | Partially fixed | `AbortController` guards dashboard fetches; more granular query/cache management could improve this further. |
| 2 | Bulk reason validation | Fixed | Zod trims and caps `reason` at 500 chars. |
| 2 | Manual `innerHTML` fragility | Fixed for main UI | React escapes by default in the submitted dashboard; legacy static files remain as fallback. |

## Remaining recommended quick wins

If more hardening time is available, the best remaining quick wins are:

1. Add a real lint script and lint configuration.
2. Always join supplier/product names in `OrdersRepository.list`.
3. Add explicit SSE refresh debounce in the React event path.
4. Add graceful shutdown handling in `src/backend/server.ts`.
5. Add Redis client retry reset and cache miss coalescing.
