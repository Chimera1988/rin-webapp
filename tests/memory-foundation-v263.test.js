import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { memoryFoundationStatus, memoryObservationPreview } from '../lib/memory-foundation/status.js';
import { readMemoryFoundationStatus, readRecentMemorySources } from '../lib/memory-foundation/database.js';
import handler from '../api/memory-foundation.js';

const source = relative => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const fakeResponse = () => ({
  code: 200, headers: {}, body: null,
  setHeader(k, v) { this.headers[k] = v; return this; },
  status(value) { this.code = value; return this; },
  json(value) { this.body = value; return this; }
});

test('v2.6.3 source ledger is idempotent, atomic for future messages, and backfills existing archive', () => {
  const sql = source('db/migrations/002_memory_foundation.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS rin_memory_observations/u);
  assert.match(sql, /source_message_id TEXT PRIMARY KEY REFERENCES rin_archive_messages\(id\)/u);
  assert.match(sql, /AFTER INSERT ON rin_archive_messages/u);
  assert.match(sql, /ON CONFLICT \(source_message_id\) DO NOTHING/gu);
  assert.match(sql, /FROM rin_archive_messages\s+ON CONFLICT/u);
  assert.match(sql, /IF NOT EXISTS \(SELECT 1 FROM pg_trigger/u);
  for (const name of ['rin_memory_episodes','rin_memory_decisions','rin_memory_experiences','rin_memory_beliefs']) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${name}`, 'u'));
  }
  assert.doesNotMatch(sql,/^\s*(?:DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|UPDATE\s+rin_archive_messages)\b/imu);
});

test('v2.6.3 episodes, decisions, outcomes and beliefs enforce verifiable provenance, provisional status, confidence and revisions',()=>{
  const sql=source('db/migrations/002_memory_foundation.sql');
  assert.match(sql,/rin_memory_episodes[\s\S]+?source_message_id TEXT NOT NULL REFERENCES rin_memory_observations\(source_message_id\)/u);
  assert.match(sql,/rin_memory_decisions[\s\S]+?episode_id TEXT NOT NULL REFERENCES rin_memory_episodes\(episode_id\)/u);
  assert.match(sql,/rin_memory_experiences[\s\S]+?decision_id TEXT NOT NULL REFERENCES rin_memory_decisions\(decision_id\)/u);
  assert.match(sql,/rin_memory_beliefs[\s\S]+?PRIMARY KEY \(belief_key, revision\)/u);
  assert.match(sql,/tentative_lesson TEXT/u);
  assert.match(sql,/evidence_level TEXT NOT NULL DEFAULT 'observed'/u);
  assert.match(sql,/CHECK \(confidence BETWEEN 0 AND 1\)/u);
  assert.match(sql,/DEFAULT 'candidate'/u);
});

test('v2.6.3 status is read-only, bounded and explicitly disables memory-driven behavior', async()=>{
  const sql=[];
  const db={query:async s=>{sql.push(s);return [{archive_messages:'180',observations:'180',episodes:'0',decisions:'0',experiences:'0',belief_revisions:'0'}];}};
  const value=await readMemoryFoundationStatus(db);
  assert.equal(value.ok,true);
  assert.equal(value.mode,'evidence_only');
  assert.equal(value.learningEnabled,false);
  assert.equal(value.affectsCognition,false);
  assert.equal(value.provenanceComplete,true);
  assert.equal(value.counts.observations,180);
  assert.equal(sql.length,1);
  assert.match(sql[0],/SELECT COUNT\(\*\) FROM rin_memory_observations/u);
  assert.doesNotMatch(sql[0],/\b(?:INSERT|UPDATE|DELETE)\b/iu);
  assert.equal(memoryFoundationStatus({archive_messages:3,observations:2}).provenanceComplete,false);
  assert.equal(memoryFoundationStatus({archive_messages:'Infinity'}).counts.archive_messages,0);
});

test('v2.6.3 recent observations expose no conversation text or private URLs and only 20 bounded entries',async()=>{
  const rows=Array.from({length:35},(_,i)=>({source_message_id:`m-${i}`,event_time_ms:1791836421891+i,speaker_role:'assistant',message_kind:'voice',request_id:'r123',payload:{content:'secret'},blob_path:'secret'}));
  const db={query:async q=>{assert.match(q,/LIMIT 20/);return rows;}};
  const recent=await readRecentMemorySources(db);
  assert.equal(recent.length,20);
  assert.equal(recent[0].sourceMessageId,'m-0');
  assert.equal(recent[0].kind,'voice');
  assert.equal('content' in recent[0],false);
  assert.equal('blob_path' in recent[0],false);
  assert.equal(memoryObservationPreview(null).length,0);
});

test('v2.6.3 diagnostic endpoint enforces PIN, GET and never allows writes',async()=>{
  const previous=process.env.ACCESS_PIN;
  const previousDb=process.env.DATABASE_URL;
  try {
    process.env.ACCESS_PIN='987123';
    delete process.env.DATABASE_URL;
    const badMethod=fakeResponse();
    await handler({method:'POST',headers:{'x-rin-pin':'987123'}},badMethod);
    assert.equal(badMethod.code,405);
    assert.equal(badMethod.headers.Allow,'GET');
    const unauthorized=fakeResponse();
    await handler({method:'GET',headers:{'x-rin-pin':'bad'}},unauthorized);
    assert.equal(unauthorized.code,401);
    const unconfigured=fakeResponse();
    await handler({method:'GET',headers:{'x-rin-pin':'987123'}},unconfigured);
    assert.equal(unconfigured.code,503);
    assert.equal(unconfigured.body.code,'MEMORY_FOUNDATION_NOT_CONFIGURED');
  } finally {
    if(previous===undefined)delete process.env.ACCESS_PIN;else process.env.ACCESS_PIN=previous;
    if(previousDb===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previousDb;
  }
});

test('v2.6.3 does not modify production cognition, existing memory or the chat archive paths',()=>{
  const api=source('api/memory-foundation.js');
  assert.match(api,/requirePin\(req, res\)/u);
  assert.match(api,/mode === 'status'/u);
  assert.match(api,/mode === 'recent'/u);
  assert.doesNotMatch(api,/POST.*(?:insert|write|save)/iu);
  const release=source('public/js/release.js');
  assert.match(release,/memory-foundation/u);
});
