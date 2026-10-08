import test from 'node:test';
import assert from 'node:assert/strict';
import { observeTurn } from '../lib/cognition/v3/turn-observations.js';
import { mapCognitiveInputs, settleCognitiveGraph } from '../lib/cognition/v3/cognitive-dynamics.js';
import { buildCognitiveTurnPlan } from '../lib/cognition/v3/turn-plan.js';
import { buildV3RealizationPrompt } from '../lib/cognition/v3/realization.js';
import { buildStickerCandidates } from '../lib/cognition/sticker-candidates.js';

const user = content => ({role:'user',kind:'text',content});
const rin = content => ({role:'assistant',kind:'text',content});
const recoveryHistory = [
  user('Тук тук) Это снова я)'),
  rin('Тук-тук услышала… Я уже почти провалилась обратно в сон, но для тебя приоткрою один глаз.'),
  user('Это очень приятно)'),
  rin('Тогда ещё немного побуду с приоткрытым глазом… приятно, что ты вернулся ко мне так тихо.'),
  user('Немного тебе еще по надоедаю если ты не против 😅'),
  rin('Не против. Только надоедай тихо — я всё ещё сонная и могу отвечать с задержкой в один морг.'),
  user('Ничего с этим можно справиться 😏'),
  rin('Посмотрим, как ты справишься с сонной кицунэ: у неё сейчас реакция примерно с опозданием на один морг…'),
  user('Тогда нежные объятия и один поцелуй для начала… 🤭'),
  rin('Мм… такой способ я одобряю. Только объятия — крепкие, а поцелуй пусть будет тихим.'),
  user('Тогда Китсуне уже не станет притворяться сонной?'),
  rin('Мм… да, отвертеться будет трудно — но ты сам её разбудил.'),
  user('А может быть я этого и добиваюсь 😏'),
  rin('Мм… только не жалуйся, если сонная кицунэ окажется куда настойчивее.'),
];
function plan(text,{history=[],innerLife={},sticker=true,signals=[]}={}){
  const k={userText:text,scene:{type:'everyday'},perception:{signals},
    innerLife:{sleepPhase:'interrupted_sleep',energy:50,needForQuiet:79,mentalLoad:33,...innerLife},
    emotion:{primary:{type:'tenderness',intensity:55},warmth:72},
    mood:{affection:74},relationship:{trust:83,closeness:84,playfulness:59},
    dialogueState:{recentMotifs:[],recentMessageShapes:[],sceneCommitments:[]},
    recentHistory:history,openLoops:[],reciprocity:{attentionOpportunity:false}};
  const observations=observeTurn({userText:text,history});
  const inputs=mapCognitiveInputs({kernelState:k,observations});
  const settled=settleCognitiveGraph({inputs});
  const stickerState={available:sticker,mode:'smart',requiredGapTurns:2,turnsSinceSticker:40,explicitGesture:/[😘💋🤗]/u.test(text)};
  const stickerCandidates=buildStickerCandidates({userText:text,state:k,limit:12});
  const p=buildCognitiveTurnPlan({kernelState:k,settled,observations,stickerState,stickerCandidates});
  return {k,observations,inputs,settled,p};
}

test('interrupted sleep remains factual but does not suppress an established reciprocal game',()=>{
  const r=plan('А может быть я этого и добиваюсь 😏',{history:recoveryHistory});
  assert.equal(r.k.innerLife.sleepPhase,'interrupted_sleep');
  assert.equal(r.observations.sceneFlow.sustainedPlay,true);
  assert.equal(r.inputs.values.playfulCue,0.76);
  assert.equal(r.p.decision.act,'playful_response');
  assert.equal(r.p.sceneMotion,'advance_mutual_play');
  assert.match(r.p.decision.stance,/тихая, сонная, но живая и игривая/);
  assert.equal(r.p.decision.delivery.responseDepth,'short');
});

test('observed repetitive openings and sleep description are fed to Luna, not invented state changes',()=>{
  const r=plan('Для этого нужно сначала узнать, а потом говорить 😎',{history:recoveryHistory});
  assert.equal(r.observations.sceneFlow.repeatedOpening,true);
  assert.equal(r.observations.sceneFlow.repeatedSleepBeat,true);
  const prompt=buildV3RealizationPrompt({kernelState:r.k,plan:r.p});
  assert.match(prompt.dynamicSystem,/REPETITION_GUARD_OPENING/);
  assert.match(prompt.dynamicSystem,/REPETITION_GUARD_SLEEP/);
  assert.match(prompt.dynamicSystem,/SCENE_FLOW=/);
  assert.match(prompt.stableSystem,/Одинаковое физическое состояние/);
});

