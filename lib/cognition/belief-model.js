import { cleanText, normalizeBelief, uniqueStrings } from './cognitive-contract.js';
import { beliefSlot, isAssertableBelief } from '../epistemic-contract.js';

function flattenFacts(value, prefix = '', out = []) {
  if (value == null) return out;
  if (Array.isArray(value)) { value.slice(0,12).forEach((item,index)=>flattenFacts(item,`${prefix}.${index}`,out)); return out; }
  if (typeof value === 'object') { Object.entries(value).slice(0,80).forEach(([key,item])=>flattenFacts(item,prefix?`${prefix}.${key}`:key,out)); return out; }
  const text=cleanText(value,700); if(text) out.push({path:prefix,value:text}); return out;
}
function tokenSet(value=''){return new Set(cleanText(value,2200).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(x=>x.length>=4));}
function relevance(path,value,userTokens){const candidate=tokenSet(`${path} ${value}`);let overlap=0;for(const token of candidate)if(userTokens.has(token))overlap++;return overlap;}
function statementBelief(userText='',brain=null){
 const literal=brain?.literalIntent; if(!['statement','reflection','disclosure'].includes(literal))return null;
 const text=cleanText(userText,700); if(!text||text.length<8)return null;
 return normalizeBelief({kind:'user_statement',subject:'user',predicate:'current_statement',value:text,source:'current_user_turn',confidence:1,status:'current',evidence:[text],provenance:['explicit_user_turn']});
}
function explicitUserCorrection(userText='',brain=null, previousBeliefs=[]){
 if(brain?.relation?.type!=='correction') return null;
 const text=cleanText(userText,700); if(!text) return null;
 const candidates=(Array.isArray(previousBeliefs)?previousBeliefs:[]).map(normalizeBelief).filter(b=>b.subject==='user'&&b.status!=='superseded'&&b.status!=='rejected');
 const recentHypotheses=candidates.filter(b=>['hypothesis','observation','rin_opinion'].includes(b.kind)).slice(-4);
 return {active:true,text,source:'explicit_user_correction',confidence:1,rejectIds:recentHypotheses.map(b=>b.id),instruction:'Свежая коррекция пользователя имеет абсолютный приоритет: старую гипотезу/интерпретацию нельзя защищать, переименовывать или повторно выдавать за факт.'};
}
export function buildBeliefModel({memory=null,userText='',brain=null}={}){
 const rawFacts=flattenFacts(memory?.facts||{}); const userTokens=tokenSet(userText);
 const factBeliefs=rawFacts.map(item=>{const [subject='unknown',...rest]=String(item.path||'').split('.');return normalizeBelief({kind:'fact',subject,predicate:rest.join('.')||'value',value:item.value,source:'long_term_memory',confidence:.95,status:'current',provenance:[`memory:${item.path}`]});});
 const stored=(Array.isArray(memory?.conversationState?.beliefs)?memory.conversationState.beliefs:[]).map(normalizeBelief);
 const byId=new Map([...factBeliefs,...stored].map(item=>[item.id,item])); const beliefs=[...byId.values()];
 const relevant=beliefs.map(item=>({item,score:relevance(`${item.subject}.${item.predicate}`,item.value,userTokens)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,8).map(x=>x.item);
 const currentStatement=statementBelief(userText,brain); const correction=explicitUserCorrection(userText,brain,stored)||{active:false,instruction:''};
 const assertable=relevant.filter(isAssertableBelief);
 const uncertain=relevant.filter(item=>!isAssertableBelief(item)&&item.status!=='superseded'&&item.status!=='rejected');
 return {beliefs,relevant,assertable,uncertain,currentStatement,correction,
  unknownPolicy:'Если источник утверждения о пользователе неизвестен или evidence недостаточно, не достраивай психологическую черту. Назови это впечатлением/догадкой или прямо признай отсутствие оснований.',
  factsToUse:assertable.map(item=>`${item.subject}.${item.predicate}: ${item.value} [${item.kind}; source=${item.source}]`),
  factsToAvoid:uniqueStrings(['неподтверждённые биографические детали Рин','предположения о характере пользователя без evidence','устаревшая трактовка после прямого исправления','формулы «ты обычно/ты всегда/ты такой человек», если нет подтверждённого источника'],8,300)};
}
export function beliefInstruction(model={}){
 const lines=['ЭПИСТЕМИЧЕСКАЯ МОДЕЛЬ — ФАКТЫ, ВПЕЧАТЛЕНИЯ И КОРРЕКЦИИ',
  model.factsToUse?.length?`Можно утверждать как подтверждённое:\n- ${model.factsToUse.join('\n- ')}`:'Подтверждённых релевантных сведений немного или нет.',
  model.uncertain?.length?`Неподтверждённые записи (НЕ выдавать за факт):\n- ${model.uncertain.map(x=>`${x.kind}: ${x.value}; confidence=${x.confidence}; evidence=${x.evidence?.length||0}`).join('\n- ')}`:'',
  model.currentStatement?`Текущие слова пользователя: ${model.currentStatement.value}. Источник — сам пользователь.`:'',
  model.correction?.active?`${model.correction.instruction} Исправление: «${model.correction.text}».`:'', model.unknownPolicy,
  'Если пользователь спрашивает «откуда ты это взяла?», «когда я так говорил?», «почему ты так решила?» — назови реальный provenance/evidence. Если его нет, прямо скажи, что это было твоё предположение и что оснований недостаточно.',
  'Никогда не изобретай пример из прошлой переписки, чтобы оправдать собственный вывод.']; return lines.filter(Boolean).join('\n');
}
