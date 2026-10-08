import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryStorage,createReq,createRes} from './helpers/runtime.js';
import {normalizeCognitivePersistence} from '../public/lib/cognitive-state-contract.js';

const original={pin:process.env.ACCESS_PIN,key:process.env.OPENAI_API_KEY};
process.env.ACCESS_PIN='8844';process.env.OPENAI_API_KEY='test-key';
const chat=(await import('../api/chat.js?v3-persistence')).default;
const store=await import('../public/js/rin_memory.js?v3-persistence');
test.after(()=>{
 if(original.pin===undefined)delete process.env.ACCESS_PIN;else process.env.ACCESS_PIN=original.pin;
 if(original.key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=original.key;
});
const withStorage=async fn=>{
 const prior=globalThis.localStorage;globalThis.localStorage=new MemoryStorage();
 try{return await fn();}finally{globalThis.localStorage=prior;}
};
function user(text,id){return {role:'user',kind:'text',status:'sent',id:`u-${id}`,requestId:id,content:text};}
function mockLuna(){const previous=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{
  calls++;
  return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({segments:[{text:'Я тебя услышала.'}]})},finish_reason:'stop'}],usage:{prompt_tokens:50,completion_tokens:10}}),{status:200});
 };return {count:()=>calls,restore:()=>{globalThis.fetch=previous;}};}
async function respond({id,text,history,memory}){
 const res=createRes();await chat(createReq({headers:{'x-rin-pin':'8844'},body:{requestId:id,history:history||[user(text,id)],memory,
   client:{sticker:{mode:'off'}}}}),res);return res;
}

test('2.5 diary remains readable after v3 cognitive schema migration',async()=>withStorage(async()=>{
  const prior=await store.loadDiary();
  await store.upsertFact('user.project','Rin');
  const upgraded=await store.loadDiary();
  assert.equal(upgraded._schema,10);
  assert.equal(upgraded.facts.user.project,'Rin');
  assert.equal(upgraded.cognitiveState.schema,'rin-cognitive-state-v3');
  assert.equal(upgraded.cognitiveState.revision,0);
  assert.deepEqual(upgraded.conversationState.openLoops,prior.conversationState.openLoops);
}));
test('single committed v3 state stays byte-identical after reload',async()=>withStorage(async()=>{
  const originalState=normalizeCognitivePersistence({revision:1,learnedWeights:{'attachment->support':.014}});
  const commit=await store.commitTurnState({requestId:'persist-1',stateTransition:{cognitiveState:originalState},now:9000000});
  assert.equal(commit.applied,true);
  const loaded=await store.loadDiary();
  assert.deepEqual(loaded.cognitiveState,originalState);
  assert.equal(loaded.conversationState.lastCommittedRequestId,'persist-1');
}));
test('duplicate client commit does not double-apply plasticity or revision',async()=>withStorage(async()=>{
  const state=normalizeCognitivePersistence({revision:1,learnedWeights:{'trust->disclose':.006}});
  const first=await store.commitTurnState({requestId:'dup',stateTransition:{cognitiveState:state}});
  const second=await store.commitTurnState({requestId:'dup',stateTransition:{cognitiveState:{...state,revision:2}}});
  const loaded=await store.loadDiary();
  assert.equal(first.applied,true);assert.equal(second.duplicate,true);
  assert.equal(loaded.cognitiveState.revision,1);
}));
test('malformed graph persistence cannot overwrite core values or escape learning bounds',async()=>withStorage(async()=>{
  const state={schema:'rin-cognitive-state-v3',revision:1,learnedWeights:{'trust->disclose':5,
    'honesty->deception':999},traits:{honesty:0,loyalty:0},history:[]};
  await store.commitTurnState({requestId:'malformed',stateTransition:{cognitiveState:state}});
  const loaded=await store.loadDiary();
  assert.equal(loaded.cognitiveState.learnedWeights['trust->disclose'],.16);
  assert.equal(loaded.cognitiveState.learnedWeights['honesty->deception'],undefined);
  assert.equal(loaded.cognitiveState.traits.honesty,.88);
}));
test('missing cognitive state in legacy transition never resets previously learned weights',async()=>withStorage(async()=>{
  await store.commitTurnState({requestId:'first',stateTransition:{cognitiveState:normalizeCognitivePersistence({revision:1,
    learnedWeights:{'attachment->support':.05}})}});
  await store.commitTurnState({requestId:'second',stateTransition:{}});
  const loaded=await store.loadDiary();
  assert.equal(loaded.cognitiveState.revision,1);
  assert.equal(loaded.cognitiveState.learnedWeights['attachment->support'],.05);
}));
test('two real API turns: explicit supportive feedback changes a durable cognitive edge',async()=>withStorage(async()=>{
  const m=mockLuna();try{
    const one=await respond({id:'one',text:'Привет)'});assert.equal(one.statusCode,200,JSON.stringify(one.body));
    const memory=await store.loadDiary();
    const committedOne=await store.commitTurnState({requestId:'one',innerLife:memory.innerLife,
      stateTransition:one.body.stateTransition});
    assert.equal(committedOne.applied,true);
    const nextMemory=await store.loadDiary();
    const history=[user('Привет)','one'),{role:'assistant',kind:'text',status:'complete',turnId:'rin-turn-one',
      requestId:'one',id:'a-one',content:one.body.reply},user('Спасибо, мне стало легче','two')];
    const second=await respond({id:'two',text:'Спасибо, мне стало легче',history,memory:nextMemory});
    assert.equal(second.statusCode,200,JSON.stringify(second.body));
    assert.ok(second.body.cognition.cognitiveDynamics.plasticity.length>0);
    await store.commitTurnState({requestId:'two',stateTransition:second.body.stateTransition});
    const loaded=await store.loadDiary();
    assert.ok(loaded.cognitiveState.learnedWeights['attachment->support']>0);
    assert.equal(loaded.cognitiveState.revision,2);
    assert.equal(m.count(),2);
  }finally{m.restore();}
}));
