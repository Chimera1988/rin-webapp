import test from 'node:test';
import assert from 'node:assert/strict';
import {mapCognitiveInputs,settleCognitiveGraph} from '../lib/cognition/v3/cognitive-dynamics.js';
import {buildCognitiveTurnPlan} from '../lib/cognition/v3/turn-plan.js';
import {inspectGroundedLife} from '../lib/cognition/v3/life-continuity.js';
import {buildV3RealizationPrompt,summarizeV3Dialogue,validateV3LifeRealization} from '../lib/cognition/v3/realization.js';
import {detectExperienceEvidence,updateCognitiveExperience} from '../lib/cognition/v3/experience.js';
import {normalizeCognitivePersistence} from '../public/lib/cognitive-state-contract.js';
import {fetchWithTransportDiagnostics} from '../public/js/http_client.js';

const kernel=(text='',more={})=>({userText:text,scene:{type:'everyday'},perception:{signals:[]},
  innerLife:{energy:63,needForQuiet:49,activity:'читает для себя',trace:'это уже не рабочий текст'},
  relationship:{trust:77,closeness:82,playfulness:55},mood:{affection:73},recentHistory:[],...more});
const graph=k=>{const inputs=mapCognitiveInputs({kernelState:k});return settleCognitiveGraph({inputs});};
const plan=(k,params={})=>buildCognitiveTurnPlan({settled:graph(k),kernelState:k,behaviorState:{},stickerState:{available:false},...params});

