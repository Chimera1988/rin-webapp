import { enableTestSecurity } from './helpers/security.js';
const releaseSecurity = enableTestSecurity();
import test from 'node:test';
import assert from 'node:assert/strict';
import { createReq, createRes } from './helpers/runtime.js';

const prior = { pin: process.env.ACCESS_PIN, key: process.env.OPENAI_API_KEY, mode: process.env.RIN_CHAT_TRANSPORT };
process.env.ACCESS_PIN = '1357';
process.env.OPENAI_API_KEY = 'test-key';
// Mode is selected through the authenticated chat request, not a global env switch.
const chat = await import('../api/chat.js?rin-responses-handler-test');
test.after(() => {
  for (const [k, env] of [['pin', 'ACCESS_PIN'], ['key','OPENAI_API_KEY'], ['mode','RIN_CHAT_TRANSPORT']]) {
    if (prior[k] === undefined) delete process.env[env]; else process.env[env] = prior[k];
  }
  releaseSecurity?.();
});

function turn(text) {
  return {
    act:'answer_directly', focus:'ответить с учётом истории', stance:'natural',
    question:{mode:'none',reason:null}, replyLink:{targetEventId:null,reason:null},
    delivery:{responseDepth:'normal',messageShape:'single',segments:[{type:'text',purpose:'reply',stickerIntent:null,maxChars:320,text}]},
    intentTransition:{operation:'none',goal:null,motive:null,target:null,nextMove:null,progress:null,commitment:null,reason:null},
    openLoops:{open:[],resolveIds:[]}, realityMode:'grounded',
    mind:{sceneMotif:'direct_exchange',lifeDomain:'none',lifeMotif:null,frameAlignment:'aligned',literalCorrection:'none',referenceAnchor:null,felt:'спокойная вовлечённость',wants:'ответить по смыслу',restraint:null,socialIntent:'respond',confidence:90}
  };
}

test('historical user message remains excluded until delivery is complete', async () => {
  const { selectModelHistory } = await import('../lib/chat-contract.js');
  const history = [
    {role:'user',kind:'text',status:'sent',requestId:'old',id:'u-old-pending',content:'Ещё не доставлено'},
    {role:'assistant',kind:'text',status:'complete',turnId:'previous',id:'a-previous',content:'Доставленный ответ'},
    {role:'user',kind:'text',status:'sent',requestId:'current',id:'u-current',content:'Новый вопрос'}
  ];
  const filtered = selectModelHistory(history,{includeRequestId:'current'});
  assert.deepEqual(filtered.map(x=>x.id), ['a-previous','u-current']);
});

test('experimental handler passes genuine dialogue roles through Responses without changing client reply contract', async () => {
  const previousFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    captured = JSON.parse(options.body);
    return new Response(JSON.stringify({
      status:'completed', model:'gpt-6-luna',
      output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(turn('Да, мы обсуждали книгу.'))}]}],
      usage:{input_tokens:125,output_tokens:155,total_tokens:280}
    }),{status:200,headers:{'content-type':'application/json'}});
  };
  try {
    const req = createReq({headers:{'x-rin-pin':'1357'},body:{
      requestId:'new',
      history:[
        {role:'user',kind:'text',status:'complete',requestId:'old',id:'u-old',content:'Помнишь, мы говорили про книгу?'},
        {role:'assistant',kind:'text',status:'complete',turnId:'a-old',requestId:'old',id:'a-old',content:'Да, мне понравилась наша беседа.'},
        {role:'user',kind:'text',status:'sent',requestId:'new',id:'u-new',content:'Что мы обсуждали?'}
      ],
      client:{experimentMode:'dialogue',sticker:{mode:'off',probability:0,safeMode:true}}
    }});
    const res=createRes();
    await chat.default(req,res);
    assert.equal(res.statusCode,200, JSON.stringify(res.body).slice(0,300));
    assert.equal(res.body.reply,'Да, мы обсуждали книгу.');
    assert.equal(res.body.promptMetrics.transport,'responses-roles-stateless');
    assert.deepEqual(captured.input.slice(-3).map(x=>x.role),['user','assistant','user']);
    assert.equal(captured.input.at(-1).content,'Что мы обсуждали?');
    assert.equal(captured.store,false);
    assert.equal(captured.text.format.name,'rin_mind_turn_v2');
  } finally {globalThis.fetch=previousFetch;}
});
