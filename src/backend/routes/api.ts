import { Router } from 'express';
import { sendError } from '../http/responses.js';
import { addEventsClient, publishEvent } from '../realtime/events.js';
import {
  BULK_ACTIONS,
  JobsRepository,
  ORDER_PRIORITIES,
  ORDER_STATUSES,
  OrdersRepository,
  ProductsRepository,
  SuppliersRepository,
  type BulkAction,
  type OrderPatch,
  type OrderFilters,
  type OrderPriority,
  type OrderSortField,
  type OrderStatus,
  type SortDirection,
} from '../repositories/index.js';

export const apiRouter = Router();

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 1000;

const ordersRepository = new OrdersRepository();
const suppliersRepository = new SuppliersRepository();
const productsRepository = new ProductsRepository();
const jobsRepository = new JobsRepository();

const ORDER_SORT_FIELDS = new Set<OrderSortField>([
  'id',
  'supplier_id',
  'product_id',
  'quantity',
  'unit_price',
  'total_price',
  'status',
  'priority',
  'created_at',
  'updated_at',
  'warehouse',
]);

function parseNonNegativeInteger(value: unknown, fallback: number): number {
  if (typeof value !== 'string') {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function getPagination(query: Record<string, unknown>): { limit: number; offset: number } {
  const requestedLimit = parseNonNegativeInteger(query.limit, DEFAULT_LIMIT);
  return {
    limit: Math.min(requestedLimit > 0 ? requestedLimit : DEFAULT_LIMIT, MAX_LIMIT),
    offset: parseNonNegativeInteger(query.offset, 0),
  };
}

function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && ORDER_STATUSES.includes(value as OrderStatus);
}

function isOrderPriority(value: unknown): value is OrderPriority {
  return typeof value === 'string' && ORDER_PRIORITIES.includes(value as OrderPriority);
}

function isBulkAction(value: unknown): value is BulkAction {
  return typeof value === 'string' && BULK_ACTIONS.includes(value as BulkAction);
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function getOrderFilters(query: Record<string, unknown>): OrderFilters | null {
  const statuses = asOptionalString(query.status)
    ?.split(',')
    .map((status) => status.trim())
    .filter((status) => status.length > 0);

  if (statuses?.some((status) => !isOrderStatus(status))) {
    return null;
  }

  const priority = asOptionalString(query.priority);
  if (priority && !isOrderPriority(priority)) {
    return null;
  }

  const minTotalRaw = asOptionalString(query.min_total);
  const minTotal = minTotalRaw === undefined ? undefined : Number(minTotalRaw);
  if (minTotal !== undefined && (!Number.isFinite(minTotal) || minTotal < 0)) {
    return null;
  }

  const sortRaw = asOptionalString(query.sort);
  const sort = sortRaw && ORDER_SORT_FIELDS.has(sortRaw as OrderSortField) ? (sortRaw as OrderSortField) : 'id';
  const orderRaw = asOptionalString(query.order)?.toLowerCase();
  const order: SortDirection = orderRaw === 'desc' ? 'desc' : 'asc';

  return {
    statuses: statuses as OrderStatus[] | undefined,
    priority: priority as OrderPriority | undefined,
    supplierId: asOptionalString(query.supplier_id),
    warehouse: asOptionalString(query.warehouse),
    dateFrom: asOptionalString(query.date_from),
    dateTo: asOptionalString(query.date_to),
    minTotal,
    search: asOptionalString(query.search),
    sort,
    order,
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected server error';
}

function getBulkOrderIds(body: Record<string, unknown>): string[] | null {
  const value = body.orderIds ?? body.order_ids;
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string')) {
    return null;
  }
  return value;
}

apiRouter.get('/health', (_req, res) => {
  res.json({ ok: true });
});

apiRouter.get('/events', (req, res) => {
  const supplierId = typeof req.query.supplier_id === 'string' ? req.query.supplier_id : undefined;

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const removeClient = addEventsClient(res, supplierId);
  req.on('close', removeClient);
});

apiRouter.get('/orders', async (req, res) => {
  try {
    const pagination = getPagination(req.query);
    const filters = getOrderFilters(req.query);
    if (!filters) {
      sendError(res, 400, 'Invalid order filter', 'INVALID_FILTER');
      return;
    }

    const result = await ordersRepository.list(pagination, filters);
    res.json({ ...result, ...pagination });
  } catch (error) {
    sendError(res, 500, getErrorMessage(error), 'INTERNAL_ERROR');
  }
});

apiRouter.get('/orders/stats', async (_req, res) => {
  try {
    const stats = await ordersRepository.getStats();
    res.json(stats);
  } catch (error) {
    sendError(res, 500, getErrorMessage(error), 'INTERNAL_ERROR');
  }
});

apiRouter.get('/orders/anomalies', async (_req, res) => {
  try {
    const anomalies = await ordersRepository.getAnomalies();
    res.json({ data: anomalies });
  } catch (error) {
    sendError(res, 500, getErrorMessage(error), 'INTERNAL_ERROR');
  }
});

apiRouter.get('/orders/:id', async (req, res) => {
  try {
    const order = await ordersRepository.getById(req.params.id);
    if (!order) {
      sendError(res, 404, 'Order not found', 'ORDER_NOT_FOUND');
      return;
    }

    res.json(order);
  } catch (error) {
    sendError(res, 500, getErrorMessage(error), 'INTERNAL_ERROR');
  }
});

apiRouter.patch('/orders/:id', async (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    const patch: OrderPatch = {};

    if (Object.prototype.hasOwnProperty.call(body, 'status')) {
      if (!isOrderStatus(body.status)) {
        sendError(res, 400, 'Invalid order status', 'INVALID_STATUS');
        return;
      }
      patch.status = body.status;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'priority')) {
      if (!isOrderPriority(body.priority)) {
        sendError(res, 400, 'Invalid order priority', 'INVALID_PRIORITY');
        return;
      }
      patch.priority = body.priority;
    }

    const before = patch.status ? await ordersRepository.getById(req.params.id) : null;
    const updated = await ordersRepository.patch(req.params.id, patch);
    if (updated) {
      res.json(updated);
      if (patch.status && before && before.status !== updated.status) {
        publishEvent({
          type: 'order_updated',
          data: {
            id: updated.id,
            supplier_id: updated.supplier_id,
            old_status: before.status,
            new_status: updated.status,
            updated_at: updated.updated_at,
          },
        });
      }
      return;
    }

    const existing = await ordersRepository.getById(req.params.id);
    if (!existing) {
      sendError(res, 404, 'Order not found', 'ORDER_NOT_FOUND');
      return;
    }

    sendError(res, 409, 'Cancelled orders cannot be updated', 'ORDER_CANCELLED');
  } catch (error) {
    sendError(res, 500, getErrorMessage(error), 'INTERNAL_ERROR');
  }
});

