import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

interface StressManifest {
  expected_api_minimums: {
    anomalies_total_min: number;
    price_mismatch_min: number;
    negative_quantity_min: number;
    timestamp_anomaly_min: number;
    price_spike_min: number;
    after_hours_min: number;
  };
}

interface AnomalyResponse {
  data?: Array<{
    order_id: string;
    anomaly_types: string[];
    severity: string;
  }>;
}

const API_URL = process.env.API_URL ?? 'http://localhost:3000';
const DATA_DIR = process.env.DATA_DIR ?? 'data_stress';
const manifestPath = path.resolve(process.cwd(), DATA_DIR, 'manifest.json');

async function readManifest(): Promise<StressManifest> {
  const raw = await readFile(manifestPath, 'utf-8');
  return JSON.parse(raw) as StressManifest;
}

async function getJson<T>(route: string): Promise<T> {
  const response = await fetch(`${API_URL}${route}`, { headers: { Accept: 'application/json' } });
  const body = await response.json();

  if (!response.ok) {
    throw new Error(`${route} failed with ${response.status}: ${JSON.stringify(body)}`);
  }

  return body as T;
}

function countType(anomalies: NonNullable<AnomalyResponse['data']>, type: string): number {
  return anomalies.filter((anomaly) => anomaly.anomaly_types.includes(type)).length;
}

function assertMinimum(label: string, actual: number, minimum: number): void {
  console.log(`${label}: minimum=${minimum} actual=${actual}`);
  if (actual < minimum) {
    throw new Error(`${label}: expected at least ${minimum}, got ${actual}`);
  }
}

describe('stress API validation', () => {
  it('meets generated manifest anomaly minimums', async () => {
    const manifest = await readManifest();
    const anomaliesBody = await getJson<AnomalyResponse>('/api/orders/anomalies');
    const anomalies = anomaliesBody.data ?? [];
    const minimums = manifest.expected_api_minimums;

    const rows = [
      { metric: 'anomalies_total', minimum: minimums.anomalies_total_min, actual: anomalies.length },
      { metric: 'price_mismatch', minimum: minimums.price_mismatch_min, actual: countType(anomalies, 'price_mismatch') },
      { metric: 'negative_quantity', minimum: minimums.negative_quantity_min, actual: countType(anomalies, 'negative_quantity') },
      { metric: 'timestamp_anomaly', minimum: minimums.timestamp_anomaly_min, actual: countType(anomalies, 'timestamp_anomaly') },
      { metric: 'price_spike', minimum: minimums.price_spike_min, actual: countType(anomalies, 'price_spike') },
      { metric: 'after_hours', minimum: minimums.after_hours_min, actual: countType(anomalies, 'after_hours') },
    ];

    console.log(`\nStress API validation using ${API_URL} and ${manifestPath}`);
    console.table(rows);

    for (const row of rows) {
      expect(row.actual, row.metric).toBeGreaterThanOrEqual(row.minimum);
    }
  });
});