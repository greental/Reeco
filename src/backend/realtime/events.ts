import type { Response } from 'express';

export interface ServerEvent {
  type: string;
  data: Record<string, unknown>;
}

interface Client {
  id: number;
  supplierId?: string;
  res: Response;
}

let nextClientId = 1;
const clients = new Map<number, Client>();

export function addEventsClient(res: Response, supplierId?: string): () => void {
  const id = nextClientId++;
  clients.set(id, { id, supplierId, res });

  res.write(': connected\n\n');

  return () => {
    clients.delete(id);
  };
}

export function publishEvent(event: ServerEvent): void {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  const supplierId = typeof event.data.supplier_id === 'string' ? event.data.supplier_id : undefined;

  for (const client of clients.values()) {
    if (client.supplierId && client.supplierId !== supplierId) {
      continue;
    }

    client.res.write(payload);
  }
}