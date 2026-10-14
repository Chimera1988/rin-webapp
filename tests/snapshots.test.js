import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareClientSnapshot} from '../public/js/cloud_memory_snapshot.js';
import {normalizeClientSnapshot,writeClientSnapshot,readLatestClientSnapshot} from '../lib/memory-foundation/snapshots.js';
const diary={_schema:9,_updated_at:1792008000000,facts:{user:{preference:{tea:'сэнтя'},apiKey:'must-not-sync'}},events:[{text:'У нас был важный разговор'}],summaries:[],relationship:{sharedMoments:[{text:'Наш вечер'}],sharedSymbols:[]}};

test('browser WebCrypto snapshots match server Node verification',async()=>{
 const a=await prepareClientSnapshot(diary),b=await prepareClientSnapshot(diary);
 assert.deepEqual(a,b);
 assert.equal(a.snapshot_hash.length,64);
 assert.equal(a.facts.user.preference.tea,'сэнтя');
 assert.equal(a.facts.user.apiKey,undefined);
 assert.equal(normalizeClientSnapshot(a).snapshot_hash,a.snapshot_hash);
});
test('tampered snapshot is rejected before SQL write',async()=>{
 const a=await prepareClientSnapshot(diary);a.facts.user.preference.tea='чай';
 const mock={query:async()=>{throw new Error('should not query');}};
 await assert.rejects(writeClientSnapshot(a,mock),/HASH_MISMATCH/);
});
test('snapshot is an immutable idempotent copy, not a browser restore',async()=>{
 let saved=null;
 const mock={query:async(q,args)=>{if(q.includes('INSERT')){saved=args;return [{snapshot_hash:'hash'}];}return [{snapshot_hash:'hash',facts:{}}];}};
 const a=await prepareClientSnapshot(diary);
 const res=await writeClientSnapshot(a,mock);
 assert.equal(res.ok,true);
 assert.equal(res.inserted,true);
 assert.equal(saved[0],a.snapshot_hash);
 assert.equal((await readLatestClientSnapshot(mock)).snapshot_hash,'hash');
});
test('reject snapshot exceeding 300KB before any hashing',async()=>{
 const massive={...diary,events:Array.from({length:120},()=>({text:'a'.repeat(5000)}))};
 await assert.rejects(prepareClientSnapshot(massive),/MEMORY_SNAPSHOT_TOO_LARGE/);
});
