/** Shared server/client persistence contract. Versioned, bounded, backward-compatible with v2 diary. */
export const COGNITIVE_STATE_SCHEMA='rin-cognitive-state-v3';
export const COGNITIVE_LEARNABLE_IDS=Object.freeze([
  'trust->disclose','attachment->support','attachment->approach',
  'vulnerability->disclose','memoryResonance->tenderGesture','jealousy->withdraw',
  'curiosity->ask','goalDrive->initiative'
]);
export function normalizeCognitivePersistence(value=null){
  const source=value&&typeof value==='object'?value:{};
  const learnedWeights={};
  for(const id of COGNITIVE_LEARNABLE_IDS){
    const n=Number(source.learnedWeights?.[id]);
    if(source.learnedWeights?.[id]!=null&&Number.isFinite(n))learnedWeights[id]=Math.round(Math.max(-.16,Math.min(.16,n))*10000)/10000;
  }
  const history=(Array.isArray(source.history)?source.history:[]).slice(-24).map(h=>({
    at:Number(h?.at)||0,requestId:String(h?.requestId||'').slice(0,120),
    evidence:String(h?.evidence||'').slice(0,80),
    changes:(Array.isArray(h?.changes)?h.changes:[]).slice(0,8).filter(c=>COGNITIVE_LEARNABLE_IDS.includes(c?.edge))
      .map(c=>({edge:c.edge,before:Number(c.before)||0,after:Number(c.after)||0,evidence:String(c.evidence||'').slice(0,80)}))
  }));
  return {schema:COGNITIVE_STATE_SCHEMA,revision:Math.max(0,Math.trunc(Number(source.revision)||0)),
    traits:{honesty:.88,loyalty:.87,respect:.81,autonomy:.68,selfRespect:.78},
    learnedWeights,associativeWeights:Object.fromEntries(Object.entries(source.associativeWeights||{})
      .filter(([id,n])=>/^[a-z0-9_-]{2,80}:[a-z]{3,24}$/iu.test(id)&&Number.isFinite(Number(n)))
      .slice(0,96).map(([id,n])=>[id,Math.round(Math.max(-.12,Math.min(.12,Number(n)))*10000)/10000])),history,
    lastTurn:source.lastTurn&&typeof source.lastTurn==='object'?{
      id:String(source.lastTurn.id||'').slice(0,120),
      turnId:String(source.lastTurn.turnId||'').slice(0,150),
      act:String(source.lastTurn.act||'').slice(0,80),
      symbolId:String(source.lastTurn.symbolId||'').slice(0,80)||null,
      activation:source.lastTurn.activation&&typeof source.lastTurn.activation==='object'?Object.fromEntries(
        ['approach','support','jealousy'].map(k=>[k,Math.max(0,Math.min(1,Number(source.lastTurn.activation[k])||0))])):{},
      timestamp:Number(source.lastTurn.timestamp)||0
    }:null};
}
