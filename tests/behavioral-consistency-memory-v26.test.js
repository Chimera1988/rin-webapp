import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage } from './helpers/runtime.js';

const storage = new MemoryStorage();
globalThis.localStorage = storage;
const memory = await import('../public/js/rin_memory.js');

test.beforeEach(() => { storage.clear(); memory.wipeAllPersona(); });

test('v2.6.0 identical previously stored memory facts are not misreported as newly learned', async () => {
  const facts=[{path:'user.favoriteMovie',value:'Лёгкая комедия',confidence:0.93},
    {path:'user.preference.nightFarewell',value:'Тёплое прощание',confidence:0.93}];
  const initial=await memory.applyMemoryExtraction({facts},{jobId:'mem-1',now:10000});
  assert.deepEqual(initial.savedFactPaths,['user.favoriteMovie','user.preference.nightFarewell']);
  const again=await memory.applyMemoryExtraction({facts},{jobId:'mem-2',now:10001});
  assert.deepEqual(again.savedFactPaths,[]);
  const diary=await memory.loadDiary();
  assert.equal(diary.facts.user.favoriteMovie,'Лёгкая комедия');
  assert.equal(diary.facts.user.preference.nightFarewell,'Тёплое прощание');
  assert.equal(diary.processedMemoryJobs.length,2);
});

test('v2.6.0 genuinely corrected fact is updated exactly once', async()=>{
  await memory.applyMemoryExtraction({facts:[{path:'user.workArrangement',value:'офис',confidence:0.85}]},{jobId:'job-1'});
  const updated=await memory.applyMemoryExtraction({facts:[{path:'user.workArrangement',value:'из дома',confidence:0.92}]},{jobId:'job-2'});
  assert.deepEqual(updated.savedFactPaths,['user.workArrangement']);
  const repeated=await memory.applyMemoryExtraction({facts:[{path:'user.workArrangement',value:'из дома',confidence:0.92}]},{jobId:'job-3'});
  assert.deepEqual(repeated.savedFactPaths,[]);
  assert.equal((await memory.loadDiary()).facts.user.workArrangement,'из дома');
});
