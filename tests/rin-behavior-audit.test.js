import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scenarios } from './fixtures/rin-audit-scenarios.mjs';
import { applyMemoryExtraction, getFact } from '../public/js/rin_memory.js';
import { MemoryStorage } from './helpers/runtime.js';
import { buildServerProfile } from '../lib/server/canonical-profile.js';
import { buildRinMindPrompt } from '../lib/cognition/rin-mind.js';

for (const s of scenarios) test(`${s.id}: ${s.category}`, s.check);
test('stable character core and canonical speech habits reach the active prompt', async () => {
  const profile=await buildServerProfile();
  const a=buildRinMindPrompt({profile,state:{userText:'Привет'}});
  const b=buildRinMindPrompt({profile,state:{userText:'Объясни транзакции'}});
  assert.equal(a.stableSystem,b.stableSystem);
  assert.ok(a.stableSystem.includes(profile.prompt_profile.character_contract.core));
  assert.ok(a.stableSystem.includes('Чем я могу помочь'));
  assert.ok(a.stableSystem.includes('Для технической задачи допустимы код'));
});
test('absent and invalid fact confidence cannot become trusted memory', async () => {
  const before=globalThis.localStorage;globalThis.localStorage=new MemoryStorage();
  try {
    for(const confidence of [undefined,'invalid',0.2]) {
      await applyMemoryExtraction({facts:[{path:'user.name',value:'Догадка',confidence}]});
      assert.equal(await getFact('user.name'),undefined);
    }
  } finally {globalThis.localStorage=before;}
});
test('initiative checkbox starts unchecked until an explicit saved setting is loaded',()=>{
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const input=html.match(/<input id="autoInitiationsEnabled"[^>]+>/u)?.[0];
  assert.ok(input);assert.doesNotMatch(input,/\bchecked\b/u);
});

test('memory rejects secret paths and hostile retractions as well as writes', async()=>{
  const {factPathParts}=await import('../public/lib/memory-fact-contract.js');
  const {sanitizeMemoryResult}=await import('../api/memory.js');
  for(const path of ['user.password','user.api_key','user.access_pin','user.__proto__.name','user.constructor.prototype.name']) {
    assert.deepEqual(factPathParts(path),[]);
    const output=sanitizeMemoryResult({facts:[{path,value:'sensitive',confidence:1}],factRetractions:[{path}]});
    assert.equal(output.facts.length,0);assert.equal(output.factRetractions.length,0);
  }
});
test('anxiety is recognized and negated achievements do not become joy',async()=>{
  const {detectAffectiveSignal}=await import('../lib/cognition/emotional-state.js');
  assert.equal(detectAffectiveSignal({userText:'Мне тревожно 😁'}).type,'user_distress');
  for(const userText of ['Не получилось','Не сдал экзамен','Не выиграл'])
    assert.notEqual(detectAffectiveSignal({userText}).type,'shared_joy');
});

test('short explicit corrections and forgetting requests qualify for existing memory extraction',async()=>{
  const {requestsMemoryRevision}=await import('../public/js/memory_job_queue.js');
  for(const text of ['Поправка: я из Казани','Я теперь живу в Твери','Я больше не люблю джаз','Забудь мой адрес','Не запоминай это','Удали из памяти мой город'])
    assert.equal(requestsMemoryRevision(text),true,text);
  for(const text of ['Нет','Да','Удали файл','Привет','Как твой день?']) assert.equal(requestsMemoryRevision(text),false,text);
});
