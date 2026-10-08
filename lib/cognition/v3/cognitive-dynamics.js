/** Rin 3.0: synchronous, bounded cognitive dynamics. No dialogue/delivery side effects. */
import {normalizeCognitivePersistence, COGNITIVE_STATE_SCHEMA, COGNITIVE_LEARNABLE_IDS} from '../../../public/lib/cognitive-state-contract.js';
export const COGNITIVE_SCHEMA = COGNITIVE_STATE_SCHEMA;
const clamp = (value, lo=0, hi=1) => Math.max(lo, Math.min(hi, Number.isFinite(Number(value)) ? Number(value) : lo));
const round = value => Math.round(clamp(value)*1000)/1000;
const NODES = Object.freeze({
  energy:.62, fatigue:.21, quietNeed:.22, mentalLoad:.25,
  anger:.08, sadness:.08, jealousy:.04, concern:.15, warmth:.58, vulnerability:.26,
  attachment:.7, trust:.65, closeness:.63, respect:.81, honesty:.88, loyalty:.87,
  autonomy:.68, curiosity:.65, playfulness:.44, selfRespect:.78, affection:.7,
  connectionNeed:.56, goalDrive:.35, reciprocity:.36, memoryResonance:.17,
  distressCue:0, romanticThreat:0, needSupport:0, questionCue:0, repairCue:0,
  boundaryCue:0, sceneClosure:0, playfulCue:0, noveltyNeed:.22,
  approach:.12, withdraw:.07, support:.24, disclose:.22, setBoundary:.16,
  directness:.29, silence:.08, initiative:.23, ask:.18, play:.2,
  vigilance:.08, tenderGesture:.2, reflection:.22
});
export const COGNITIVE_NODES = Object.freeze(Object.keys(NODES));
const EDGES = Object.freeze([
  ['energy','initiative',.28],['energy','play',.13],['fatigue','initiative',-.33],
  ['fatigue','silence',.27],['fatigue','quietNeed',.24],['fatigue','anger',.08],
  ['mentalLoad','quietNeed',.22],['mentalLoad','reflection',.12],['mentalLoad','initiative',-.22],
  ['quietNeed','silence',.38],['quietNeed','ask',-.23],['quietNeed','disclose',-.12],
  ['anger','directness',.23],['anger','withdraw',.19],['anger','setBoundary',.23],
  ['sadness','disclose',.19],['sadness','initiative',-.16],['sadness','connectionNeed',.13],
  ['concern','support',.41],['concern','reflection',.13],
  ['distressCue','concern',.48],['distressCue','support',.34],
  ['needSupport','support',.47],['needSupport','approach',.16],
  ['attachment','approach',.38],['attachment','support',.22],['attachment','tenderGesture',.3],
  ['attachment','connectionNeed',.17],['attachment','withdraw',-.22],
  ['trust','disclose',.27],['trust','approach',.19],['trust','withdraw',-.36],
  ['closeness','tenderGesture',.19],['closeness','approach',.12],
  ['affection','tenderGesture',.3],['affection','approach',.17],
  ['warmth','support',.13],['warmth','play',.08],
  ['vulnerability','disclose',.14],['vulnerability','reflection',.12],
  ['honesty','directness',.27],['honesty','disclose',.17],
  ['respect','setBoundary',.1],['respect','support',.12],
  ['loyalty','approach',.2],['loyalty','withdraw',-.11],
  ['autonomy','initiative',.31],['autonomy','setBoundary',.14],
  ['selfRespect','setBoundary',.24],['selfRespect','withdraw',.06],
  ['connectionNeed','approach',.21],['connectionNeed','ask',.06],
  ['curiosity','ask',.24],['curiosity','reflection',.21],
  ['playfulness','play',.33],['playfulness','tenderGesture',.09],
  ['playfulCue','playfulness',.33],['playfulCue','play',.24],
  ['goalDrive','initiative',.21],['reciprocity','support',.12],
  ['reciprocity','ask',.15],['memoryResonance','reflection',.22],
  ['memoryResonance','tenderGesture',.11],['noveltyNeed','initiative',.12],
  ['questionCue','ask',-.08],['questionCue','reflection',.22],
  ['boundaryCue','setBoundary',.3],['boundaryCue','ask',-.41],
  ['sceneClosure','silence',.5],['sceneClosure','initiative',-.31],['sceneClosure','ask',-.28],
  ['repairCue','disclose',.24],['repairCue','approach',.21],['repairCue','silence',-.25],
  ['romanticThreat','jealousy',.55],['romanticThreat','vigilance',.29],
  ['jealousy','vigilance',.45],['jealousy','directness',.16],
  // Trust moderates the negative expression, never eliminates the jealousy itself.
  ['jealousy','withdraw',.68,{inhibitedBy:'trust',rate:.86}],
  ['jealousy','setBoundary',.11],['trust','vigilance',-.15],
  ['support','withdraw',-.24],['approach','withdraw',-.21],
  ['setBoundary','withdraw',-.06],['disclose','approach',.09],
  ['silence','initiative',-.16],['sceneClosure','tenderGesture',-.14]
].map(([from,to,weight,modifier])=>Object.freeze({id:`${from}->${to}`,from,to,weight,modifier:modifier||null})));
export const COGNITIVE_EDGES = EDGES;
const nodeDict=Object.freeze({...NODES});
const fixedKeys = new Set(['honesty','loyalty','respect','autonomy','selfRespect']);
const MAX_LEARNED_DELTA=.16;
export const LEARNABLE_EDGES = Object.freeze(new Set(COGNITIVE_LEARNABLE_IDS));
const num = (obj,key,fallback=.5) => clamp(obj?.[key],0,1) * (obj?.[key] == null ? 0 : 1) + (obj?.[key] == null ? fallback : 0);
const pct = (obj,key,fallback=50)=>obj?.[key]==null?fallback/100:clamp(Number(obj[key])/100);
export function normalizeCognitiveState(saved={}) {return normalizeCognitivePersistence(saved);}
const cleanPersisted=normalizeCognitiveState;

