import pg from 'pg';
import { loadConfig } from '../config/env.js';

const { Pool } = pg;

export function createPool() {
  const config = loadConfig();
  return new Pool({ connectionString: config.database.url });
}

export type DbPool = pg.Pool;
export type DbClient = pg.PoolClient;
