import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildAffectiveTurn, observeAffectiveTurn } from '../lib/cognition/emotional-state.js';
import { observeSceneContracts } from '../lib/cognition/v3/scene-contracts.js';
import { observeTurn } from '../lib/cognition/v3/turn-observations.js';
import { buildCognitiveTurnPlan } from '../lib/cognition/v3/turn-plan.js';
import { inspectGroundedLife } from '../lib/cognition/v3/life-continuity.js';
import { validateV3LifeRealization, v3FallbackRealization, buildV3RealizationPrompt } from '../lib/cognition/v3/realization.js';
import { applyIntentTransition } from '../lib/cognition/turn-decision.js';
const u=(content,i=1)=>({role:'user',kind:'text',content,id:`u-${i}`});
const a=(content,i=1)=>({role:'assistant',kind:'text',content,id:`a-${i}`});
const gameHistory=[
  a('Давай в «Три вопроса». По очереди задаём друг другу по три — отвечать нужно честно, но можно один раз за игру сказать «пас».',1),
  u('Хорошо, давай',2), a('Тогда начинаю',3),u('Вопрос номер один)',4),a('Ну наконец-то. Спрашивай',5),
  u('Как ты относишься ко мне? После твой вопрос',6),
  a('Ты для меня не просто приятный собеседник. Мне важна твоя забота и мне нравится рядом с тобой быть собой.',7)
];
const behavior={approach:.67,support:.53,disclose:.40,play:.54,silence:.26,ask:.12,initiative:.31,
  tenderGesture:.22,setBoundary:.08,vigilance:.12,reflection:.5,directness:.68};
function makePlan(userText,history=[],opts={}) {
  const k={userText,innerLife:{energy:63,needForQuiet:49,sleepPhase:'awake',dayType:'weekday',workMode:'normal'},
    recentHistory:history,relationship:{trust:73,comfort:70,closeness:70},
    relationalConstancy:{relationalSafety:74,disclosureOpportunity:false,internal:{primaryIntensity:0}},
    perception:{signals:/\?/u.test(userText)?['direct_question_present']:[]},scene:{type:'everyday'},
    dialogueState:{recentMessageShapes:[],recentMotifs:[],recentLifeBeats:[]},
    reciprocity:{attentionOpportunity:false},environment:{rinHuman:'2026-10-09 21:00',rinTz:'Asia/Tokyo'},
    ...opts};
  const h=[...history,u(userText,999)];
  const observations=observeTurn({userText,history:h});
  const plan=buildCognitiveTurnPlan({settled:{behavioralState:behavior,evidence:{userQuestion:/\?/u.test(userText),userNeeds:false}},kernelState:k,observations,stickerState:{available:false},sharedSymbolState:{candidates:[]}});
  return {k,observations,plan};
}
function getText(text){return {segments:[{text}]};}

