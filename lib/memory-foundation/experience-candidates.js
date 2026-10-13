// Rin 2.6.4 — evidence-linked, deterministic EXPERIENCE CANDIDATES.
// Not psychological inference. A first-person claim is not proof that an action happened.
// This module has no permission to modify cognition, relationship or beliefs.
import { createHash } from 'node:crypto';
import { classifyExplicitActivity } from '../cognition/activity-continuity.js';

const newId = (prefix, messageId) => `${prefix}-${createHash('sha256').update(String(messageId)).digest('hex').slice(0, 32)}`;
// A few high-signal user statements can become evidence-linked episode CANDIDATES.
// We store only what was explicitly said, not a verdict about intimacy, intent or feelings.
const USER_REPORTS = Object.freeze([
  {activity:'shared_moment',pattern:/(?:лучший момент (?:всего )?(?:этого |сегодняшнего )?дня|незабываемый момент|особенный момент этого дня)/iu,
    summary:'Пользователь назвал совместный момент особенно значимым.'},
  {activity:'closeness_reflection',pattern:/(?:мы (?:сегодня |за этот день )?(?:стали|становимся) (?:чуть |немного )?ближе|(?:этот|сегодняшний) (?:день|вечер) нас (?:сблизил|сблизило)|ты стала (?:чуть |немного )?ближе ко мне)/iu,
    summary:'Пользователь выразил ощущение сближения.'},
  {activity:'moment_boundary',pattern:/(?=.*(?:лучше остановиться|давай остановимся|я хочу остановиться))(?=.*(?:побудем|побыть|рядом|момент|поцелуй|приятно))/iu,
    summary:'Пользователь попросил остановить развитие момента.'},
  {activity:'shared_day_reflection',pattern:/(?:мне понравил[ао]сь|мне понравился)[^.!?]{0,90}(?:кулинарн[а-яё]* шоу|наш (?:вечер|разговор)|тво[яё][а-яё]* забот[а-яё]*)/iu,
    summary:'Пользователь положительно вспомнил совместный эпизод.'}
]);
export function classifyExplicitSharedReport(message = null) {
  if (message?.role !== 'user' || (message?.status != null && message.status !== 'complete') || message?.kind !== 'text') return null;
  const text = String(message.content ?? '').replace(/\s+/gu,' ').trim().slice(0,1000);
  if (!text || /(?:представь|допустим|а если бы|вроде бы ты говорил)/iu.test(text)) return null;
  const match = USER_REPORTS.find(rule => rule.pattern.test(text));
  return match ? {activity:match.activity,phase:'reported_significance',summary:match.summary,
    source:'user',evidence:'explicit_user_statement_not_external_fact'} : null;
}

export function experienceCandidates(messages = []) {
  const rows = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message?.id || !Number.isSafeInteger(Number(message.ts)) || Number(message.ts) <= 0) continue;
    const activity = classifyExplicitActivity(message) || classifyExplicitSharedReport(message);
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
    context:{origin:c.source === 'user' ? 'user_explicit_statement' : 'rin_explicit_self_report',activity:c.activity,phase:c.phase,evidence:c.evidence || 'statement_not_physical_observation'}}));
}
export function toDecisionRows(candidates) {
  return candidates.filter(c=>c.phase==='planned').map(c=>({decision_id:c.decisionId,
    episode_id:c.episodeId,source_message_id:c.sourceMessageId,action_key:`${c.activity}_start`,
    stated_reason:null,alternatives:[],evidence_level:'self_reported'}));
}
