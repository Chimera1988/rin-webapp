import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyRinSelfReport,fromMessageToRecord,recallQuery,recallRinAction,saveRinActionCandidates} from '../lib/memory-foundation/autobiography.js';
const m=(content,overrides={})=>({id:'rin-a1',ts:1792008000000,role:'assistant',kind:'text',status:'complete',content,...overrides});

test('records explicit completed acts, not hypothetical or negated claims',()=>{
  assert.equal(classifyRinSelfReport(m('Я закончила перевод и проверила правки.')).kind,'rin_action_reported_complete');
  assert.equal(classifyRinSelfReport(m('Я не закончила перевод')),null);
  assert.equal(classifyRinSelfReport(m('Я бы закончила перевод, если бы успела')),null);
  assert.equal(classifyRinSelfReport(m('Представь, я закончила перевод')),null);
  assert.equal(classifyRinSelfReport(m('Я собираюсь закончить перевод')),null);
  assert.equal(classifyRinSelfReport(m('Ты закончила перевод?',{role:'user'})),null);
});

test('stably identifies exact source, preserving epistemic uncertainty',()=>{
  const a=fromMessageToRecord(m('Я подготовила комментарии к тексту.'));
  const b=fromMessageToRecord(m('Я подготовила комментарии к тексту.'));
  assert.deepEqual(a,b);
  assert.equal(a.source_message_id,'rin-a1');
  assert.equal(a.review_status,'candidate');
  assert.equal(a.confidence,null);
  assert.match(a.statement,/Рин сказала/u);
});

test('only explicit recall and specific subject triggers cloud query',()=>{
  assert.equal(recallQuery('Как прошёл день?'),null);
  assert.equal(recallQuery('Помнишь, ты сделала это?'),null);
  assert.ok(recallQuery('Помнишь, ты закончила перевод статьи?').includes('перевод'));
});

test('read-only recall passes parameterized SQL and retains provenance',async()=>{
  let called=null;
  const db={query:async(sql,args)=>{called={sql,args};return [{record_id:'1',statement:'Рин сказала: «Я закончила перевод»',source_message_id:'a1',event_time_ms:1792008000000,source_kind:'rin_self_report',review_status:'candidate'}];}};
  const rows=await recallRinAction('Как прошёл день?',db);
  assert.deepEqual(rows,[]);
  assert.equal(called,null);
  const hit=await recallRinAction('Помнишь, ты закончила перевод?',db);
  assert.equal(hit.length,1);
  assert.match(hit[0].text,/не внешняя проверка/u);
  assert.match(called.sql,/plainto_tsquery\('russian',\$1\)/u);
  assert.equal(called.args.length,1);
});

test('writes only source-linked candidates idempotently',async()=>{
  let stmt=null;
  const db={query:async(sql,args)=>{stmt={sql,args};return [{record_id:'x'}];}};
  const result=await saveRinActionCandidates([m('Я закончила перевод.'),m('Я хочу закончить перевод.',{id:'a2'})],db);
  assert.deepEqual(result,{candidates:1,inserted:1});
  assert.match(stmt.sql,/JOIN rin_memory_observations/u);
  assert.match(stmt.sql,/ON CONFLICT \(record_id\) DO NOTHING/u);
  assert.doesNotMatch(stmt.sql,/UPDATE|DELETE/iu);
});
