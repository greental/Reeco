import { randomUUID } from 'node:crypto';
import { invalidateApiCache } from '../cache/responseCache.js';
import { getPool, type Queryable } from '../db/query.js';
import { publishEvent } from '../realtime/events.js';
import { BaseRepository } from './baseRepository.js';

export const BULK_ACTIONS = ['approve', 'reject', 'flag'] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];
export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface BulkJob {
  id: string;
  status: JobStatus;
  action: BulkAction;
  total: number;
  completed: number;
  failed: number;
}

interface JobRow {
  id: string;
  status: JobStatus;
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

const CHUNK_SIZE = 500;

export class JobsRepository extends BaseRepository {
  private workerRunning = false;

  constructor(db: Queryable = getPool()) {
    super(db);
  }

  async createBulkJob(orderIds: string[], action: BulkAction, reason?: string): Promise<string> {
    const jobId = `job_${randomUUID()}`;
    const uniqueOrderIds = [...new Set(orderIds)];
    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO jobs (id, status, action, reason, total, completed, failed)
         VALUES ($1, 'queued', $2, $3, $4, 0, 0)`,
        [jobId, action, reason ?? null, uniqueOrderIds.length],
      );
      await client.query(
        `INSERT INTO job_items (job_id, order_id, status)
         SELECT $1, unnest($2::text[]), 'pending'
         ON CONFLICT (job_id, order_id) DO NOTHING`,
        [jobId, uniqueOrderIds],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    this.kickWorker();
    return jobId;
  }

  async getJob(id: string): Promise<BulkJob | null> {
    const row = await this.one<JobRow>(
      `SELECT id, status, action, total, completed, failed FROM jobs WHERE id = $1`,
      [id],
    );
    return row
      ? { id: row.id, status: row.status, action: row.action, total: Number(row.total), completed: Number(row.completed), failed: Number(row.failed) }
      : null;
  }

  async recoverStaleJobs(staleAfterMinutes = 10): Promise<number> {
    const result = await getPool().query(
      `UPDATE jobs
       SET status = 'queued', updated_at = now()
       WHERE status = 'processing'
         AND updated_at < now() - ($1::text || ' minutes')::interval`,
      [staleAfterMinutes],
    );
    if ((result.rowCount ?? 0) > 0) this.kickWorker();
    return result.rowCount ?? 0;
  }

  kickWorker(): void {
    if (this.workerRunning) return;
    this.workerRunning = true;
    setImmediate(() => {
      this.processQueuedJobs()
        .catch((error: unknown) => console.error('Bulk job worker failed', error))
        .finally(() => {
          this.workerRunning = false;
        });
    });
  }

  private async claimNextJob(): Promise<{ id: string; action: BulkAction } | null> {
    return this.one<{ id: string; action: BulkAction }>(
      `UPDATE jobs
       SET status = 'processing', updated_at = now()
       WHERE id = (
         SELECT id FROM jobs
         WHERE status = 'queued'
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       RETURNING id, action`,
    );
  }

  private async processQueuedJobs(): Promise<void> {
    for (;;) {
      const job = await this.claimNextJob();
      if (!job) return;
      await this.processBulkJob(job.id, job.action);
    }
  }

  private async processBulkJob(jobId: string, action: BulkAction): Promise<void> {
    let changedOrders = false;
    try {
      for (;;) {
        const processed = await this.processBulkJobChunk(jobId, action);
        changedOrders ||= processed.changedOrders;
        if (processed.pendingCount === 0) {
          await this.finishJob(jobId);
          break;
        }
      }
      if (changedOrders) await invalidateApiCache();
      publishEvent({ type: 'bulk_completed', data: { jobId } });
    } catch (error) {
      await getPool().query(`UPDATE jobs SET status = 'failed', updated_at = now(), completed_at = now() WHERE id = $1`, [jobId]);
      throw error;
    }
  }

  private async processBulkJobChunk(jobId: string, action: BulkAction): Promise<{ pendingCount: number; changedOrders: boolean }> {
    const targetStatus = ACTION_TO_STATUS[action];
    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const itemResult = await client.query<{ order_id: string }>(
        `SELECT order_id
         FROM job_items
         WHERE job_id = $1 AND status = 'pending'
         ORDER BY id
         LIMIT $2
         FOR UPDATE SKIP LOCKED`,
        [jobId, CHUNK_SIZE],
      );
      const orderIds = itemResult.rows.map((row) => row.order_id);
      if (orderIds.length === 0) {
        await client.query('COMMIT');
        return { pendingCount: 0, changedOrders: false };
      }

      let completedIds: string[] = [];
      if (targetStatus) {
        const updated = await client.query<{ id: string }>(
          `UPDATE orders
           SET status = $2, updated_at = now(), version = version + 1
           WHERE id = ANY($1::text[]) AND status <> 'cancelled'
           RETURNING id`,
          [orderIds, targetStatus],
        );
        completedIds = updated.rows.map((row) => row.id);
      } else {
        const updated = await client.query<{ id: string }>(
          `UPDATE orders
           SET flagged = true, updated_at = now(), version = version + 1
           WHERE id = ANY($1::text[]) AND status <> 'cancelled'
           RETURNING id`,
          [orderIds],
        );
        completedIds = updated.rows.map((row) => row.id);
      }

      const completedSet = new Set(completedIds);
      const failedIds = orderIds.filter((id) => !completedSet.has(id));
      if (completedIds.length > 0) {
        await client.query(`UPDATE job_items SET status = 'completed', updated_at = now() WHERE job_id = $1 AND order_id = ANY($2::text[])`, [jobId, completedIds]);
      }
      if (failedIds.length > 0) {
        await client.query(
          `UPDATE job_items
           SET status = 'failed', error = 'Order not found or cancelled', updated_at = now()
           WHERE job_id = $1 AND order_id = ANY($2::text[])`,
          [jobId, failedIds],
        );
      }
      await this.refreshJobProgress(jobId, client);
      await client.query('COMMIT');
      return { pendingCount: orderIds.length, changedOrders: completedIds.length > 0 };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async refreshJobProgress(jobId: string, db: Queryable = getPool()): Promise<void> {
    await db.query(
      `UPDATE jobs
       SET completed = counts.completed,
           failed = counts.failed,
           updated_at = now()
       FROM (
         SELECT
           COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
           COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
         FROM job_items
         WHERE job_id = $1
       ) counts
       WHERE jobs.id = $1`,
      [jobId],
    );
  }

  private async finishJob(jobId: string): Promise<void> {
    await getPool().query(
      `UPDATE jobs
       SET status = CASE WHEN counts.completed > 0 THEN 'completed' ELSE 'failed' END,
           completed = counts.completed,
           failed = counts.failed,
           updated_at = now(),
           completed_at = now()
       FROM (
         SELECT
           COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
           COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
         FROM job_items
         WHERE job_id = $1
       ) counts
       WHERE jobs.id = $1`,
      [jobId],
    );
  }
}
