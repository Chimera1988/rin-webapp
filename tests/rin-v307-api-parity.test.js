import test from 'node:test';
import assert from 'node:assert/strict';
import {createReq,createRes} from './helpers/runtime.js';
const previous={pin:process.env.ACCESS_PIN,key:process.env.OPENAI_API_KEY,model:process.env.OPENAI_MIND_MODEL};
process.env.ACCESS_PIN='1357';process.env.OPENAI_API_KEY='test-key';process.env.OPENAI_MIND_MODEL='gpt-6-luna';
const chat=(await import('../api/chat.js?rin-v307-api-parity')).default;
test.after(()=>{for(const [id,name] of [['pin','ACCESS_PIN'],['key','OPENAI_API_KEY'],['model','OPENAI_MIND_MODEL']]){
 if(previous[id]===undefined)delete process.env[name];else process.env[name]=previous[id];
}});
let seq=0;
const a=content=>({role:'assistant',kind:'text',status:'complete',content,id:`prev-assistant-${++seq}`});
const u=content=>({role:'user',kind:'text',status:'complete',content,id:`prev-user-${++seq}`});
const prevGame=[a('Давай в «Три вопроса». По очереди задаём друг другу по три — отвечать нужно честно, но можно один раз за игру сказать «пас».') ,u('Хорошо, давай'),a('Тогда начинаю'),u('Вопрос номер один)'),a('Ну наконец-то. Спрашивай'),u('Как ты относишься ко мне? После твой вопрос'),a('Мне важна твоя забота. Я привязана к тебе и хочу узнавать тебя дальше.')];
function mock(output){const prior=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{
 calls++;
 return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({segments:[{text:output}]})},finish_reason:'stop'}],
 usage:{prompt_tokens:320,completion_tokens:40,total_tokens:360},model:'gpt-6-luna'}),{status:200,headers:{'content-type':'application/json'}});
};return {get calls(){return calls;},restore(){globalThis.fetch=prior}};}
async function run(last,history=[],memory={}){
 const id=`parity-api-${++seq}`;
 const h=[...history,{...u(last),requestId:id,status:'sent'}];
 const req=createReq({headers:{'x-rin-pin':'1357'},body:{requestId:id,history:h,memory,
  client:{sticker:{mode:'off',probability:0,safeMode:true}}}});
 const res=createRes();await chat(req,res);
 assert.equal(res.statusCode,200,JSON.stringify(res.body?.error||res.body).slice(0,500));
 return res.body;
}
test('production API preserves an accepted turn-taking question from Luna',async()=>{
 const m=mock('Мой первый вопрос: что тебе больше всего нравится в наших разговорах?');try{
  const r=await run('Засчитано, а твой вопрос ко мне?',prevGame);
  assert.equal(r.turnDecision.act,'take_game_turn');assert.equal(r.turnDecision.question.mode,'required');
  assert.equal(r.reply,'Мой первый вопрос: что тебе больше всего нравится в наших разговорах?');
  assert.equal(r.promptMetrics.questionSanitized,false);
  assert.equal(r.promptMetrics.modelFallback,false);assert.equal(m.calls,1);
 }finally{m.restore();}
});
test('production API refuses an empty game question without calling Luna twice',async()=>{
 const m=mock('Ну, я слушаю тебя.');try{
  const r=await run('Засчитано, а твой вопрос ко мне?',prevGame);
  assert.equal(r.turnDecision.question.mode,'required');assert.match(r.reply,/\?/u);
  assert.equal(r.promptMetrics.modelFallback,true);assert.equal(m.calls,1);
 }finally{m.restore();}
});
test('production API reports question sanitization separately, so the source of lost language is visible',async()=>{
 const m=mock('Я рядом. Что дальше?');try{
  const r=await run('Спасибо',[u('Пожалуйста, без вопросов'),a('Хорошо, без вопросов')]);
  assert.equal(r.turnDecision.question.mode,'none');assert.doesNotMatch(r.reply,/\?/u);
  assert.equal(r.promptMetrics.questionSanitized,true);assert.equal(r.promptMetrics.modelFallback,false);
 }finally{m.restore();}
});
test('production API updates relationship and mood, while retaining single action owner',async()=>{
 const m=mock('Мне приятно, что ты так сказал.');try{
  const relation={trust:70,closeness:60,comfort:60,attraction:55,playfulness:50};
  const r=await run('Я тебя люблю 🤗',[],{relationship:relation,mood:{affection:65,energy:65},conversationState:{revision:21}});
  assert.ok(r.affectiveTurn.relationshipState.closeness>60);
  assert.ok(r.affectiveTurn.moodState.affection>65);
  assert.equal(r.stateTransition.relationshipState.closeness,r.affectiveTurn.relationshipState.closeness);
  assert.equal(r.turnDecision.source,'rin-cognitive-turn-plan-v3');
 }finally{m.restore();}
});
test('production API does not confirm dinner after only a preparation plan',async()=>{
 const m=mock('Да, съеден. Инспекция сработала.');try{
  const r=await run('Ужин съеден?',[a('Ужин будет самым простым — что-нибудь соберу на скорую руку.')]);
  assert.doesNotMatch(r.reply,/Да, съеден/u);
  assert.equal(r.promptMetrics.modelFallback,true);assert.equal(m.calls,1);
 }finally{m.restore();}
});
