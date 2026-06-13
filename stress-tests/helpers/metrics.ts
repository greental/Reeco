import { expect } from 'vitest';
import { expectOk } from './api.js';

export interface TimingResult {
  label: string;
  endpoint: string;
  requests: number;
  concurrency: number;
  durations: number[];
  failures: Array<{ status?: number; message: string }>;
}

export interface TimingSummary {
  label: string;
  endpoint: string;
  requests: number;
  concurrency: number;
  successes: number;
  failures: number;
  avg_ms: number;
  p50_ms: number;
  p95_ms: number;
  max_ms: number;
}

export function percentile(values: number[], percent: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil((percent / 100) * sorted.length) - 1);
  return sorted[index];
}

export function summarize(result: TimingResult): TimingSummary {
  const successes = result.durations.length;
  const avg = successes ? result.durations.reduce((sum, value) => sum + value, 0) / successes : 0;
  return {
    label: result.label,
    endpoint: result.endpoint,
    requests: result.requests,
    concurrency: result.concurrency,
    successes,
    failures: result.failures.length,
    avg_ms: Number(avg.toFixed(2)),
    p50_ms: Number(percentile(result.durations, 50).toFixed(2)),
    p95_ms: Number(percentile(result.durations, 95).toFixed(2)),
    max_ms: Number(Math.max(0, ...result.durations).toFixed(2)),
  };
}

export async function runEndpointStress(
  baseUrl: string,
  endpoint: string,
  options: { label?: string; requests: number; concurrency: number },
): Promise<TimingResult> {
  const durations: number[] = [];
  const failures: TimingResult['failures'] = [];
  let next = 0;

  async function worker(): Promise<void> {
    while (next < options.requests) {
      next += 1;
      try {
        const response = await expectOk(baseUrl, endpoint);
        durations.push(response.responseTime);
      } catch (error) {
        failures.push({ message: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(options.concurrency, options.requests) }, () => worker()));

  return {
    label: options.label ?? endpoint,
    endpoint,
    requests: options.requests,
    concurrency: options.concurrency,
    durations,
    failures,
  };
}

export function printSummaries(title: string, summaries: TimingSummary[]): void {
  console.log(`\n${title}`);
  console.table(
    summaries.map((summary) => ({
      label: summary.label,
      endpoint: summary.endpoint,
      ok: summary.successes,
      fail: summary.failures,
      avg_ms: summary.avg_ms,
      p50_ms: summary.p50_ms,
      p95_ms: summary.p95_ms,
      max_ms: summary.max_ms,
    })),
  );
}

export function expectNoFailures(result: TimingResult): void {
  expect(result.failures, `${result.endpoint} failures: ${JSON.stringify(result.failures.slice(0, 5))}`).toHaveLength(0);
  expect(result.durations).toHaveLength(result.requests);
}