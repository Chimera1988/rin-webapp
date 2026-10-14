import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {PATCHES,ADDED_FILES,BASE_RELEASE,NEXT_RELEASE} from '../installer/patches.mjs';
import {createCloudMemorySync} from '../public/js/cloud_memory_sync.js';
import {backfillRinActions} from '../lib/memory-foundation/backfill.js';

test('all patches have unique paths, anchored changes and one-way releases',()=>{
  assert.equal(PATCHES.length,4);
  assert.equal(new Set(PATCHES.map(x=>x.path)).size,4);
  assert.ok(BASE_RELEASE.includes('2.6.16')&&NEXT_RELEASE.includes('2.6.17'));
  for(const patch of PATCHES){
    assert.match(patch.baseSha,/^[0-9a-f]{40}$/);
    for(const [old,next] of patch.changes){assert.ok(old.length>0);assert.notEqual(old,next);assert.ok(next.includes(old)||patch.path==='public/js/release.js');}
  }
  assert.equal(new Set(ADDED_FILES).size,ADDED_FILES.length);
});

test('cloud backup saves content once, does not mutate browser diary and verifies server acknowledgement',async()=>{
  let calls=0;
  const saved=new Map();
  const local={_schema:9,_updated_at:500, facts:{user:{language:'русский'}},events:[],summaries:[],relationship:{sharedMoments:[],sharedSymbols:[]}};
  const json=JSON.stringify(local);
  const fetchFn=async (url,options)=>{
    calls++;
    const body=JSON.parse(options.body);
    assert.equal(url,'/api/archive');assert.equal(body.action,'memory-snapshot');
    return {ok:true,json:async()=>({ok:true,snapshotHash:body.snapshot.snapshot_hash,inserted:true})};
  };
  globalThis.crypto ||= webcrypto;
  const sync=createCloudMemorySync({getDiary:async()=>local,storage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)},fetchFn,headers:()=>({'x-test':'ok'})});
  assert.equal((await sync.sync()).ok,true);
  assert.equal((await sync.sync()).duplicate,true);
  assert.equal(calls,1);
  local._updated_at=600; // No content change, so not a new cloud snapshot.
  assert.equal((await sync.sync()).duplicate,true);
  assert.equal(JSON.stringify({...local,_updated_at:500}),json);
});

test('bounded archive backfill returns cursor and only saves source-linked first-person claims',async()=>{
 const msg=(id,text,ts)=>({id,ts,role:'assistant',kind:'text',status:'complete',content:text});
 const records=[msg('one','Я закончила перевод.',10),msg('two','Я не закончила перевод.',20),msg('three','Я собрала комментарии.',30)];
 const queries=[];
 const db={query:async(q,args=[])=>{
   queries.push({q,args});
   if(q.includes('SELECT id,ts,role,kind,status,payload')) return records.slice(0,2).map(x=>({...x,payload:x}));
   if(q.includes('INSERT INTO rin_memory_records')) return [{record_id:'one'}];
   throw new Error('Unexpected SQL');
 }};
 const outcome=await backfillRinActions({afterTs:0,afterId:'',limit:1},db);
 assert.equal(outcome.scanned,1);
 assert.equal(outcome.candidates,1);
 assert.equal(outcome.inserted,1);
 assert.equal(outcome.hasMore,true);
 assert.deepEqual(outcome.nextCursor,{afterTs:10,afterId:'one'});
 assert.equal(queries.length,2);
});
