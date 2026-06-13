import { afterAll, describe, expect, it } from 'vitest';
import { expectOk, patch } from './helpers/api.js';
import { getAnySupplierId, getPendingOrderForPatch } from './helpers/fixture.js';
import { percentile } from './helpers/metrics.js';
import { startServer, type StartedServer } from './helpers/server.js';

const WARM_REQUESTS = Number(process.env.CACHE_STRESS_WARM_REQUESTS ?? 8);
const DISABLED_PORT = Number(process.env.CACHE_STRESS_DISABLED_PORT ?? 3101);
const ENABLED_PORT = Number(process.env.CACHE_STRESS_ENABLED_PORT ?? 3102);

interface CacheSummary {
  label: string;
  endpoint: string;
  mode: 'redis-disabled' | 'redis-enabled';
  cold_ms: number;
  warm_avg_ms: number;
  warm_p95_ms: number;
  improvement_vs_disabled_pct?: number;
}

const servers: StartedServer[] = [];

afterAll(async () => {
  await Promise.all(servers.map((server) => server.stop()));
});

async function timeJson(baseUrl: string, endpoint: string): Promise<{ ms: number; body: unknown }> {
  const response = await expectOk(baseUrl, endpoint);
  return { ms: response.responseTime, body: response.data };
}

async function sampleEndpoint(
  baseUrl: string,
  endpoint: string,
  mode: CacheSummary['mode'],
  label: string,
): Promise<CacheSummary & { coldBody: unknown; warmBody: unknown }> {
  const cold = await timeJson(baseUrl, endpoint);

  // Explicit test-controlled warm-up: the app itself remains lazy/cold-start cache-aside.
  await timeJson(baseUrl, endpoint);

  const warmDurations: number[] = [];
  let warmBody: unknown = cold.body;
  for (let index = 0; index < WARM_REQUESTS; index += 1) {
    const warm = await timeJson(baseUrl, endpoint);
    warmDurations.push(warm.ms);
    warmBody = warm.body;
  }

  const warmAvg = warmDurations.reduce((sum, value) => sum + value, 0) / warmDurations.length;
  return {
    label,
    endpoint,
    mode,
    cold_ms: Number(cold.ms.toFixed(2)),
    warm_avg_ms: Number(warmAvg.toFixed(2)),
    warm_p95_ms: Number(percentile(warmDurations, 95).toFixed(2)),
    coldBody: cold.body,
    warmBody,
  };
}

function printCacheSummaries(summaries: CacheSummary[]): void {
  console.log('\nCache comparison summary (app startup is cold/lazy; warm-up is test-controlled)');
  console.table(
    summaries.map((summary) => ({
      label: summary.label,
      endpoint: summary.endpoint,
      mode: summary.mode,
      cold_ms: summary.cold_ms,
      warm_avg_ms: summary.warm_avg_ms,
      warm_p95_ms: summary.warm_p95_ms,
      improvement_vs_disabled_pct: summary.improvement_vs_disabled_pct ?? 'baseline',
    })),
  );
}

describe('Redis response cache stress', () => {
  it('shows warm-cache effect with extra focus on required aggregation endpoint', async () => {
    const namespace = `reeco-stress-${Date.now()}`;
    const disabled = await startServer({ PORT: String(DISABLED_PORT), REDIS_ENABLED: 'false' });
    servers.push(disabled);
    const enabled = await startServer({
      PORT: String(ENABLED_PORT),
      REDIS_ENABLED: 'true',
      CACHE_TTL_SECONDS: '60',
      CACHE_MAX_ENTRIES: '500',
      CACHE_NAMESPACE: namespace,
    });
    servers.push(enabled);

    const supplierId = await getAnySupplierId(enabled.baseUrl);
    const endpoints = [
      { label: 'required aggregation cache target', endpoint: '/api/orders/stats' },
      { label: 'secondary anomaly aggregate', endpoint: '/api/orders/anomalies' },
      { label: 'secondary supplier aggregate', endpoint: `/api/suppliers/${encodeURIComponent(supplierId)}/performance` },
    ];

    const summaries: CacheSummary[] = [];
    for (const item of endpoints) {
      const disabledSummary = await sampleEndpoint(disabled.baseUrl, item.endpoint, 'redis-disabled', item.label);
      const enabledSummary = await sampleEndpoint(enabled.baseUrl, item.endpoint, 'redis-enabled', item.label);

      enabledSummary.improvement_vs_disabled_pct = Number(
        Math.max(0, ((disabledSummary.warm_avg_ms - enabledSummary.warm_avg_ms) / disabledSummary.warm_avg_ms) * 100).toFixed(2),
      );

      expect(Object.keys(enabledSummary.coldBody as Record<string, unknown>).sort()).toEqual(
        Object.keys(enabledSummary.warmBody as Record<string, unknown>).sort(),
      );

      summaries.push(disabledSummary, enabledSummary);
    }

    printCacheSummaries(summaries);

    const statsDisabled = summaries.find(
      (summary) => summary.endpoint === '/api/orders/stats' && summary.mode === 'redis-disabled',
    );
    const statsEnabled = summaries.find(
      (summary) => summary.endpoint === '/api/orders/stats' && summary.mode === 'redis-enabled',
    );
    expect(statsDisabled).toBeTruthy();
    expect(statsEnabled).toBeTruthy();
    expect(statsEnabled!.warm_avg_ms, 'required aggregation endpoint should benefit from warm Redis cache').toBeLessThan(
      statsDisabled!.warm_avg_ms,
    );

    const patchTarget = await getPendingOrderForPatch(enabled.baseUrl);
    if (patchTarget) {
      await timeJson(enabled.baseUrl, '/api/orders/stats');
      const patchResponse = await patch(enabled.baseUrl, `/api/orders/${encodeURIComponent(patchTarget.id)}`, {
        priority: patchTarget.priority === 'low' ? 'medium' : 'low',
        version: patchTarget.version,
      });
      expect(patchResponse.ok, JSON.stringify(patchResponse.data)).toBe(true);
      const afterInvalidation = await timeJson(enabled.baseUrl, '/api/orders/stats');
      console.log(
        `Cache invalidation check: patched ${patchTarget.id}, then /api/orders/stats returned in ${afterInvalidation.ms.toFixed(2)}ms`,
      );
    }
  });
});