import { isTextTurn } from '../chat-contract.js';

const clean=(v,max=900)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,max);
const STOP=new Set('и в во на но а я ты он она мы вы это как что к у из за по для не да же ли или про мне тебя мой моя твой твоя сейчас просто очень уже ещё'.split(' '));
function stem(token=''){
  const value=String(token).toLowerCase().replace(/ё/g,'е');
  if(value.length<6) return value;
  return value.replace(/(?:иями|ями|ами|ого|его|ому|ему|иях|ах|ях|ой|ей|ую|юю|ов|ев|ом|ем|ам|ям|ы|и|а|я|у|ю|е)$/u,'');
}
function tokens(v=''){return clean(v,5000).toLowerCase().match(/[а-яёa-z0-9]{3,}/giu)?.filter(x=>!STOP.has(x)).map(stem).filter(x=>x.length>=3)||[];}
function overlap(a,b){const A=new Set(tokens(a));let s=0;for(const w of tokens(b)) if(A.has(w)) s+=w.length>6?2:1;return s;}
const PATH_ALIASES={name:'имя зовут',project:'проект',preference:'предпочтение нравится люблю',preferences:'предпочтения нравится люблю',work:'работа работаю',job:'работа',birthday:'день рождения',city:'город живу',location:'место живу',relationship:'отношения'};
function pathSemantic(path=''){return String(path).split('.').map(x=>`${x} ${PATH_ALIASES[x]||''}`).join(' ');}
function flattenFacts(value,path='',out=[]){
 if(value==null)return out;
 if(typeof value!=='object'||Array.isArray(value)){const text=clean(typeof value==='object'?JSON.stringify(value):value,300);if(path&&text)out.push({path,text});return out;}
 for(const [k,v] of Object.entries(value)) flattenFacts(v,path?`${path}.${k}`:k,out); return out;
}
export function retrieveMemory({memory=null,userText='',history=[],cognition=null,limits={}}={}){
 if(!memory||typeof memory!=='object') return {facts:[],events:[],summaries:[],sharedMoments:[],reason:'no_memory',suppressed:true};
 const recent=(Array.isArray(history)?history:[]).filter(isTextTurn).slice(-5).map(x=>x.content||'').join(' ');
 const context=clean(`${userText} ${recent}`,6000);
 const directRecall=/(помнишь|вспомни|я говорил|я рассказывал|мы тогда|раньше|прошлый раз|не забыла|ты помнишь|как называется мой|что ты знаешь о мо|что я люблю|что мне нравится)/iu.test(userText);
 const callback=cognition?.openLoops?.callback?.subject || cognition?.openLoops?.callback?.text || '';
 const query=clean(`${userText} ${callback}`,2400);
 const maxFacts=limits.maxFacts||6, maxEvents=limits.maxEvents||4, maxSummaries=limits.maxSummaries||1;
 const facts=flattenFacts(memory.facts||{}).map(item=>{
   const score=overlap(query,`${pathSemantic(item.path)} ${item.text}`)+(directRecall?1:0);
   return {...item,score,source:'semantic_fact'};
 }).filter(item=>item.score>=2).sort((a,b)=>b.score-a.score).slice(0,maxFacts);
 const events=(Array.isArray(memory.recentEvents)?memory.recentEvents:[]).map((item,index,all)=>{
   const text=clean(item?.text,420); const relevance=overlap(query,text); const importance=Number(item?.importance)||5; const recency=index/Math.max(1,all.length-1);
   return {text,relevance,importance,recency,score:relevance*4+importance*.35+recency,source:'episodic_event'};
 }).filter(x=>x.text&&(x.relevance>=2||(directRecall&&x.relevance>=1)||(callback&&overlap(callback,x.text)>=1))).sort((a,b)=>b.score-a.score).slice(0,maxEvents);
 const sharedMoments=(Array.isArray(memory?.relationship?.sharedMoments)?memory.relationship.sharedMoments:[]).map(item=>({text:clean(item?.text||item,360),score:overlap(query,item?.text||item),source:'relationship_memory'})).filter(x=>x.text&&(x.score>=2||(directRecall&&x.score>=1))).sort((a,b)=>b.score-a.score).slice(0,2);
 const summaries=(Array.isArray(memory.summaries)?memory.summaries:[]).map((item,index,all)=>({text:clean(item?.text,900),score:overlap(query,item?.text||'')+(index/Math.max(1,all.length-1)),source:'summary'})).filter(x=>x.text&&(directRecall?x.score>=1:x.score>=2)).sort((a,b)=>b.score-a.score).slice(0,maxSummaries);
 const selected=facts.length+events.length+sharedMoments.length+summaries.length;
 return {facts,events,summaries,sharedMoments,directRecall,callback:clean(callback,300)||null,reason:selected?(directRecall?'explicit_recall':'topic_relevance'):'no_relevant_memory',suppressed:selected===0};
}

export function memoryRetrievalInstruction(result={}){
 if(result.suppressed) return 'ДОЛГОСРОЧНАЯ ПАМЯТЬ: сейчас ничего не вспоминай специально. Отсутствие релевантного воспоминания лучше демонстрации памяти ради эффекта.';
 return [
   'РЕЛЕВАНТНАЯ ПАМЯТЬ — RETRIEVAL POLICY',
   result.facts?.length?`Подтверждённые факты:\n- ${result.facts.map(x=>`${x.path}: ${x.text}`).join('\n- ')}`:'',
   result.events?.length?`Эпизоды:\n- ${result.events.map(x=>x.text).join('\n- ')}`:'',
   result.sharedMoments?.length?`Общие моменты:\n- ${result.sharedMoments.map(x=>x.text).join('\n- ')}`:'',
   result.summaries?.length?`Сводка:\n- ${result.summaries.map(x=>x.text).join('\n- ')}`:'',
   'Используй память только если она естественно помогает текущему ходу. Не перечисляй известное и не говори «я помню» без необходимости. Текущая явная реплика пользователя всегда сильнее старой записи.'
 ].filter(Boolean).join('\n\n');
}
