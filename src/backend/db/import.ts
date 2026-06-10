import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse';
import type { DbClient } from './pool.js';
import { createPool } from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../..');
const dataDir = path.join(rootDir, 'data');

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

const EXPECTED_COUNTS = {
  suppliers: 500,
  categories: 195,
  products: 5000,
  orders: 50000,
} as const;

function emptyToNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

function parseBoolean(value: string): boolean {
  return value.trim().toLowerCase() === 'true';
}

async function readCsv<T>(fileName: string): Promise<T[]> {
  const rows: T[] = [];
  const filePath = path.join(dataDir, fileName);

  await new Promise<void>((resolve, reject) => {
    createReadStream(filePath)
      .pipe(
        parse({
          bom: true,
          columns: true,
          skip_empty_lines: true,
          relax_quotes: true,
        }),
      )
      .on('data', (row: Record<string, string>) => rows.push(row as T))
      .on('error', reject)
      .on('end', resolve);
  });

  return rows;
}

async function resetTables(client: DbClient): Promise<void> {
  await client.query('TRUNCATE job_items, jobs, orders, products, categories, suppliers RESTART IDENTITY CASCADE');
}

async function importSuppliers(client: DbClient, rows: SupplierRow[]): Promise<void> {
  const sql = `
    INSERT INTO suppliers (id, name, email, rating, country, active, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `;

  for (const row of rows) {
    await client.query(sql, [
      row.id,
      row.name,
      emptyToNull(row.email),
      emptyToNull(row.rating),
      emptyToNull(row.country),
      parseBoolean(row.active),
      row.created_at,
    ]);
  }
}

async function importCategories(client: DbClient, rows: CategoryRow[]): Promise<void> {
  for (const row of rows) {
    await client.query('INSERT INTO categories (id, name, parent_id) VALUES ($1, $2, NULL)', [row.id, row.name]);
  }

  const knownIds = new Set(rows.map((row) => row.id));
  for (const row of rows) {
    const parentId = emptyToNull(row.parent_id);
    if (parentId && knownIds.has(parentId)) {
      await client.query('UPDATE categories SET parent_id = $1 WHERE id = $2', [parentId, row.id]);
    }
  }
}

async function importProducts(client: DbClient, rows: ProductRow[]): Promise<void> {
  const sql = `
    INSERT INTO products (id, name, category_id, sku, price)
    VALUES ($1, $2, $3, $4, $5)
  `;

  for (const row of rows) {
    await client.query(sql, [row.id, row.name, emptyToNull(row.category_id), emptyToNull(row.sku), row.price]);
  }
}

async function importOrders(client: DbClient, rows: OrderRow[]): Promise<void> {
  const sql = `
    INSERT INTO orders (
      id, supplier_id, product_id, quantity, unit_price, total_price,
      status, priority, created_at, updated_at, warehouse, notes
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  `;

  for (const row of rows) {
    await client.query(sql, [
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
    ]);
  }
}

async function countRows(client: DbClient, table: keyof typeof EXPECTED_COUNTS): Promise<number> {
  const result = await client.query<{ count: string }>(`SELECT COUNT(*) AS count FROM ${table}`);
  return Number(result.rows[0]?.count ?? 0);
}

async function validateCounts(client: DbClient): Promise<void> {
  for (const [table, expected] of Object.entries(EXPECTED_COUNTS) as Array<[keyof typeof EXPECTED_COUNTS, number]>) {
    const actual = await countRows(client, table);
    if (actual !== expected) {
      throw new Error(`Import count mismatch for ${table}: expected ${expected}, got ${actual}`);
    }
    console.log(`${table}: ${actual}`);
  }
}

export async function importData(): Promise<void> {
  const pool = createPool();
  const client = await pool.connect();

  try {
    const [suppliers, categories, products, orders] = await Promise.all([
      readCsv<SupplierRow>('suppliers.csv'),
      readCsv<CategoryRow>('categories.csv'),
      readCsv<ProductRow>('products.csv'),
      readCsv<OrderRow>('orders.csv'),
    ]);

    console.log('CSV rows loaded:', {
      suppliers: suppliers.length,
      categories: categories.length,
      products: products.length,
      orders: orders.length,
    });

    await client.query('BEGIN');
    await resetTables(client);
    await importSuppliers(client, suppliers);
    await importCategories(client, categories);
    await importProducts(client, products);
    await importOrders(client, orders);
    await validateCounts(client);
    await client.query('COMMIT');

    console.log('CSV import complete.');
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
