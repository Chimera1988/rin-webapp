import test from 'node:test';
import assert from 'node:assert/strict';
import {createReq,createRes} from './helpers/runtime.js';
const old={pin:process.env.ACCESS_PIN,key:process.env.OPENAI_API_KEY};
process.env.ACCESS_PIN='3017';process.env.OPENAI_API_KEY='test-key';
const chat=(await import('../api/chat.js?v301-api')).default;
test.after(()=>{
  if(old.pin===undefined)delete process.env.ACCESS_PIN;else process.env.ACCESS_PIN=old.pin;
  if(old.key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=old.key;
});
function req(id,text,history=[],memory={}){
  return createReq({headers:{'x-rin-pin':'3017'},body:{requestId:id,
    history:[...history,{role:'user',kind:'text',status:'sent',requestId:id,id:`u-${id}`,content:text}],
    client:{sticker:{mode:'off'}},memory}});
}
function mock(answer){const prev=globalThis.fetch;let calls=0,voicePrompt='';globalThis.fetch=async(url,init)=>{
  calls++;voicePrompt=JSON.stringify(JSON.parse(init.body).messages||[]);
  return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({segments:[{text:answer}]})},finish_reason:'stop'}],
    model:'gpt-6-luna',usage:{prompt_tokens:110,completion_tokens:25}}),{status:200});
};return {calls:()=>calls,prompt:()=>voicePrompt,restore:()=>{globalThis.fetch=prev;}};}
async function respond(request){const response=createRes();await chat(request,response);return response;}

test('3.0.1 API exposes actual short-term dialogue metrics and reading subject',async()=>{
  const m=mock('Пока просто читаю небольшой текст — название не выбрала.');try{
    const response=await respond(req('read-301','Про что читала?',[{role:'assistant',kind:'text',status:'complete',turnId:'older',content:'Читаю для себя, без редакторского карандаша.'}],
      {innerLife:{activity:'читает для себя',energy:66,needForQuiet:24}}));
    assert.equal(response.statusCode,200);
    assert.equal(response.body.mind.lifeDomain,'reading');
    assert.ok(response.body.promptMetrics.shortTermSpeakerTurns>=2);
    assert.ok(response.body.promptMetrics.shortTermChars>0);
    assert.match(m.prompt(),/GROUNDED_LIFE/u);
    assert.match(m.prompt(),/reading_content_unspecified/u);
    assert.equal(m.calls(),1);
  }finally{m.restore();}
});
test('3.0.1 API rejects unsupported completed walk without another paid call',async()=>{
  const m=mock('Да, успела немного прогуляться.');try{
    const response=await respond(req('walk-301','Получилось у тебя прогуляться?',
      [{role:'assistant',kind:'text',status:'complete',turnId:'old',content:'Осень такая хорошая, хочется гулять.'}],
      {innerLife:{activity:'читает для себя',energy:58,needForQuiet:35}}));
    assert.equal(response.statusCode,200,JSON.stringify(response.body));
    assert.equal(response.body.promptMetrics.modelFallback,true);
    assert.doesNotMatch(response.body.reply,/успела немного прогуляться/iu);
    assert.equal(response.body.mind.lifeDomain,'city');
    assert.equal(m.calls(),1);
  }finally{m.restore();}
});
