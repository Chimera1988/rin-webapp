// Shadow-mode event formation: all rows are candidates, never cognitive inputs.
import { archiveSql } from '../archive/database.js';
import { experienceCandidates, toEpisodeRows, toDecisionRows } from './experience-candidates.js';

export async function writeExperienceCandidates(messages = [], sqlClient = null) {
  const candidates = experienceCandidates(messages);
  if (!candidates.length) return {episodes:0,decisions:0,experienceClaims:0};
  const sql = sqlClient || await archiveSql();
  // FK to observations forbids unsupported source ids even on retried requests.
  await sql.query(`
    INSERT INTO rin_memory_episodes (episode_id,source_message_id,event_time_ms,summary,context)
    SELECT x.episode_id,x.source_message_id,x.event_time_ms,x.summary,x.context
    FROM jsonb_to_recordset($1::jsonb)
      AS x(episode_id text,source_message_id text,event_time_ms bigint,summary text,context jsonb)
    JOIN rin_memory_observations o ON o.source_message_id=x.source_message_id
    ON CONFLICT (episode_id) DO NOTHING
  `,[JSON.stringify(toEpisodeRows(candidates))]);
  const decisions = toDecisionRows(candidates);
  if (decisions.length) await sql.query(`
    INSERT INTO rin_memory_decisions
      (decision_id,episode_id,source_message_id,action_key,stated_reason,alternatives,evidence_level)
    SELECT x.decision_id,x.episode_id,x.source_message_id,x.action_key,x.stated_reason,x.alternatives,x.evidence_level
    FROM jsonb_to_recordset($1::jsonb)
      AS x(decision_id text,episode_id text,source_message_id text,action_key text,stated_reason text,alternatives jsonb,evidence_level text)
    JOIN rin_memory_episodes e ON e.episode_id=x.episode_id
    ON CONFLICT (decision_id) DO NOTHING
  `,[JSON.stringify(decisions)]);
  let experienceClaims=0;
  for (const c of candidates.filter(item=>item.phase==='claimed_complete')) {
    const earlier=await sql.query(`
      SELECT d.decision_id,e.event_time_ms
      FROM rin_memory_decisions d
      JOIN rin_memory_episodes e ON e.episode_id=d.episode_id
      WHERE d.action_key=$1 AND e.event_time_ms<$2
        AND e.event_time_ms >= $3
      ORDER BY e.event_time_ms DESC,d.decision_id DESC LIMIT 1
    `,[`${c.activity}_start`,c.eventTimeMs,c.eventTimeMs-c.maxMinutes*60000]);
    const match=earlier[0];
    if (!match) continue; // A claimed completion without a recorded decision stays an episode only.
    const elapsed=c.eventTimeMs-Number(match.event_time_ms);
    if (!Number.isFinite(elapsed) || elapsed<c.minMinutes*60000) continue;
    await sql.query(`
      INSERT INTO rin_memory_experiences
        (experience_id,decision_id,source_message_id,observed_outcome,tentative_lesson,confidence,review_status)
      SELECT $1,$2,$3,$4,NULL,NULL,'candidate'
      WHERE EXISTS (SELECT 1 FROM rin_memory_observations WHERE source_message_id=$3)
      ON CONFLICT (experience_id) DO NOTHING
    `,[c.experienceId,match.decision_id,c.sourceMessageId,
      `${c.summary} Это её сообщение о действии, а не внешняя проверка.`]);
    experienceClaims++;
  }
  return {episodes:candidates.length,decisions:decisions.length,experienceClaims};
}
