// Server-only database writes and verification. Browser code lives in public/js.
import {createHash} from 'node:crypto';
import {snapshotBody, snapshotContentBytes} from '../../public/js/cloud_memory_snapshot.js';
import {normalizePersonalActions} from '../../public/lib/action-lifecycle.js';
import {correctKnownMemoryEvents, isMisattributedDaliReading} from '../../public/lib/memory-attribution.js';

export function normalizeClientSnapshot(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MEMORY_SNAPSHOT_INVALID');
  const body = snapshotBody({
    _schema: value.schema_version, _updated_at: value.client_updated_at_ms,
    facts: value.facts, events: value.events, summaries: value.summaries,
    relationship: {sharedMoments: value.shared_moments, sharedSymbols: value.shared_symbols},
    innerLife: {personalActions:value.personal_actions}
  });
  const bytes = snapshotContentBytes(body);
  const calculated = createHash('sha256').update(bytes).digest('hex');
  let acknowledgedHash = calculated;
  if (value.snapshot_hash !== calculated) {
    // A pre-2.6.23 browser may still submit a previously signed snapshot with
    // the false "начну считать" reading plan. Verify its ORIGINAL hash before
    // accepting; store only the cleaned canonical payload. No silent trust of
    // mutated or otherwise malformed historical snapshots.
    const oldActions = Array.isArray(value.personal_actions) ? value.personal_actions : [];
    const hasRejectedReaderPlan = oldActions.some(action => action?.kind === 'reading'
      && /(?<![\p{L}\p{N}])(?:начну|буду|стану)\s+считать(?=$|[^\p{L}\p{N}])/iu.test(String(action.goal || '')));
    // Some already deployed clients still sign the exact old text of the
    // book event. Accept only its authenticated pre-correction payload and
    // persist the canonical corrected text under its new SHA-256 hash.
    const originalEvents = Array.isArray(value.events) ? value.events.slice(-120) : [];
    const hasMisattributedBook = originalEvents.some(isMisattributedDaliReading);
    if (!hasRejectedReaderPlan && !hasMisattributedBook) throw new Error('MEMORY_SNAPSHOT_HASH_MISMATCH');
    const legacy = { ...body, events: originalEvents, personal_actions: oldActions };
    const legacyHash = createHash('sha256').update(snapshotContentBytes(legacy)).digest('hex');
    if (value.snapshot_hash !== legacyHash) throw new Error('MEMORY_SNAPSHOT_HASH_MISMATCH');
    acknowledgedHash = legacyHash;
  }
  return { ...body, snapshot_hash: calculated, acknowledged_hash: acknowledgedHash };
}
export async function writeClientSnapshot(snapshot, sqlClient = null) {
  const verified = normalizeClientSnapshot(snapshot);
  const sql = sqlClient || await (await import('../archive/database.js')).archiveSql();
  const rows = await sql.query(`
    INSERT INTO rin_memory_client_snapshots
     (snapshot_hash,schema_version,client_updated_at_ms,facts,events,summaries,shared_moments,shared_symbols,personal_actions)
    VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb)
    ON CONFLICT (snapshot_hash) DO NOTHING RETURNING snapshot_hash`, [
      verified.snapshot_hash, verified.schema_version, verified.client_updated_at_ms,
      JSON.stringify(verified.facts), JSON.stringify(verified.events), JSON.stringify(verified.summaries),
      JSON.stringify(verified.shared_moments), JSON.stringify(verified.shared_symbols),JSON.stringify(verified.personal_actions)
    ]);
  // Materialize a bounded, versioned causal diary without claiming physical evidence.
  // Upserts never regress to an earlier phase when a stale snapshot arrives.
  const actions=normalizePersonalActions(verified.personal_actions);
  if(actions.length)await sql.query(`
    INSERT INTO rin_memory_personal_actions
      (action_id,kind,goal,motive,status,decided_at_ms,planned_start_at_ms,planned_finish_at_ms,deferred_until_ms,started_at_ms,finished_at_ms,updated_at_ms,outcome,decision_request_id,disclosure_request_id,disclosed_at_ms)
    SELECT x.id,x.kind,x.goal,x.motive,x.status,x.decided_at_ms,x.planned_start_at_ms,x.planned_finish_at_ms,x.deferred_until_ms,x.started_at_ms,x.finished_at_ms,x.updated_at_ms,x.outcome,x.decision_request_id,x.disclosure_request_id,x.disclosed_at_ms
    FROM jsonb_to_recordset($1::jsonb) AS x(
      id text,kind text,goal text,motive text,status text,decided_at_ms bigint,planned_start_at_ms bigint,
      planned_finish_at_ms bigint,deferred_until_ms bigint,started_at_ms bigint,
      finished_at_ms bigint,updated_at_ms bigint,outcome jsonb,decision_request_id text,
      disclosure_request_id text,disclosed_at_ms bigint)
    ON CONFLICT (action_id) DO UPDATE SET
      status=EXCLUDED.status,started_at_ms=EXCLUDED.started_at_ms,finished_at_ms=EXCLUDED.finished_at_ms,
      updated_at_ms=EXCLUDED.updated_at_ms,outcome=EXCLUDED.outcome,
      planned_start_at_ms=EXCLUDED.planned_start_at_ms,planned_finish_at_ms=EXCLUDED.planned_finish_at_ms,
      deferred_until_ms=EXCLUDED.deferred_until_ms,disclosure_request_id=EXCLUDED.disclosure_request_id,
      disclosed_at_ms=EXCLUDED.disclosed_at_ms
    WHERE EXCLUDED.updated_at_ms>rin_memory_personal_actions.updated_at_ms
  `,[JSON.stringify(actions.map(a=>({
    id:a.id,kind:a.kind,goal:a.goal,motive:a.motive,status:a.status,decided_at_ms:a.decidedAt,
    planned_start_at_ms:a.plannedStartAt,planned_finish_at_ms:a.plannedFinishAt,
    deferred_until_ms:a.deferredUntil||null,started_at_ms:a.startedAt||null,finished_at_ms:a.finishedAt||null,updated_at_ms:a.updatedAt,
    outcome:a.outcome,decision_request_id:a.decisionRequestId,disclosure_request_id:a.disclosureRequestId,
    disclosed_at_ms:a.disclosedAt||null
  })))]);
  return {ok:true, snapshotHash:verified.acknowledged_hash, inserted:rows.length === 1};
}
export async function readLatestClientSnapshot(sqlClient = null) {
  const sql = sqlClient || await (await import('../archive/database.js')).archiveSql();
  const rows = await sql.query(`
    SELECT snapshot_hash,schema_version,client_updated_at_ms,facts,events,summaries,
      shared_moments,shared_symbols,personal_actions,created_at
    FROM rin_memory_client_snapshots
    ORDER BY created_at DESC,snapshot_hash DESC LIMIT 1`);
  const snapshot=rows[0] || null;
  if(!snapshot)return null;
  const actions=await sql.query(`
    SELECT action_id AS id,kind,goal,motive,status,decided_at_ms AS "decidedAt",
      planned_start_at_ms AS "plannedStartAt",planned_finish_at_ms AS "plannedFinishAt",
      deferred_until_ms AS "deferredUntil",disclosed_at_ms AS "disclosedAt",
      started_at_ms AS "startedAt",finished_at_ms AS "finishedAt",updated_at_ms AS "updatedAt",
      decision_request_id AS "decisionRequestId",disclosure_request_id AS "disclosureRequestId",outcome
    FROM rin_memory_personal_actions ORDER BY decided_at_ms DESC,action_id DESC LIMIT 10`);
  const mapped=actions.map(row=>({
    id:row.id,kind:row.kind,goal:row.goal,motive:row.motive,status:row.status,
    decidedAt:row.decidedAt,updatedAt:row.updatedAt,startedAt:row.startedAt,
    finishedAt:row.finishedAt,decisionRequestId:row.decisionRequestId,
    disclosureRequestId:row.disclosureRequestId,outcome:row.outcome,
    plannedStartAt:row.plannedStartAt,plannedFinishAt:row.plannedFinishAt,
    deferredUntil:row.deferredUntil,disclosedAt:row.disclosedAt
  }));
  const {mergePersonalActions}=await import('../../public/lib/action-lifecycle.js');
  return {...snapshot,events:correctKnownMemoryEvents(snapshot.events),
    recovered_personal_actions:mergePersonalActions(snapshot.personal_actions,mapped)};
}
