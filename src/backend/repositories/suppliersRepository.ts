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
}