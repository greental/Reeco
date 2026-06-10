import type { Queryable } from '../db/query.js';
import { BaseRepository } from './baseRepository.js';

export const ORDER_STATUSES = ['pending', 'approved', 'rejected', 'shipped', 'delivered', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export type OrderPriority = (typeof ORDER_PRIORITIES)[number];

export interface PaginationOptions {
  limit: number;
  offset: number;
}

export interface OrderFilters {
  statuses?: OrderStatus[];
  priority?: OrderPriority;
  supplierId?: string;
  warehouse?: string;
  dateFrom?: string;
  dateTo?: string;
  minTotal?: number;
  search?: string;
  sort: OrderSortField;
  order: SortDirection;
}

export type OrderSortField =
  | 'id'
  | 'supplier_id'
  | 'product_id'
  | 'quantity'
  | 'unit_price'
  | 'total_price'
  | 'status'
  | 'priority'
  | 'created_at'
  | 'updated_at'
  | 'warehouse';

export type SortDirection = 'asc' | 'desc';

export interface OrderListRow {
  id: string;
  supplier_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  status: OrderStatus;
  priority: OrderPriority;
  created_at: Date;
  updated_at: Date;
  warehouse: string | null;
  notes: string | null;
  version: number;
}

export interface OrderDetailRow extends OrderListRow {
  supplier_name: string;
  product_name: string;
}

interface CountRow {
  total: string;
}

export interface OrderPatch {
  status?: OrderStatus;
  priority?: OrderPriority;
}

export const ORDER_SORT_COLUMNS: Record<OrderSortField, string> = {
  id: 'o.id',
  supplier_id: 'o.supplier_id',
  product_id: 'o.product_id',
  quantity: 'o.quantity',
  unit_price: 'o.unit_price',
  total_price: 'o.total_price',
  status: 'o.status',
  priority: 'o.priority',
  created_at: 'o.created_at',
  updated_at: 'o.updated_at',
  warehouse: 'o.warehouse',
};

export class OrdersRepository extends BaseRepository {
  constructor(db?: Queryable) {
    super(db);
  }

  async list(options: PaginationOptions, filters: OrderFilters): Promise<{ data: OrderDetailRow[]; total: number }> {
    const params: unknown[] = [];
    const where: string[] = [];

    if (filters.statuses && filters.statuses.length > 0) {
      params.push(filters.statuses);
      where.push(`o.status = ANY($${params.length}::text[])`);
    }

    if (filters.priority) {
      params.push(filters.priority);
      where.push(`o.priority = $${params.length}`);
    }

    if (filters.supplierId) {
      params.push(filters.supplierId);
      where.push(`o.supplier_id = $${params.length}`);
    }

    if (filters.warehouse) {
      params.push(filters.warehouse);
      where.push(`o.warehouse = $${params.length}`);
    }

    if (filters.dateFrom) {
      params.push(filters.dateFrom);
      where.push(`o.created_at >= $${params.length}::timestamptz`);
    }

    if (filters.dateTo) {
      params.push(filters.dateTo);
      where.push(`o.created_at <= $${params.length}::timestamptz`);
    }

    if (filters.minTotal !== undefined) {
      params.push(filters.minTotal);
      where.push(`o.total_price >= $${params.length}`);
    }

    if (filters.search) {
      params.push(`%${filters.search.toLowerCase()}%`);
      where.push(`LOWER(p.name) LIKE $${params.length}`);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const sortColumn = ORDER_SORT_COLUMNS[filters.sort];
    const sortDirection = filters.order.toUpperCase();

    const dataParams = [...params, options.limit, options.offset];
    const limitParam = dataParams.length - 1;
    const offsetParam = dataParams.length;

    const [data, count] = await Promise.all([
      this.rows<OrderDetailRow>(
        `
          SELECT o.id, o.supplier_id, o.product_id, o.quantity,
                 o.unit_price::float AS unit_price,
                 o.total_price::float AS total_price,
                 o.status, o.priority, o.created_at, o.updated_at, o.warehouse, o.notes, o.version,
                 s.name AS supplier_name,
                 p.name AS product_name
          FROM orders o
          JOIN suppliers s ON s.id = o.supplier_id
          JOIN products p ON p.id = o.product_id
          ${whereClause}
          ORDER BY ${sortColumn} ${sortDirection}, o.id ASC
          LIMIT $${limitParam} OFFSET $${offsetParam}
        `,
        dataParams,
      ),
      this.one<CountRow>(
        `
          SELECT COUNT(*) AS total
          FROM orders o
          JOIN products p ON p.id = o.product_id
          ${whereClause}
        `,
        params,
      ),
    ]);

    return { data, total: Number(count?.total ?? 0) };
  }

  async getById(id: string): Promise<OrderDetailRow | null> {
    return this.one<OrderDetailRow>(
      `
        SELECT o.id, o.supplier_id, o.product_id, o.quantity, o.unit_price, o.total_price,
               o.status, o.priority, o.created_at, o.updated_at, o.warehouse, o.notes, o.version,
               s.name AS supplier_name,
               p.name AS product_name
        FROM orders o
        JOIN suppliers s ON s.id = o.supplier_id
        JOIN products p ON p.id = o.product_id
        WHERE o.id = $1
      `,
      [id],
    );
  }

  async getStatus(id: string): Promise<{ status: OrderStatus } | null> {
    return this.one<{ status: OrderStatus }>('SELECT status FROM orders WHERE id = $1', [id]);
  }

  async patch(id: string, patch: OrderPatch): Promise<OrderDetailRow | null> {
    const assignments: string[] = [];
    const params: unknown[] = [];

    if (patch.status !== undefined) {
      params.push(patch.status);
      assignments.push(`status = $${params.length}`);
    }

    if (patch.priority !== undefined) {
      params.push(patch.priority);
      assignments.push(`priority = $${params.length}`);
    }

    if (assignments.length === 0) {
      return this.getById(id);
    }

    params.push(id);
    const idParam = params.length;

    return this.one<OrderDetailRow>(
      `
        WITH updated AS (
          UPDATE orders
          SET ${assignments.join(', ')}, updated_at = now(), version = version + 1
          WHERE id = $${idParam} AND status <> 'cancelled'
          RETURNING id, supplier_id, product_id, quantity, unit_price, total_price,
                    status, priority, created_at, updated_at, warehouse, notes, version
        )
        SELECT u.*, s.name AS supplier_name, p.name AS product_name
        FROM updated u
        JOIN suppliers s ON s.id = u.supplier_id
        JOIN products p ON p.id = u.product_id
      `,
      params,
    );
  }
}