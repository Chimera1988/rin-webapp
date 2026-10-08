/** Context-activated relational associations: concept cues → linked private symbols. */
import { collectSharedSymbols } from '../shared-symbols.js';
const clamp=(x,min=0,max=1)=>Math.max(min,Math.min(max,Number(x)||0));
const norm=x=>String(x||'').toLocaleLowerCase('ru-RU').replace(/ё/g,'е');
const TOKENS={
  playfulness:['playful','игра','игрив','поддраз','хитр','флирт','challenge','tease'],
  tenderness:['tender','нежност','ласк','обнят','kiss','поцелу','тепл','близост'],
  mystery:['mystery','тайн','секрет','загад','недосказ','не говор'],
  vulnerability:['vulnerab','смущ','уязв','покрас','раним'],
  night:['ноч','night','сон','спат','sleep'],
  support:['support','поддерж','забот','рядом','comfort'],
  trust:['trust','довер','верн','безопасн']
};
const CONCEPTS=Object.keys(TOKENS);
const includesCue=(text,concept)=>TOKENS[concept].some(t=>norm(text).includes(t));
const associationMatch=(s,concept)=>{
  const text=norm([s.meaning,...(s.associations||[]),...(s.fitMotifs||[]),...(s.fitEmotions||[])].join(' '));
  return includesCue(text,concept);
};
export function activateAssociations({profile=null,memory=null,kernelState={},saved=null}={}){
  const symbols=collectSharedSymbols({profile,memory});
  const text=norm(kernelState.userText);
  const scene=norm(kernelState.scene?.type);
  const primary=norm(kernelState.emotion?.primary?.type);
  const life=kernelState.innerLife||{};
  const cues=Object.fromEntries(CONCEPTS.map(k=>[k,0]));
  for(const c of CONCEPTS){
    if(includesCue(text,c))cues[c]=Math.max(cues[c],.68);
    if(includesCue(scene,c))cues[c]=Math.max(cues[c],.75);
    if(includesCue(primary,c))cues[c]=Math.max(cues[c],.78);
  }
  if(['winding_down','drowsy','sleeping','interrupted_sleep'].includes(life.sleepPhase))cues.night=Math.max(cues.night,.72);
  if(Number(kernelState.relationship?.trust)>70)cues.trust=Math.max(cues.trust,.35);
  if(Number(kernelState.relationship?.closeness)>65)cues.tenderness=Math.max(cues.tenderness,.25);
  const past=Array.isArray(kernelState.dialogueState?.recentSharedSymbols)?kernelState.dialogueState.recentSharedSymbols:[];
  const learned=saved?.associativeWeights&&typeof saved.associativeWeights==='object'?saved.associativeWeights:{};
  const candidates=symbols.map(symbol=>{
    const aliases=[symbol.label,...(symbol.aliases||[])].map(norm).filter(x=>x.length>=3);
    const directRecall=aliases.some(a=>text.includes(a));
    const edges=[];
    let weighted=0,total=0;
    for(const c of CONCEPTS){
      if(!associationMatch(symbol,c))continue;
      const id=`${symbol.id}:${c}`;
      const weight=clamp(.45+Number(learned[id]||0),.25,.68);
      const contribution=cues[c]*weight;
      edges.push({id,cue:c,weight:Math.round(weight*1000)/1000,contribution:Math.round(contribution*1000)/1000});
      weighted+=contribution;total+=1;
    }
    const previous=past.filter(item=>(item?.id||item)===symbol.id).length;
    const repetitionPressure=Math.min(100,previous*26);
    const salience=clamp((Number(symbol.salience)||50)/100);
    const activation=clamp((directRecall?.88:0)+Math.min(.67,weighted*.38)+salience*.08-repetitionPressure/260);
    return {
      id:symbol.id,label:symbol.label,meaning:symbol.meaning,
      activation:Math.round(activation*100),directRecall,
      repetitionPressure,associations:edges,
      source:directRecall?'direct_recall':'spreading_activation',
      privacy:symbol.privacy||'private'
    };
  }).sort((a,b)=>b.activation-a.activation);
  return {schema:'rin-associative-activation-v3',cues,candidates:candidates.slice(0,8),
    trace:candidates.slice(0,4).map(s=>({id:s.id,activation:s.activation,source:s.source,
      links:s.associations.filter(x=>x.contribution>0).sort((a,b)=>b.contribution-a.contribution).slice(0,3)}))};
}
