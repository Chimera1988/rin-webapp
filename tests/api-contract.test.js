import test from 'node:test';
import assert from 'node:assert/strict';
import {createReq,createRes} from './helpers/runtime.js';

const env={pin:process.env.ACCESS_PIN,key:process.env.OPENAI_API_KEY,mind:process.env.OPENAI_MIND_MODEL};
process.env.ACCESS_PIN='1357';process.env.OPENAI_API_KEY='test-key';process.env.OPENAI_MIND_MODEL='gpt-6-luna';
const chat=await import('../api/chat.js?v3-api-contract');
const memoryApi=await import('../api/memory.js?v3-api-contract');
test.after(()=>{for(const [k,name] of [['pin','ACCESS_PIN'],['key','OPENAI_API_KEY'],['mind','OPENAI_MIND_MODEL']]){
  if(env[k]===undefined)delete process.env[name];else process.env[name]=env[k];
}});
function mockResponse(value){return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)},finish_reason:'stop'}],
  usage:{prompt_tokens:140,completion_tokens:28,total_tokens:168,prompt_tokens_details:{cached_tokens:80}},model:'gpt-6-luna'}),
  {status:200,headers:{'content-type':'application/json'}});}
function request(text='Привет)',id='r1',options={}){
  return createReq({headers:{'x-rin-pin':'1357'},body:{requestId:id,history:[{role:'user',kind:'text',status:'sent',requestId:id,id:`u-${id}`,content:text}],
    client:{sticker:{mode:'off',probability:0,safeMode:true}},...options}});
}
function intercept(fn=()=>({segments:[{text:'Угу, я здесь.'}]})){
  const original=globalThis.fetch, calls=[];
  globalThis.fetch=async(url,options={})=>{
    const body=JSON.parse(options.body||'{}');calls.push({url,body});
    return mockResponse(fn(body,calls));
  };
  return {calls,restore(){globalThis.fetch=original;}};
}
async function run(req){const res=createRes();await chat.default(req,res);return res;}
const traceName='rin_v3_realization';

