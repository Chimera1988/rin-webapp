// Rin 2.6.19 — optional, source-qualified episodic curation.
// Curation writes candidate historical dialogue records, not personality,
// causal truth, independently observed physical action, or automatic promises.
import { createHash } from 'node:crypto';

const clean = (value, max = 600) => String(value ?? '')
  .replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, max);
const norm = value => clean(value, 900).toLowerCase().replace(/ё/gu, 'е').replace(/[«»“”'.,!?;:()]/gu, '').replace(/\s+/gu, ' ');
const KINDS = new Set(['shared_moment', 'rin_reflection', 'correction', 'rin_action_planned']);
const FORGET = /(?:забудь|удали|не\s+(?:сохраняй|запоминай)|не\s+нужно\s+помнить)/iu;

export function validEpisodeCandidates(raw = [], history = [], userText = '') {
  if (FORGET.test(userText)) return [];
  const messages = (Array.isArray(history) ? history : []).filter(item =>
    ['user', 'assistant'].includes(item?.role) && typeof item?.id === 'string' && item.id.length < 150
      && clean(item?.content, 1300)).slice(-28);
  const byId = new Map(messages.map(m => [m.id, m]));
  const selected = [];
  for (const item of (Array.isArray(raw) ? raw : []).slice(0, 3)) {
    const kind = clean(item?.kind, 35);
    const sourceId = clean(item?.sourceMessageId, 145);
    const source = byId.get(sourceId);
    const quote = clean(item?.evidenceQuote, 160);
    const statement = clean(item?.statement, 530);
    const key = clean(item?.episodeKey, 100).toLowerCase().replace(/[^a-z0-9_-]/gu, '-').replace(/-+/gu, '-').replace(/^-|-$/gu, '');
    if (!KINDS.has(kind) || !source || !quote || !statement || key.length < 5) continue;
    // Direct quote must be a contiguous span of the actual message; the
    // curator cannot invent its own provenance or infer events off-screen.
    if (norm(quote).length < 12 || !norm(source.content).includes(norm(quote))) continue;
    if (kind === 'rin_reflection' || kind === 'rin_action_planned') {
      if (source.role !== 'assistant') continue;
    }
    if (selected.some(x => x.episodeKey === key && x.kind === kind)) continue;
    selected.push({
      kind, episodeKey: key, sourceMessageId: sourceId, evidenceQuote: quote,
      statement: (statement.startsWith('В переписке:') ? statement : `В переписке: ${statement}`).slice(0, 550),
      sourceKind: source.role === 'user' ? 'user_statement' : 'rin_self_report',
      scope: clean(item?.scope, 60) || 'shared_dialogue',
      day: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Number(source.ts) || Date.now()))
    });
    if (selected.length >= 2) break;
  }
  return selected;
}

export function episodeRecordId(item) {
  // One candidate per theme per civil day: repeated near-identical turns do
  // not flood Neon. Existing candidates are never silently rewritten.
  const seed = [item.day, item.kind, item.episodeKey].join('|');
  return 'rin-auto-' + createHash('sha256').update(seed).digest('hex').slice(0, 32);
}

export async function saveEpisodeCandidates(candidates, { sqlClient = null } = {}) {
  if (!candidates?.length) return { saved: 0, deferred: 0, attempted: 0, pending: [] };
  let sql = sqlClient;
  if (!sql) {
    if (!process.env.DATABASE_URL) return { saved: 0, deferred: candidates.length, attempted: candidates.length, pending: candidates };
    const { archiveSql } = await import('../archive/database.js');
    sql = await archiveSql();
  }
  let saved = 0, deferred = 0;
  const pending = [];
  for (const item of candidates) {
    // Both archive message and provenance observation must exist at write time.
    // A delayed cloud sync can safely be retried by the same stable record ID.
    const rows = await sql.query(`
      INSERT INTO rin_memory_records
        (record_id,kind,actor,statement,source_message_id,source_kind,event_time_ms,review_status,confidence,details)
      SELECT $1,$2,'shared',$3,m.id,$4,m.ts,'candidate',NULL,
        jsonb_build_object('scope',$5::text,'episode_key',$6::text,
          'evidence_quote',$7::text,'origin','auto_source_qualified_v1',
          'epistemic_limit','archived_dialogue_not_external_observation')
      FROM rin_archive_messages m
      JOIN rin_memory_observations o ON o.source_message_id = m.id
      WHERE m.id=$8 AND m.role=ANY($9::text[])
        AND strpos(lower(regexp_replace(replace(m.payload->>'content','ё','е'), '[[:space:]]+', ' ', 'g')),
          lower(replace($10::text,'ё','е'))) > 0
        AND NOT EXISTS (
          SELECT 1 FROM rin_memory_records old
          WHERE old.kind=$2
            AND (old.details->>'episode_key'=$6 OR old.details->>'episode_key'='oct16-'||$6)
            AND to_char(to_timestamp(old.event_time_ms/1000.0) AT TIME ZONE 'Europe/Moscow','YYYY-MM-DD')=$11
        )
      ON CONFLICT (record_id) DO NOTHING
      RETURNING record_id`, [
      episodeRecordId(item), item.kind, item.statement, item.sourceKind,
      item.scope, item.episodeKey, item.evidenceQuote, item.sourceMessageId,
      item.sourceKind === 'user_statement' ? ['user'] : ['assistant'],
      item.evidenceQuote, item.day
    ]);
    if (rows.length) saved += 1;
    else {
      const exists = await sql.query(`SELECT 1 FROM rin_archive_messages m
        JOIN rin_memory_observations o ON o.source_message_id=m.id
        WHERE m.id=$1 LIMIT 1`, [item.sourceMessageId]);
      if (!exists.length) { deferred += 1; pending.push(item); }
    }
  }
  return { saved, deferred, attempted: candidates.length, pending };
}
