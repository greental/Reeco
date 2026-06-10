import { createPool } from '../src/backend/db/pool.js';
import { getCategoryAndDescendantIds } from '../src/backend/repositories/categoriesRepository.js';

async function main() {
  const pool = createPool();

  try {
    const root = await getCategoryAndDescendantIds(pool, 'cat_001');
    console.log(`cat_001 descendants including self: ${root.categoryIds.length}`);
    if (root.categoryIds.length <= 1) {
      throw new Error('Expected cat_001 to include at least one child category');
    }

    const cycle = await getCategoryAndDescendantIds(pool, 'cat_150');
    console.log(`cat_150 traversal IDs: ${cycle.categoryIds.join(', ')}`);
    if (!cycle.categoryIds.includes('cat_150')) {
      throw new Error('Expected traversal to include the starting cycle category');
    }
    if (cycle.categoryIds.length > 10) {
      throw new Error('Cycle guard failed: traversal returned too many categories');
    }

    console.log('Category lookup verification passed.');
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
