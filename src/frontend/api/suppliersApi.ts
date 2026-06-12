import { requestJson } from './client.js';
import type { OrderDto, Paginated, SupplierDto, SupplierPerformanceDto } from '../types/api.js';

export async function getSupplierDetail(id: string, signal?: AbortSignal) {
  const [supplier, performance, orders] = await Promise.all([
    requestJson<SupplierDto>(`/api/suppliers/${encodeURIComponent(id)}`, {}, signal),
    requestJson<SupplierPerformanceDto>(`/api/suppliers/${encodeURIComponent(id)}/performance`, {}, signal),
    requestJson<Paginated<OrderDto>>(`/api/orders?supplier_id=${encodeURIComponent(id)}&limit=10&sort=created_at&order=desc`, {}, signal),
  ]);
  return { supplier, performance, orders: orders.data };
}