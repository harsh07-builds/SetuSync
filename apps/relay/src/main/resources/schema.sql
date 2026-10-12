CREATE TABLE IF NOT EXISTS install (
    id UUID PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL,
    last_seen TIMESTAMPTZ NOT NULL,
    quota_used BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS search_job (
    id UUID PRIMARY KEY,
    cache_key TEXT NOT NULL,
    request_payload JSONB,
    provider_search_id TEXT,
    state TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    credits INTEGER NOT NULL DEFAULT 0,
    submission_started_at TIMESTAMPTZ,
    acquisition_event_created_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS request_ticket (
    id UUID PRIMARY KEY,
    install_id UUID REFERENCES install(id),
    idempotency_key TEXT NOT NULL,
    cache_key TEXT NOT NULL,
    state TEXT NOT NULL,
    search_job_id UUID REFERENCES search_job(id),
    created_at TIMESTAMPTZ NOT NULL,
    UNIQUE (install_id, idempotency_key)
);

ALTER TABLE search_job
    ADD COLUMN IF NOT EXISTS request_payload JSONB;

ALTER TABLE search_job
    ADD COLUMN IF NOT EXISTS submission_started_at TIMESTAMPTZ;

ALTER TABLE search_job
    ADD COLUMN IF NOT EXISTS acquisition_event_created_at TIMESTAMPTZ;

ALTER TABLE request_ticket
    ADD COLUMN IF NOT EXISTS search_job_id UUID;

CREATE INDEX IF NOT EXISTS ix_request_ticket_search_job
ON request_ticket(search_job_id);

DROP INDEX IF EXISTS uq_search_job_active;

CREATE UNIQUE INDEX uq_search_job_active
ON search_job(cache_key)
WHERE state IN (
    'QUEUED',
    'SUBMITTING',
    'SUBMITTED',
    'PROCESSING'
);

CREATE TABLE IF NOT EXISTS capsule (
    id TEXT PRIMARY KEY,
    cache_key TEXT NOT NULL,
    chash TEXT NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    risk TEXT NOT NULL,
    kid TEXT NOT NULL,
    object_key TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger (
    id UUID PRIMARY KEY,
    ts TIMESTAMPTZ NOT NULL,
    kind TEXT NOT NULL,
    credits INTEGER NOT NULL DEFAULT 0,
    saved_credits INTEGER NOT NULL DEFAULT 0,
    bytes_raw BIGINT NOT NULL DEFAULT 0,
    bytes_capsule BIGINT NOT NULL DEFAULT 0,
    note TEXT
);

CREATE TABLE IF NOT EXISTS outbox_event (
    id UUID PRIMARY KEY,
    aggregate_type TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    claimed_at TIMESTAMPTZ,
    claim_token UUID,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_error TEXT
);

ALTER TABLE outbox_event
    ADD COLUMN IF NOT EXISTS created_at
        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE outbox_event
    ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

ALTER TABLE outbox_event
    ADD COLUMN IF NOT EXISTS claim_token UUID;

ALTER TABLE outbox_event
    ADD COLUMN IF NOT EXISTS attempts
        INTEGER NOT NULL DEFAULT 0;

ALTER TABLE outbox_event
    ADD COLUMN IF NOT EXISTS next_attempt_at
        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE outbox_event
    ADD COLUMN IF NOT EXISTS last_error TEXT;

CREATE INDEX IF NOT EXISTS ix_outbox_event_pending
ON outbox_event(next_attempt_at, created_at)
WHERE published_at IS NULL;

-- Archive polling metadata.
-- These fields allow workers to schedule and coordinate archive checks.

ALTER TABLE search_job
    ADD COLUMN IF NOT EXISTS poll_attempts INTEGER NOT NULL DEFAULT 0;

ALTER TABLE search_job
    ADD COLUMN IF NOT EXISTS next_poll_at TIMESTAMPTZ;

ALTER TABLE search_job
    ADD COLUMN IF NOT EXISTS poll_claimed_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS ix_search_job_archive_poll
    ON search_job (next_poll_at, updated_at)
    WHERE provider_search_id IS NOT NULL
      AND state IN ('SUBMITTED', 'PROCESSING');

-- Persist completed SerpApi archive responses before Capsule compilation.
-- This allows the Relay to recover safely after a process restart.

ALTER TABLE search_job
    ADD COLUMN IF NOT EXISTS provider_result JSONB;

ALTER TABLE search_job
    ADD COLUMN IF NOT EXISTS provider_result_received_at TIMESTAMPTZ;

-- RESULT_READY remains active until the Capsule has been compiled
-- and persisted, preventing a duplicate acquisition for the same key.

DROP INDEX IF EXISTS uq_search_job_active;

CREATE UNIQUE INDEX uq_search_job_active
    ON search_job (cache_key)
    WHERE state IN (
        'QUEUED',
        'SUBMITTING',
        'SUBMITTED',
        'PROCESSING',
        'RESULT_READY'
    );

-- Capsule compilation claim and retry tracking

ALTER TABLE search_job
    ADD COLUMN IF NOT EXISTS capsule_claimed_until TIMESTAMPTZ;

ALTER TABLE search_job
    ADD COLUMN IF NOT EXISTS capsule_attempts INTEGER NOT NULL DEFAULT 0;

ALTER TABLE search_job
    ADD COLUMN IF NOT EXISTS capsule_last_error TEXT;

CREATE INDEX IF NOT EXISTS ix_search_job_capsule_compile
    ON search_job (updated_at)
    WHERE state = 'RESULT_READY'
      AND provider_result IS NOT NULL;

-- Public signing-key registry.
-- Private signing material must remain outside PostgreSQL.

CREATE TABLE IF NOT EXISTS keyset (
    kid TEXT PRIMARY KEY,
    algorithm TEXT NOT NULL CHECK (algorithm = 'Ed25519'),
    public_key_spki_b64 TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'RETIRED', 'REVOKED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    activated_at TIMESTAMPTZ,
    retired_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_keyset_status
    ON keyset (status);

ALTER TABLE search_job
    ADD COLUMN IF NOT EXISTS capsule_claim_token UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_keyset_one_active
    ON keyset (status)
    WHERE status = 'ACTIVE';

-- Prevent duplicate acquisition accounting when workers retry.

CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_acquisition_job
ON ledger(kind, note)
WHERE kind IN (
    'ACQUISITION_CACHE_HIT',
    'ACQUISITION_PROVIDER'
);

-- Governor reservation prevents concurrent workers from overspending
-- the configured provider-credit budget.

ALTER TABLE search_job
    ADD COLUMN IF NOT EXISTS governor_reserved_credits
        INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS ix_search_job_governor_reservations
ON search_job(created_at)
WHERE governor_reserved_credits > 0;

-- Persist compiled Capsule size so wishlist selection can be
-- performed without downloading every object from object storage.

ALTER TABLE capsule
    ADD COLUMN IF NOT EXISTS bytes_capsule BIGINT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS ix_capsule_wishlist
ON capsule(expires_at, fetched_at);

-- Human-readable reason shown to clients when a ticket ends FAILED.

ALTER TABLE request_ticket
    ADD COLUMN IF NOT EXISTS failure_reason TEXT;
