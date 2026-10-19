-- Rin 2.6.21 Causal Action Lifecycle. Apply AFTER 004_autobiographical_memory.sql.
-- Additive only. No user-message deletion, rewrite, or inferred physical actions.
-- Local diary remains the interactive source of truth; snapshots are cloud recovery.

ALTER TABLE rin_memory_client_snapshots
  ADD COLUMN IF NOT EXISTS personal_actions JSONB NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(personal_actions)='array');

CREATE TABLE IF NOT EXISTS rin_memory_personal_actions (
  action_id TEXT PRIMARY KEY CHECK (length(action_id) BETWEEN 5 AND 115),
  kind TEXT NOT NULL CHECK (kind IN ('reading','meal','walk','home','work','rest','music','creative')),
  goal TEXT NOT NULL CHECK (length(goal) BETWEEN 5 AND 190),
  motive TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('planned','in_progress','deferred','completed','partial','interrupted','cancelled')),
  decided_at_ms BIGINT NOT NULL CHECK (decided_at_ms>0),
  planned_start_at_ms BIGINT NOT NULL CHECK (planned_start_at_ms>=decided_at_ms),
  planned_finish_at_ms BIGINT NOT NULL CHECK (planned_finish_at_ms>=planned_start_at_ms),
  deferred_until_ms BIGINT,
  started_at_ms BIGINT,
  finished_at_ms BIGINT,
  updated_at_ms BIGINT NOT NULL CHECK (updated_at_ms>0),
  outcome JSONB CHECK (outcome IS NULL OR jsonb_typeof(outcome)='object'),
  decision_request_id TEXT,
  disclosure_request_id TEXT,
  disclosed_at_ms BIGINT,
  reality_mode TEXT NOT NULL DEFAULT 'simulated_character_world'
    CHECK (reality_mode='simulated_character_world'),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rin_personal_actions_recent_idx
  ON rin_memory_personal_actions (updated_at_ms DESC,action_id DESC);
CREATE INDEX IF NOT EXISTS rin_personal_actions_outcomes_idx
  ON rin_memory_personal_actions (finished_at_ms DESC) WHERE status IN ('completed','partial');
-- A completed simulated action is *not* external observation and must never be
-- automatically copied into rin_memory_experiences as if there were an archived
-- real-world witness. Verbal reports remain separate evidence in archived messages.
