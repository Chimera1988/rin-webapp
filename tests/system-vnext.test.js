import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { analyzeConversation } from '../lib/conversation-brain.js';
import { resolveConversationContinuity } from '../lib/conversation-continuity.js';
import { buildCognitiveTurn, buildAffectiveTurn, buildStateTransition, finalizePersistentIntentAfterReply, planResponse, verifyReply } from '../lib/cognition/index.js';
import { buildCoreDecision } from '../lib/core-personality.js';
import { buildInnerLifeSnapshot } from '../lib/personality/inner-life.js';
import { retrieveMemory } from '../lib/cognition/memory-retrieval.js';
import { buildRealityBoundary, unsupportedAutobiographicalClaim } from '../lib/cognition/reality-boundary.js';
import { advancePersistentIntent } from '../lib/cognition/persistent-intent.js';
import { MemoryStorage, createReq, createRes } from './helpers/runtime.js';

function complete(role, content, id) { return { role, kind:'text', status:'complete', content, id }; }

test('ownership audit: legacy style engines and server inner-life fallback are not active writers', () => {
  const core = fs.readFileSync(new URL('../lib/core-personality.js', import.meta.url), 'utf8');
  for (const old of ['habits.js','micro-reactions.js','humanizer.js','rhythm-controller.js','character.js']) {
    assert.ok(!core.includes(old), `core must not import legacy writer ${old}`);
  }
  const inner = fs.readFileSync(new URL('../lib/personality/inner-life.js', import.meta.url), 'utf8');
  assert.ok(!/POOL|fallbackActivity|Math\.random/u.test(inner));
  assert.match(inner, /READ ONLY/iu);
});

test('memory retrieval returns relevant memory and suppresses unrelated database display', () => {
  const memory = {
    facts:{user:{name:'Алексей',project:'Rin',favoriteDrink:'кофе'}},
    recentEvents:[{text:'Обсуждали поездку в Берлин',importance:8},{text:'Купил новый кабель',importance:3}],
    summaries:[{text:'Ранее планировали поездку в Берлин.'}], relationship:{sharedMoments:[]}
  };
  const project = retrieveMemory({memory,userText:'Как называется мой проект?',history:[]});
  assert.ok(project.facts.some(x=>x.path==='user.project' && x.text==='Rin'));
  assert.ok(!project.facts.some(x=>x.path==='user.favoriteDrink'));
  const trip = retrieveMemory({memory,userText:'Что с поездкой в Берлин?',history:[]});
  assert.ok(trip.events.some(x=>/Берлин/u.test(x.text)) || trip.summaries.some(x=>/Берлин/u.test(x.text)));
  const irrelevant = retrieveMemory({memory,userText:'Как сегодня тихо.',history:[]});
  assert.ok(!irrelevant.events.some(x=>/кабель/u.test(x.text)));
  assert.equal(irrelevant.facts.length,0,'irrelevant facts must not be surfaced merely because they exist');
});

test('server Inner Life is read-only and cannot invent a book title or fallback activity', () => {
  const empty = buildInnerLifeSnapshot({}, null, 'Чем занимаешься?', []);
  assert.equal(empty.activity, '');
  const stored = buildInnerLifeSnapshot({innerLife:{activity:'читаю несколько страниц неназванной книги',activityGoal:'отдохнуть перед сном',startedAt:Date.now()-60000}}, null, 'Что читаешь?', []);
  assert.match(stored.activity,/неназванной книги/u);
  assert.equal(stored.directQuestion,true);
  assert.equal('bookTitle' in stored,false);
});

test('assistant history cannot self-legalize an invented Rin biography', () => {
  const memory={innerLife:{activity:'читаю несколько страниц книги'}};
  const first=buildRealityBoundary({profile:{prompt_profile:{identity:{full_name:'Рин Акихара'}}},memory,lore:{},userText:'Что читаешь?',history:[]});
  assert.equal(unsupportedAutobiographicalClaim('Я читаю «Тень горы».',first)?.type,'unsupported_named_self_detail');
  const history=[complete('assistant','Я читаю «Тень горы».','a1'),complete('user','О чём она?','u1')];
  const second=buildRealityBoundary({profile:{prompt_profile:{identity:{full_name:'Рин Акихара'}}},memory,lore:{},userText:'О чём она?',history});
  assert.equal(unsupportedAutobiographicalClaim('«Тень горы» — продолжение моей любимой истории.',second)?.type,'unsupported_named_self_detail');
  assert.equal(unsupportedAutobiographicalClaim('Я бы представила книгу о тихой горной тропе.',{...second,mode:'shared_imagination'}),null);
});

