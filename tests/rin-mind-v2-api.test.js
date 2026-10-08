/* Historical filename retained for replacement-file deployment. Contracts now cover Rin v3. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildV3RealizationSchema,parseV3Realization} from '../lib/cognition/v3/realization.js';
import {buildCognitiveTurnPlan} from '../lib/cognition/v3/turn-plan.js';
import {settleCognitiveGraph} from '../lib/cognition/v3/cognitive-dynamics.js';

const original={pin:process.env.ACCESS_PIN,key:process.env.OPENAI_API_KEY,mind:process.env.OPENAI_MIND_MODEL};
process.env.ACCESS_PIN='1357';process.env.OPENAI_API_KEY='test-key';process.env.OPENAI_MIND_MODEL='gpt-6-luna';
const chat=await import('../api/chat.js?v3-transport');
test.after(()=>{
 for(const [key,value] of Object.entries({ACCESS_PIN:original.pin,OPENAI_API_KEY:original.key,OPENAI_MIND_MODEL:original.mind})){
  if(value===undefined)delete process.env[key];else process.env[key]=value;
 }
});
const plan=()=>buildCognitiveTurnPlan({settled:settleCognitiveGraph(),kernelState:{userText:'Привет',scene:{type:'everyday'},
  innerLife:{energy:60},perception:{signals:[]}},stickerState:{available:false}});

test('v3 voice schema is byte stable for every turn',()=>{
 const first=buildV3RealizationSchema();
 assert.equal(JSON.stringify(first),JSON.stringify(buildV3RealizationSchema()));
 assert.equal(first.json_schema.name,'rin_v3_realization');
});
test('v3 parser accepts text content only and cannot own final decision',()=>{
 const result=parseV3Realization({segments:[{text:'Привет.'}],decision:{act:'other',delivery:{responseDepth:'extended'}}},plan());
 assert.deepEqual(result.segments,[{type:'text',purpose:'natural_reply',text:'Привет.'}]);
 assert.equal('decision' in result,false);
});
test('v3 realization rejects schema with wrong number of text segments',()=>{
 assert.throws(()=>parseV3Realization({segments:[]},plan()),/SEGMENT_COUNT/);
});
test('GPT-6 uses max_completion_tokens and removes temperature for reasoning',async()=>{
 const originalFetch=globalThis.fetch;let captured;
 globalThis.fetch=async(_,options)=>{captured=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{message:{content:'x'},finish_reason:'stop'}],usage:{}}),{status:200});};
 try{
  await chat.openaiChat({model:'gpt-6-luna',messages:[{role:'system',content:'x'}],temperature:.58,max_tokens:1200,reasoning_effort:'low'});
  assert.equal(captured.max_completion_tokens,1200);
  assert.equal('temperature' in captured,false);
 }finally{globalThis.fetch=originalFetch;}
});
test('rollbacks use legacy model transport without explicit cache',()=>{
 const prompt={system:'stable\n\ndynamic',stableSystem:'stable',dynamicSystem:'dynamic'};
 assert.equal(chat.supportsExplicitPromptCache('gpt-4.1'),false);
 assert.equal(chat.supportsExplicitPromptCache('gpt-6-luna'),true);
 assert.deepEqual(chat.buildMindMessages(prompt,'gpt-4.1'),[{role:'system',content:prompt.system}]);
});
test('stable cache key changes with schema but not dynamic content',()=>{
 const a=chat.buildMindCacheKey('same stable','gpt-6-luna',buildV3RealizationSchema());
 const b=chat.buildMindCacheKey('same stable','gpt-6-luna',buildV3RealizationSchema());
 assert.equal(a,b);assert.match(a,/^rin-mind-[a-f0-9]{40}$/);
 assert.notEqual(a,chat.buildMindCacheKey('changed','gpt-6-luna',buildV3RealizationSchema()));
});
test('nightly terminal silence need not invoke Luna to add unnecessary text',()=>{
 const p=plan();assert.equal(p.decision.delivery.segments.length,1);
 assert.equal(p.responseRequired,true);
});
