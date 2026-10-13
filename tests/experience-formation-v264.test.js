import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import { classifyExplicitActivity, inspectActivityContinuity, formatActivityContinuity } from '../lib/cognition/activity-continuity.js';
import { experienceCandidates, toEpisodeRows, toDecisionRows } from '../lib/memory-foundation/experience-candidates.js';
import { writeExperienceCandidates } from '../lib/memory-foundation/experience-database.js';
const base=Date.UTC(2026,9,13,11,9,0);
const msg=(id,content,minutes=0,role='assistant',status='complete')=>({id,role,status,kind:'text',content,ts:base+minutes*60000});
const plan='Пожалуй, да. Ты вовремя напомнил — закрываю фрагмент и иду обедать, пока перевод не решил, что мы с ним теперь неразлучны.';
const done='На обед была простая лапша с овощами — как раз то, что можно съесть, не отвлекаясь на сложные решения.';

test('explicit meal plan is a decision candidate, not a completed activity',()=>{
  const row=classifyExplicitActivity(msg('meal-start',plan));
  assert.equal(row?.phase,'planned');
  assert.equal(row?.activity,'meal');
  const entries=experienceCandidates([msg('meal-start',plan),msg('meal-done',done,4)]);
  assert.deepEqual(entries.map(x=>x.phase),['planned','claimed_complete']);
  assert.equal(toDecisionRows(entries).length,1);
  assert.equal(toEpisodeRows(entries).length,2);
  assert.equal(toEpisodeRows(entries)[0].context.evidence,'statement_not_physical_observation');
  assert.ok(toEpisodeRows(entries).every(x=>x.summary && !/лапша|перевод/u.test(x.summary)));
});

test('temporal cue identifies prematurely claimed lunch, without treating it as verified',()=>{
  const state=inspectActivityContinuity({history:[msg('meal-start',plan),msg('meal-done',done,4)],now:base+5*60000});
  assert.equal(state?.phase,'time_conflict');
  assert.equal(state?.elapsedToCompletionMinutes,4);
  assert.match(formatActivityContinuity(state,"Как ты быстро поела?"),/НЕ внешне подтверждённое/u);
});

test('activity cue works with kernel recentHistory which strips status',()=>{
  const history=[msg('meal-start',plan)];delete history[0].status;
  const state=inspectActivityContinuity({history,now:base+2*60000});
  assert.equal(state?.phase,'planned');
  assert.match(formatActivityContinuity(state),/намерение, не доказательство/u);
});

test('an in-progress claim is its own episode and prevents premature completion',()=>{
  const eating=msg('meal-eating','Сейчас обедаю, лапша вкусная.',2);
  const state=inspectActivityContinuity({history:[msg('plan',plan),eating],now:base+3*60000});
  assert.equal(state?.phase,'in_progress');
  assert.match(formatActivityContinuity(state),/не завершай/iu);
  const entries=experienceCandidates([eating]);
  assert.equal(entries[0].phase,'in_progress');
  assert.equal(toDecisionRows(entries).length,0);
  assert.match(toEpisodeRows(entries)[0].summary,/обедает/u);
});

test('a time-conflict warning is contextual and does not invade later unrelated exchanges',()=>{
  const state=inspectActivityContinuity({history:[msg('plan',plan),msg('done',done,4)],now:base+20*60000});
  assert.equal(state?.phase,'time_conflict');
  assert.equal(formatActivityContinuity(state,'Как у тебя настроение?'),'');
  assert.match(formatActivityContinuity(state,'Тебе понравился обед?'),/НЕ внешне подтверждённое/u);
});

test('completed actions after credible elapsed time are not flagged as contradictions',()=>{
  const state=inspectActivityContinuity({history:[msg('x',plan),msg('y',done,25)],now:base+27*60000});
  assert.equal(state?.phase,'claimed_complete');
  assert.equal(formatActivityContinuity(state),'');
});

