-- Rin 2.6.3: Memory Foundation / evidence ledger. Run in Neon SQL Editor (neondb, public, main).
-- Does NOT change chat, the existing diary, the Cognitive Kernel, or any past messages.
-- All statements are idempotent; no DROP / DELETE / UPDATE on user data.

-- 1. Each immutable archived message has one provenance observation.
-- This is EVIDENCE, not an inferred feeling, event summary, or learning result.
CREATE TABLE IF NOT EXISTS rin_memory_observations (
  source_message_id TEXT PRIMARY KEY REFERENCES rin_archive_messages(id) ON DELETE RESTRICT,
  event_time_ms BIGINT NOT NULL,
  speaker_role TEXT NOT NULL CHECK (speaker_role IN ('user','assistant')),
  message_kind TEXT NOT NULL CHECK (message_kind IN ('text','voice','sticker','silence')),
  request_id TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rin_memory_observations_time_idx
  ON rin_memory_observations (event_time_ms DESC, source_message_id DESC);
CREATE INDEX IF NOT EXISTS rin_memory_observations_request_idx
  ON rin_memory_observations (request_id) WHERE request_id IS NOT NULL;

-- 2. Future verified/candidate episodic records: every episode cites an actual message.
CREATE TABLE IF NOT EXISTS rin_memory_episodes (
  episode_id TEXT PRIMARY KEY CHECK (length(episode_id) BETWEEN 1 AND 120),
  source_message_id TEXT NOT NULL REFERENCES rin_memory_observations(source_message_id) ON DELETE RESTRICT,
  event_time_ms BIGINT NOT NULL,
  summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 1600),
  context JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(context)='object'),
  review_status TEXT NOT NULL DEFAULT 'candidate'
    CHECK (review_status IN ('candidate','verified','disputed','retracted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rin_memory_episodes_time_idx
  ON rin_memory_episodes (event_time_ms DESC, episode_id DESC);

-- 3. Past choices, NOT hidden model reasoning. Reasons may be unavailable.
CREATE TABLE IF NOT EXISTS rin_memory_decisions (
  decision_id TEXT PRIMARY KEY CHECK (length(decision_id) BETWEEN 1 AND 120),
  episode_id TEXT NOT NULL REFERENCES rin_memory_episodes(episode_id) ON DELETE RESTRICT,
  source_message_id TEXT NOT NULL REFERENCES rin_memory_observations(source_message_id) ON DELETE RESTRICT,
  action_key TEXT NOT NULL CHECK (length(action_key) BETWEEN 1 AND 120),
  stated_reason TEXT,
  alternatives JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(alternatives)='array'),
  evidence_level TEXT NOT NULL DEFAULT 'observed'
    CHECK (evidence_level IN ('observed','self_reported','inferred')),
  review_status TEXT NOT NULL DEFAULT 'candidate'
    CHECK (review_status IN ('candidate','verified','disputed','retracted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Observed outcomes and hypotheses are kept separate; correlation != causation.
CREATE TABLE IF NOT EXISTS rin_memory_experiences (
  experience_id TEXT PRIMARY KEY CHECK (length(experience_id) BETWEEN 1 AND 120),
  decision_id TEXT NOT NULL REFERENCES rin_memory_decisions(decision_id) ON DELETE RESTRICT,
  source_message_id TEXT NOT NULL REFERENCES rin_memory_observations(source_message_id) ON DELETE RESTRICT,
  observed_outcome TEXT NOT NULL CHECK (length(observed_outcome) BETWEEN 1 AND 1600),
  tentative_lesson TEXT,
  confidence NUMERIC(4,3) CHECK (confidence BETWEEN 0 AND 1),
  review_status TEXT NOT NULL DEFAULT 'candidate'
    CHECK (review_status IN ('candidate','verified','disputed','retracted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rin_memory_experiences_decision_idx
  ON rin_memory_experiences (decision_id, created_at DESC);

-- 5. Append-only belief versions. A newer revision never overwrites an old one.
CREATE TABLE IF NOT EXISTS rin_memory_beliefs (
  belief_key TEXT NOT NULL CHECK (length(belief_key) BETWEEN 1 AND 120),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  source_message_id TEXT NOT NULL REFERENCES rin_memory_observations(source_message_id) ON DELETE RESTRICT,
  statement TEXT NOT NULL CHECK (length(statement) BETWEEN 1 AND 1600),
  confidence NUMERIC(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  review_status TEXT NOT NULL DEFAULT 'candidate'
    CHECK (review_status IN ('candidate','verified','disputed','retracted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (belief_key, revision)
);
CREATE INDEX IF NOT EXISTS rin_memory_beliefs_recent_idx
  ON rin_memory_beliefs (created_at DESC);

-- Source capture takes place inside the same database transaction as archive INSERT.
-- An inserted message cannot be missed if an app sync is interrupted.
CREATE OR REPLACE FUNCTION rin_memory_observe_archive_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO rin_memory_observations
    (source_message_id, event_time_ms, speaker_role, message_kind, request_id)
  VALUES
    (NEW.id, NEW.ts, NEW.role, NEW.kind, NULLIF(left(NEW.payload->>'requestId',100),''))
  ON CONFLICT (source_message_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='rin_memory_observe_archive_after_insert'
                  AND tgrelid='rin_archive_messages'::regclass AND NOT tgisinternal) THEN
    CREATE TRIGGER rin_memory_observe_archive_after_insert
      AFTER INSERT ON rin_archive_messages
      FOR EACH ROW EXECUTE FUNCTION rin_memory_observe_archive_insert();
  END IF;
END;
$$;

-- Import only metadata of ALREADY ARCHIVED messages; never invent deleted history.
INSERT INTO rin_memory_observations
  (source_message_id, event_time_ms, speaker_role, message_kind, request_id)
SELECT id, ts, role, kind, NULLIF(left(payload->>'requestId',100),'')
FROM rin_archive_messages
ON CONFLICT (source_message_id) DO NOTHING;

-- Verify in SQL Editor:
-- SELECT COUNT(*) FROM rin_archive_messages;
-- SELECT COUNT(*) FROM rin_memory_observations;
-- Both counts should match after migration when no concurrent writes are in flight.
