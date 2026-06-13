BEGIN;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS flagged BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
ALTER TABLE jobs
  ADD CONSTRAINT jobs_status_check CHECK (status IN ('queued', 'processing', 'completed', 'failed'));

CREATE INDEX IF NOT EXISTS idx_jobs_status_updated_at ON jobs (status, updated_at);

COMMIT;