test('stale, unrelated or user-spoken meal plans do not create an active activity',()=>{
  assert.equal(inspectActivityContinuity({history:[msg('x',plan)],now:base+5*3600000}),null);
  assert.equal(inspectActivityContinuity({history:[msg('u','Иду обедать',0,'user')],now:base+1000}),null);
  assert.equal(experienceCandidates([msg('u','Иду обедать',0,'user')]).length,0);
  assert.equal(classifyExplicitActivity(msg('neg','Не пойду обедать')),null);
  assert.equal(classifyExplicitActivity(msg('pending',plan,0,'assistant','pending')),null);
});

test('idempotent, bounded candidate ids refer back to real source message ids',()=>{
  const m=msg('assistant-long-'+('X'.repeat(78)),plan);
  const a=experienceCandidates([m])[0],b=experienceCandidates([m])[0];
  assert.equal(a.episodeId,b.episodeId);
  assert.ok(a.episodeId.length<=120);
  assert.equal(toEpisodeRows([a])[0].source_message_id,m.id);
});

test('candidate writer creates only evidence-linked episodes and self-reported decisions',async()=>{
  const statements=[];
  const sql={query:async(q,args=[])=>{statements.push({q,args});return [];}};
  const value=await writeExperienceCandidates([msg('m',plan)],sql);
  assert.deepEqual(value,{episodes:1,decisions:1,experienceClaims:0});
  assert.equal(statements.length,2);
  assert.match(statements[0].q,/JOIN rin_memory_observations/u);
  assert.match(statements[1].q,/evidence_level/u);
  assert.ok(!statements.some(s=>/rin_memory_beliefs|UPDATE\s+rin_|DELETE\s+FROM/iu.test(s.q)));
});

test('four-minute completion cannot form a validated outcome link',async()=>{
  const stmts=[];
  const sql={query:async(q,args=[])=>{stmts.push({q,args});return /SELECT d.decision_id/u.test(q)?[{decision_id:'dec-start',event_time_ms:base}]:[];}};
  const value=await writeExperienceCandidates([msg('m',done,4)],sql);
  assert.deepEqual(value,{episodes:1,decisions:0,experienceClaims:0});
  assert.equal(stmts.length,2);
  assert.ok(!stmts.some(s=>/INSERT INTO rin_memory_experiences/u.test(s.q)));
});

test('later explicit completion creates only tentative outcome claim with no lesson or confidence',async()=>{
  const stmts=[];
  const sql={query:async(q,args=[])=>{stmts.push({q,args});return /SELECT d.decision_id/u.test(q)?[{decision_id:'dec-start',event_time_ms:base}]:[];}};
  const value=await writeExperienceCandidates([msg('m',done,25)],sql);
  assert.equal(value.experienceClaims,1);
  const outcome=stmts.find(s=>/INSERT INTO rin_memory_experiences/u.test(s.q));
  assert.ok(outcome);
  assert.match(outcome.q,/NULL,NULL,'candidate'/u);
  assert.match(outcome.args[3],/её сообщение/u);
});

test('2.6.4 integration preserves the Vercel Hobby function count',()=>{
  const api=readFileSync(new URL('../api/archive.js', import.meta.url),'utf8');
  const prompt=readFileSync(new URL('../lib/cognition/rin-mind.js', import.meta.url),'utf8');
  const migration=readFileSync(new URL('../db/migrations/003_experience_formation.sql', import.meta.url),'utf8');
  assert.match(api,/writeExperienceCandidates\(messages\)/u);
  assert.match(api,/readMemoryFoundationStatus/u);
  assert.match(prompt,/inspectActivityContinuity\(/u);
  assert.match(prompt,/formatActivityContinuity\(/u);
  assert.match(migration,/CREATE INDEX IF NOT EXISTS/u);
  assert.doesNotMatch(migration,/(?:CREATE TABLE|DROP TABLE|ALTER TABLE|TRUNCATE|DELETE FROM|UPDATE rin_)/iu);
});
