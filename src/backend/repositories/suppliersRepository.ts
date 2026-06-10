import type { Queryable } from '../db/query.js';
import { BaseRepository } from './baseRepository.js';
import type { PaginationOptions } from './ordersRepository.js';

export interface SupplierRow {
  id: string;
  name: string;
  email: string | null;
  rating: string | null;
  country: string | null;
  active: boolean;
  created_at: Date;
}

export interface SupplierDetailRow extends SupplierRow {
  order_count: string;
  total_revenue: string;
}

interface CountRow {
  total: string;
}

interface SupplierExistsRow {
  id: string;
}

interface SupplierPerformanceSummaryRow {
  avg_delivery_days: string | null;
  rejection_rate: string | null;
  avg_order_value: string | null;
  price_consistency: string | null;
}

interface SupplierMonthlyTrendRow {
  month: string;
  order_count: string;
}

export interface SupplierPerformance {
  avg_delivery_days: number;
  rejection_rate: number;
  avg_order_value: number;
  monthly_trend: Array<{ month: string; order_count: number }>;
  price_consistency: number;
}

export class SuppliersRepository extends BaseRepository {
  constructor(db?: Queryable) {
    super(db);
  }

  async list(options: PaginationOptions): Promise<{ data: SupplierRow[]; total: number }> {
    const [data, count] = await Promise.all([
      this.rows<SupplierRow>(
        `
          SELECT id, name, email, rating, country, active, created_at
          FROM suppliers
          ORDER BY id
          LIMIT $1 OFFSET $2
        `,
        [options.limit, options.offset],
      ),
      this.one<CountRow>('SELECT COUNT(*) AS total FROM suppliers'),
    ]);

    return { data, total: Number(count?.total ?? 0) };
  }

  async getById(id: string): Promise<SupplierDetailRow | null> {
    return this.one<SupplierDetailRow>(
      `
        SELECT s.id, s.name, s.email, s.rating, s.country, s.active, s.created_at,
               COUNT(o.id)::text AS order_count,
               COALESCE(SUM(o.total_price), 0)::text AS total_revenue
        FROM suppliers s
        LEFT JOIN orders o ON o.supplier_id = s.id
        WHERE s.id = $1
        GROUP BY s.id
      `,
      [id],
    );
  }

  async getPerformance(id: string): Promise<SupplierPerformance | null> {
    const exists = await this.one<SupplierExistsRow>('SELECT id FROM suppliers WHERE id = $1', [id]);
    if (!exists) {
      return null;
    }

    const [summary, monthlyTrend] = await Promise.all([
      this.one<SupplierPerformanceSummaryRow>(
        `
          SELECT AVG(EXTRACT(EPOCH FROM (o.updated_at - o.created_at)) / 86400)
                   FILTER (WHERE o.status = 'delivered') AS avg_delivery_days,
                 COUNT(*) FILTER (WHERE o.status = 'rejected')::float / NULLIF(COUNT(*), 0) AS rejection_rate,
                 AVG(o.total_price) AS avg_order_value,
                 COUNT(*) FILTER (
                   WHERE p.price <> 0
                     AND ABS(o.unit_price - p.price) / p.price <= 0.2
                 )::float / NULLIF(COUNT(*), 0) AS price_consistency
          FROM orders o
          JOIN products p ON p.id = o.product_id
          WHERE o.supplier_id = $1
        `,
        [id],
      ),
      this.rows<SupplierMonthlyTrendRow>(
        `
          SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month,
                 COUNT(*) AS order_count
          FROM orders
          WHERE supplier_id = $1
          GROUP BY date_trunc('month', created_at)
          ORDER BY date_trunc('month', created_at)
        `,
        [id],
      ),
    ]);

    return {
      avg_delivery_days: Number(summary?.avg_delivery_days ?? 0),
      rejection_rate: Number(summary?.rejection_rate ?? 0),
      avg_order_value: Number(summary?.avg_order_value ?? 0),
      monthly_trend: monthlyTrend.map((row) => ({ month: row.month, order_count: Number(row.order_count) })),
      price_consistency: Number(summary?.price_consistency ?? 0),
    };
  }
}