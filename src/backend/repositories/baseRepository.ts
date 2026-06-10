import type pg from 'pg';
import { getPool, type QueryParams, type Queryable } from '../db/query.js';

export abstract class BaseRepository {
  protected readonly db: Queryable;

  protected constructor(db: Queryable = getPool()) {
    this.db = db;
  }

  protected async rows<T extends pg.QueryResultRow>(sql: string, params: QueryParams = []): Promise<T[]> {
    const result = await this.db.query<T>(sql, params as unknown[]);
    return result.rows;
  }

  protected async one<T extends pg.QueryResultRow>(sql: string, params: QueryParams = []): Promise<T | null> {
    const rows = await this.rows<T>(sql, params);
    return rows[0] ?? null;
  }
}
