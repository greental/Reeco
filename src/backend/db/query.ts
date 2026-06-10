import type pg from 'pg';
import { createPool, type DbClient, type DbPool } from './pool.js';

export type QueryParams = readonly unknown[];
export type Queryable = Pick<DbPool | DbClient, 'query'>;

const sharedPool = createPool();

export function getPool(): DbPool {
  return sharedPool;
}

export async function query<T extends pg.QueryResultRow>(
  text: string,
  params: QueryParams = [],
): Promise<T[]> {
  const result = await sharedPool.query<T>(text, params as unknown[]);
  return result.rows;
}

export async function queryOne<T extends pg.QueryResultRow>(
  text: string,
  params: QueryParams = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function transaction<T>(work: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await sharedPool.connect();

  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await sharedPool.end();
}
