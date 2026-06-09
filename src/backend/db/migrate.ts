import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool } from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, 'migrations');

async function ensureMigrationTable(pool: ReturnType<typeof createPool>): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function appliedMigrations(pool: ReturnType<typeof createPool>): Promise<Set<string>> {
  const result = await pool.query<{ name: string }>('SELECT name FROM schema_migrations');
  return new Set(result.rows.map((row) => row.name));
}

export async function runMigrations(): Promise<void> {
  const pool = createPool();

  try {
    await ensureMigrationTable(pool);
    const applied = await appliedMigrations(pool);
    const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`Skipping migration ${file}`);
        continue;
      }

      const sql = await readFile(path.join(migrationsDir, file), 'utf-8');
      console.log(`Applying migration ${file}`);
      await pool.query(sql);
      await pool.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    }

    console.log('Database migrations complete.');
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js')) {
  runMigrations().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
