import type { DbPool } from '../db/pool.js';

export interface CategoryDescendantResult {
  categoryIds: string[];
  hasCycle: boolean;
}

export async function getCategoryAndDescendantIds(
  pool: DbPool,
  categoryId: string,
): Promise<CategoryDescendantResult> {
  const result = await pool.query<{ id: string; cycle: boolean }>(
    `
      WITH RECURSIVE descendants(id, path, cycle) AS (
        SELECT id, ARRAY[id], false
        FROM categories
        WHERE id = $1

        UNION ALL

        SELECT child.id, descendants.path || child.id, child.id = ANY(descendants.path)
        FROM categories child
        JOIN descendants ON child.parent_id = descendants.id
        WHERE NOT descendants.cycle
      )
      SELECT DISTINCT id, bool_or(cycle) AS cycle
      FROM descendants
      GROUP BY id
      ORDER BY id
    `,
    [categoryId],
  );

  return {
    categoryIds: result.rows.map((row) => row.id),
    hasCycle: result.rows.some((row) => row.cycle),
  };
}
