-- SetuSync forward-only schema repair for existing PostgreSQL deployments.
-- Safe to re-run; does not drop tables, rows, or containers.
BEGIN;

-- The Java SearchJobRepository expects these fields, but the existing schema
-- in the uploaded source bundle does not create them on older databases.
ALTER TABLE search_job
    ADD COLUMN IF NOT EXISTS install_id UUID REFERENCES install(id);

ALTER TABLE search_job
    ADD COLUMN IF NOT EXISTS provider_result JSONB;

ALTER TABLE search_job
    ADD COLUMN IF NOT EXISTS provider_result_received_at TIMESTAMPTZ;

-- Ensure the ticket/job relationship used by current code exists.
ALTER TABLE request_ticket
    ADD COLUMN IF NOT EXISTS search_job_id UUID;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'request_ticket_search_job_id_fkey'
          AND conrelid = 'request_ticket'::regclass
    ) THEN
        ALTER TABLE request_ticket
            ADD CONSTRAINT request_ticket_search_job_id_fkey
            FOREIGN KEY (search_job_id) REFERENCES search_job(id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_search_job_install_id
    ON search_job(install_id);

CREATE INDEX IF NOT EXISTS ix_search_job_result_ready
    ON search_job(provider_result_received_at)
    WHERE state = 'RESULT_READY' AND provider_result IS NOT NULL;

COMMIT;
