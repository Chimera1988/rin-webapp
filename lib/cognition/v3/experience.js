/** Confirmed feedback updates bounded learned *relationships* without rewriting Rin's core values. */
import {normalizeCognitiveState,LEARNABLE_EDGES,COGNITIVE_SCHEMA} from './cognitive-dynamics.js';
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,Number(x)||0));
const round=x=>Math.round(x*10000)/10000;
export function detectExperienceEvidence(userText='',history=[]){
  const text=String(userText||'').trim();
  const last=(Array.isArray(history)?history:[]).filter(x=>x?.role==='assistant'&&x?.kind!=='silence').at(-1);
  const target=last?.turnId||last?.requestId||null;
  if(!text||!target)return {kind:'none',strength:0,targetTurn:null};
  // Explicit user signals only; no unobserved emotional reward and no guessed outcomes.
  if(/(?:спасибо|благодарю|мне\s+стало\s+легче|ты\s+меня\s+успокоила|я\s+тебе\s+доверяю)/iu.test(text))
    return {kind:'positive_support',strength:.7,targetTurn:target};
  if(/(?:ты\s+меня\s+не\s+поняла|неправильно\s+поняла|мне\s+неприятно|это\s+меня\s+задело)/iu.test(text))
    return {kind:'negative_misattunement',strength:.65,targetTurn:target};
  if(/(?:мне\s+нравится\s+как\s+ты|мне\s+приятно\s+когда\s+ты)/iu.test(text))
    return {kind:'positive_closeness',strength:.45,targetTurn:target};
  // Plain, explicit appreciation for Rin's previous move is evidence too;
  // emojis alone are not a reliable reinforcement event.
  if(/(?:умничка|молодец|горжусь\s+тобой|хорошо\s+сделала|хвалю\s+тебя|какая\s+ты\s+умница)/iu.test(text))
    return {kind:'positive_appreciation',strength:.32,targetTurn:target};
  return {kind:'none',strength:0,targetTurn:null};
}
export function updateCognitiveExperience({previous={},settled={},plan={},evidence={},requestId='',now=Date.now()}={}){
  const saved=normalizeCognitiveState(previous);
  const learned={...saved.learnedWeights};
  const kind=evidence?.kind||'none';
  const rate=Math.min(.006,Math.max(0,Number(evidence?.strength)||0)*.006);
  const changes=[];
  const associativeWeights={...saved.associativeWeights};
  const targets=kind==='positive_support'?{'trust->disclose':1,'attachment->support':1}:
    kind==='negative_misattunement'?{'trust->disclose':-.55,'attachment->support':-.3}:
    kind==='positive_closeness'?{'attachment->approach':1,'memoryResonance->tenderGesture':.5}:
    kind==='positive_appreciation'?{'attachment->approach':.55,'attachment->support':.25}:{};
  if(saved.lastTurn?.id && evidence?.targetTurn===saved.lastTurn.turnId){
    for(const [id,direction] of Object.entries(targets)){
      if(!LEARNABLE_EDGES.has(id))continue;
      const old=Number(learned[id])||0;
      const next=round(clamp(old+rate*direction,-.16,.16));
      if(next!==old){learned[id]=next;changes.push({edge:id,before:old,after:next,evidence:kind});}
    }
  }
  if(saved.lastTurn?.symbolId && evidence?.targetTurn===saved.lastTurn.turnId &&
      ['positive_support','positive_closeness'].includes(kind)){
    const concept=kind==='positive_closeness'?'tenderness':'trust';
    const id=`${saved.lastTurn.symbolId}:${concept}`;
    const prior=Number(associativeWeights[id])||0;
    const next=round(clamp(prior+rate*.65,-.12,.12));
    if(next!==prior){associativeWeights[id]=next;changes.push({edge:id,before:prior,after:next,evidence:kind});}
  }
  const id=String(requestId||'').slice(0,120);
  const next={schema:COGNITIVE_SCHEMA,revision:saved.revision+1,
    traits:{...saved.traits},learnedWeights:learned,associativeWeights,
    history:[...saved.history,...(changes.length?[{at:now,requestId:id,evidence:kind,changes}]:[])].slice(-24),
    lastTurn:{id,turnId:`rin-turn-${id}`,act:plan?.decision?.act||'none',symbolId:plan?.symbolId||null,
      activation:{approach:settled?.behavioralState?.approach||0,support:settled?.behavioralState?.support||0,
        jealousy:settled?.nodes?.jealousy||0},timestamp:now}};
  return {state:next,changes,accepted:changes.length>0,evidenceKind:kind};
}
