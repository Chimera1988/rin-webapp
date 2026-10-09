import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { observeAffectiveTurn } from '../lib/cognition/emotional-state.js';
import { observeTurn } from '../lib/cognition/v3/turn-observations.js';
import { mapCognitiveInputs, settleCognitiveGraph } from '../lib/cognition/v3/cognitive-dynamics.js';
const source = path => readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('production excludes old affective/behavior/drive action writers, not merely their output', async()=>{
  const api=await source('api/chat.js');
  for(const forbidden of [
    /buildAffectiveTurn\s*\(/, /buildBehaviorState\s*\(/, /buildDriveState\s*\(/,
    /stabilizeTurn\s*\(/, /buildRinMindPrompt\s*\(/,
    /from ['"]\.\.\/lib\/cognition\/drive-state\.js['"]/
  ]) assert.doesNotMatch(api, forbidden);
  assert.match(api,/observeAffectiveTurn\s*\(/);
  assert.match(api,/observeTurn\s*\(/);
  assert.match(api,/buildCognitiveTurnPlan\s*\(/);
  assert.match(api,/parseV3Realization\s*\(/);
  assert.match(api,/mapCognitiveInputs\(\{kernelState,observations:turnObservations,sharedSymbolState\}\)/);
  const graph=await source('lib/cognition/v3/cognitive-dynamics.js');
  assert.doesNotMatch(graph, /driveState|behaviorState/);
  const plan=await source('lib/cognition/v3/turn-plan.js');
  assert.doesNotMatch(plan,/behaviorState/);
});

test('affective observations restore deterministic relationship/mood progression without a second action owner',()=>{
  const memory={relationship:{trust:72,closeness:75,comfort:72,playfulness:55,attraction:70},
    mood:{affection:68,energy:61},conversationState:{revision:9,emotionalState:{}}};
  const before=JSON.stringify(memory);
  const observed=observeAffectiveTurn({userText:'Я тебя люблю 🤗',memory,brain:{activeScene:{type:'romance'}}});
  assert.equal(JSON.stringify(memory),before);
  assert.equal(observed.relationshipState.trust,memory.relationship.trust);
  assert.ok(observed.relationshipState.closeness>memory.relationship.closeness);
  assert.ok(observed.moodState.affection>memory.mood.affection);
  assert.equal(observed.emotionalState.primary.type,'tenderness');
});

test('observation interface contains no legacy imperative guidance',()=>{
  const observed=observeTurn({userText:'Я рядом)',history:[{role:'assistant',kind:'text',content:'Закрываю глаза. Уже засыпаю.'}]});
  assert.equal(observed.sceneClosure.strong,true);
  assert.doesNotMatch(JSON.stringify(observed),/"guidance"/);
});

test('graph derives curiosity and connection directly from identity and relationship observations',()=>{
  const k={innerLife:{energy:75},relationship:{closeness:70,trust:75,comfort:70},mood:{affection:68,energy:75},
    scene:{type:'everyday'},perception:{signals:[]}};
  const values=mapCognitiveInputs({kernelState:k,driveState:{curiosity:0,autonomy:0,connection:0}}).values;
  assert.ok(values.curiosity>.5);
  assert.ok(values.autonomy>.6);
  assert.ok(values.connectionNeed>.55);
  const settled=settleCognitiveGraph({inputs:{values}});
  assert.ok(settled.behavioralState.approach>.4);
});
