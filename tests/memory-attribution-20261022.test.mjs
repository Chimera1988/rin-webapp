import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  correctKnownMemoryAttribution, correctKnownMemoryEvents,
  DALI_READING_CORRECTED_TEXT, DALI_READING_WRONG_TEXT
} from '../public/lib/memory-attribution.js';
import {snapshotBody, prepareClientSnapshot} from '../public/js/cloud_memory_snapshot.js';
import {normalizeClientSnapshot,readLatestClientSnapshot} from '../lib/memory-foundation/snapshots.js';

const badEvent=()=>({id:'k-2347l',ts:1792692670527,key:'k-2347l',tags:['reading','life_choice'],
  text:DALI_READING_WRONG_TEXT,type:'plan',importance:7});
const oldHash=body=>createHash('sha256').update(new TextEncoder().encode(JSON.stringify(body))).digest('hex');

test('actual Dali reading owner is Rin; retain the event identity and status',()=>{
  const raw=badEvent(), corrected=correctKnownMemoryAttribution(raw);
  assert.equal(corrected.id,raw.id);
  assert.equal(corrected.key,raw.key);
  assert.equal(corrected.ts,raw.ts);
  assert.equal(corrected.type,'plan');
  assert.equal(corrected.text,DALI_READING_CORRECTED_TEXT);
  assert.equal(raw.text,DALI_READING_WRONG_TEXT);
  assert.match(corrected.text,/начало чтения не подтверждено/);
});

test('no change to other events, even if text happens to mention the book',()=>{
  const unrelated={...badEvent(),id:'other-event',key:'other-event'};
  const different={...badEvent(),text:'Рин прочла книгу'};
  assert.equal(correctKnownMemoryAttribution(unrelated),unrelated);
  assert.equal(correctKnownMemoryAttribution(different),different);
  assert.deepEqual(correctKnownMemoryEvents([unrelated,different]),[unrelated,different]);
});

test('future snapshots canonically correct the existing event',async()=>{
  const diary={_schema:9,events:[badEvent()]};
  const snap=await prepareClientSnapshot(diary);
  assert.equal(snap.events[0].text,DALI_READING_CORRECTED_TEXT);
  assert.equal(normalizeClientSnapshot(snap).snapshot_hash,snap.snapshot_hash);
});

test('legacy correctly-signed snapshot is accepted but canonicalized',()=>{
  const canonicalBody=snapshotBody({_schema:9,events:[badEvent()]});
  const original={...canonicalBody,events:[badEvent()]};
  const incoming={...original,snapshot_hash:oldHash(original)};
  const normalized=normalizeClientSnapshot(incoming);
  assert.equal(normalized.acknowledged_hash,incoming.snapshot_hash);
  assert.notEqual(normalized.snapshot_hash,incoming.snapshot_hash);
  assert.equal(normalized.events[0].text,DALI_READING_CORRECTED_TEXT);
});

test('legacy SHA mismatch is not accepted if other fields are tampered with',()=>{
  const canonicalBody=snapshotBody({_schema:9,events:[badEvent()]});
  const original={...canonicalBody,events:[badEvent()]};
  const signed={...original,snapshot_hash:oldHash(original)};
  assert.throws(()=>normalizeClientSnapshot({...signed,facts:{user:{madeup:'wrong'}}}),/HASH_MISMATCH/);
});

test('readLatestClientSnapshot corrects old immutable snapshots in the view',async()=>{
  const sql={query:async statement=>/FROM rin_memory_personal_actions/.test(statement) ? [] : [{
    snapshot_hash:'legacy-hash',events:[badEvent()],personal_actions:[]
  }]};
  const latest=await readLatestClientSnapshot(sql);
  assert.equal(latest.events[0].text,DALI_READING_CORRECTED_TEXT);
});