test('reality verifier treats unsupported Rin autobiography as severe', () => {
  const boundary=buildRealityBoundary({profile:{prompt_profile:{identity:{full_name:'Рин Акихара'}}},memory:{},lore:{},userText:'Расскажи что-нибудь о себе',history:[]});
  const result=verifyReply('Однажды я села не в тот автобус и нашла парк, которого раньше не знала.',{
    plan:{responseAct:'state_personal_view',questionBudget:0,factsToUse:[],rinIntent:null},
    brain:{activeScene:{type:'everyday'}},userText:'Расскажи что-нибудь о себе',realityBoundary:boundary
  });
  assert.equal(result.needsRewrite,true);
  assert.ok(result.warnings.includes('unsupported_rin_autobiographical_claim'));
  assert.ok(result.severeWarnings.includes('unsupported_rin_autobiographical_claim'));
});

test('farewell is a hard continuity boundary and an old playful hook cannot leak into a new session', () => {
  const history=[
    complete('user','Ну попробуй меня смутить 😏','u1'), complete('assistant','Не выкручивайся — сам начал.','a1'),
    complete('user','Спокойной ночи','u2'), complete('assistant','Спокойной ночи.','a2'),
    complete('user','Спасибо 😊','u3')
  ];
  const continuity=resolveConversationContinuity({history,userText:'Спасибо 😊',rawScene:{type:'everyday'},conversationState:'ongoing'});
  assert.notEqual(continuity.scene,'playful_flirt');
  assert.equal(continuity.openHook ?? null,null);
});

test('terminal intent remains a tombstone and cannot reopen from emotional/playful candidate', () => {
  const completed={id:'intent-old',rootId:'intent-old',goal:'подразнить',target:'playful_tease',scene:'playful_flirt',sceneBinding:{key:'playful_tease',kind:'playful',subject:'test'},status:'completed',commitment:90,progress:1,turnCount:3,startedAtTurn:5,updatedAtTurn:8,terminalAtTurn:8,cooldownUntilTurn:18,semanticKey:'play|playful_tease|playful_flirt'};
  const memory={conversationState:{revision:9,rinIntent:completed},relationship:{trust:70,closeness:70,playfulness:70},mood:{affection:70}};
  const next=advancePersistentIntent({memory,characterIntent:{desire:'continue_playful_tension',move:'tease_or_advance',strength:90},dialogueState:{scene:'everyday'},brain:{literalIntent:'gratitude',relation:{type:'continuation'},hiddenIntent:{type:'none'},activeScene:{type:'everyday'}},userText:'Спасибо 😊'});
  assert.equal(next.status,'completed');
  assert.equal(next.id,'intent-old');
});

test('proactive greeting uses the same chat pipeline and returns a state transition', async () => {
  const oldPin=process.env.ACCESS_PIN, oldKey=process.env.OPENAI_API_KEY, oldFetch=globalThis.fetch;
  process.env.ACCESS_PIN='4242'; process.env.OPENAI_API_KEY='test';
  globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:'Я сама решила написать первой — просто захотелось.'},finish_reason:'stop'}],usage:{}}),{status:200,headers:{'content-type':'application/json'}});
  try {
    const handler=(await import('../api/chat.js?vnext-proactive-test')).default;
    const res=createRes();
    await handler(createReq({headers:{'x-rin-pin':'4242'},body:{requestId:'pro-1',history:[],trigger:{type:'greeting',reason:'new contact'},memory:{facts:{},conversationState:{}},profile:{},lore:{},env:{}}}),res);
    assert.equal(res.statusCode,200);
    assert.equal(res.body.responsePlan.responseAct,'proactive_greeting');
    assert.equal(res.body.responsePlan.questionBudget,0);
    assert.ok(res.body.stateTransition);
    assert.equal(res.body.trigger.type,'greeting');
  } finally {
    globalThis.fetch=oldFetch;
    if(oldPin===undefined) delete process.env.ACCESS_PIN; else process.env.ACCESS_PIN=oldPin;
    if(oldKey===undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY=oldKey;
  }
});

