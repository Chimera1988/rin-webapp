-- Rin 2.6.4 Experience Formation — additive indexes only.
-- Requires 002_memory_foundation.sql applied first. No changes to archived messages.
-- Safe to run multiple times. Every generated episode/decision remains review_status=candidate.
CREATE INDEX IF NOT EXISTS rin_memory_decisions_action_idx
  ON rin_memory_decisions (action_key, created_at DESC, decision_id DESC);
CREATE INDEX IF NOT EXISTS rin_memory_decisions_source_idx
  ON rin_memory_decisions (source_message_id);
CREATE INDEX IF NOT EXISTS rin_memory_episodes_source_idx
  ON rin_memory_episodes (source_message_id);
CREATE INDEX IF NOT EXISTS rin_memory_experiences_source_idx
  ON rin_memory_experiences (source_message_id);
-- There is intentionally no auto-generated belief or cognitive-state update.