// Single normalization boundary: no rule-providing module is allowed to write action tendencies.
export function mapCognitiveInputs({kernelState={},behaviorState={},sharedSymbolState={},driveState={}}={}) {
  const k=kernelState||{}, life=k.innerLife||{}, emo=k.emotion||{}, rel=k.relationship||{}, mood=k.mood||{}, percept=k.perception||{};
  const primary=String(emo?.primary?.type||'').toLowerCase();
  const intensity=pct(emo?.primary,'intensity',0);
  const signals=new Set(percept.signals||[]);
  const userText=String(k.userText||'');
  const distress=signals.has('user_seeks_emotional_presence')||signals.has('possible_relational_hurt')||/мне\s+(плохо|тяжело|страшно|больно)|я\s+(расстроен|подавлен)/iu.test(userText);
  const userQuestion=signals.has('direct_question_present')||(/\?/u.test(userText)&&!signals.has('explicit_farewell'));
  const threat=primary==='jealousy' ? intensity : 0;
  const scene=String(k.scene?.type||'');
  const memoryCandidate=Math.max(0,...(sharedSymbolState.candidates||[]).map(x=>pct(x,'activation',0)));
  const closure=behaviorState?.sceneClosure?.strong ? 1 : behaviorState?.sceneClosure?.soft ? .55 : 0;
  const boundary=behaviorState?.question?.strongNoQuestion || signals.has('user_requests_space') || signals.has('explicit_boundary');
  const mapped={
    energy:pct(life,'energy',pct(mood,'energy',60)*100),
    fatigue:Math.max(Math.min(1,Math.max(0,Number(life.sleepDebtMinutes)||0)/240)*.5,1-pct(life,'energy',60)),
    quietNeed:pct(life,'needForQuiet',35),mentalLoad:pct(life,'mentalLoad',35),
    anger:['irritation','playful_irritation','frustration','hurt'].includes(primary)?intensity:0,
    sadness:['sadness','disappointment'].includes(primary)?intensity:0,
    jealousy:primary==='jealousy'?intensity:0,
    concern:primary==='concern'?intensity:.13,
    warmth:pct(emo,'warmth',pct(mood,'affection',65)*100),
    vulnerability:pct(rel,'vulnerability',28),attachment:pct(rel,'closeness',70),
    trust:pct(rel,'trust',65),closeness:pct(rel,'closeness',65),
    affection:pct(mood,'affection',65),playfulness:pct(rel,'playfulness',45),
    curiosity:pct(driveState,'curiosity',64),autonomy:pct(driveState,'autonomy',65),
    reciprocity:pct(k.reciprocity,'attentionPressure',32),
    goalDrive:k.activeIntent?.status==='active'?.72:.22,
    connectionNeed:pct(driveState,'connection',65),
    memoryResonance:memoryCandidate,
    distressCue:distress?1:0,needSupport:distress?1:0,
    questionCue:userQuestion?1:0,
    repairCue:signals.has('repair_attempt')?1:0,
    boundaryCue:boundary?1:0,
    sceneClosure:closure,
    playfulCue:['playful_flirt','romance'].includes(scene)? .72 : signals.has('playful_tension_continues')?.8:0,
    romanticThreat:threat,
    noveltyNeed:pct(behaviorState?.novelty,'pressure',15)
  };
  // A previous turn's transient activations are not fed back as new evidence: only durable traits/learning persist.
  return {values:mapped,evidence:{primaryEmotion:primary,scene,userQuestion,distress,boundary,closure,
    semanticSignals:[...signals],sharedSymbolCandidate:sharedSymbolState?.candidates?.[0]?.id||null}};
}

