import test from 'node:test';
import assert from 'node:assert/strict';
import {observeTurn} from '../lib/cognition/v3/turn-observations.js';
import {buildCognitiveTurnPlan} from '../lib/cognition/v3/turn-plan.js';
import {buildV3RealizationPrompt} from '../lib/cognition/v3/realization.js';
import {mapCognitiveInputs,settleCognitiveGraph} from '../lib/cognition/v3/cognitive-dynamics.js';

const assistant = content => ({role:'assistant',content,kind:'text'});
const user = content => ({role:'user',content,kind:'text'});
function make(text,{env={rinHuman:'2026-10-09 06:16',rinTz:'Asia/Tokyo',partOfDay:'утро'},
  innerLife={},history=[],shapes=[],stickerState={available:false},signals=[]}={}){
  const kernel={userText:text,perception:{signals},scene:{type:'everyday'},
    environment:env,
    innerLife:{sleepPhase:'interrupted_sleep',energy:49,needForQuiet:80,
      dayType:'weekday',workMode:'normal',wakeReason:'kirill_message',...innerLife},
    emotion:{primary:{type:'playfulness',intensity:62},warmth:69},
    mood:{affection:73},relationship:{trust:78,closeness:84,playfulness:59},
    dialogueState:{recentMotifs:[],recentMessageShapes:shapes,sceneCommitments:[]},
    recentHistory:history,openLoops:[],reciprocity:{attentionOpportunity:false}};
  const observations=observeTurn({userText:text,history});
  const inputs=mapCognitiveInputs({kernelState:kernel,observations});
  const settled=settleCognitiveGraph({inputs});
  const plan=buildCognitiveTurnPlan({kernelState:kernel,observations,settled,stickerState});
  const prompt=buildV3RealizationPrompt({kernelState:kernel,plan});
  return {observations,plan,prompt,kernel};
}

test('real 06:16 in Kanazawa, not the user greeting, grounds Rin waking state',()=>{
  const {plan,prompt}=make('Доброе утро) Надеюсь не разбудил тебя)',
    {history:[assistant('Ты снова меня подловил 😏')],
      innerLife:{plannedWakeAt:Date.parse('2026-10-08T22:12:00Z')}});
  assert.equal(plan.rinDaily.localTime,'2026-10-09 06:16');
  assert.equal(plan.rinDaily.partOfDay,'утро');
  assert.equal(plan.rinDaily.sleepPhase,'interrupted_sleep');
  assert.equal(plan.rinDaily.scheduledWakeLocal,'2026-10-09 07:12');
  assert.equal(plan.sceneMotion,'grounded_greeting');
  assert.equal(plan.decision.act,'personal_response');
  assert.match(plan.decision.focus,/приветствие Кирилла не служит источником времени/);
  assert.match(prompt.dynamicSystem,/RIN_LOCAL_CLOCK=/);
  assert.match(prompt.dynamicSystem,/RIN_CLOCK_PRIORITY=/);
  assert.match(prompt.stableSystem,/Приветствие пользователя не меняет часы/);
});

test('wrong greeting does not turn Rin afternoon into user morning',()=>{
  const {plan}=make('Доброе утро)',{env:{rinHuman:'2026-10-09 16:16',rinTz:'Asia/Tokyo',partOfDay:'утро'},
    innerLife:{sleepPhase:'awake'}});
  assert.equal(plan.rinDaily.partOfDay,'день');
  assert.match(plan.decision.focus,/день/);
});

test('missing clock is unknown and not invented from a greeting',()=>{
  const {plan,prompt}=make('Доброе утро)',{env:{}});
  assert.equal(plan.rinDaily.source,'unknown');
  assert.equal(plan.rinDaily.localTime,null);
  assert.doesNotMatch(prompt.dynamicSystem,/RIN_CLOCK_PRIORITY=/);
});

test('drowsy Rin can naturally split a two-beat message without fake energy recovery',()=>{
  const {plan,observations,prompt}=make('Да я понимаю, и не отрицаю и готов ко всем последствиям 😏');
  assert.equal(observations.socialCues.multiBeat,true);
  assert.equal(plan.decision.delivery.messageShape,'split');
  assert.equal(plan.decision.delivery.segments.filter(s=>s.type==='text').length,2);
  assert.equal(plan.decision.delivery.mode,'multi_message');
  assert.equal(plan.rinDaily.sleepPhase,'interrupted_sleep');
  assert.match(prompt.dynamicSystem,/SPLIT_RHYTHM=/);
});

test('no pointless split of a tiny reply or simple factual question',()=>{
  assert.equal(make('😘').plan.decision.delivery.messageShape,'single');
  assert.equal(make('А сколько у тебя сейчас времени?',{signals:['direct_question_present']}).plan.decision.delivery.messageShape,'single');
});

test('recent split is respected as a conversational rhythm, not every turn',()=>{
  const text='Да я понимаю, и не отрицаю и готов ко всем последствиям 😏';
  assert.equal(make(text,{shapes:['single','split','single']}).plan.decision.delivery.messageShape,'single');
  assert.equal(make(text,{shapes:['split','single','single','single','single']}).plan.decision.delivery.messageShape,'split');
});

test('sleeping, boundary and high quiet need do not produce forced multi message',()=>{
  const text='Да я понимаю, и не отрицаю и готов ко всем последствиям 😏';
  assert.equal(make(text,{innerLife:{sleepPhase:'sleeping'}}).plan.decision.delivery.messageShape,'single');
  assert.equal(make(text,{innerLife:{needForQuiet:96}}).plan.decision.delivery.messageShape,'single');
  assert.equal(make('Не пиши мне, я хочу тишины. И хочу выспаться, понятно?').plan.decision.delivery.messageShape,'single');
});

test('a request to sleep closes instead of relaunching banter',()=>{
  for(const line of ['Так, вымогательница) Все спать, спать, спать 🤗😘',
    'Хорошо, может еще немного поспать, если время позволяет?',
    'Хорошо, может еще немного по спать, если время позволяет?',
    'Тогда утренние объятия для тебя и отдохни еще немного, только не проспи пол дня 😉']){
    const {plan,observations}=make(line,{signals:line.includes('?')?['direct_question_present']:[]});
    assert.equal(observations.sceneFlow.sleepFarewell,true,line);
    assert.equal(plan.decision.delivery.messageShape,'single',line);
    assert.equal(plan.sceneMotion,'sleep_farewell',line);
    assert.equal(plan.decision.act,'say_goodbye',line);
  }
});

test('agreement to sleep settles into silence, a new substantive request wakes the scene',()=>{
  const history=[user('Может ещё немного поспим?'),assistant('Да, давай ещё немного поспим. Мне сейчас хочется тишины.')];
  const closing=make('Договорились 😏',{history});
  assert.equal(closing.observations.sceneFlow.settledAfterFarewell,true);
  assert.equal(closing.plan.decision.act,'natural_silence');
  const newTopic=make('А сколько у тебя сейчас времени?',{history,signals:['direct_question_present']});
  assert.equal(newTopic.plan.decision.act,'answer_user_question');
});

test('debug remains in its existing files and no secondary decision owner is activated',()=>{
  const {plan}=make('Обниму тебя и поспим ещё немного 🤗');
  assert.equal(plan.decision.delivery.messageShape,'single');
  assert.equal(plan.rinDaily.timezone,'Asia/Tokyo');
});
