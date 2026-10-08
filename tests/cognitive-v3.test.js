import test from 'node:test';
import assert from 'node:assert/strict';
import {COGNITIVE_EDGES,COGNITIVE_NODES,settleCognitiveGraph,mapCognitiveInputs,normalizeCognitiveState} from '../lib/cognition/v3/cognitive-dynamics.js';
import {buildCognitiveTurnPlan} from '../lib/cognition/v3/turn-plan.js';
import {buildV3RealizationPrompt,buildV3RealizationSchema,parseV3Realization,v3FallbackRealization} from '../lib/cognition/v3/realization.js';
import {detectExperienceEvidence,updateCognitiveExperience} from '../lib/cognition/v3/experience.js';
import {activateAssociations} from '../lib/cognition/v3/associative-memory.js';
import {normalizeCognitivePersistence,COGNITIVE_LEARNABLE_IDS} from '../public/lib/cognitive-state-contract.js';
import {inspectSceneClosure} from '../lib/cognition/behavior-state.js';
import {MemoryStorage} from './helpers/runtime.js';
const baseline={trust:.8,attachment:.84,closeness:.81,affection:.8,energy:.64,fatigue:.2,
  quietNeed:.3,anger:.1,jealousy:0,playfulness:.48,curiosity:.55,autonomy:.72,
  concern:.1,distressCue:0,needSupport:0,sceneClosure:0,questionCue:0,boundaryCue:0,repairCue:0};
const world=(overrides={})=>({userText:'Привет)',scene:{type:'everyday'},conversationState:'ongoing',
  perception:{signals:[]},innerLife:{energy:65,needForQuiet:30,sleepPhase:'awake'},
  relationship:{closeness:84,trust:82},mood:{affection:75},...overrides});
const settle=(values={},saved=null)=>settleCognitiveGraph({inputs:{values:{...baseline,...values}},saved});
const plan=(graph,overrides={})=>buildCognitiveTurnPlan({settled:graph,kernelState:world(overrides),
  observations:overrides.behaviorState||{},stickerState:{available:false}});

