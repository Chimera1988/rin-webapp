import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { explicitSceneActions, recentSceneActions } from '../lib/cognition/scene-agency.js';
import { buildDialogueState } from '../lib/cognition/dialogue-state.js';
import { normalizeDialogueState } from '../lib/cognition/cognitive-contract.js';
import { buildRinMindPrompt } from '../lib/cognition/rin-mind.js';
import { inspectExpressionNovelty, formatExpressionGuidance, rhetoricalMove } from '../lib/cognition/expression-novelty.js';
import { rinCalendarForPrompt } from '../lib/cognition/temporal-grounding.js';
import { inspectSceneClosure } from '../lib/cognition/behavior-state.js';

const event = (role, content, index=1) => ({ id:`${role}-${index}`,role,kind:'text',status:'complete',content,ts:index*1000,turnId:`t${index}` });
const user = text => event('user',text,25);
const assistant = text => event('assistant',text,24);
const makeHistory = contents => contents.flatMap((s,i)=>[event('user','Продолжай',i*2+1),event('assistant',s,i*2+2)]);

// User examples from real regression discussions.
test('v2.6.0 scene agency: directed invitation has unambiguous actor/destination and is NOT completed',()=>{
  assert.deepEqual(explicitSceneActions('Иди ко мне…','user').map(({action,actor,destination,status})=>[action,actor,destination,status]),[
    ['invite_approach','rin','user','proposed']
  ]);
  assert.deepEqual(explicitSceneActions('Иди ко мне…','assistant').map(({actor,destination})=>[actor,destination]),[['user','rin']]);
  assert.deepEqual(explicitSceneActions('Я иду к тебе','assistant').map(({action,actor,destination,status})=>[action,actor,destination,status]),[
    ['approach','rin','user','stated']
  ]);
});

test('v2.6.0 scene agency: seating beside user does not become seating beside Rin',()=>{
  const actions=explicitSceneActions('Садись рядом со мной', 'user');
  assert.equal(actions.length,1);
  assert.equal(actions[0].actor,'rin');
  assert.equal(actions[0].destination,'user');
  assert.equal(actions[0].status,'proposed');
});

test('v2.6.0 scene agency: "Нет, садись, вместе почирикаем" keeps the proposed invitation with unspecified location',()=>{
  const actions=explicitSceneActions('Нет, садись, вместе почирикаем)','user');
  assert.equal(actions.length,1);
  assert.equal(actions[0].action,'invite_sit');
  assert.equal(actions[0].actor,'rin');
  assert.equal(actions[0].destination,'shared');
  assert.equal(actions[0].status,'proposed');
});

test('v2.6.0 scene agency: hypotheticals, negatives and questions cannot become completed physical actions',()=>{
  for(const text of ['Если подойдёшь ко мне, то…', 'Может, садись рядом со мной?', 'Не иди ко мне', 'А ты садись?']) {
    assert.deepEqual(explicitSceneActions(text,'user'),[],text);
  }
});

test('v2.6.0 scene agency: records are bounded, normalized and resolve role according to each speaker',()=>{
  const actions=recentSceneActions([user('Иди ко мне'), assistant('Я иду к тебе')],'');
  assert.equal(actions.length,2);
  assert.deepEqual(actions.map(a=>[a.action,a.actor,a.destination,a.status]),[
    ['invite_approach','rin','user','proposed'],
    ['approach','rin','user','stated']
  ]);
  const normalized=normalizeDialogueState({sceneActions:actions});
  assert.deepEqual(normalized.sceneActions,actions);
  assert.deepEqual(recentSceneActions([], '',{sceneActions:actions},{sceneChanged:true}),[]);
});

