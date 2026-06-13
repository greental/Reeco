import { expect } from 'vitest';
import { expectOk } from './api.js';

interface SupplierListResponse {
  data?: Array<{ id: string }>;
}

export async function getAnySupplierId(baseUrl: string): Promise<string> {
  const response = await expectOk<SupplierListResponse>(baseUrl, '/api/suppliers?limit=1');
  const supplierId = response.data.data?.[0]?.id;
  expect(supplierId, 'at least one supplier must exist for supplier performance stress tests').toBeTruthy();
  return supplierId as string;
}

export async function getPendingOrderForPatch(baseUrl: string): Promise<{ id: string; priority: string; version: number } | null> {
  const response = await expectOk<{ data?: Array<{ id: string; priority: string; version: number }> }>(
    baseUrl,
    '/api/orders?status=pending&limit=1',
  );
  return response.data.data?.[0] ?? null;
}