test('v2.5 relationship and mood transitions are carried into v3 observations without changing the input',()=>{
 const memory={relationship:{trust:70,closeness:60,comfort:60,attraction:55,playfulness:50},
   mood:{affection:65,energy:65},conversationState:{revision:16,emotionalState:{}}};
 const original=JSON.stringify(memory);
 for(const utterance of ['Я тебя люблю 🤗','Спасибо, что ты рядом','Ты красивая','Ты тупая, отвали']){
  const x=buildAffectiveTurn({userText:utterance,memory});const y=observeAffectiveTurn({userText:utterance,memory});
  for(const [key,value] of Object.entries(x.relationshipState)){if(!['updatedAt','lastInteractionAt'].includes(key))assert.deepEqual(y.relationshipState[key],value,key);}
  assert.deepEqual(y.moodState,x.moodState);
  assert.deepEqual(y.emotionalState,x.emotionalState);
 }
 assert.equal(JSON.stringify(memory),original);
});
test('game is recognized from accepted rules, without inventing a separate physical reality',()=>{
 const result=observeSceneContracts({history:gameHistory,userText:'Засчитано, а твой вопрос ко мне?'});
 assert.equal(result.game.type,'alternating_questions');assert.equal(result.game.rinQuestionDue,true);
 assert.equal(result.game.rinAsked,0);
});
test('Rin must take her turn when user says her question is due, even with low graph question drive',()=>{
 const x=makePlan('Засчитано, а твой вопрос ко мне?',gameHistory);
 assert.equal(x.plan.decision.act,'take_game_turn');
 assert.equal(x.plan.decision.question.mode,'required');
 assert.equal(x.plan.sceneMotion,'take_game_turn');
 assert.equal(x.plan.decision.delivery.segments.filter(s=>s.type==='text').length,1);
 assert.match(v3FallbackRealization(x.plan).segments[0].text,/\?/u);
});
test('a compound own question + handoff obligates Rin to answer AND ask, not just take the turn',()=>{
 const history=gameHistory.slice(0,-1);
 const x=makePlan('Как ты относишься ко мне? После твой вопрос',history.slice(0,-1));
 assert.equal(x.observations.sceneContracts.game.answerThenAsk,true);
 assert.equal(x.plan.decision.question.mode,'required');
 assert.equal(x.plan.sceneMotion,'answer_then_game_question');
 assert.equal(x.plan.decision.act,'answer_user_question');
 const text=v3FallbackRealization(x.plan).segments[0].text;
 assert.match(text,/\?/u);assert.match(text,/Ты мне/u);
});
test('an unanswered user question must be answered before the game turn is taken',()=>{
 const x=makePlan('Как ты относишься ко мне? После твой вопрос',gameHistory.slice(0,-1));
 assert.notEqual(x.plan.decision.act,'take_game_turn');
});
test('a random request for a question does not manufacture an active game',()=>{
 const x=makePlan('Твой вопрос ко мне?', [a('Мне нравится говорить с тобой')]);
 assert.equal(x.observations.sceneContracts.game,null);
 assert.notEqual(x.plan.decision.act,'take_game_turn');
});
test('explicitly ending a game disables the stored turn obligation',()=>{
 const x=observeSceneContracts({history:[...gameHistory,u('Хватит играть, давай сменим тему')],userText:'Хватит играть, давай сменим тему'});
 assert.equal(x.game,null);
});
test('a scene boundary wins over an implicit game question obligation',()=>{
 const h=[...gameHistory,u('Пожалуйста, без вопросов',8),a('Ладно, не буду расспрашивать',9)];
 const x=makePlan('Спасибо',h);
 assert.equal(x.observations.question.strongNoQuestion,true);
 assert.equal(x.plan.decision.question.mode,'none');
});
test('no-questions restraint survives next user turns, but an explicit release lifts it',()=>{
 const h=[u('Пожалуйста, без вопросов'),a('Хорошо, без вопросов')];
 assert.equal(observeSceneContracts({history:h,userText:'Спасибо'}).questionRestraint,true);
 assert.equal(observeSceneContracts({history:h,userText:'Можешь спросить меня кое о чём'}).questionRestraint,false);
});
test('a no-questions request expires rather than becoming a permanent gag',()=>{
 const h=[u('Без вопросов'),a('Хорошо')];
 for(let i=0;i<5;i++){h.push(u('Мне хорошо',i+10),a('Я рядом',i+10));}
 assert.equal(observeSceneContracts({history:h,userText:'Спасибо'}).questionRestraint,false);
});
test('achievement timeout is a cancellation, not fake 100 percent success',()=>{
 const intent={status:'active',kind:'achievement',target:'current_scene',goal:'развить собственную мысль',scene:'everyday',progress:.05,turnCount:11,maxTurns:8};
 const x=makePlan('Ладно',[],{activeIntent:intent});
 assert.equal(x.plan.decision.intentTransition.operation,'cancel');
 const next=applyIntentTransition(intent,x.plan.decision,{revision:118,scene:'everyday'});
 assert.equal(next.status,'cancelled');
 assert.equal(next.progress,.05);
});
test('explicit user refusal cancels an intent even before the timeout',()=>{
 const intent={status:'active',kind:'achievement',target:'current_scene',goal:'развить собственную мысль',scene:'everyday',progress:.05,turnCount:2,maxTurns:8};
 const x=makePlan('Я не хочу',[],{activeIntent:intent,perception:{signals:['user_explicit_refusal']}});
 assert.equal(x.plan.decision.intentTransition.operation,'cancel');
});
test('meal guard blocks unobserved completion after a cooking plan',()=>{
 const k={userText:'Так и что всё? Ужин съеден?',innerLife:{activity:'отдых'},recentHistory:[
 a('Пока нет. Ужин пора перестать откладывать.'),a('Ладно, отчитываюсь: ужин будет самым простым — что-нибудь соберу на скорую руку.')
 ]};
 const life=inspectGroundedLife({kernelState:k});
 assert.equal(life.guard,'meal_completion_unconfirmed');
 assert.equal(validateV3LifeRealization(getText('Да, съеден. Инспекция сработала.'),life),'unconfirmed_completed_meal');
 assert.equal(validateV3LifeRealization(getText('Пока только собиралась приготовить, ещё не поела.'),life),null);
});
test('existing completed meal statement avoids retroactive false denial',()=>{
 const k={userText:'Ужин съеден?',innerLife:{},recentHistory:[a('Ужин сегодня простой.'),a('Да, я уже поела и убрала посуду.')]};
 assert.equal(inspectGroundedLife({kernelState:k}).guard,'none');
});
test('current work, old outdoor and clock guards remain in place',()=>{
 const x=makePlan('А во сколько тебе вставать?', [a('Мне приятно с тобой рядом')]);
 assert.equal(x.plan.rinDaily.timezone,'Asia/Tokyo');
 assert.equal(x.plan.rinDaily.partOfDay,'вечер');
 assert.equal(x.plan.rinDaily.dayType,'weekday');
});
test('scene rules are visible in realization without granting Luna second action ownership',()=>{
 const {k,plan}=makePlan('Засчитано, а твой вопрос ко мне?',gameHistory);
 const prompt=buildV3RealizationPrompt({kernelState:k,plan});
 assert.match(prompt.dynamicSystem,/GAME_TURN=/);
 assert.match(prompt.dynamicSystem,/SCENE_CONTRACTS=/);
 assert.match(prompt.stableSystem,/Не меняй act/);
 assert.deepEqual(Object.keys(buildV3RealizationPrompt({kernelState:k,plan}).responseFormat.json_schema.schema.properties),['segments']);
});
test('debug reports stripped questions distinctly from upstream-model fallback',()=>{
 const api=readFileSync(new URL('../api/chat.js',import.meta.url),'utf8');
 const chat=readFileSync(new URL('../public/chat.js',import.meta.url),'utf8');
 assert.match(api,/questionSanitized:questionWasSanitized/);
 assert.match(chat,/questionSanitized=/);
 assert.match(chat,/gameTurnDue=/);
});
