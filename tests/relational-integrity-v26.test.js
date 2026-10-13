import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evolveRelationalIntegrity, normalizeRelationalIntegrity, disallowedBoundaryUse, inspectPressureSignal, integrateRinRepairChoice } from '../lib/cognition/relational-integrity.js';
import { buildAffectiveTurn } from '../lib/cognition/emotional-state.js';
import { buildKernelState } from '../lib/cognition/kernel-state.js';
import { buildRinMindPrompt, serializeCompactState } from '../lib/cognition/rin-mind.js';

const convo = (x, userText, revision, signal) => evolveRelationalIntegrity({ previous:x,userText,revision,affectiveSignal:signal });

test('boundary set when user explicitly objects, survives normal conversation and restart normalization', () => {
  let s=convo(null,'Ну не надзиратель, это как-то грубовато. Я ведь забочусь о тебе',10);
  assert.equal(s.boundaries[0].term,'надзиратель');
  assert.equal(s.rupture.affected,'user');
  s=normalizeRelationalIntegrity(JSON.parse(JSON.stringify(s)));
  s=convo(s,'Я тебе расскажу про сегодняшний ужин',11);
  assert.equal(s.boundaries[0].status,'active');
  assert.equal(disallowedBoundaryUse('Ну что, мой заботливый надзиратель?',s),'надзиратель');
  assert.equal(disallowedBoundaryUse('Отчитываюсь перед надзирателем)',s),'надзиратель');
  assert.equal(disallowedBoundaryUse('Прости, я не должна была говорить «надзиратель»',s),null);
  assert.equal(disallowedBoundaryUse('Мой милый защитник)',s),null);
});

test('plain banter, disagreement, and boundaries about other things are not automatically labeled injury or manipulation',()=>{
  for(const phrase of ['Нет, не согласен)','Ты меня дразнишь 😅','Я сегодня хочу просто отдохнуть','Если любишь чай, завари себе чашку','Я не могу сейчас общаться']){
    assert.equal(inspectPressureSignal(phrase),null,phrase);
    const s=convo(null,phrase,1);
    assert.equal(s.rupture,null,phrase);
  }
});

test('a second objection renews active rupture rather than erasing first boundary',()=>{
  const s1=convo(null,'Ну не надзиратель, это грубовато',12);
  const s2=convo(s1,'Ты снова называешь меня надзирателем? Это может звучать обидно',13);
  assert.equal(s2.rupture.affected,'user');
  assert.ok(s2.rupture.intensity>s1.rupture.intensity);
  assert.equal(s2.boundaries.filter(b=>b.status==='active').length,1);
});

test('guilt/coercion and emotional leverage are noticed as speech signals, not a personality diagnosis',()=>{
  const cases=[
    ['Если ты меня любишь, то обязана перестать обижаться','conditional_affection'],
    ['Если ты не согласишься со мной, я уйду и перестану общаться','threatened_connection'],
    ['Я же извинился, забудь теперь обиду','invalidating_hurt'],
    ['После всего, что я для тебя сделал, ты должна уступить','guilt_leverage']
  ];
  for(const [userText,signal] of cases){
    assert.equal(inspectPressureSignal(userText)?.type,signal,userText);
    const affect=buildAffectiveTurn({userText,memory:{conversationState:{revision:4}},brain:{activeScene:{type:'everyday'}}});
    assert.equal(affect.signal.type,'boundary_pressure',userText);
    const state=convo(null,userText,4,affect.signal);
    assert.equal(state.rupture.affected,'rin');
    assert.equal(state.pressure.signal,signal);
  }
});

test("explicit Rin disrespect creates hurt; user's honest apology softens but cannot instantly erase incident",()=>{
  const first=buildAffectiveTurn({userText:'Ты тупая, отвали',memory:{conversationState:{revision:6}},brain:{activeScene:{type:'everyday'}}});
  assert.equal(first.emotionalState.primary.type,'hurt');
  const state=convo(null,'Ты тупая, отвали',6,first.signal);
  assert.equal(state.rupture.affected,'rin');
  const apology=convo(state,'Прости, я погорячился и не хотел тебя обидеть',7,{type:'repair'});
  assert.equal(apology.rupture.phase,'repairing');
  assert.ok(apology.rupture.intensity>0);
  assert.equal(integrateRinRepairChoice(apology,'Я тебя услышала, но мне нужно немного времени').rupture.phase,'repairing');
  assert.equal(integrateRinRepairChoice(apology,'Я тебя прощаю. Давай дальше бережнее').rupture.phase,'resolved');
});

test('user hurt is not erased by one apology or user smile; explicit later consent can close it',()=>{
  const a=convo(null,'Не называй меня надзиратель, это неприятно',100);
  const b=convo(a,'☺️',101);
  assert.notEqual(b.rupture.phase,'resolved');
  const c=convo(b,'Обнимаю тебя 😘',102);
  assert.equal(c.rupture.phase,'repairing');
  const d=convo(c,'Договорились, всё хорошо',103);
  assert.equal(d.rupture.phase,'resolved');
  assert.equal(d.boundaries[0].status,'active');
});

