import type { Queryable } from '../db/query.js';
import { getPool } from '../db/query.js';
import { BaseRepository } from './baseRepository.js';
import { getCategoryAndDescendantIds } from './categoriesRepository.js';
import type { PaginationOptions } from './ordersRepository.js';

export interface ProductRow {
  id: string;
  name: string;
  category_id: string | null;
  sku: string | null;
  price: string;
}

interface CountRow {
  total: string;
}

export class ProductsRepository extends BaseRepository {
  constructor(db: Queryable = getPool()) {
    super(db);
  }

  async list(options: PaginationOptions, categoryId?: string): Promise<{ data: ProductRow[]; total: number }> {
    const dataParams: unknown[] = [options.limit, options.offset];
    const countParams: unknown[] = [];
    let dataWhereClause = '';
    let countWhereClause = '';

    if (categoryId) {
      const { categoryIds } = await getCategoryAndDescendantIds(this.db, categoryId);
      if (categoryIds.length === 0) {
        return { data: [], total: 0 };
      }
      dataParams.push(categoryIds);
      countParams.push(categoryIds);
      dataWhereClause = `WHERE category_id = ANY($${dataParams.length}::text[])`;
      countWhereClause = 'WHERE category_id = ANY($1::text[])';
    }

    const [data, count] = await Promise.all([
      this.rows<ProductRow>(
        `
          SELECT id, name, category_id, sku, price
          FROM products
          ${dataWhereClause}
          ORDER BY id
          LIMIT $1 OFFSET $2
        `,
        dataParams,
      ),
      this.one<CountRow>(`SELECT COUNT(*) AS total FROM products ${countWhereClause}`, countParams),
    ]);

    return { data, total: Number(count?.total ?? 0) };
  }
}