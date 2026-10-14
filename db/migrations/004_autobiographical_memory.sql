-- Rin autobiographical memory, additive foundation (candidate, NOT applied to production).
-- Execute only after 002_memory_foundation.sql; keep original archive and browser diary.
-- No DROP, DELETE, UPDATE, or automatic cognition changes.

CREATE TABLE IF NOT EXISTS rin_memory_records (
    record_id TEXT PRIMARY KEY CHECK (length(record_id) BETWEEN 1 AND 160),
    kind TEXT NOT NULL CHECK (kind IN (
      'user_fact','rin_action_planned','rin_action_reported_complete',
      'shared_moment','correction','rin_reflection'
    )),
    actor TEXT NOT NULL CHECK (actor IN ('user','rin','shared')),
    statement TEXT NOT NULL CHECK (length(statement) BETWEEN 1 AND 1600),
    source_message_id TEXT REFERENCES rin_memory_observations(source_message_id) ON DELETE RESTRICT,
    source_kind TEXT NOT NULL CHECK (source_kind IN (
      'user_statement','rin_self_report','tool_result','local_diary_import'
    )),
    event_time_ms BIGINT,
    review_status TEXT NOT NULL DEFAULT 'candidate'
      CHECK (review_status IN ('candidate','verified','disputed','retracted')),
    confidence NUMERIC(4,3) CHECK (confidence BETWEEN 0 AND 1),
    details JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details)='object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- A conversation claim must have source evidence. Local imports are linked
    -- to their immutable client-snapshot hash instead and remain candidates.
    CONSTRAINT rin_memory_records_provenance CHECK (
      source_message_id IS NOT NULL OR source_kind='local_diary_import'
    )
);
CREATE INDEX IF NOT EXISTS rin_memory_records_time_idx
  ON rin_memory_records (event_time_ms DESC,record_id DESC);
CREATE INDEX IF NOT EXISTS rin_memory_records_source_idx
  ON rin_memory_records (source_message_id) WHERE source_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS rin_memory_records_search_idx
  ON rin_memory_records USING GIN (to_tsvector('russian', statement));

-- Client diary backup is versioned/append-only. It does not supersede the
-- local authoritative diary until a separate, tested cutover is implemented.
CREATE TABLE IF NOT EXISTS rin_memory_client_snapshots (
    snapshot_hash TEXT PRIMARY KEY CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
    schema_version INTEGER NOT NULL CHECK (schema_version BETWEEN 1 AND 99),
    client_updated_at_ms BIGINT,
    facts JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(facts)='object'),
    events JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(events)='array'),
    summaries JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(summaries)='array'),
    shared_moments JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(shared_moments)='array'),
    shared_symbols JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(shared_symbols)='array'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS rin_memory_client_snapshots_created_idx
  ON rin_memory_client_snapshots (created_at DESC);
