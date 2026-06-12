import { requestJson } from './client.js';
import type { JobDto } from '../types/api.js';

export function createBulkJob(body: { orderIds: string[]; action: string; reason?: string }) {
  return requestJson<{ jobId: string; job_id: string }>('/api/orders/bulk-action', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function getJob(id: string, signal?: AbortSignal) {
  return requestJson<JobDto>(`/api/jobs/${encodeURIComponent(id)}`, {}, signal);
}