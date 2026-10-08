import test from 'node:test';
import assert from 'node:assert/strict';
import { mapCognitiveInputs, settleCognitiveGraph } from '../lib/cognition/v3/cognitive-dynamics.js';
import { buildCognitiveTurnPlan } from '../lib/cognition/v3/turn-plan.js';
import { buildStickerCandidates } from '../lib/cognition/sticker-candidates.js';
import { isStickerIntentResolvable } from '../lib/cognition/sticker-selector.js';

const kernel=(userText,phase='interrupted_sleep')=>({
  userText,scene:{type:'everyday'},perception:{signals:[]},
  innerLife:{sleepPhase:phase,energy:50,needForQuiet:79,mentalLoad:33},
  mood:{affection:73},relationship:{trust:78,closeness:84,playfulness:57},
  emotion:{primary:{type:'tenderness',intensity:50},warmth:75},
  dialogueState:{recentMotifs:[],recentMessageShapes:[],sceneCommitments:[]},recentHistory:[],openLoops:[]
});
function run(userText,{phase='interrupted_sleep',since=35,available=true,mode='smart',observations={}}={}){
  const k=kernel(userText,phase);
  const stickerState={available,mode,turnsSinceSticker:since,requiredGapTurns:2,explicitGesture:/[😘💋🤗]/u.test(userText)};
  const stickerCandidates=buildStickerCandidates({userText,state:{...k,stickerState},limit:12});
  const inputs=mapCognitiveInputs({kernelState:k,observations});
  const settled=settleCognitiveGraph({inputs});
  const plan=buildCognitiveTurnPlan({kernelState:k,settled,observations,stickerState,stickerCandidates});
  return {plan,stickerCandidates,stickerState};
}

for (const [text,prefix] of [
  ['Обнимаю крепче…','hug_'],
  ['😘😘😘','kiss_'],
  ['Тогда нежные объятия и один поцелуй для начала… 🤭','hug_']
]) {
  test(`interrupted sleep permits a contextual ${prefix} sticker for ${text}`, async()=>{
    const {plan,stickerCandidates}=run(text);
    assert.equal(plan.contactStance,'quiet_presence');
    assert.equal(plan.decision.delivery.responseDepth,'short');
    const sticker=plan.decision.delivery.segments.find(s=>s.type==='sticker');
    assert.ok(sticker,JSON.stringify({reason:plan.trace.stickerReason,stickerCandidates}));
    assert.ok(sticker.stickerIntent.startsWith(prefix),sticker.stickerIntent);
    assert.ok(await isStickerIntentResolvable(sticker.stickerIntent));
    assert.equal(plan.trace.stickerReason,'direct_contextual_gesture');
  });
}
test('emoji-only kiss may use a sticker without model text',()=>{
  const {plan}=run('😘😘😘');
  assert.equal(plan.decision.delivery.mode,'sticker_only');
  assert.equal(plan.needsVoice,false);
});
test('actual sleeping blocks sticker even in kiss context',()=>{
  const {plan}=run('😘',{phase:'sleeping'});
  assert.equal(plan.decision.delivery.segments.some(s=>s.type==='sticker'),false);
  assert.equal(plan.trace.stickerReason,'sleeping');
});
test('request for no contact blocks stickers',()=>{
  const {plan}=run('Обнимаю тебя 🤗',{observations:{space:{strongBoundary:true}}});
  assert.equal(plan.decision.delivery.segments.some(s=>s.type==='sticker'),false);
  assert.equal(plan.trace.stickerReason,'contact_boundary');
});
test('sticker preference is authoritative',()=>{
  const {plan}=run('😘',{available:false});
  assert.equal(plan.decision.delivery.segments.some(s=>s.type==='sticker'),false);
  assert.equal(plan.trace.stickerReason,'sticker_unavailable');
});
test('repeated emoji does not spam stickers despite positive context',()=>{
  for(const since of [0,1,2]){
    const {plan}=run('😘',{since});
    assert.equal(plan.decision.delivery.segments.some(s=>s.type==='sticker'),false);
    assert.equal(plan.trace.stickerReason,'sticker_spacing');
  }
});
test('warmth alone does not force decorative stickers',()=>{
  const {plan}=run('Ну хорошо, моя хорошая)');
  assert.equal(plan.decision.delivery.segments.some(s=>s.type==='sticker'),false);
  assert.equal(plan.trace.stickerReason,'no_contextual_gesture');
});
test('hug candidate survives catalog top-12 truncation in tender scenes',()=>{
  const {stickerCandidates}=run('Обнимаю крепче…');
  assert.ok(stickerCandidates.some(x=>x.id.startsWith('hug_')),JSON.stringify(stickerCandidates.map(x=>x.id)));
  assert.ok(stickerCandidates[0].id.startsWith('hug_'));
});
