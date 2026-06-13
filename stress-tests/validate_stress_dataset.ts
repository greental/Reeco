import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { query, closePool } from '../src/backend/db/query.js';

type TableName = 'suppliers' | 'categories' | 'products' | 'orders';

interface ManifestFileCounts {
  source_rows: number;
  expected_inserted: number;
  expected_skipped: number;
}

interface StressManifest {
  files: Record<TableName, ManifestFileCounts>;
}

const DATA_DIR = process.env.DATA_DIR ?? 'data_stress';
const manifestPath = path.resolve(process.cwd(), DATA_DIR, 'manifest.json');
const tables: TableName[] = ['suppliers', 'categories', 'products', 'orders'];

async function readManifest(): Promise<StressManifest> {
  const raw = await readFile(manifestPath, 'utf-8');
  return JSON.parse(raw) as StressManifest;
}

async function countRows(table: TableName): Promise<number> {
  const rows = await query<{ count: string }>(`SELECT COUNT(*) AS count FROM ${table}`);
  return Number(rows[0]?.count ?? 0);
}

describe('stress dataset validation', () => {
  it('matches imported table counts to manifest expectations', async () => {
    try {
      const manifest = await readManifest();
      const rows: Array<{ table: TableName; expected: number; actual: number; skipped: number }> = [];

      for (const table of tables) {
        const actual = await countRows(table);
        const expected = manifest.files[table]?.expected_inserted;
        const skipped = manifest.files[table]?.expected_skipped;
        rows.push({ table, expected, actual, skipped });
        expect(actual, `${table} imported row count`).toBe(expected);
      }

      console.log(`\nStress dataset validation using ${manifestPath}`);
      console.table(rows);
    } finally {
      await closePool();
    }
  });
});