const API_URL = process.env.API_URL ?? 'http://localhost:3000';
const REQUESTS = Number(process.env.STRESS_REQUESTS ?? 200);
const CONCURRENCY = Number(process.env.STRESS_CONCURRENCY ?? 50);

interface TimingResult {
  endpoint: string;
  durations: number[];
  failures: number;
}

const endpoints = [
  '/api/orders?limit=25&sort=created_at&order=desc',
  '/api/orders/stats',
  '/api/orders/anomalies',
  '/api/suppliers/sup_042/performance',
];

async function timeRequest(endpoint: string): Promise<number> {
  const started = performance.now();
  const response = await fetch(`${API_URL}${endpoint}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`${endpoint} failed with ${response.status}`);
  }
  await response.arrayBuffer();
  return performance.now() - started;
}

async function runEndpoint(endpoint: string): Promise<TimingResult> {
  const durations: number[] = [];
  let failures = 0;
  let next = 0;

  async function worker(): Promise<void> {
    while (next < REQUESTS) {
      next += 1;
      try {
        durations.push(await timeRequest(endpoint));
      } catch (error) {
        failures += 1;
        console.error(error instanceof Error ? error.message : error);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, REQUESTS) }, () => worker()));
  return { endpoint, durations, failures };
}

function percentile(values: number[], percent: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil((percent / 100) * sorted.length) - 1);
  return sorted[index];
}

function printResult(result: TimingResult): void {
  const count = result.durations.length;
  const avg = count ? result.durations.reduce((sum, value) => sum + value, 0) / count : 0;
  console.log(
    JSON.stringify(
      {
        endpoint: result.endpoint,
        requests: REQUESTS,
        concurrency: CONCURRENCY,
        successes: count,
        failures: result.failures,
        avg_ms: Number(avg.toFixed(2)),
        p50_ms: Number(percentile(result.durations, 50).toFixed(2)),
        p95_ms: Number(percentile(result.durations, 95).toFixed(2)),
        max_ms: Number(Math.max(0, ...result.durations).toFixed(2)),
      },
      null,
      2,
    ),
  );
}

for (const endpoint of endpoints) {
  const result = await runEndpoint(endpoint);
  printResult(result);
  if (result.failures > 0) {
    process.exitCode = 1;
  }
}