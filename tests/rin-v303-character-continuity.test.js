import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {observeTurn} from '../lib/cognition/v3/turn-observations.js';
import {buildCognitiveTurnPlan} from '../lib/cognition/v3/turn-plan.js';
import {mapCognitiveInputs,settleCognitiveGraph} from '../lib/cognition/v3/cognitive-dynamics.js';
import {buildV3RealizationPrompt} from '../lib/cognition/v3/realization.js';
import {normalizeOpenLoop} from '../lib/cognition/cognitive-contract.js';
import {detectUserFutureCallback,futureCallbackOpenLoop} from '../lib/cognition/future-callbacks.js';
import {buildStickerState} from '../lib/cognition/sticker-state.js';

const profile=JSON.parse(readFileSync(new URL('../data/canon/rin_prompt_profile.json',import.meta.url),'utf8'));
const kernel=(userText,extra={})=>({userText,perception:{signals:[]},scene:{type:'everyday'},
  innerLife:{energy:74,needForQuiet:22,sleepPhase:'awake'},
  mood:{affection:77},relationship:{trust:86,closeness:86,playfulness:65},
  dialogueState:{recentMotifs:[],recentMessageShapes:[],sceneCommitments:[]},recentHistory:[],openLoops:[],...extra});
const make=(text,extra={},override={})=>{
  const k=kernel(text,extra);
  const observations=observeTurn({userText:text,history:k.recentHistory,memory:{conversationState:{dialogueState:k.dialogueState}}});
  const settled=settleCognitiveGraph({inputs:mapCognitiveInputs({kernelState:k,observations})});
  return {k,observations,plan:buildCognitiveTurnPlan({settled,kernelState:k,observations,
    stickerState:{available:false},...override})};
};

test('everyday brief exchange is not padded to a long answer',()=>{
  const r=make('Ну ты хитрая)');
  assert.equal(r.observations.socialCues.smallSocialBeat,true);
  assert.equal(r.plan.decision.delivery.responseDepth,'short');
  assert.equal(r.plan.decision.delivery.segments[0].maxChars,320);
});

test('care offered to Rin becomes a causal social cue and meaningful plan focus',()=>{
  const r=make('Ты устала? Попей чай, береги себя)',{perception:{signals:[]}});
  assert.equal(r.observations.socialCues.careForRin,true);
  // A question remains answer-first; the care cue must still reach the voice.
  assert.equal(r.plan.decision.act,'answer_user_question');
  const prompt=buildV3RealizationPrompt({profile:{prompt_profile:profile},kernelState:r.k,plan:r.plan});
  assert.match(prompt.dynamicSystem,/CARE_FRAME=/);
  assert.match(prompt.dynamicSystem,/SOCIAL_CUES=/);
});

test('non-question care is not reduced to generic thanks',()=>{
  const r=make('Береги себя, попей чаю)');
  assert.equal(r.plan.decision.focus.includes('заботу'),true);
});

test('playful invitation stays playful when graph supports it',()=>{
  const r=make('Ах ты хитрая лиса)');
  assert.equal(r.observations.socialCues.playfulInvitation,true);
  assert.equal(r.plan.decision.act,'playful_response');
  assert.match(r.plan.decision.focus,/взаимную игру/);
});


test('a mock-court question remains shared play rather than an unwanted interview',()=>{
  const r=make('Не понимаю) Суд присяжных, объясните, в чем я виновен?');
  assert.equal(r.observations.socialCues.playfulRhetorical,true);
  assert.equal(r.plan.decision.act,'playful_response');
  assert.equal(r.plan.decision.question.mode,'none');
  assert.equal(r.plan.decision.delivery.responseDepth,'short');
});

test('direct questions about Rin are recognized as personal interest rather than generic facts',()=>{
  const r=make('А у тебя как прошел вечер?');
  assert.equal(r.observations.socialCues.personalInterest,true);
  assert.equal(r.plan.decision.act,'answer_user_question');
  assert.match(r.plan.decision.focus,/своё мнение и конкретную личную деталь/);
});

test('literal correction is not turned into a playful counter-attack',()=>{
  const r=make('Ты меня не так поняла. Я имел в виду вечер, не день.');
  assert.equal(r.observations.socialCues.seriousCorrection,true);
  assert.equal(r.plan.decision.act,'clarify_misunderstanding');
  const prompt=buildV3RealizationPrompt({kernelState:r.k,plan:r.plan});
  assert.match(prompt.dynamicSystem,/REPAIR_FRAME=/);
});

test('explicit no-contact request makes silence and suspends current intent',()=>{
  const r=make('Не пиши мне, мне нужно побыть одному.',{
    activeIntent:{status:'active',kind:'maintenance',goal:'сохранять взаимную игровую динамику'}});
  assert.equal(r.plan.decision.act,'natural_silence');
  assert.equal(r.plan.needsVoice,false);
  assert.equal(r.plan.decision.intentTransition.operation,'suspend');
});

test('direct question still defeats scene closure and is answered',()=>{
  const r=make('Скажи, ты спишь?',{perception:{signals:['direct_question_present']}});
  assert.equal(r.plan.decision.act,'answer_user_question');
  assert.equal(r.plan.responseRequired,true);
});

test('reference persona voice includes all approved dialogue examples',()=>{
  const r=make('Привет)');
  const prompt=buildV3RealizationPrompt({profile:{prompt_profile:profile},kernelState:r.k,plan:r.plan});
  for(const example of profile.reference_dialogue_examples)assert.ok(prompt.stableSystem.includes(example.user));
  assert.match(prompt.stableSystem,/не психологическая консультация/);
  assert.match(prompt.stableSystem,/maxChars — потолок/);
});

test('future callback retains original timing and original utterance through canonical normalizer',()=>{
  const cue=detectUserFutureCallback('Вечером расскажу, что произошло');
  const loop=futureCallbackOpenLoop(cue,1234);
  const roundtrip=normalizeOpenLoop(loop);
  assert.equal(roundtrip.temporalCue,'evening');
  assert.match(roundtrip.originText,/Вечером расскажу/);
});

test('sticker semantic schema is stable across rehydration',async()=>{
  const state=await buildStickerState({history:[],preference:{mode:'smart',probability:30,safeMode:true}});
  assert.equal(state.schema,'rin-sticker-state-v3');
});

test('realization keeps decision ownership in the TurnPlan',()=>{
  const r=make('Отдыхай, моя Китсуне 😘');
  const prompt=buildV3RealizationPrompt({profile:{prompt_profile:profile},kernelState:r.k,plan:r.plan});
  assert.equal(r.plan.decision.act,'say_goodbye');
  assert.equal(r.plan.decision.question.mode,'none');
  assert.deepEqual(Object.keys(prompt.responseFormat.json_schema.schema.properties),['segments']);
});