test('live emotional signal changes cognitive dynamics rather than preserving one baseline',()=>{
  const neutral=graph(kernel('Понятно)'));
  const affection=graph(kernel('Обнимаю тебя 🤗'));
  assert.ok(affection.behavioralState.approach>neutral.behavioralState.approach);
  assert.ok(affection.behavioralState.tenderGesture>neutral.behavioralState.tenderGesture);
  assert.ok(affection.nodes.warmth>neutral.nodes.warmth);
});
test('direct interest in Rin increases disclosure and reflection, not artificial questioning',()=>{
  const k=kernel('Про что читала?',{perception:{signals:['direct_question_present']}});
  const v=graph(k);
  const calm=graph(kernel('Понятно)'));
  assert.ok(v.behavioralState.disclose>calm.behavioralState.disclose);
  assert.ok(v.behavioralState.reflection>calm.behavioralState.reflection);
  assert.equal(plan(k).decision.act,'answer_user_question');
});
test('reading topic grounded in current activity, but title and plot are unknown',()=>{
  const k=kernel('Про что читала?',{recentHistory:[{role:'assistant',kind:'text',content:'Читаю для себя — просто ради удовольствия.'}]});
  const c=inspectGroundedLife({kernelState:k});
  assert.equal(c.domain,'reading');
  assert.equal(c.guard,'reading_content_unspecified');
  assert.deepEqual(c.evidence.reading,[]);
  const p=plan(k);
  const prompt=buildV3RealizationPrompt({kernelState:k,plan:p});
  assert.match(prompt.dynamicSystem,/reading_content_unspecified|книга, автор и сюжет не установлены/u);
});
test('unconfirmed completed walk cannot be asserted based only on pleasant weather',()=>{
  const k=kernel('Получилось у тебя прогуляться?',{innerLife:{activity:'читает для себя'},recentHistory:[
    {role:'assistant',kind:'text',content:'В такую осень хочется идти не спеша.'}
  ]});
  const c=inspectGroundedLife({kernelState:k});
  assert.equal(c.domain,'city');
  assert.equal(c.guard,'past_walk_unconfirmed');
  assert.equal(validateV3LifeRealization({segments:[{text:'Да, получилось — немного прошлась.'}]},c),'unconfirmed_completed_walk');
  assert.equal(validateV3LifeRealization({segments:[{text:'Пока думаю об этом, ещё не выбиралась.'}]},c),null);
});
test('existing past evidence removes completed walk guard',()=>{
  const k=kernel('Получилось у тебя погулять?',{recentHistory:[{role:'assistant',content:'Я уже немного прогулялась по городу.',kind:'text'}]});
  assert.equal(inspectGroundedLife({kernelState:k}).guard,'none');
});
test('legacy achievement no longer remains open after horizon',()=>{
  const k=kernel('Почему бы и нет)',{activeIntent:{status:'active',kind:'achievement',goal:'сохранять взаимную близость',
    scene:'everyday',turnCount:13,maxTurns:10,progress:.08}});
  const result=plan(k);
  assert.equal(result.decision.intentTransition.operation,'cancel');
  assert.equal(result.decision.intentTransition.reason,'achievement_horizon_reached');
});
test('ongoing relational goal advances by observed dialogue, not every turn',()=>{
  const current={status:'active',kind:'achievement',goal:'сохранять взаимную близость',scene:'everyday',turnCount:4,maxTurns:10,progress:.08};
  const warm=plan(kernel('Обнимаю тебя 🤗',{activeIntent:current}));
  assert.equal(warm.decision.intentTransition.operation,'advance');
  assert.ok(warm.decision.intentTransition.progress>.08);
  const distant=plan(kernel('Ладно, займусь делами',{activeIntent:{...current,goal:'решить конкретную загадку',scene:'reflective'}}));
  assert.equal(distant.decision.intentTransition.operation,'preserve');
});
test('maintenance intent tracks engagement without fake progress',()=>{
  const k=kernel('Я рядом 🤗',{activeIntent:{status:'active',kind:'maintenance',goal:'быть на связи',turnCount:4}});
  const d=plan(k).decision.intentTransition;
  assert.equal(d.operation,'preserve');assert.equal(d.progress,null);
  assert.ok(d.engagement>0);assert.ok(d.saturation>0);
});
test('plain affection alone cannot cause a decorative sticker',()=>{
  const k=kernel('Почему бы и нет)');
  const graphResult=graph(k);
  const result=buildCognitiveTurnPlan({settled:graphResult,kernelState:k,stickerState:{available:true,turnsSinceSticker:8},
    stickerCandidates:[{id:'tender_affectionate_lounge'}]});
  assert.equal(result.decision.delivery.segments.filter(s=>s.type==='sticker').length,0);
  assert.equal(result.trace.stickerReason,'no_contextual_gesture');
});
test('explicit user hug does not override close sticker spacing',()=>{
  const k=kernel('🤗');
  const r=buildCognitiveTurnPlan({settled:graph(k),kernelState:k,stickerState:{available:true,turnsSinceSticker:1,explicitGesture:true},
    stickerCandidates:[{id:'hug_soft'}]});
  assert.equal(r.decision.delivery.segments.some(s=>s.type==='sticker'),false);
});
test('explicit matching gesture after spacing may use a sticker',()=>{
  const k=kernel('Обнимаю тебя 🤗');
  const r=buildCognitiveTurnPlan({settled:graph(k),kernelState:k,stickerState:{available:true,turnsSinceSticker:3,explicitGesture:true},
    stickerCandidates:[{id:'hug_soft'}]});
  assert.equal(r.decision.delivery.segments.some(s=>s.type==='sticker'),true);
});
test('v3 short-term metrics reflect actual assembled dialogue, not old v2 fields',()=>{
  const k=kernel('Про что читала?',{recentHistory:[
    {role:'user',requestId:'u1',content:'Чем занята?',kind:'text'},
    {role:'assistant',turnId:'a1',content:'Читаю для себя.',kind:'text'},
    {role:'user',requestId:'u2',content:'Про что читала?',kind:'text'}
  ]});
  const d=summarizeV3Dialogue(k.recentHistory);
  assert.deepEqual([d.metrics.exchanges,d.metrics.speakerTurns],[1,3]);
  assert.ok(d.metrics.chars>30);
  assert.deepEqual(buildV3RealizationPrompt({kernelState:k,plan:plan(k)}).shortTermMetrics,d.metrics);
});
test('appreciation is learnable only when linked to previous committed Rin turn',()=>{
  const history=[{role:'assistant',turnId:'rin-turn-a',content:'Гулять приятно',kind:'text'}];
  const evidence=detectExperienceEvidence('Умничка ☺️😘',history);
  assert.equal(evidence.kind,'positive_appreciation');
  const saved=normalizeCognitivePersistence({revision:1,lastTurn:{id:'a',turnId:'rin-turn-a',act:'personal_response'}});
  const updated=updateCognitiveExperience({previous:saved,evidence,requestId:'b'});
  assert.ok(updated.state.learnedWeights['attachment->approach']>0);
  assert.equal(detectExperienceEvidence('🤗',history).kind,'none');
  const mismatched=updateCognitiveExperience({previous:saved,evidence:{...evidence,targetTurn:'someone-else'},requestId:'b'});
  assert.deepEqual(mismatched.changes,[]);
});
test('Safari-like Load failed is diagnosed without automatic retry',async()=>{
  const prior=globalThis.fetch;let attempts=0;
  globalThis.fetch=async()=>{attempts++;throw new TypeError('Load failed');};
  try{
    await assert.rejects(fetchWithTransportDiagnostics('/api/chat',{method:'POST'},50),e=>{
      assert.equal(e.transportDiagnostics?.kind,'network_load_failed');
      assert.ok(e.transportDiagnostics.elapsedMs>=0);
      return true;
    });
    assert.equal(attempts,1);
  }finally{globalThis.fetch=prior;}
});
