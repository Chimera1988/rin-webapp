import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectConversationAgency } from '../lib/cognition/v3/initiative-continuity.js';
import { observeTurn } from '../lib/cognition/v3/turn-observations.js';
import { inspectGroundedLife } from '../lib/cognition/v3/life-continuity.js';
import { buildCognitiveTurnPlan } from '../lib/cognition/v3/turn-plan.js';
import { buildV3RealizationPrompt, validateV3LifeRealization } from '../lib/cognition/v3/realization.js';
import { mapCognitiveInputs,settleCognitiveGraph } from '../lib/cognition/v3/cognitive-dynamics.js';

const user=content=>({role:'user',content,kind:'text'});
const rin=content=>({role:'assistant',content,kind:'text'});
function make(text,{history=[],activity='разбирает рабочие заметки',sleepPhase='awake',energy=65,quiet=30,
  signals=[],attentionOpportunity=false,activeIntent=null}={}){
  const kernelState={userText:text,perception:{signals},scene:{type:'everyday'},environment:{rinHuman:'2026-10-09 18:06',rinTz:'Asia/Tokyo'},
    innerLife:{activity,sleepPhase,energy,needForQuiet:quiet,dayType:'weekday',workMode:'normal',desireToShare:60},
    relationship:{trust:79,closeness:80,playfulness:54},mood:{affection:68},emotion:{primary:{type:'playfulness'},warmth:70},
    dialogueState:{recentMotifs:[],recentMessageShapes:[],sceneCommitments:[]},
    recentHistory:history,openLoops:[],activeIntent,reciprocity:{attentionOpportunity,attentionAnchor:{text:'У Кирилла сегодня хороший день'}}};
  const observations=observeTurn({userText:text,history});
  const settled=settleCognitiveGraph({inputs:mapCognitiveInputs({kernelState,observations})});
  const plan=buildCognitiveTurnPlan({kernelState,observations,settled,stickerState:{available:false}});
  const prompt=buildV3RealizationPrompt({kernelState,plan});
  return {observations,plan,prompt,kernelState};
}

const papers=[
  rin('Заканчиваю рабочий день: убираю материалы.'), user('Я думал ты закончила.'),
  rin('Я уже убрала бумаги — всё, Китсуне свободна от канцелярского заговора.'),
  user('Можешь закончить, а я подожду.'),rin('Не так важно, чтобы ты ждал. Я уже убрала бумаги.'),
  user('Я могу подождать.'),rin('Я знаю. Но ждать тебе не нужно — я уже переключилась на вечер.')
];

test('the old 2.x independent-thread principle is activated on an explicit topic invitation',()=>{
  const {observations,plan,prompt}=make('О чём ещё поговорим?',{history:[rin('Сижу и улыбаюсь после твоего поцелуя.')]});
  assert.equal(observations.agency.topicInvitation,true);
  assert.equal(plan.decision.act,'offer_own_topic');
  assert.equal(plan.sceneMotion,'introduce_own_thread');
  assert.equal(plan.decision.intentTransition.operation,'activate');
  assert.equal(plan.decision.intentTransition.kind,'achievement');
  assert.match(plan.decision.focus,/самостоятельно выбрать/);
  assert.match(prompt.dynamicSystem,/OWN_INITIATIVE=/);
  assert.equal(plan.decision.question.mode,'none');
});

test('invite initiative when Rin is tired without claiming she woke up or forcing two bubbles',()=>{
  const {plan}=make('Предложи тему, о чём поговорим?',{sleepPhase:'interrupted_sleep',energy:29,quiet:80});
  assert.equal(plan.decision.act,'offer_own_topic');
  assert.equal(plan.rinDaily.sleepPhase,'interrupted_sleep');
  assert.equal(plan.decision.delivery.responseDepth,'short');
});

test('actual sleeping and explicit space boundary prohibit initiating a new thread',()=>{
  const sleepy=make('О чём ещё поговорим?',{sleepPhase:'sleeping'}).plan;
  assert.notEqual(sleepy.decision.act,'offer_own_topic');
  assert.notEqual(sleepy.decision.intentTransition.operation,'activate');
  const boundary=make('Не пиши мне. Предложи тему.',{signals:[]}).plan;
  assert.equal(boundary.decision.act,'natural_silence');
});

test('a completed paperwork claim persists as bounded conversation evidence',()=>{
  const a=inspectConversationAgency({history:papers,userText:'Я пока побуду рядом',innerLife:{activity:'разбирает рабочие бумаги'}});
  assert.equal(a.workContinuity.claimedCompleted,true);
  assert.match(a.workContinuity.priorClaim,/переключилась на вечер/);
  assert.equal(a.offersWait,true);
});

test('an incomplete or explicitly negated task is not accepted as finished',()=>{
  for(const phrase of ['Я ещё не закончила с бумагами', 'Пока не убрала бумаги, разберу их позже', 'Я уже почти закончила с бумагами']){
    const a=inspectConversationAgency({history:[rin(phrase)],userText:'Как дела?'});
    assert.equal(a.workContinuity.claimedCompleted,false,phrase);
  }
});

test('waiting for real work is acknowledged, not rejected mechanically',()=>{
  const {plan,prompt}=make('Если нужно, я готов подождать',{history:[rin('Я пока редактирую текст.')],activity:'редактирует текст'});
  assert.equal(plan.decision.act,'acknowledge_wait');
  assert.equal(plan.sceneMotion,'respect_offered_wait');
  assert.match(plan.decision.focus,/Принять заботу/);
  assert.match(prompt.dynamicSystem,/OFFERED_WAIT=/);
});

