// Rin 2.6.9: read-only historical candidate audit by default.
// Writes can be explicitly enabled by a human in a separately authorized run.
import { experienceCandidates } from '../lib/memory-foundation/experience-candidates.js';
import { writeExperienceCandidates } from '../lib/memory-foundation/experience-database.js';

export async function auditHistoricalCandidates({ sql, apply = false, limit = 80 } = {}) {
  if (!sql?.query) throw new Error('SQL_QUERY_REQUIRED');
  const pageSize = Math.max(1, Math.min(80, Math.floor(Number(limit) || 80)));
  let ts = null;
  let id = null;
  const result = { scanned:0, candidates:0, byActivity:{}, applied:false };
  while (true) {
    const rows = await sql.query(`
      SELECT id,ts,payload FROM rin_archive_messages
      WHERE ($1::bigint IS NULL OR (ts,id) > ($1::bigint,$2::text))
      ORDER BY ts ASC,id ASC LIMIT $3::integer
    `, [ts,id,pageSize]);
    if (!rows.length) break;
    const messages = rows.map(row => row.payload).filter(Boolean);
    const candidates = experienceCandidates(messages);
    result.scanned += messages.length;
    result.candidates += candidates.length;
    for (const candidate of candidates) result.byActivity[candidate.activity] = (result.byActivity[candidate.activity] || 0) + 1;
    if (apply && candidates.length) await writeExperienceCandidates(messages,sql);
    const last = rows.at(-1);
    ts = Number(last.ts);
    id = String(last.id);
    if (rows.length < pageSize) break;
  }
  result.applied = apply;
  return result;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  if (process.argv.includes('--help')) {
    console.log('node scripts/audit-episodic-candidates.js [--apply]');
    console.log('Default: SELECT-only candidate counts. --apply requires RIN_EPISODIC_BACKFILL_WRITE=YES.');
  } else {
    const apply=process.argv.includes('--apply');
    if (apply && process.env.RIN_EPISODIC_BACKFILL_WRITE !== 'YES') throw new Error('BACKFILL_WRITE_NOT_AUTHORIZED');
    const { archiveSql } = await import('../lib/archive/database.js');
    const sql=await archiveSql();
    const outcome=await auditHistoricalCandidates({sql,apply});
    console.log(JSON.stringify(outcome));
  }
}