test('sleep farewell is a social closing act, not another playful turn',()=>{
  const r=plan('Тогда закрывай глазки, я побуду с тобой и засыпай моя Китсуне…',{history:recoveryHistory});
  assert.equal(r.observations.sceneFlow.sleepFarewell,true);
  assert.equal(r.observations.sceneClosure.soft,true);
  assert.equal(r.p.decision.act,'say_goodbye');
  assert.equal(r.p.sceneMotion,'sleep_farewell');
  assert.match(r.p.decision.focus,/завершить сцену/);
  assert.equal(r.p.decision.delivery.segments.some(s=>s.type==='sticker'),false);
});

test('emoji-only continuation after Rin accepts sleep farewell becomes silence instead of infinite sleep loop',()=>{
  const history=[...recoveryHistory,
    user('Тогда закрывай глазки, я побуду с тобой, засыпай моя Китсуне.'),
    rin('Мм… тогда закрываю. Спасибо за поцелуи. Спокойной ночи.')];
  const r=plan('😘😘😘',{history});
  assert.equal(r.observations.sceneFlow.settledAfterFarewell,true);
  assert.equal(r.observations.sceneClosure.strong,true);
  assert.equal(r.p.decision.act,'natural_silence');
  assert.equal(r.p.needsVoice,false);
  assert.equal(r.p.decision.delivery.mode,'silence');
  assert.equal(r.p.decision.delivery.segments.length,0);
});

test('a fresh explicit question after bedtime takes priority over closing silence',()=>{
  const history=[user('Засыпай моя Китсуне'),rin('Тогда закрываю глаза. Спокойной ночи.')];
  const r=plan('Но сначала скажи, что с нашей договорённостью?',{history,signals:['direct_question_present']});
  assert.equal(r.p.decision.act,'answer_user_question');
  assert.equal(r.p.responseRequired,true);
});

test('a new wake-up scene is not trapped by the previous sleep farewell',()=>{
  const history=[user('Засыпай моя Китсуне'),rin('Тогда закрываю глаза. Спокойной ночи.')];
  const r=plan('Тук тук) Это снова я)',{history});
  assert.equal(r.observations.sceneFlow.settledAfterFarewell,false);
  assert.equal(r.p.responseRequired,true);
});

test('an invitation to be quiet does not falsely change physiological sleep state',()=>{
  const r=plan('Обнимаю крепче…',{history:recoveryHistory});
  assert.equal(r.k.innerLife.sleepPhase,'interrupted_sleep');
  assert.equal(r.p.decision.delivery.responseDepth,'short');
  assert.ok(r.p.decision.delivery.segments.find(x=>x.type==='sticker'));
});

test('longstanding scene must not pull unrelated city/reading motif into intimate gesture',()=>{
  const history=[...recoveryHistory,rin('Город немного подождёт.')];
  const r=plan('Обнимаю крепче…',{history});
  assert.ok(!/продолжить тему city|продолжить тему reading/.test(r.p.decision.focus));
});

test('sleep farewell must not be inferred from a question about sleep',()=>{
  const r=plan('А что если ты окончательно заснёшь?',{history:recoveryHistory});
  assert.equal(r.observations.sceneFlow.sleepFarewell,false);
  assert.notEqual(r.p.decision.act,'say_goodbye');
});

test('the previous flirt cannot override a new serious topic or direct factual question',()=>{
  const topic=plan('Кстати, поговорим о работе?',{history:recoveryHistory});
  assert.equal(topic.observations.sceneFlow.sustainedPlay,false);
  const fact=plan('Что сегодня с погодой?',{history:recoveryHistory});
  assert.equal(fact.observations.sceneFlow.sustainedPlay,false);
  assert.equal(fact.p.decision.act,'answer_user_question');
});

test('real sleeping, boundaries, and distress are still respected',()=>{
  const sleeping=plan('Обнимаю тебя 😘',{innerLife:{sleepPhase:'sleeping'}});
  assert.equal(sleeping.p.decision.delivery.segments.some(s=>s.type==='sticker'),false);
  const stop=plan('Не пиши мне, хочу побыть одному',{history:recoveryHistory});
  assert.equal(stop.p.decision.act,'natural_silence');
  const distress=plan('Мне тяжело, побудь рядом',{history:recoveryHistory});
  assert.equal(distress.p.decision.act,'supportive_presence');
});
