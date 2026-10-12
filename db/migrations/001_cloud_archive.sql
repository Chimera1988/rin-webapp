-- Run ONCE in Neon SQL Editor before activating cloud archive.
-- Original messages are immutable; source fields stay auditable.
CREATE TABLE IF NOT EXISTS rin_archive_messages (
 id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 100),
 ts BIGINT NOT NULL,
 role TEXT NOT NULL CHECK (role IN ('user','assistant')),
 kind TEXT NOT NULL CHECK (kind IN ('text','voice','sticker','silence')),
 status TEXT NOT NULL CHECK (status = 'complete'),
 payload JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rin_archive_messages_cursor_idx ON rin_archive_messages (ts DESC, id DESC);
CREATE TABLE IF NOT EXISTS rin_archive_assets (
 message_id TEXT PRIMARY KEY CHECK (length(message_id) BETWEEN 1 AND 100),
 blob_path TEXT NOT NULL UNIQUE,
 mime TEXT NOT NULL CHECK (mime IN ('audio/mpeg')),
 bytes INTEGER NOT NULL CHECK (bytes BETWEEN 1 AND 5242880),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rin_archive_assets_created_idx ON rin_archive_assets (created_at DESC);
-- No DELETE operation is exposed by the app in this first phase.
