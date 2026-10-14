// Server-only database writes and verification. Browser code lives in public/js.
import {createHash} from 'node:crypto';
import {snapshotBody, snapshotContentBytes} from '../../public/js/cloud_memory_snapshot.js';

export function normalizeClientSnapshot(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MEMORY_SNAPSHOT_INVALID');
  const body = snapshotBody({
    _schema: value.schema_version, _updated_at: value.client_updated_at_ms,
    facts: value.facts, events: value.events, summaries: value.summaries,
    relationship: {sharedMoments: value.shared_moments, sharedSymbols: value.shared_symbols}
  });
  const bytes = snapshotContentBytes(body);
  const calculated = createHash('sha256').update(bytes).digest('hex');
  if (value.snapshot_hash !== calculated) throw new Error('MEMORY_SNAPSHOT_HASH_MISMATCH');
  return { ...body, snapshot_hash: calculated };
}
export async function writeClientSnapshot(snapshot, sqlClient = null) {
  const verified = normalizeClientSnapshot(snapshot);
  const sql = sqlClient || await (await import('../archive/database.js')).archiveSql();
  const rows = await sql.query(`
    INSERT INTO rin_memory_client_snapshots
     (snapshot_hash,schema_version,client_updated_at_ms,facts,events,summaries,shared_moments,shared_symbols)
    VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb)
    ON CONFLICT (snapshot_hash) DO NOTHING RETURNING snapshot_hash`, [
      verified.snapshot_hash, verified.schema_version, verified.client_updated_at_ms,
      JSON.stringify(verified.facts), JSON.stringify(verified.events), JSON.stringify(verified.summaries),
      JSON.stringify(verified.shared_moments), JSON.stringify(verified.shared_symbols)
    ]);
  return {ok:true, snapshotHash:verified.snapshot_hash, inserted:rows.length === 1};
}
export async function readLatestClientSnapshot(sqlClient = null) {
  const sql = sqlClient || await (await import('../archive/database.js')).archiveSql();
  const rows = await sql.query(`
    SELECT snapshot_hash,schema_version,client_updated_at_ms,facts,events,summaries,
      shared_moments,shared_symbols,created_at
    FROM rin_memory_client_snapshots
    ORDER BY created_at DESC,snapshot_hash DESC LIMIT 1`);
  return rows[0] || null;
}
