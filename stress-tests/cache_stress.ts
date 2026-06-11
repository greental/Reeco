const API_URL = process.env.API_URL ?? 'http://localhost:3000';

async function timedJson(path: string): Promise<{ ms: number; body: unknown }> {
  const started = performance.now();
  const response = await fetch(`${API_URL}${path}`, { headers: { Accept: 'application/json' } });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}: ${JSON.stringify(body)}`);
  }
  return { ms: performance.now() - started, body };
}

async function patchJson(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'PATCH',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function sample(path: string): Promise<void> {
  const cold = await timedJson(path);
  const warm = await timedJson(path);
  console.log(
    JSON.stringify(
      {
        endpoint: path,
        cold_ms: Number(cold.ms.toFixed(2)),
        warm_ms: Number(warm.ms.toFixed(2)),
        same_shape: JSON.stringify(Object.keys(cold.body as Record<string, unknown>).sort()) ===
          JSON.stringify(Object.keys(warm.body as Record<string, unknown>).sort()),
      },
      null,
      2,
    ),
  );
}

await sample('/api/orders/stats');
await sample('/api/orders/anomalies');
await sample('/api/suppliers/sup_042/performance');

const orderBefore = (await timedJson('/api/orders?status=pending&limit=1')).body as { data?: Array<{ id: string; priority: string }> };
const order = orderBefore.data?.[0];
if (order) {
  await timedJson('/api/orders/stats');
  await patchJson(`/api/orders/${encodeURIComponent(order.id)}`, {
    priority: order.priority === 'low' ? 'medium' : 'low',
  });
  const afterInvalidation = await timedJson('/api/orders/stats');
  console.log(
    JSON.stringify(
      {
        invalidation_check: 'patched order then read stats',
        order_id: order.id,
        stats_after_patch_ms: Number(afterInvalidation.ms.toFixed(2)),
      },
      null,
      2,
    ),
  );
} else {
  console.log('No pending order found for invalidation check; skipped write invalidation sample.');
}