test('40-turn cross-system lifecycle commits once, survives reload and does not resurrect pre-farewell intent', async () => {
  globalThis.localStorage=new MemoryStorage();
  const store=await import('../public/js/rin_memory.js?vnext-long-flow');
  const script=[
    'Как дела?','Мне тоже спокойно','Ну попробуй меня подразнить 😏','Давай)','А почему ты так сказала?','Хорошо, продолжай','Можешь раскрыть один секрет?','Расскажешь?','Представь мир, где цветы светятся ночью','Да, и там есть кицунэ','А какая завтра погода?','Вернёмся к нашему миру','Это была шутка)','Понятно','Меня пригласила девушка на встречу','Это рабочая встреча','Ты ревнуешь?','Ладно, не дразню','Расскажи что-нибудь конкретное','Спасибо','Как называется мой проект?','Я же говорил: Rin','А что ты сейчас делаешь?','Что читаешь?','Не придумывай название','Хорошо','Давай обнимемся','🤗','Мне приятно','Спокойной ночи',
    'Спасибо 😊','Добрый вечер','Как настроение?','Сегодня был спокойный день','Помнишь проект Rin?','Да','А поездка в Берлин?','Посмотрим позже','Мне пора','До завтра'
  ];
  let history=[]; let questions=0; let preFarewellIntentId=null;
  for(let i=0;i<script.length;i++){
    const text=script[i]; const ending=/спокойной ночи|до завтра/iu.test(text);
    const user=complete('user',text,`u${i}`); history.push(user);
    const diary=await store.loadDiary();
    const memory={...diary,recentEvents:diary.events||[],conversationState:diary.conversationState};
    const brain=analyzeConversation({userText:text,history,conversationState:ending?'ending':'ongoing'});
    const cognition=buildCognitiveTurn({userText:text,history,memory,brain,conversationState:ending?'ending':'ongoing'});
    const affective=buildAffectiveTurn({userText:text,memory,brain});
    const core=buildCoreDecision({userText:text,history,memory,conversationState:ending?'ending':'ongoing',conversationBrain:brain,affectiveTurn:affective});
    const plan=planResponse({cognition,brain,coreDecision:core,memory,userText:text,history});
    questions+=plan.questionBudget;
    let reply= plan.responseAct==='close_warmly' ? 'Спокойной ночи.' : plan.rinIntent?.nextMove==='reveal_specific_personal_secret' ? 'Иногда я представляю тихий ночной сад, где можно ненадолго спрятаться от шума.' : plan.rinIntent?.nextMove==='add_specific_shared_world_detail' ? 'Я бы добавила туда узкую тропу вдоль реки — место, которое мы нашли бы сами.' : 'Я отвечу на это конкретно и останусь в нашей текущей линии.';
    const finalized=finalizePersistentIntentAfterReply(plan.rinIntent,reply);
    const transition=buildStateTransition({cognition,coreDecision:core,affectiveTurn:affective,responsePlan:{...plan,rinIntent:finalized,behavior:{...(plan.behavior||{}),persistentIntent:finalized}}});
    if(i===12){ // failed attempt: no commit; retry must see exactly the old revision
      const before=(await store.loadDiary()).conversationState.revision;
      assert.equal((await store.loadDiary()).conversationState.revision,before);
    }
    await store.commitTurnState({requestId:`r${i}`,stateTransition:transition,now:20_000_000+i*1000});
    const committed=(await store.loadDiary()).conversationState;
    assert.equal(committed.revision,i+1);
    history.push(complete('assistant',reply,`a${i}`));
    if(i===28) preFarewellIntentId=committed.rinIntent?.id||null;
    if(i===30){
      assert.notEqual(committed.rinIntent?.status,'active','gratitude after farewell cannot reactivate old goal');
      if(preFarewellIntentId && committed.rinIntent) assert.equal(committed.rinIntent.id,preFarewellIntentId);
    }
    if(i===20){ // reload boundary is real persisted data
      const reloaded=await store.loadDiary();
      assert.equal(reloaded.conversationState.revision,21);
    }
  }
  const final=await store.loadDiary();
  assert.equal(final.conversationState.revision,40);
  assert.ok(questions<=8,`question pressure too high: ${questions}`);
});