test('v2.6.0 actual dialogue state exposes agency to the dynamic prompt, stable prefix unchanged',()=>{
  const history=[assistant('Ты можешь садиться на мой подоконник.'),user('Иди ко мне')];
  const dialogue=buildDialogueState({history,userText:'Иди ко мне',brain:{activeScene:{type:'playful_flirt'}}});
  assert.equal(dialogue.sceneActions.at(-1).actor,'rin');
  const profile={prompt_profile:{}};
  const prior=buildRinMindPrompt({profile,state:{}});
  const next=buildRinMindPrompt({profile,state:{dialogueState:dialogue}});
  assert.equal(prior.stableSystem,next.stableSystem);
  assert.match(next.dynamicSystem,/SCENE AGENCY/);
  assert.match(next.dynamicSystem,/"actor":"rin"/);
  assert.match(next.dynamicSystem,/COMMITMENT CONSISTENCY|SCENE AGENCY/);
});

test('v2.6.0 new scene and farewell clear old spatial actions without clearing memories',()=>{
  const previous=normalizeDialogueState({scene:'playful_flirt',sceneActions:explicitSceneActions('Иди ко мне','user')});
  const switched=buildDialogueState({history:[],userText:'Как завтра с работой?',previousState:previous,brain:{activeScene:{type:'everyday',topicDrift:true}}});
  assert.deepEqual(switched.sceneActions,[]);
  const farewell=buildDialogueState({history:[],userText:'Спокойной ночи',previousState:previous,brain:{activeScene:{type:'farewell'}}});
  assert.deepEqual(farewell.sceneActions,[]);
  const close=inspectSceneClosure([assistant('Спокойной ночи, до завтра.')],'Спокойной ночи, моя Китсуне');
  assert.equal(close.strong,true);
});

test('v2.6.0 varied wording but repeated stubborn stance is flagged as same rhetorical move',()=>{
  const lines=[
    'Уступать буду только по собственному решению.',
    'Мой вечер начался с разговора о кино.',
    'Не думаю, что я сдамся так просто.',
    'Теперь надо заварить свежий чай.',
    'В этом споре не уступлю ни за что.',
    'Спасибо, что выслушал меня.',
    'А вот дальше я сама решаю.',
  ];
  const result=inspectExpressionNovelty(makeHistory(lines));
  const move=result.repeatedMoves.find(x=>x.move==='defend_autonomy');
  assert.ok(move?.count >= 3,JSON.stringify(result));
  assert.ok(result.pressure >= 24);
  assert.match(formatExpressionGuidance(result,11),/один смысловой ход/);
  assert.equal(rhetoricalMove('Не уступлю'),'defend_autonomy');
});

test('v2.6.0 changing rhetorical moves in a long affectionate chat is not a semantic loop',()=>{
  const result=inspectExpressionNovelty(makeHistory([
    'Я выбрала новый чай.',
    'Сегодня библиотека закрылась раньше.',
    'Не перестаю улыбаться твоему рассказу.',
    'Меня удивило, как пахнет осенний город.',
    'Утром я записала одну интересную мысль.',
  ]));
  assert.deepEqual(result.repeatedMoves,[]);
  assert.equal(result.pressure,0);
});

test('v2.6.0 calendar preserves scheduled tomorrow separately from today current state',()=>{
  const schedule=JSON.parse(readFileSync(new URL('../public/data/rin_schedule.json',import.meta.url),'utf8')).weekly_rhythm;
  const calendar=rinCalendarForPrompt({environment:{rinHuman:'2026-10-11 23:28',rinTz:'Europe/Moscow'},weeklyRhythm:schedule,currentWorkMode:'off'});
  assert.equal(calendar.days[0].workMode,'off');
  assert.deepEqual(calendar.days.slice(0,3).map(x=>[x.weekday,x.scheduledWork]),[
    ['воскресенье',false],['понедельник',true],['вторник',true]
  ]);
});

test('v2.6.0 debug exposes semantic and agency signals; no extra LLM retry imposed',()=>{
  const source=readFileSync(new URL('../api/chat.js',import.meta.url),'utf8');
  const client=readFileSync(new URL('../public/chat.js',import.meta.url),'utf8');
  assert.match(source,/expressionRepeatedMoves:/);
  assert.match(source,/sceneActionCount:/);
  assert.match(client,/exprPressure=/);
  assert.match(client,/sceneActions=/);
  assert.match(source,/semanticRetries: 0/);
});
