import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse';

import type { DbClient } from './pool.js';
import { createPool } from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../..');
const dataDir = path.join(rootDir, 'data');

const DEFAULT_BATCH_SIZE = 1000;

type SqlValue = string | number | boolean | null;
type TableName = 'suppliers' | 'categories' | 'products' | 'orders';

interface SupplierRow {
  id: string;
  name: string;
  email: string;
  rating: string;
  country: string;
  active: string;
  created_at: string;
}

interface CategoryRow {
  id: string;
  name: string;
  parent_id: string;
}

interface ProductRow {
  id: string;
  name: string;
  category_id: string;
  sku: string;
  price: string;
}

interface OrderRow {
  id: string;
  supplier_id: string;
  product_id: string;
  quantity: string;
  unit_price: string;
  total_price: string;
  status: string;
  priority: string;
  created_at: string;
  updated_at: string;
  warehouse: string;
  notes: string;
}

interface ImportCounts {
  suppliers: number;
  categories: number;
  products: number;
  orders: number;
}

function emptyToNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

function parseBoolean(value: string): boolean {
  return value.trim().toLowerCase() === 'true';
}

async function streamCsv<T extends object>(
  fileName: string,
  onRow: (row: T) => Promise<void>,
): Promise<number> {
  const filePath = path.join(dataDir, fileName);

  const parser = createReadStream(filePath).pipe(
    parse({
      bom: true,
      columns: true,
      skip_empty_lines: true,
      relax_quotes: true,
    }),
  );

  let count = 0;

  for await (const row of parser as AsyncIterable<T>) {
    count += 1;
    await onRow(row);
  }

  return count;
}

async function resetTables(client: DbClient): Promise<void> {
  await client.query(
    'TRUNCATE job_items, jobs, orders, products, categories, suppliers RESTART IDENTITY CASCADE',
  );
}

async function bulkInsert(
  client: DbClient,
  tableName: TableName,
  columns: string[],
  rows: SqlValue[][],
): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const values: SqlValue[] = [];
  let paramIndex = 1;

  const rowPlaceholders = rows.map((row) => {
    const placeholders = row.map(() => `$${paramIndex++}`);
    values.push(...row);
    return `(${placeholders.join(', ')})`;
  });

  const sql = `
    INSERT INTO ${tableName} (${columns.join(', ')})
    VALUES ${rowPlaceholders.join(', ')}
  `;

  await client.query(sql, values);
}

async function importCsvInBatches<T extends object>(
  client: DbClient,
  fileName: string,
  tableName: TableName,
  columns: string[],
  mapRow: (row: T) => SqlValue[],
  batchSize = DEFAULT_BATCH_SIZE,
): Promise<number> {
  let batch: SqlValue[][] = [];

  const count = await streamCsv<T>(fileName, async (row) => {
    batch.push(mapRow(row));

    if (batch.length >= batchSize) {
      await bulkInsert(client, tableName, columns, batch);
      batch = [];
    }
  });

  if (batch.length > 0) {
    await bulkInsert(client, tableName, columns, batch);
  }

  return count;
}

async function importSuppliers(client: DbClient): Promise<number> {
  return importCsvInBatches<SupplierRow>(
    client,
    'suppliers.csv',
    'suppliers',
    ['id', 'name', 'email', 'rating', 'country', 'active', 'created_at'],
    (row) => [
      row.id,
      row.name,
      emptyToNull(row.email),
      emptyToNull(row.rating),
      emptyToNull(row.country),
      parseBoolean(row.active),
      row.created_at,
    ],
  );
}

async function importCategories(client: DbClient): Promise<number> {
  const knownIds = new Set<string>();
  const parentUpdates: Array<{ id: string; parentId: string }> = [];
  let batch: SqlValue[][] = [];

  const count = await streamCsv<CategoryRow>('categories.csv', async (row) => {
    knownIds.add(row.id);

    const parentId = emptyToNull(row.parent_id);
    if (parentId) {
      parentUpdates.push({ id: row.id, parentId });
    }

    batch.push([row.id, row.name, null]);

    if (batch.length >= DEFAULT_BATCH_SIZE) {
      await bulkInsert(client, 'categories', ['id', 'name', 'parent_id'], batch);
      batch = [];
    }
  });

  if (batch.length > 0) {
    await bulkInsert(client, 'categories', ['id', 'name', 'parent_id'], batch);
  }

  const validParentUpdates = parentUpdates.filter(({ parentId }) => knownIds.has(parentId));
  await updateCategoryParents(client, validParentUpdates);

  return count;
}

async function updateCategoryParents(
  client: DbClient,
  updates: Array<{ id: string; parentId: string }>,
  batchSize = DEFAULT_BATCH_SIZE,
): Promise<void> {
  for (let offset = 0; offset < updates.length; offset += batchSize) {
    const chunk = updates.slice(offset, offset + batchSize);

    if (chunk.length === 0) {
      continue;
    }

    const values: SqlValue[] = [];
    let paramIndex = 1;

    const rowsSql = chunk.map((update) => {
      values.push(update.id, update.parentId);
      return `($${paramIndex++}, $${paramIndex++})`;
    });

    const sql = `
      UPDATE categories AS c
      SET parent_id = v.parent_id
      FROM (VALUES ${rowsSql.join(', ')}) AS v(id, parent_id)
      WHERE c.id = v.id
    `;

    await client.query(sql, values);
  }
}

async function importProducts(client: DbClient): Promise<number> {
  return importCsvInBatches<ProductRow>(
    client,
    'products.csv',
    'products',
    ['id', 'name', 'category_id', 'sku', 'price'],
    (row) => [
      row.id,
      row.name,
      emptyToNull(row.category_id),
      emptyToNull(row.sku),
      row.price,
    ],
  );
}

async function importOrders(client: DbClient): Promise<number> {
  return importCsvInBatches<OrderRow>(
    client,
    'orders.csv',
    'orders',
    [
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
      'notes',
    ],
    (row) => [
      row.id,
      row.supplier_id,
      row.product_id,
      Number(row.quantity),
      row.unit_price,
      row.total_price,
      row.status,
      row.priority,
      row.created_at,
      row.updated_at,
      emptyToNull(row.warehouse),
      row.notes,
    ],
  );
}

async function countRows(client: DbClient, table: TableName): Promise<number> {
  const result = await client.query<{ count: string }>(`SELECT COUNT(*) AS count FROM ${table}`);
  return Number(result.rows[0]?.count ?? 0);
}

async function validateCounts(client: DbClient, expectedCounts: ImportCounts): Promise<void> {
  for (const [table, expected] of Object.entries(expectedCounts) as Array<
    [TableName, number]
  >) {
    const actual = await countRows(client, table);

    if (actual !== expected) {
      throw new Error(`Import count mismatch for ${table}: expected ${expected}, got ${actual}`);
    }

    console.log(`${table}: ${actual}`);
  }
}

export async function importData(): Promise<void> {
  const importStartedAt = Date.now();

  const pool = createPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await resetTables(client);

    const counts: ImportCounts = {
      suppliers: await importSuppliers(client),
      categories: await importCategories(client),
      products: await importProducts(client),
      orders: await importOrders(client),
    };

    console.log('CSV rows loaded:', counts);

    await validateCounts(client, counts);

    await client.query('COMMIT');

    

    console.log('CSV import complete.');
    const importFinishedAt = Date.now();
    console.log(
      `import duration=${((importFinishedAt - importStartedAt) / 1000).toFixed(2)}s`,
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1]?.endsWith('import.ts') || process.argv[1]?.endsWith('import.js')) {
  importData().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}