test('after the established completion, avoid restarting the same papers to keep the user talking',()=>{
  const {plan,prompt}=make('Да, ты пока заканчиваешь, а я побуду рядом',{history:papers,activity:'редактирует текст'});
  assert.equal(plan.decision.act,'acknowledge_wait');
  assert.match(plan.decision.focus,/уже сообщила, что закончила/);
  assert.equal(plan.life.workContinuity.claimedCompleted,true);
  assert.match(prompt.dynamicSystem,/WORK_CONTINUITY=/);
});

test('the life validator catches a reopened task but permits a separate new assignment',()=>{
  const life=inspectGroundedLife({kernelState:{innerLife:{activity:'разбирает рабочие бумаги'},recentHistory:papers,userText:'Я подожду'}});
  assert.equal(life.workContinuity.claimedCompleted,true);
  assert.equal(validateV3LifeRealization({segments:[{text:'Я уже почти закончила с этими бумагами.'}]},life),'reopened_completed_work');
  assert.equal(validateV3LifeRealization({segments:[{text:'Я снова убираю бумаги со стола.'}]},life),'reopened_completed_work');
  assert.equal(validateV3LifeRealization({segments:[{text:'Я уже убрала бумаги. Теперь просто сижу рядом.'}]},life),null);
  assert.equal(validateV3LifeRealization({segments:[{text:'Сегодня взяла новое задание, редактирую другой текст.'}]},life),'unconfirmed_new_work');
  const nextTask=inspectGroundedLife({kernelState:{innerLife:{activity:'редактирует новый перевод'},recentHistory:papers,userText:'Я подожду'}});
  assert.equal(validateV3LifeRealization({segments:[{text:'Сегодня взяла новое задание, редактирую другой текст.'}]},nextTask),null);
});

test('saturated motif is detected as conversational repetition, not as renewed actual work',()=>{
  const repeated=[...papers,rin('Проверяю, не вернулись ли бумаги на рабочий стол.')];
  const {plan,observations,prompt}=make('Молодец, Китсуне 😏',{history:repeated,activity:'отдыхает после работы'});
  assert.equal(observations.agency.topicSaturation.saturated,true);
  assert.equal(plan.agency.motifSaturated,true);
  assert.match(prompt.dynamicSystem,/MOTIF_SATURATION=/);
});

test('a regular question still receives a factual answer without compulsory agency',()=>{
  const {plan}=make('Ты уже поужинала?',{signals:['direct_question_present']});
  assert.equal(plan.decision.act,'answer_user_question');
  assert.notEqual(plan.decision.intentTransition.operation,'activate');
});

test('sleep farewell and existing sticker rules remain authoritative',()=>{
  const {plan}=make('Всё, спать, спать, спать 😘',{sleepPhase:'interrupted_sleep',quiet:80});
  assert.equal(plan.sceneMotion,'sleep_farewell');
  assert.notEqual(plan.decision.act,'offer_own_topic');
});


test('established mutual play can start a maintenance intent without forcing a question',()=>{
  const history=[user('А ты меня поймаешь? 😏'),rin('Попробуй сначала не выдать себя.'),
    user('Я уже рядом и улыбаюсь 🤭'),rin('Тогда придётся придумать тебе испытание.')];
  const {plan,observations}=make('Ну хитрюга 😏',{history});
  assert.equal(observations.sceneFlow.sustainedPlay,true);
  assert.equal(plan.decision.intentTransition.operation,'activate');
  assert.equal(plan.decision.intentTransition.kind,'maintenance');
  assert.equal(plan.decision.intentTransition.reason,'sustained_mutual_play');
  assert.equal(plan.decision.question.mode,'none');
});

test('a self-chosen achievement intent advances on engagement and closes on a genuine topic switch',()=>{
  const intent={id:'thought-1',status:'active',kind:'achievement',goal:'поделиться собственной мыслью или интересом по приглашению Кирилла',
    target:'self_chosen_topic',nextMove:'share_one_concrete_thought',progress:.05,turnCount:1,maxTurns:8};
  const engaged=make('Любопытно, а почему тебе это интересно?',{activeIntent:intent,signals:['direct_question_present']}).plan;
  assert.equal(engaged.decision.intentTransition.operation,'advance');
  const unrelated=make('А какая сегодня погода?',{activeIntent:intent,signals:['direct_question_present']}).plan;
  assert.equal(unrelated.decision.intentTransition.operation,'preserve');
  const switched=make('Кстати, давай сменим тему. Какая погода?',{activeIntent:intent,signals:['direct_question_present']}).plan;
  assert.equal(switched.decision.intentTransition.operation,'cancel');
});

test('a passing playful word without sustained reciprocal play does not manufacture a maintenance intent',()=>{
  const {plan}=make('Хитрюга 😏',{history:[]});
  assert.notEqual(plan.decision.intentTransition.reason,'sustained_mutual_play');
});


test('a request “подожди” is not mistaken for the user offering to wait',()=>{
  const a=inspectConversationAgency({userText:'Подожди, пожалуйста. Я хотел другое спросить.'});
  assert.equal(a.offersWait,false);
  assert.equal(inspectConversationAgency({userText:'Я подожду, пока ты закончишь.'}).offersWait,true);
});
