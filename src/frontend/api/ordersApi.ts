import { requestJson } from './client.js';
import type { AnomalyDto, OrderDto, OrdersQuery, OrdersStats, Paginated } from '../types/api.js';

export function listOrders(query: OrdersQuery, signal?: AbortSignal) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return requestJson<Paginated<OrderDto>>(`/api/orders?${params.toString()}`, {}, signal);
}

export function getOrder(id: string, signal?: AbortSignal) {
  return requestJson<OrderDto>(`/api/orders/${encodeURIComponent(id)}`, {}, signal);
}

export function patchOrder(id: string, body: Partial<Pick<OrderDto, 'status' | 'priority'>> & { version?: number }) {
  return requestJson<OrderDto>(`/api/orders/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function getStats(signal?: AbortSignal) {
  return requestJson<OrdersStats>('/api/orders/stats', {}, signal);
}

export function getAnomalies(signal?: AbortSignal) {
  return requestJson<{ data: AnomalyDto[] }>('/api/orders/anomalies', {}, signal);
}