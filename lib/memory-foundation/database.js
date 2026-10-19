import { archiveSql } from '../archive/database.js';
import { memoryFoundationStatus, memoryObservationPreview } from './status.js';

export async function readMemoryFoundationStatus(sqlClient = null) {
  const sql = sqlClient || await archiveSql();
  const rows = await sql.query(`
    SELECT
      (SELECT COUNT(*) FROM rin_archive_messages) AS archive_messages,
      (SELECT COUNT(*) FROM rin_memory_observations) AS observations,
      (SELECT COUNT(*) FROM rin_memory_episodes) AS episodes,
      (SELECT COUNT(*) FROM rin_memory_decisions) AS decisions,
      (SELECT COUNT(*) FROM rin_memory_experiences) AS experiences,
      (SELECT COUNT(*) FROM rin_memory_personal_actions WHERE status IN ('completed','partial')) AS simulated_action_outcomes,
      (SELECT COUNT(*) FROM rin_memory_beliefs) AS belief_revisions
  `);
  return memoryFoundationStatus(rows[0] || {});
}

export async function readRecentMemorySources(sqlClient = null) {
  const sql = sqlClient || await archiveSql();
  const rows = await sql.query(`
    SELECT source_message_id, event_time_ms, speaker_role, message_kind, request_id
    FROM rin_memory_observations
    ORDER BY event_time_ms DESC, source_message_id DESC LIMIT 20
  `);
  return memoryObservationPreview(rows);
}
