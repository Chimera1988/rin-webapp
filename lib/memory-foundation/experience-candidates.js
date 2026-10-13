// Rin 2.6.4 — evidence-linked, deterministic EXPERIENCE CANDIDATES.
// Not psychological inference. A first-person claim is not proof that an action happened.
// This module has no permission to modify cognition, relationship or beliefs.
import { createHash } from 'node:crypto';
import { classifyExplicitActivity } from '../cognition/activity-continuity.js';

const newId = (prefix, messageId) => `${prefix}-${createHash('sha256').update(String(messageId)).digest('hex').slice(0, 32)}`;

export function experienceCandidates(messages = []) {
  const rows = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message?.id || !Number.isSafeInteger(Number(message.ts)) || Number(message.ts) <= 0) continue;
    const activity = classifyExplicitActivity(message);
    if (!activity) continue;
    const sourceMessageId = String(message.id);
    rows.push({
      sourceMessageId,
      eventTimeMs: Number(message.ts),
      episodeId: newId('ep',sourceMessageId),
      decisionId: activity.phase === 'planned' ? newId('dec',sourceMessageId) : null,
      experienceId: activity.phase === 'claimed_complete' ? newId('exp',sourceMessageId) : null,
      ...activity
    });
  }
  return rows;
}

export { classifyExplicitActivity };

// The same message always produces the same identifiers; repeated archive sync is harmless.
export function toEpisodeRows(candidates) {
  return candidates.map(c=>({episode_id:c.episodeId,source_message_id:c.sourceMessageId,
    event_time_ms:c.eventTimeMs,summary:c.summary,
    context:{origin:'rin_explicit_self_report',activity:c.activity,phase:c.phase,evidence:'statement_not_physical_observation'}}));
}
export function toDecisionRows(candidates) {
  return candidates.filter(c=>c.phase==='planned').map(c=>({decision_id:c.decisionId,
    episode_id:c.episodeId,source_message_id:c.sourceMessageId,action_key:`${c.activity}_start`,
    stated_reason:null,alternatives:[],evidence_level:'self_reported'}));
}