test('background turn does not invent new user feelings or resolve conflict',()=>{
  const a=convo(null,'Мне неприятно, что ты так сказала',20);
  const b=evolveRelationalIntegrity({previous:a,userText:'',revision:21});
  assert.deepEqual(b,a);
});

test('prompt carries boundaries, repair steps and pressure without altering stable identity',()=>{
  const profile={prompt_profile:{}};
  const normal=buildRinMindPrompt({profile,state:{}});
  const integrity=convo(null,'Если ты меня любишь, то обязана перестать обижаться',6,{type:'boundary_pressure'});
  integrity.boundaries=[{term:'надзиратель',reason:'мне неприятно',createdAtTurn:3,updatedAtTurn:3,status:'active'}];
  const state={relationalIntegrity:integrity};
  const prompt=buildRinMindPrompt({profile,state});
  assert.equal(prompt.stableSystem,normal.stableSystem);
  assert.match(prompt.dynamicSystem,/RELATIONAL REPAIR/u);
  assert.match(prompt.dynamicSystem,/RELATIONAL PRESSURE AWARENESS/u);
  assert.match(prompt.dynamicSystem,/ЯВНО ОЗНАЧЕННЫЕ ГРАНИЦЫ/u);
  assert.match(serializeCompactState(state),/надзиратель/u);
});

test('kernel state and durable transition carry the same relational integrity on standard turns',async()=>{
  const text='Ну не надзиратель, это грубовато';
  const history=[{id:'rin-0',role:'assistant',status:'complete',content:'Ты мой заботливый надзиратель'},{id:'user-1',role:'user',status:'sent',requestId:'r1',content:text}];
  const k=buildKernelState({requestId:'r1',userText:text,history,memory:{conversationState:{revision:15}},affectiveTurn:{signal:{type:'user_hurt'}}});
  assert.equal(k.relationalIntegrity.boundaries[0].term,'надзиратель');
  const turn=readFileSync(new URL('../lib/cognition/turn-decision.js',import.meta.url),'utf8');
  const memory=readFileSync(new URL('../public/js/rin_memory.js',import.meta.url),'utf8');
  const api=readFileSync(new URL('../api/chat.js',import.meta.url),'utf8');
  assert.match(turn,/relationalIntegrity:\s*state\?\.relationalIntegrity/u);
  assert.match(memory,/normalizeRelationalIntegrity\(transition.relationalIntegrity\)/u);
  assert.match(api,/disallowedBoundaryUse\(segment.text/u);
});

test('release and debug markers include the new relational consistency state',()=>{
  const release=readFileSync(new URL('../public/js/release.js',import.meta.url),'utf8');
  const chat=readFileSync(new URL('../public/chat.js',import.meta.url),'utf8');
  assert.match(release,/export const RIN_RELEASE_ID = '\d{4}-\d{2}-\d{2}-rin-mind-v\d+\.\d+\.\d+-[a-z0-9-]+';/u);
  assert.match(chat,/relPressure=/u);
  assert.match(chat,/relBoundaries=/u);
});

test('both local scheduler and Push cron gate unsolicited messages after an explicit request for space',()=>{
  const local=readFileSync(new URL('../public/chat.js',import.meta.url),'utf8');
  const push=readFileSync(new URL('../lib/push/core.js',import.meta.url),'utf8');
  assert.match(local,/savedMemory\?\.conversationState\?\.relationalIntegrity\?\.contactBoundary\?\.active/u);
  assert.match(push,/snapshot\?\.memory\?\.conversationState\?\.relationalIntegrity\?\.contactBoundary\?\.active/u);
});

test('unresolved Rin hurt retains tension and pending repair after a single apology',()=>{
  const base={relationship:{trust:78,comfort:70,closeness:72,respect:78},conversationState:{revision:8}};
  const bad=buildAffectiveTurn({userText:'Ты тупая, отвали',memory:base,brain:{activeScene:{type:'conflict_repair'}}});
  const integrity=convo(null,'Ты тупая, отвали',8,bad.signal);
  const memory={...base,relationship:bad.relationshipState,conversationState:{revision:9,emotionalState:bad.emotionalState,relationalIntegrity:integrity}};
  const next=buildAffectiveTurn({userText:'Прости, не хотел тебя обидеть',memory,brain:{activeScene:{type:'conflict_repair'}}});
  assert.equal(next.signal.type,'repair');
  assert.equal(next.relationshipState.recentDynamic.repairPending,true);
  assert.equal(next.emotionalState.secondary.type,'hurt');
  assert.ok(next.emotionalState.tension>bad.emotionalState.tension-28);
});