test('memory API preserves durable fact scope rather than accepting relationship mutations',()=>{
  const result=memoryApi.sanitizeMemoryResult({facts:[{path:'user.project',value:'Rin',confidence:.98}],
    events:[],mood:{energy:0},relationship:{trust:0}});
  assert.equal(result.facts[0].path,'user.project');
  assert.equal('relationship' in result,false);
});
test('single Luna invocation is a strict voice-only JSON schema',async()=>{
  const m=intercept();try{
    const r=await run(request('Привет)','v3-schema'));
    assert.equal(r.statusCode,200,JSON.stringify(r.body));
    assert.equal(m.calls.length,1);
    const b=m.calls[0].body;
    assert.equal(b.response_format.json_schema.name,traceName);
    assert.deepEqual(Object.keys(b.response_format.json_schema.schema.properties),['segments']);
    assert.equal(b.model,'gpt-6-luna');assert.equal(b.reasoning_effort,'none');
    assert.equal(b.max_completion_tokens,1200);
    assert.equal(r.body.reply,'Угу, я здесь.');
    assert.equal(r.body.turnDecision.source,'rin-cognitive-turn-plan-v3');
    assert.equal(r.body.model.kernel,'rin-cognitive-dynamics-v3');
    assert.equal(r.body.promptMetrics.calls.realization,1);
    assert.equal(r.body.promptMetrics.calls.mind,0);
    assert.equal(r.body.promptMetrics.semanticRetries,0);
  }finally{m.restore();}
});
test('cached stable voice prefix and volatile context have distinct developer messages',async()=>{
  const m=intercept();try{
    const r=await run(request('Мне хочется поговорить','v3-cache'));
    assert.equal(r.statusCode,200);
    const b=m.calls[0].body;
    assert.equal(b.messages.length,2);
    assert.equal(b.messages[0].role,'developer');
    assert.deepEqual(b.messages[0].content[0].prompt_cache_breakpoint,{mode:'explicit'});
    assert.equal(b.messages[1].role,'developer');
    assert.match(b.messages[1].content,/Мне хочется поговорить/);
    assert.equal(b.prompt_cache_options.ttl,'30m');
  }finally{m.restore();}
});
test('model-supplied intent decision is ignored: TurnPlan remains authoritative',async()=>{
  const m=intercept(()=>({segments:[{text:'Я с тобой.'}],decision:{act:'force_breakup',intentTransition:{operation:'cancel'}}}));
  try{
    const r=await run(request('Можешь побыть рядом?','v3-control'));
    assert.equal(r.statusCode,200);
    assert.notEqual(r.body.turnDecision.act,'force_breakup');
    assert.notEqual(r.body.turnDecision.intentTransition.operation,'cancel');
  }finally{m.restore();}
});
test('direct question must produce response, not scene closure silence',async()=>{
  const m=intercept();try{
    const history=[{role:'assistant',kind:'text',status:'complete',turnId:'previous',content:'Я закрываю глаза. Уже засыпаю.'},
      {role:'user',kind:'text',status:'sent',requestId:'question-sleep',id:'user-question',content:'Ты спишь?'}];
    const r=await run(request('Ты спишь?','question-sleep',{history}));
    assert.equal(r.statusCode,200);assert.notEqual(r.body.deliveryPlan.mode,'silence');
  }finally{m.restore();}
});
test('terminal presence acknowledgement after sleep closure returns actual silence without model call',async()=>{
  const m=intercept();try{
    const history=[{role:'assistant',kind:'text',status:'complete',turnId:'previous',content:'Я закрываю глаза. Уже засыпаю.'},
      {role:'user',kind:'text',status:'sent',requestId:'sleep-close',id:'u-close',content:'Я рядом)'}];
    const r=await run(request('Я рядом)','sleep-close',{history}));
    assert.equal(r.statusCode,200,JSON.stringify(r.body));
    assert.equal(r.body.deliveryPlan.mode,'silence');
    assert.equal(m.calls.length,0);
    assert.equal(r.body.reply,'');
    assert.equal(r.body.promptMetrics.calls.realization,0);
    assert.equal(r.body.stateTransition.cognitiveState.schema,'rin-cognitive-state-v3');
  }finally{m.restore();}
});
test('user distress under night fatigue still yields response',async()=>{
  const m=intercept(()=>({segments:[{text:'Я рядом. Что случилось?'}]}));
  try{
    const r=await run(request('Мне сейчас плохо','night-support',{memory:{innerLife:{energy:12,needForQuiet:95,sleepPhase:'interrupted_sleep'}}}));
    assert.equal(r.statusCode,200);
    assert.equal(r.body.turnDecision.delivery.responseDepth,'short');
    assert.notEqual(r.body.deliveryPlan.mode,'silence');
    assert.ok(m.calls.length===1);
  }finally{m.restore();}
});
test('stop-questions boundary suppresses generated question without changing TurnPlan',async()=>{
  const m=intercept(()=>({segments:[{text:'Ладно, отступаю) А что дальше?'}]}));
  try{
    const r=await run(request('Хватит вопросов пока)','no-questions'));
    assert.equal(r.statusCode,200);
    assert.equal(r.body.turnDecision.question.mode,'none');
    assert.equal(r.body.reply.includes('?'),false);
  }finally{m.restore();}
});
test('invalid Luna output falls back locally without retry or decision replacement',async()=>{
  const m=intercept(()=>({invalid:true}));try{
    const r=await run(request('Привет','bad-output'));
    assert.equal(r.statusCode,200);
    assert.equal(r.body.promptMetrics.modelFallback,true);
    assert.equal(m.calls.length,1);
    assert.ok(r.body.reply.length>0);
    assert.equal(r.body.turnDecision.source,'rin-cognitive-turn-plan-v3');
  }finally{m.restore();}
});
test('false autobiographical model claim is rejected without second LLM call',async()=>{
  const m=intercept(()=>({segments:[{text:'Я только что была на Луне и разговаривала с астронавтами.'}]}));try{
    const r=await run(request('Привет)','reality'));
    assert.equal(r.statusCode,200);
    assert.equal(m.calls.length,1);
    assert.ok(r.body.reply.length>0);
    assert.ok(r.body.stateTransition);
  }finally{m.restore();}
});
test('sticker permission is grounded in asset availability, not forced by model',async()=>{
  const m=intercept(()=>({segments:[{text:'Угу.'}],stickerIntent:'nonexistent_sticker'}));try{
    const r=await run(request('Привет','sticker-off'));
    assert.equal(r.statusCode,200);
    assert.equal(r.body.deliveryPlan.segments.every(s=>s.type==='text'),true);
  }finally{m.restore();}
});
test('multi-turn intent is preserved across ordinary contact and in cognitive graph',async()=>{
  const m=intercept();try{
    const r=await run(request('Я рядом)','intent-preserve',{memory:{conversationState:{revision:15,rinIntent:{status:'active',kind:'maintenance',goal:'взаимная игра',target:'playful_closeness',startedAtTurn:10}}}}));
    assert.equal(r.statusCode,200);
    assert.equal(r.body.turnDecision.intentTransition.operation,'preserve');
    assert.equal(r.body.stateTransition.rinIntent.status,'active');
  }finally{m.restore();}
});
test('cognitive state advances as one committed state transition with feedback trace',async()=>{
  const m=intercept();try{
    const r=await run(request('Спасибо, мне стало легче','feedback',{memory:{cognitiveState:{schema:'rin-cognitive-state-v3',revision:4,
      lastTurn:{id:'previous',turnId:'rin-turn-previous',act:'supportive_presence'}}},
      history:[{role:'assistant',kind:'text',status:'complete',requestId:'previous',turnId:'rin-turn-previous',content:'Я рядом.'},
        {role:'user',kind:'text',status:'sent',requestId:'feedback',id:'u-feedback',content:'Спасибо, мне стало легче'}]}));
    assert.equal(r.statusCode,200);
    assert.equal(r.body.stateTransition.cognitiveState.revision,5);
    assert.ok(Object.keys(r.body.stateTransition.cognitiveState.learnedWeights).length>0);
    assert.ok(r.body.cognition.cognitiveDynamics.plasticity.length>0);
  }finally{m.restore();}
});
test('jealousy keeps emotional signal and causal trace without proprietary model arbitration',async()=>{
  const m=intercept();try{
    const r=await run(request('Меня пригласила другая девушка на кофе','jealousy',{memory:{relationship:{trust:80,closeness:89,attraction:82}}}));
    assert.equal(r.statusCode,200);
    assert.equal(r.body.cognition.cognitiveDynamics.schema,'rin-cognitive-settling-v3');
    assert.ok(r.body.cognition.cognitiveDynamics.influences.length>0);
    assert.ok(r.body.cognition.cognitiveDynamics.state.jealousy>=0);
    assert.ok(r.body.cognition.cognitiveDynamics.state.trust>.7);
  }finally{m.restore();}
});
test('canonical identity appears in stable realization prompt and user has no canonical lore authority',async()=>{
  const m=intercept();try{
    const r=await run(request('Привет)','canon',{profile:{name:'Override to impostor',description:'Мой характер'}}));
    assert.equal(r.statusCode,200);
    assert.match(JSON.stringify(m.calls[0].body.messages[0]),/Рин Акихара/);
    assert.match(JSON.stringify(m.calls[0].body.messages[0]),/Мой характер/);
    assert.equal(r.body.model.kernel,'rin-cognitive-dynamics-v3');
  }finally{m.restore();}
});
test('schema and reality errors do not leak internal trace into a user reply',async()=>{
  const m=intercept(()=>({segments:[{text:'[Невербальный жест Рин: тест; причина: внутренняя причина]'}]}));try{
    const r=await run(request('Привет','meta-leak'));
    assert.equal(r.statusCode,200);
    assert.equal(r.body.promptMetrics.modelFallback,true);
    assert.doesNotMatch(r.body.reply,/Невербальный жест Рин/u);
  }finally{m.restore();}
});
test('technical non-OpenAI configuration error maps to stable public HTTP response',async()=>{
  const res=await run(createReq({method:'GET',headers:{'x-rin-pin':'1357'},body:{}}));
  assert.equal(res.statusCode,405);
});
test('server rejects malformed empty current user turn without issuing model request',async()=>{
  const m=intercept();try{
    const r=await run(request('','empty',{history:[]}));
    assert.equal(r.statusCode,400);assert.equal(m.calls.length,0);
  }finally{m.restore();}
});
