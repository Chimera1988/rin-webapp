import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage } from './helpers/runtime.js';
import { evolveRelationalIntegrity } from '../lib/cognition/relational-integrity.js';

const store = new MemoryStorage();
globalThis.localStorage = store;
const memory = await import('../public/js/rin_memory.js');

test.beforeEach(()=>{store.clear();memory.wipeAllPersona();});

test('commits and reloads rejected terms and unresolved conflicts without mutating existing older diary data',async()=>{
  const prior=(await memory.loadDiary()).conversationState;
  const integrity=evolveRelationalIntegrity({previous:prior.relationalIntegrity,userText:'Ну не надзиратель, это грубовато',revision:prior.revision});
  const first=await memory.commitTurnState({requestId:'rel-1',stateTransition:{relationalIntegrity:integrity},now:1791828000000});
  assert.equal(first.applied,true);
  let saved=await memory.loadDiary();
  assert.equal(saved.conversationState.relationalIntegrity.boundaries[0].term,'надзиратель');
  assert.equal(saved.conversationState.relationalIntegrity.rupture.affected,'user');
  assert.equal(saved.conversationState.revision,1);
  const dupe=await memory.commitTurnState({requestId:'rel-1',stateTransition:{relationalIntegrity:null},now:1791828000000});
  assert.equal(dupe.duplicate,true);
  saved=await memory.loadDiary();
  assert.equal(saved.conversationState.revision,1);
  const unchanged=await memory.commitTurnState({requestId:'rel-2',stateTransition:{},now:1791828001000});
  assert.equal(unchanged.applied,true);
  saved=await memory.loadDiary();
  assert.equal(saved.conversationState.relationalIntegrity.boundaries[0].status,'active');
});

test('repeated coercion after prior reconciliation remains a bounded incident pattern',()=>{
  let s=evolveRelationalIntegrity({userText:'Если любишь меня, то обязана перестать обижаться',revision:0});
  assert.equal(s.incidents[0].count,1);
  s=evolveRelationalIntegrity({previous:s,userText:'Прости, я не хотел давить',revision:1});
  s=evolveRelationalIntegrity({previous:s,userText:'Давай помиримся',revision:2});
  s=evolveRelationalIntegrity({previous:s,userText:'Если любишь меня, то обязана перестать обижаться',revision:3});
  assert.equal(s.incidents[0].count,2);
  assert.ok(s.rupture.intensity>48);
  assert.equal(s.incidents.length,1);
});

test('explicit space request disables unsolicited contact until the user initiates anew',()=>{
  let s=evolveRelationalIntegrity({userText:'Не пиши мне, я хочу побыть один',revision:10});
  assert.equal(s.contactBoundary.active,true);
  s=evolveRelationalIntegrity({previous:s,userText:'',revision:11});
  assert.equal(s.contactBoundary.active,true);
  s=evolveRelationalIntegrity({previous:s,userText:'Привет, я вернулся',revision:12});
  assert.equal(s.contactBoundary.active,false);
});