test('Rin 3 graph has valid unique typed edges and no unbounded coefficients',()=>{
  const ids=new Set(COGNITIVE_EDGES.map(e=>e.id));
  assert.equal(ids.size,COGNITIVE_EDGES.length);
  for(const edge of COGNITIVE_EDGES){
    assert.ok(COGNITIVE_NODES.includes(edge.from)&&COGNITIVE_NODES.includes(edge.to),edge.id);
    assert.ok(Number.isFinite(edge.weight)&&Math.abs(edge.weight)<=.9,edge.id);
  }
});
test('synchronous settling is deterministic and independent of input key insertion order',()=>{
  const a=settle({fatigue:.72,anger:.43});
  const b=settleCognitiveGraph({inputs:{values:{anger:.43,fatigue:.72,...Object.entries(baseline).filter(([k])=>!['fatigue','anger'].includes(k)).reduce((a,[k,v])=>(a[k]=v,a),{})}}});
  assert.deepEqual(a.nodes,b.nodes);
  assert.ok(a.steps>=1&&a.steps<=24);
});
test('all activations bounded 0-1 under maximum inputs and adversarial learned weights',()=>{
  const state=normalizeCognitiveState({learnedWeights:Object.fromEntries(COGNITIVE_LEARNABLE_IDS.map(k=>[k,10]))});
  const graph=settleCognitiveGraph({inputs:{values:Object.fromEntries(COGNITIVE_NODES.map(k=>[k,100]))},saved:state,iterations:24});
  for(const [k,v] of Object.entries(graph.nodes)) assert.ok(v>=0&&v<=1,k);
  for(const v of Object.values(state.learnedWeights))assert.ok(v<=.16);
});
test('Rin can be tired and attached: tired lowers initiative without mandating withdrawal',()=>{
  const rested=settle({fatigue:.12,quietNeed:.2,energy:.86});
  const tired=settle({fatigue:.94,quietNeed:.85,energy:.15});
  assert.ok(tired.behavioralState.initiative<rested.behavioralState.initiative);
  assert.ok(tired.behavioralState.silence>rested.behavioralState.silence);
  assert.ok(tired.behavioralState.approach>.4);
  assert.ok(tired.behavioralState.withdraw<.3);
});
test('user vulnerability drives care through concurrent pathways instead of fixed response template',()=>{
  const a=settle({distressCue:0,needSupport:0});
  const b=settle({distressCue:1,needSupport:1});
  assert.ok(b.behavioralState.support>a.behavioralState.support+.1);
  assert.ok(b.behavioralState.approach>=a.behavioralState.approach);
});
test('jealousy activates vigilance while trust modulates its withdrawal pathway',()=>{
  const calm=settle({jealousy:.02,romanticThreat:0});
  const trust=settle({jealousy:.95,romanticThreat:.95,trust:.98});
  const distrust=settle({jealousy:.95,romanticThreat:.95,trust:.12});
  assert.ok(trust.behavioralState.vigilance>calm.behavioralState.vigilance);
  assert.ok(distrust.behavioralState.withdraw>trust.behavioralState.withdraw);
  assert.ok(trust.nodes.jealousy>.8);
});
test('honesty and autonomy are stable values not learnable response toggles',()=>{
  const saved=normalizeCognitivePersistence({traits:{honesty:0,loyalty:0,autonomy:0},learnedWeights:{'honesty->directness':-.99}});
  assert.equal(saved.traits.honesty,.88);
  assert.equal(saved.learnedWeights['honesty->directness'],undefined);
  assert.equal(settle({},saved).nodes.honesty,.88);
});
test('closure allows true silence and quiet presence without breaking relationship',()=>{
  const messages=[{role:'assistant',kind:'text',content:'Я закрываю глаза. Уже засыпаю.',turnId:'old'}];
  const closure=inspectSceneClosure(messages,'Я рядом)');
  assert.equal(closure.strong,true);
  const graph=settle({sceneClosure:1,quietNeed:.9,fatigue:.84});
  const result=buildCognitiveTurnPlan({settled:{...graph,evidence:{...graph.evidence,userQuestion:false,distress:false}},
    kernelState:world({userText:'Я рядом)',conversationState:'ending'}),observations:{sceneClosure:closure},stickerState:{available:false}});
  assert.equal(result.responseRequired,false);
  assert.equal(result.decision.delivery.mode,'silence');
  assert.equal(result.decision.delivery.segments.length,0);
  assert.notEqual(result.contactStance,'strained_presence');
});
test('explicit question defeats scene closure silence without resetting emotional attachment',()=>{
  const graph=settle({sceneClosure:1,questionCue:1,quietNeed:.9});
  const result=buildCognitiveTurnPlan({settled:{...graph,evidence:{userQuestion:true}},
    kernelState:world({userText:'Ты спишь?',perception:{signals:['direct_question_present']}}),observations:{sceneClosure:{strong:true}},stickerState:{available:false}});
  assert.equal(result.responseRequired,true);
  assert.equal(result.decision.delivery.segments.length,1);
});
test('emotional repair obligation defeats silence',()=>{
  const graph=settle({sceneClosure:1,needSupport:1,distressCue:1});
  const result=buildCognitiveTurnPlan({settled:{...graph,evidence:{distress:true}},
    kernelState:world({userText:'Мне сейчас плохо',perception:{signals:['user_seeks_emotional_presence']}}),observations:{sceneClosure:{strong:true}},stickerState:{available:false}});
  assert.equal(result.responseRequired,true);
  assert.equal(result.decision.act,'supportive_presence');
});
test('silence does not terminate persistent maintenance intent',()=>{
  const graph=settle({sceneClosure:1,quietNeed:1});
  const result=buildCognitiveTurnPlan({settled:graph,kernelState:world({activeIntent:{status:'active',kind:'maintenance',goal:'сохранять игровую динамику'}}),
    observations:{sceneClosure:{strong:true}},stickerState:{available:false}});
  assert.equal(result.decision.intentTransition.operation,'preserve');
});
test('physiological short cap outranks style expansion without changing personality',()=>{
  const graph=settle({energy:.15,fatigue:.9});
  const result=plan(graph,{innerLife:{energy:18,needForQuiet:95,sleepPhase:'interrupted_sleep'},userText:'Привет'});
  assert.equal(result.decision.delivery.responseDepth,'short');
  assert.ok(graph.nodes.honesty>=.8);
});
test('explicit long answer can receive extended response despite tiredness',()=>{
  const graph=settle({energy:.15,fatigue:.9});
  const result=buildCognitiveTurnPlan({settled:graph,kernelState:world({innerLife:{energy:18,sleepPhase:'waking'}}),
    observations:{},stickerState:{available:false},longRequested:true});
  assert.equal(result.decision.delivery.responseDepth,'extended');
});
test('no question boundary does not destroy curiosity',()=>{
  const graph=settle({curiosity:1,boundaryCue:1});
  const result=buildCognitiveTurnPlan({settled:graph,kernelState:world(),
    observations:{question:{strongNoQuestion:true}},stickerState:{available:false}});
  assert.equal(result.decision.question.mode,'none');
  assert.ok(graph.nodes.curiosity>.9);
});
test('explicit farewell ends active intent but quiet silence preserves it',()=>{
  const graph=settle();
  const result=plan(graph,{userText:'Спокойной ночи',perception:{signals:['explicit_farewell']},
    activeIntent:{status:'active',kind:'maintenance',goal:'игра'}});
  assert.equal(result.decision.intentTransition.operation,'complete');
});
test('strict voice schema cannot prescribe actions',()=>{
  const fmt=buildV3RealizationSchema();
  assert.equal(fmt.json_schema.name,'rin_v3_realization');
  assert.deepEqual(Object.keys(fmt.json_schema.schema.properties),['segments']);
});
test('Luna realization can vary words, not decision or segment count',()=>{
  const p=plan(settle());
  const text=parseV3Realization(JSON.stringify({segments:[{text:'Угу. Я здесь.'}]}),p);
  assert.equal(text.segments[0].text,'Угу. Я здесь.');
  assert.throws(()=>parseV3Realization(JSON.stringify({segments:[]}),p),/SEGMENT_COUNT/);
});
test('voice carries canonical identity, context and fixed action',()=>{
  const p=plan(settle());
  const pr=buildV3RealizationPrompt({profile:{prompt_profile:{identity:{full_name:'Рин Акихара'},character_contract:{core:'своя жизнь'}}},
    kernelState:world({userText:'Привет!'}),plan:p});
  assert.match(pr.stableSystem,/Рин Акихара/);
  assert.match(pr.dynamicSystem,/Привет!/);
  assert.match(pr.dynamicSystem,/TURN_PLAN/);
  assert.doesNotMatch(pr.stableSystem,/выбирай свой act|выполняй intentTransition/iu);
});
test('local voice fallback respects planned number of text segments',()=>{
  const p=plan(settle());
  const text=v3FallbackRealization(p);
  assert.equal(text.segments.length,p.decision.delivery.segments.filter(x=>x.type==='text').length);
});
test('association activation recalls a private symbol by explicit cue and can spread indirectly',()=>{
  const profile={prompt_profile:{relationship:{shared_symbols:[{
    id:'kitsune',label:'Китсуне',meaning:'взаимная игра, лёгкая хитрость и нежность',
    aliases:['кицунэ'],scope:'relationship_private',salience:65,associations:['тайны','игра','нежность']}]}}};
  const direct=activateAssociations({profile,kernelState:world({userText:'Помнишь нашу кицунэ?'})});
  const indirect=activateAssociations({profile,kernelState:world({userText:'Я тебя поддразню)',scene:{type:'playful_flirt'}})});
  const neutral=activateAssociations({profile,kernelState:world({userText:'Как прошёл ремонт?'} )});
  assert.equal(direct.candidates[0].directRecall,true);
  assert.ok(indirect.candidates[0].activation>neutral.candidates[0].activation);
  assert.equal(direct.candidates[0].privacy,'private');
});
test('associative suppression reduces repeated symbol without deleting association',()=>{
  const profile={prompt_profile:{relationship:{shared_symbols:[{id:'kitsune',label:'Китсуне',meaning:'игра',scope:'relationship_private'}]}}};
  const memory={};const a=activateAssociations({profile,memory,kernelState:world({userText:'Китсуне'})});
  const b=activateAssociations({profile,memory,kernelState:world({userText:'Китсуне',dialogueState:{recentSharedSymbols:[{id:'kitsune'},{id:'kitsune'}]}})});
  assert.ok(a.candidates[0].activation>b.candidates[0].activation);
});
test('experience only learns after explicit feedback on prior Rin turn',()=>{
  const first=updateCognitiveExperience({previous:{},settled:settle(),plan:plan(settle()),requestId:'first'});
  const evidence=detectExperienceEvidence('Спасибо, мне стало легче',[
    {role:'assistant',turnId:'rin-turn-first',content:'Я тебя слушаю'}]);
  assert.equal(evidence.kind,'positive_support');
  const second=updateCognitiveExperience({previous:first.state,settled:settle(),plan:plan(settle()),evidence,requestId:'second'});
  assert.ok(second.changes.length>0);
  assert.ok(second.state.learnedWeights['attachment->support']>0);
  assert.equal(second.state.revision,2);
});
test('feedback about unrelated turn does not alter link weights',()=>{
  const first=updateCognitiveExperience({previous:{},settled:settle(),plan:plan(settle()),requestId:'first'});
  const second=updateCognitiveExperience({previous:first.state,settled:settle(),plan:plan(settle()),
    evidence:{kind:'positive_support',strength:1,targetTurn:'some_other_turn'},requestId:'second'});
  assert.deepEqual(second.state.learnedWeights,{});
});
test('negative feedback is bounded and never rewrites ethical traits',()=>{
  let state=normalizeCognitiveState({});
  for(let i=0;i<90;i++){
    state.lastTurn={id:String(i),turnId:`rin-turn-${i}`};
    state=updateCognitiveExperience({previous:state,settled:settle(),plan:plan(settle()),requestId:String(i+1),
      evidence:{kind:'negative_misattunement',strength:1,targetTurn:`rin-turn-${i}`}}).state;
  }
  assert.ok(Math.abs(state.learnedWeights['trust->disclose'])<=.16);
  assert.equal(state.traits.honesty,.88);
  assert.ok(state.history.length<=24);
});
test('old v2 diary migrates to bounded v3 cognitive state',()=>{
  const migrated=normalizeCognitivePersistence();
  assert.equal(migrated.schema,'rin-cognitive-state-v3');
  assert.equal(migrated.revision,0);
  assert.equal(migrated.lastTurn,null);
});
test('hard data boundary retains sleep/environment truth as input rather than graph output',()=>{
  const inputs=mapCognitiveInputs({kernelState:world({innerLife:{energy:18,sleepPhase:'sleeping',needForQuiet:90},
    environment:{weather:{temp:5,desc:'дождь'}}})});
  assert.equal(inputs.values.energy,.18);
  assert.ok(inputs.values.quietNeed>.8);
  assert.equal('weather' in inputs.values,false);
});
test('explicit mutual agreement is a planned social act and becomes a canonical commitment',async()=>{
  const graph=settle({attachment:.9,trust:.92});
  const result=plan(graph,{userText:'Давай договоримся, что вечером допишем нашу историю'});
  assert.equal(result.commitment.action,'establish');
  assert.match(result.commitment.subject,/вечером допишем/);
  const {buildDecisionStateTransition}=await import('../lib/cognition/turn-decision.js');
  const transition=buildDecisionStateTransition({kernelState:{revision:3,scene:{type:'everyday'},conversationState:'ongoing',
    dialogueState:{scene:'everyday'},activeIntent:null,beliefModel:{beliefs:[],currentStatement:null,correction:null}},
    decision:result.decision,mind:{commitmentAction:result.commitment.action,commitmentSubject:result.commitment.subject,
      commitmentOwner:result.commitment.owner,commitmentStrength:result.commitment.strength},
    userText:'Давай договоримся, что вечером допишем нашу историю'});
  assert.equal(transition.dialogueState.sceneCommitments.at(-1).status,'active');
  assert.equal(transition.dialogueState.sceneCommitments.at(-1).source,'rin_turn_plan_v3');
});
test('Luna cannot create a promise solely by phrasing when TurnPlan did not approve',async()=>{
  const {unauthorizedSpeechAct}=await import('../lib/cognition/v3/realization.js');
  const p=plan(settle());
  assert.equal(unauthorizedSpeechAct({segments:[{text:'Я обещаю ничего не забывать.'}]},p),'unplanned_commitment');
  assert.equal(unauthorizedSpeechAct({segments:[{text:'Я думаю, это получится.'}]},p),null);
});