export function settleCognitiveGraph({inputs={},saved={},iterations=16}={}) {
  const persisted=cleanPersisted(saved);
  const ext=inputs?.values||inputs||{};
  const base={...NODES};
  const anchored=new Set([...fixedKeys,...Object.keys(ext).filter(id=>id in NODES)]);
  for(const [id,value] of Object.entries(ext)) if(id in NODES) base[id]=clamp(value);
  const state={...base};
  let steps=0, delta=0;
  const MAX_STEPS=Math.max(4,Math.min(24,Math.floor(iterations)));
  for(let step=0;step<MAX_STEPS;step++){
    const sums=Object.fromEntries(Object.keys(base).map(id=>[id,0]));
    for(const e of EDGES){
      let w=e.weight+(persisted.learnedWeights[e.id]||0);
      if(e.modifier?.inhibitedBy) w*=1-e.modifier.rate*state[e.modifier.inhibitedBy];
      sums[e.to]+=w*state[e.from];
    }
    const next={};delta=0;
    for(const id of Object.keys(base)){
      // External factual/affective observations are clamped inputs, not endlessly amplified.
      const strength=anchored.has(id)? .09 : .63;
      const target=clamp(base[id]+sums[id]*strength);
      next[id]=round(state[id]*.35+target*.65);
      delta=Math.max(delta,Math.abs(next[id]-state[id]));
    }
    Object.assign(state,next);steps=step+1;
    if(delta<.002)break;
  }
  const actions=['approach','withdraw','support','disclose','setBoundary','directness','silence','initiative','ask','play','vigilance','tenderGesture','reflection'];
  const influences=[];
  for(const e of EDGES) if(actions.includes(e.to)){
    let w=e.weight+(persisted.learnedWeights[e.id]||0);
    if(e.modifier?.inhibitedBy)w*=1-e.modifier.rate*state[e.modifier.inhibitedBy];
    influences.push({path:e.id,impact:Math.round(w*state[e.from]*1000)/1000});
  }
  influences.sort((a,b)=>Math.abs(b.impact)-Math.abs(a.impact));
  return {schema:'rin-cognitive-settling-v3',nodes:state,
    behavioralState:Object.fromEntries(actions.map(id=>[id,state[id]])),
    steps,converged:delta<.002,delta:round(delta),
    topInfluences:influences.slice(0,16),
    learnedWeights:{...persisted.learnedWeights},evidence:inputs?.evidence||{}};
}
