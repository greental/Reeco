import { describe, expect, it } from 'vitest';
import { getBaseUrl } from './helpers/api.js';
import { getAnySupplierId } from './helpers/fixture.js';
import { expectNoFailures, printSummaries, runEndpointStress, summarize } from './helpers/metrics.js';

const REQUESTS = Number(process.env.STRESS_REQUESTS ?? 200);
const CONCURRENCY = Number(process.env.STRESS_CONCURRENCY ?? 50);
const MAX_P95_MS = Number(process.env.STRESS_MAX_P95_MS ?? 2_000);

describe('API stress', () => {
  it('keeps core read endpoints healthy under concurrent load', async () => {
    const baseUrl = getBaseUrl();
    const supplierId = await getAnySupplierId(baseUrl);
    const endpoints = [
      { label: 'orders page', endpoint: '/api/orders?limit=25&sort=created_at&order=desc' },
      { label: 'required aggregation: orders stats', endpoint: '/api/orders/stats' },
      { label: 'anomaly aggregation', endpoint: '/api/orders/anomalies' },
      { label: 'supplier performance', endpoint: `/api/suppliers/${encodeURIComponent(supplierId)}/performance` },
    ];

    const results = [];
    for (const item of endpoints) {
      results.push(await runEndpointStress(baseUrl, item.endpoint, { label: item.label, requests: REQUESTS, concurrency: CONCURRENCY }));
    }

    const summaries = results.map(summarize);
    printSummaries('API stress summary', summaries);

    for (const result of results) {
      expectNoFailures(result);
    }

    for (const summary of summaries) {
      expect(summary.p95_ms, `${summary.endpoint} p95`).toBeLessThan(MAX_P95_MS);
    }
  });
});