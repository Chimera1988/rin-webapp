import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePrivateCloseness, recordPrivateCloseness } from '../lib/cognition/private-closeness.js';
import { buildRinMindPrompt } from '../lib/cognition/rin-mind.js';
import { normalizeTurnDecision } from '../lib/cognition/turn-decision.js';
import { stabilizePersistentIntent } from '../lib/cognition/intent-policy.js';
import { classifyExplicitSharedReport, experienceCandidates, toEpisodeRows, toDecisionRows } from '../lib/memory-foundation/experience-candidates.js';
import { writeExperienceCandidates } from '../lib/memory-foundation/experience-database.js';

const m = (mode, move, thread) => ({socialIntent:'affection',contactStance:'open',closenessMode:mode,closenessFocus:'affection',closenessMove:move,closenessThread:thread});
const record = (state, mode, move, thread, revision, userText='') => recordPrivateCloseness({previous:state,mind:m(mode,move,thread),revision,userText});
const mk = (id, role, content, ts=1791921000000, kind='text') => ({id,role,content,ts,kind,status:'complete'});

test('scene landmarks preserve original frame after many model rewritten summaries',()=>{
  let s=record(null,'tender','initiate','Крепость принадлежит пользователю',500);
  for(let i=501;i<550;i++) s=record(s,'tender','stay',`Новый короткий фокус ${i}`,i);
  assert.equal(s.landmarks.length,1);
  assert.equal(s.landmarks[0].text,'Крепость принадлежит пользователю');
  assert.equal(s.thread,'Новый короткий фокус 549');
  assert.ok(buildRinMindPrompt({state:{privateCloseness:s}}).dynamicSystem.includes('Крепость принадлежит пользователю'));
});

test('landmarks keep opening beat and five last decisive transitions',()=>{
  let s=record(null,'tender','initiate','Начало вечера',1);
  for(let i=2;i<=15;i++) s=record(s,'tender','deepen',`Существенный ход ${i}`,i);
  assert.equal(s.landmarks.length,6);
  assert.equal(s.landmarks[0].text,'Начало вечера');
  assert.equal(s.landmarks.at(-1).text,'Существенный ход 15');
  assert.deepEqual(s.landmarks.map(x=>x.atTurn),[2,12,13,14,15,16]);
});

test('explicit correction takes priority over prior scene summary and persists',()=>{
  const start=record(null,'tender','initiate','Крепость Рин',10);
  let s=record(start,'tender','stay','Крепость Рин',11,'Мы же говорили про сердце моей крепости');
  assert.equal(s.landmarks.at(-1).kind,'correction');
  assert.match(s.landmarks.at(-1).text,/моей крепости/);
  for(let i=12;i<25;i++) s=record(s,'tender','stay','Вместе сидят у очага',i);
  assert.match(JSON.stringify(s.landmarks),/моей крепости/);
});

test('request to stop is observed, even if conversation becomes quiet',()=>{
  let s=record(null,'tender','initiate','Взаимная нежность',1);
  s=record(s,'quiet','shift','Остаются рядом',2,'Мне приятно, но лучше остановиться, побудем просто рядом');
  assert.equal(s.mode,'quiet');
  assert.ok(s.landmarks.some(x=>x.kind==='boundary'));
  const ended=recordPrivateCloseness({previous:s,conversationState:'ending',revision:3,mind:m('tender','stay','продолжение')});
  assert.equal(ended.thread,null);
  assert.deepEqual(ended.landmarks,[]);
});

test('maintenance without a model commitment receives actual connection drive instead of zero',()=>{
  const transition={operation:'activate',kind:'maintenance',goal:'сохранять тихую взаимную близость, делясь мыслями дня',target:'shared_daily_reflection',commitment:0};
  const t=stabilizePersistentIntent({transition,driveState:{connection:82},revision:100});
  assert.equal(t.operation,'activate');
  assert.equal(t.engagement,82);
  assert.equal(t.kind,'maintenance');
});

test('genuinely low engagement does not start unmotivated maintenance',()=>{
  const transition={operation:'activate',kind:'maintenance',goal:'сохранять тихую взаимную близость',target:'shared_daily_reflection',commitment:0};
  const t=stabilizePersistentIntent({transition,driveState:{connection:0},revision:100});
  assert.equal(t.operation,'none');
  assert.equal(t.reason,'low_maintenance_engagement');
});

test('only explicit user statements produce rare shared-event candidates',()=>{
  const samples=[
    mk('u1','user','Это лучший момент всего этого дня… ☺️'),
    mk('u2','user','Мне кажется, этот вечер нас сблизил'),
    mk('u3','user','Мне правда приятно, но лучше остановиться…. И если ты не против, побудем просто рядом'),
    mk('u4','user','А ещё мне понравилось твоё кулинарное шоу для одного зрителя'),
    mk('a1','assistant','Это лучший момент всего этого дня…'),
    mk('u5','user','Тогда обнимемся, ну и поцелуй'),
    mk('u6','user','Представь, что это лучший момент всего этого дня')
  ];
  const entries=experienceCandidates(samples);
  assert.deepEqual(entries.map(x=>x.activity),['shared_moment','closeness_reflection','moment_boundary','shared_day_reflection']);
  assert.equal(toDecisionRows(entries).length,0);
  const rows=toEpisodeRows(entries);
  assert.ok(rows.every(x=>x.context.origin==='user_explicit_statement' && x.context.evidence==='explicit_user_statement_not_external_fact'));
  assert.ok(rows.every(x=>x.source_message_id.startsWith('u')));
  assert.ok(rows.every(x=>!x.summary.includes('поцелуй') && !x.summary.includes('кулинарное шоу')));
});

test('no invented relational belief, decision, or inferred experience is written',async()=>{
  const statements=[];
  const sql={query:async(q, args=[])=>{statements.push({q,args});return [];}};
  const entries=[mk('u1','user','Это лучший момент всего этого дня'),mk('u2','user','Мне правда приятно, но лучше остановиться, побудем просто рядом')];
  const a=await writeExperienceCandidates(entries,sql);
  assert.deepEqual(a,{episodes:2,decisions:0,experienceClaims:0});
  assert.equal(statements.length,1);
  assert.match(statements[0].q,/JOIN rin_memory_observations/u);
  assert.doesNotMatch(statements[0].q,/UPDATE|DELETE|rin_memory_beliefs/iu);
  assert.equal(classifyExplicitSharedReport(mk('u3','user','Я не хочу отпускать этот вечер')),null);
});

test('historical audit scans old messages without writing unless explicitly requested',async()=>{
  const { auditHistoricalCandidates }=await import('../scripts/audit-episodic-candidates.js');
  let page=0;const queries=[];
  const entries=[{id:'u1',ts:1,payload:mk('u1','user','Это лучший момент всего этого дня',1)},
    {id:'u2',ts:2,payload:mk('u2','user','Может посмотрим кино?',2)}];
  const sql={query:async(q,args)=>{
    queries.push({q,args});
    if(!q.includes('SELECT id,ts,payload'))throw new Error('unexpected write');
    return page++ === 0 ? entries : [];
  }};
  const r=await auditHistoricalCandidates({sql,limit:2});
  assert.deepEqual(r,{scanned:2,candidates:1,byActivity:{shared_moment:1},applied:false});
  assert.equal(queries.length,2);
  assert.match(queries[0].q,/ORDER BY ts ASC,id ASC LIMIT/u);
});
