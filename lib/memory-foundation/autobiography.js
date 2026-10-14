// Isolated, conservative classifier and retrieval primitives. No runtime hooks yet.
// Self reports are evidence that Rin said something, NOT independent proof of actions.
import { createHash } from 'node:crypto';
// Import archiveSql only for real DB calls; injected clients keep this module independently testable.
async function getSql() { const {archiveSql}=await import('../archive/database.js'); return archiveSql(); }

const clean = (v, max = 1600) => String(v ?? '').replace(/\s+/gu, ' ').trim().slice(0, max);
const ACTIONS = Object.freeze([
  ['закончила', 'complete'], ['завершила', 'complete'], ['сделала', 'complete'],
  ['подготовила', 'complete'], ['отправила', 'complete'], ['написала', 'complete'],
  ['проверила', 'complete'], ['прочитала', 'complete'], ['перевела', 'complete'],
  ['исправила', 'complete'], ['собрала', 'complete'], ['нарисовала', 'complete'],
  ['обновила', 'complete']
]);
const PATTERN = new RegExp(`(?:^|[^\\p{L}])я\\s+(?:уже\\s+|наконец\\s+|только что\\s+)?(${ACTIONS.map(v=>v[0]).join('|')})(?=$|[^\\p{L}])`, 'iu');
const CONDITIONAL = /(?:если бы|я бы|представь|вообрази|допустим|могла бы)/iu;
const QUOTE_ONLY = /(?:она сказала|он сказал|ты сказала|цитата|например\s*[:«])/iu;
const NEGATED = /(?:^|[^\p{L}])я\s+(?:ещ[её]\s+)?не\s+(?:закончила|завершила|сделала|подготовила|отправила|написала|проверила|прочитала|перевела|исправила|собрала|нарисовала|обновила)/iu;

export function classifyRinSelfReport(message = null) {
  if (!message || message.role !== 'assistant' || !['text','voice'].includes(message.kind)) return null;
  if (message.status && message.status !== 'complete') return null;
  const text = clean(message.content);
  if (!text || CONDITIONAL.test(text) || QUOTE_ONLY.test(text) || NEGATED.test(text)) return null;
  const match = PATTERN.exec(text);
  if (!match) return null;
  // Keep literal evidence rather than inventing a summary of an action.
  return {
    kind:'rin_action_reported_complete', actor:'rin', source_kind:'rin_self_report',
    statement:`Рин сказала: «${text.slice(0,1200)}»`,
    review_status:'candidate', confidence:null,
    details:{action_verb:match[1].toLowerCase(), evidence:'self_report_not_externally_verified'}
  };
}

export function fromMessageToRecord(message = null) {
  const classified = classifyRinSelfReport(message);
  if (!classified || !message.id || !Number.isSafeInteger(Number(message.ts)) || Number(message.ts)<=0) return null;
  const record_id='rin-msg-'+createHash('sha256').update(`${message.id}:own_action`).digest('hex').slice(0,32);
  return {...classified,record_id,source_message_id:String(message.id),event_time_ms:Number(message.ts)};
}

// At first this is lexical full-text retrieval. More complex paraphrases need
// a later hybrid/semantic stage, and no match must not become a guessed memory.
const STOP = new Set('помнишь помни вспомни вспомнила вспоминала когда как почему тогда была были был ли мы они она тебе тебя этот этой этом такое такая что ты это мне скажи только именно сделала делала ведь который которое закончила завершила собрала прочитала написала подготовила отправила проверила исправила перевела позже раньше историю разговор'.split(' '));
export function recallQuery(userText = '') {
  const raw=clean(userText,500).toLowerCase().replace(/ё/g,'е');
  if (!/(помнишь|вспомни|ты (?:делала|сделала|закончила|говорила|писала)|что ты тогда)/iu.test(raw)) return null;
  const keywords=(raw.match(/[а-яa-z0-9]{4,}/gu)||[]).filter(x=>!STOP.has(x));
  return [...new Set(keywords)].slice(0,7).join(' ') || null;
}

export async function recallRinAction(userText = '', sqlClient = null) {
  const query=recallQuery(userText);
  if (!query) return [];
  const sql=sqlClient || await getSql();
  const rows=await sql.query(`
    SELECT r.record_id, r.statement, r.source_message_id, r.event_time_ms,
           r.source_kind, r.review_status
    FROM rin_memory_records r
    WHERE r.kind='rin_action_reported_complete'
      AND r.review_status NOT IN ('disputed','retracted')
      AND to_tsvector('russian',r.statement) @@
        to_tsquery('russian',replace(plainto_tsquery('russian',$1)::text, ' & ', ' | '))
    ORDER BY ts_rank(to_tsvector('russian',r.statement),
        to_tsquery('russian',replace(plainto_tsquery('russian',$1)::text, ' & ', ' | '))) DESC,
        r.event_time_ms DESC NULLS LAST, r.record_id DESC
    LIMIT 3`, [query]);
  return rows.map(row=>({
    text:clean(`${row.statement} (архив: собственное сообщение Рин; не внешняя проверка)`,900),
    sourceMessageId:row.source_message_id,
    eventTimeMs:Number(row.event_time_ms)||null,
    status:row.review_status,
    importance:7
  }));
}

export async function saveRinActionCandidates(messages = [], sqlClient = null) {
  const records=(Array.isArray(messages)?messages:[]).map(fromMessageToRecord).filter(Boolean);
  if (!records.length) return {candidates:0,inserted:0};
  const sql=sqlClient||await getSql();
  const rows=await sql.query(`
    INSERT INTO rin_memory_records
    (record_id,kind,actor,statement,source_message_id,source_kind,event_time_ms,review_status,confidence,details)
    SELECT x.record_id,x.kind,x.actor,x.statement,x.source_message_id,x.source_kind,
           x.event_time_ms,x.review_status,x.confidence,x.details
    FROM jsonb_to_recordset($1::jsonb) AS x(
      record_id text,kind text,actor text,statement text,source_message_id text,
      source_kind text,event_time_ms bigint,review_status text,confidence numeric,details jsonb)
    JOIN rin_memory_observations o ON o.source_message_id=x.source_message_id
    ON CONFLICT (record_id) DO NOTHING
    RETURNING record_id`, [JSON.stringify(records)]);
  return {candidates:records.length,inserted:rows.length};
}
