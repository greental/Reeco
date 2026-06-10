import { randomUUID } from 'node:crypto';
import { getPool, type Queryable } from '../db/query.js';
import { publishEvent } from '../realtime/events.js';
import { BaseRepository } from './baseRepository.js';

export const BULK_ACTIONS = ['approve', 'reject', 'flag'] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];

export interface BulkJob {
  id: string;
  status: 'processing' | 'completed' | 'failed';
  action: BulkAction;
  total: number;
  completed: number;
  failed: number;
}

interface JobRow {
  id: string;
  status: 'processing' | 'completed' | 'failed';
  action: BulkAction;
  total: number;
  completed: number;
  failed: number;
}

const ACTION_TO_STATUS: Record<BulkAction, string | null> = {
  approve: 'approved',
  reject: 'rejected',
  flag: null,
};

export class JobsRepository extends BaseRepository {
  constructor(db: Queryable = getPool()) {
    super(db);
  }

  async createBulkJob(orderIds: string[], action: BulkAction, reason?: string): Promise<string> {
    const jobId = `job_${randomUUID()}`;
    const uniqueOrderIds = [...new Set(orderIds)];

    await this.db.query('BEGIN');
    try {
      await this.db.query(
        `
          INSERT INTO jobs (id, status, action, reason, total, completed, failed)
          VALUES ($1, 'processing', $2, $3, $4, 0, 0)
        `,
        [jobId, action, reason ?? null, uniqueOrderIds.length],
      );

      await this.db.query(
        `
          INSERT INTO job_items (job_id, order_id, status)
          SELECT $1, unnest($2::text[]), 'pending'
          ON CONFLICT (job_id, order_id) DO NOTHING
        `,
        [jobId, uniqueOrderIds],
      );

      await this.db.query('COMMIT');
    } catch (error) {
      await this.db.query('ROLLBACK');
      throw error;
    }

    setImmediate(() => {
      this.processBulkJob(jobId, action).catch((error: unknown) => {
        console.error('Bulk job failed', jobId, error);
      });
    });

    return jobId;
  }

  async getJob(id: string): Promise<BulkJob | null> {
    const row = await this.one<JobRow>(
      `
        SELECT id, status, action, total, completed, failed
        FROM jobs
        WHERE id = $1
      `,
      [id],
    );

    return row
      ? {
          id: row.id,
          status: row.status,
          action: row.action,
          total: Number(row.total),
          completed: Number(row.completed),
          failed: Number(row.failed),
        }
      : null;
  }

  private async processBulkJob(jobId: string, action: BulkAction): Promise<void> {
    const targetStatus = ACTION_TO_STATUS[action];
    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const itemResult = await client.query<{ order_id: string }>(
        `
          SELECT order_id
          FROM job_items
          WHERE job_id = $1 AND status = 'pending'
          ORDER BY id
          FOR UPDATE SKIP LOCKED
        `,
        [jobId],
      );
      const orderIds = itemResult.rows.map((row) => row.order_id);

      if (orderIds.length === 0) {
        await client.query(
          `UPDATE jobs SET status = 'completed', updated_at = now(), completed_at = now() WHERE id = $1`,
          [jobId],
        );
        await client.query('COMMIT');
        return;
      }

      let completedIds: string[] = [];
      if (targetStatus) {
        const updated = await client.query<{ id: string }>(
          `
            UPDATE orders
            SET status = $2, updated_at = now(), version = version + 1
            WHERE id = ANY($1::text[]) AND status <> 'cancelled'
            RETURNING id
          `,
          [orderIds, targetStatus],
        );
        completedIds = updated.rows.map((row) => row.id);
      } else {
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM orders WHERE id = ANY($1::text[]) AND status <> 'cancelled'`,
          [orderIds],
        );
        completedIds = existing.rows.map((row) => row.id);
      }

      const completedSet = new Set(completedIds);
      const failedIds = orderIds.filter((id) => !completedSet.has(id));

      if (completedIds.length > 0) {
        await client.query(
          `UPDATE job_items SET status = 'completed', updated_at = now() WHERE job_id = $1 AND order_id = ANY($2::text[])`,
          [jobId, completedIds],
        );
      }

      if (failedIds.length > 0) {
        await client.query(
          `
            UPDATE job_items
            SET status = 'failed', error = 'Order not found or cancelled', updated_at = now()
            WHERE job_id = $1 AND order_id = ANY($2::text[])
          `,
          [jobId, failedIds],
        );
      }

      const finalStatus = completedIds.length > 0 ? 'completed' : 'failed';
      await client.query(
        `
          UPDATE jobs
          SET status = $2,
              completed = $3,
              failed = $4,
              updated_at = now(),
              completed_at = now()
          WHERE id = $1
        `,
        [jobId, finalStatus, completedIds.length, failedIds.length],
      );

      await client.query('COMMIT');

      publishEvent({ type: 'bulk_completed', data: { jobId } });
    } catch (error) {
      await client.query('ROLLBACK');
      await pool.query(`UPDATE jobs SET status = 'failed', updated_at = now(), completed_at = now() WHERE id = $1`, [jobId]);
      throw error;
    } finally {
      client.release();
    }
  }
}