async function handleBulkAction(req: Parameters<Parameters<typeof apiRouter.post>[1]>[0], res: Parameters<Parameters<typeof apiRouter.post>[1]>[1]) {
  try {
    const body = req.body as Record<string, unknown>;
    const orderIds = getBulkOrderIds(body);
    if (!orderIds || orderIds.length === 0 || orderIds.length > 10_000 || !isBulkAction(body.action)) {
      sendError(res, 400, 'Invalid bulk action request', 'INVALID_BULK_ACTION');
      return;
    }

    const reason = typeof body.reason === 'string' ? body.reason : undefined;
    const jobId = await jobsRepository.createBulkJob(orderIds, body.action, reason);
    res.status(202).json({ jobId, job_id: jobId });
  } catch (error) {
    sendError(res, 500, getErrorMessage(error), 'INTERNAL_ERROR');
  }
}

apiRouter.post('/orders/bulk-action', handleBulkAction);
apiRouter.post('/orders/bulk-actions', handleBulkAction);
apiRouter.post('/orders/bulk', handleBulkAction);

apiRouter.get('/jobs/:id', async (req, res) => {
  try {
    const job = await jobsRepository.getJob(req.params.id);
    if (!job) {
      sendError(res, 404, 'Job not found', 'JOB_NOT_FOUND');
      return;
    }

    res.json({
      status: job.status,
      progress: {
        total: job.total,
        completed: job.completed,
        failed: job.failed,
      },
    });
  } catch (error) {
    sendError(res, 500, getErrorMessage(error), 'INTERNAL_ERROR');
  }
});

apiRouter.get('/suppliers', async (req, res) => {
  try {
    const pagination = getPagination(req.query);
    const result = await suppliersRepository.list(pagination);
    res.json({ ...result, ...pagination });
  } catch (error) {
    sendError(res, 500, getErrorMessage(error), 'INTERNAL_ERROR');
  }
});

apiRouter.get('/suppliers/:id/performance', async (req, res) => {
  try {
    const performance = await suppliersRepository.getPerformance(req.params.id);
    if (!performance) {
      sendError(res, 404, 'Supplier not found', 'SUPPLIER_NOT_FOUND');
      return;
    }

    res.json(performance);
  } catch (error) {
    sendError(res, 500, getErrorMessage(error), 'INTERNAL_ERROR');
  }
});

apiRouter.get('/suppliers/:id', async (req, res) => {
  try {
    const supplier = await suppliersRepository.getById(req.params.id);
    if (!supplier) {
      sendError(res, 404, 'Supplier not found', 'SUPPLIER_NOT_FOUND');
      return;
    }

    res.json(supplier);
  } catch (error) {
    sendError(res, 500, getErrorMessage(error), 'INTERNAL_ERROR');
  }
});

apiRouter.get('/products', async (req, res) => {
  try {
    const pagination = getPagination(req.query);
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const result = await productsRepository.list(pagination, category);
    res.json({ ...result, ...pagination });
  } catch (error) {
    sendError(res, 500, getErrorMessage(error), 'INTERNAL_ERROR');
  }
});

apiRouter.use((_req, res) => {
  sendError(res, 404, 'API route not found', 'NOT_FOUND');
});
