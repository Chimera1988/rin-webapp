// Bounded, restartable archive backfill. No archive edits or inferred physical actions.
import {saveRinActionCandidates} from './autobiography.js';

export async function backfillRinActions({afterTs=0,afterId='',limit=70}={},sqlClient=null) {
  const sql=sqlClient||await (await import('../archive/database.js')).archiveSql();
  const ts=Number(afterTs);
  if(!Number.isSafeInteger(ts)||ts<0||typeof afterId!=='string'||afterId.length>120) throw new Error('BACKFILL_INVALID_CURSOR');
  const count=Math.max(1,Math.min(100,Math.round(Number(limit)||70)));
  const rows=await sql.query(`
    SELECT id,ts,role,kind,status,payload FROM rin_archive_messages
    WHERE (ts,id)>($1::bigint,$2::text)
    ORDER BY ts ASC,id ASC LIMIT $3::integer`,[ts,afterId,count+1]);
  const batch=rows.slice(0,count);
  const candidateMessages=batch.map(r=>({ ...r.payload, id:r.id,ts:Number(r.ts),role:r.role,kind:r.kind,status:r.status }));
  const saved=await saveRinActionCandidates(candidateMessages,sql);
  const last=batch.at(-1);
  return {ok:true,scanned:batch.length,candidates:saved.candidates,inserted:saved.inserted,
    hasMore:rows.length>count, nextCursor:last?{afterTs:Number(last.ts),afterId:last.id}:null};
}
