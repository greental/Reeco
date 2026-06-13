import { Router } from 'express';
import { z } from 'zod';
import { cached, invalidateApiCache, makeCacheKey } from '../cache/responseCache.js';
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

const SortFieldSchema = z.enum([
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
const SortDirectionSchema = z.enum(['asc', 'desc']);
const OptionalTrimmedStringSchema = z.string().trim().min(1).optional();
const DateStringSchema = z.string().trim().refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid date').optional();
const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(MAX_LIMIT).optional().default(DEFAULT_LIMIT),
  offset: z.coerce.number().int().nonnegative().optional().default(0),
});
const OrderQuerySchema = PaginationQuerySchema.extend({
  status: z.string().trim().optional(),
  priority: z.enum(ORDER_PRIORITIES).optional(),
  supplier_id: OptionalTrimmedStringSchema,
  warehouse: OptionalTrimmedStringSchema,
  date_from: DateStringSchema,
  date_to: DateStringSchema,
  min_total: z.coerce.number().nonnegative().optional(),
  search: OptionalTrimmedStringSchema,
  sort: SortFieldSchema.optional().default('id'),
  order: SortDirectionSchema.optional().default('asc'),
}).superRefine((value, ctx) => {
  if (value.status) {
    for (const status of value.status.split(',').map((item) => item.trim()).filter(Boolean)) {
      if (!ORDER_STATUSES.includes(status as OrderStatus)) {
        ctx.addIssue({ code: 'custom', path: ['status'], message: `Invalid status: ${status}` });
      }
    }
  }
});
const PatchOrderSchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  priority: z.enum(ORDER_PRIORITIES).optional(),
  version: z.coerce.number().int().positive().optional(),
  expectedVersion: z.coerce.number().int().positive().optional(),
  expected_version: z.coerce.number().int().positive().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.version === undefined && value.expectedVersion === undefined && value.expected_version === undefined) {
    ctx.addIssue({ code: 'custom', path: ['version'], message: 'Expected version is required' });
  }
});
const BulkActionSchema = z.object({
  action: z.enum(BULK_ACTIONS),
  orderIds: z.array(z.string().trim().min(1)).optional(),
  order_ids: z.array(z.string().trim().min(1)).optional(),
  reason: z.string().trim().max(500).optional(),
}).strict().superRefine((value, ctx) => {
  const ids = value.orderIds ?? value.order_ids;
  if (!ids || ids.length === 0 || ids.length > 10_000) {
    ctx.addIssue({ code: 'custom', path: ['orderIds'], message: 'orderIds must contain 1-10000 ids' });
  }
});

function sendValidationError(res: Parameters<typeof sendError>[0], error: z.ZodError): void {
  sendError(res, 400, `Invalid request: ${error.issues.map((issue) => issue.message).join('; ')}`, 'VALIDATION_ERROR');
}

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
    const parsed = OrderQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    const { limit, offset, status, priority, supplier_id, warehouse, date_from, date_to, min_total, search, sort, order } = parsed.data;
    const filters: OrderFilters = {
      statuses: status?.split(',').map((item) => item.trim()).filter(Boolean) as OrderStatus[] | undefined,
      priority,
      supplierId: supplier_id,
      warehouse,
      dateFrom: date_from,
      dateTo: date_to,
      minTotal: min_total,
      search,
      sort,
      order,
    };
    const pagination = { limit, offset };
    const result = await ordersRepository.list(pagination, filters);
    res.json({ ...result, ...pagination });
  } catch (error) {
    sendError(res, 500, getErrorMessage(error), 'INTERNAL_ERROR');
  }
});

apiRouter.get('/orders/stats', async (_req, res) => {
  try {
    const stats = await cached(makeCacheKey('orders:stats'), () => ordersRepository.getStats());
    res.json(stats);
  } catch (error) {
    sendError(res, 500, getErrorMessage(error), 'INTERNAL_ERROR');
  }
});

apiRouter.get('/orders/anomalies', async (_req, res) => {
  try {
    const result = await cached(makeCacheKey('orders:anomalies'), async () => ({
      data: await ordersRepository.getAnomalies(),
    }));
    res.json(result);
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
    const parsed = PatchOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    const patch: OrderPatch = {};
    if (parsed.data.status !== undefined) patch.status = parsed.data.status;
    if (parsed.data.priority !== undefined) patch.priority = parsed.data.priority;
    const expectedVersion = parsed.data.version ?? parsed.data.expectedVersion ?? parsed.data.expected_version!;

    const before = patch.status ? await ordersRepository.getById(req.params.id) : null;
    const result = await ordersRepository.patch(req.params.id, patch, expectedVersion);
    const updated = result.order;
    if (updated) {
      await invalidateApiCache();
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

    if (result.conflict === 'not_found') {
      sendError(res, 404, 'Order not found', 'ORDER_NOT_FOUND');
      return;
    }

    if (result.conflict === 'cancelled') {
      sendError(res, 409, 'Cancelled orders cannot be updated', 'ORDER_CANCELLED');
      return;
    }

    sendError(res, 409, 'Order version conflict', 'VERSION_CONFLICT');
  } catch (error) {
    sendError(res, 500, getErrorMessage(error), 'INTERNAL_ERROR');
  }
});

async function handleBulkAction(req: Parameters<Parameters<typeof apiRouter.post>[1]>[0], res: Parameters<Parameters<typeof apiRouter.post>[1]>[1]) {
  try {
    const parsed = BulkActionSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    const orderIds = parsed.data.orderIds ?? parsed.data.order_ids!;
    const jobId = await jobsRepository.createBulkJob(orderIds, parsed.data.action, parsed.data.reason);
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
    const performance = await cached(makeCacheKey('suppliers:performance', { id: req.params.id }), () =>
      suppliersRepository.getPerformance(req.params.id),
    );
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
