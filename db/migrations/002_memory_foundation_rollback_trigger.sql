-- Optional DB rollback of the AUTOMATIC OBSERVATION TRIGGER ONLY.
-- Safe: leaves archive messages, media, and all five memory tables/data intact.
-- Re-run 002_memory_foundation.sql to re-enable it later (idempotent).
DROP TRIGGER IF EXISTS rin_memory_observe_archive_after_insert ON rin_archive_messages;
