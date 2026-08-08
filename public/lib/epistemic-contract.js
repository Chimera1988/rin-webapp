export const EPISTEMIC_SCHEMA = 'rin-epistemic-state-v1';
export const BELIEF_KINDS = new Set(['fact','user_statement','observation','rin_opinion','hypothesis','temporary_state','unknown']);
export const BELIEF_STATUSES = new Set(['current','historical','superseded','uncertain','rejected']);

const clean = (v,max=700)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,max);
const clamp01=(v,f=0)=>{const n=Number(v);return Number.isFinite(n)?Math.max(0,Math.min(1,n)):f};
const unique=(v,max=6,itemMax=280)=>[...new Set((Array.isArray(v)?v:[]).map(x=>clean(x,itemMax)).filter(Boolean))].slice(0,max);
function hash(value=''){let h=2166136261;for(const c of String(value)){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return(h>>>0).toString(36)}
export function beliefSlot(input={}) { return `${clean(input.subject,120)||'unknown'}:${clean(input.predicate,160)||'unknown'}`; }
export function beliefId(input={}) { return `belief-${hash(`${beliefSlot(input)}:${clean(input.value,700).toLowerCase()}`)}`; }
export function normalizeBelief(input={}) {
 const kind=BELIEF_KINDS.has(input.kind)?input.kind:'unknown'; const subject=clean(input.subject,120)||'unknown'; const predicate=clean(input.predicate,160)||'unknown'; const value=clean(input.value,700);
 const status=BELIEF_STATUSES.has(input.status)?input.status:(kind==='unknown'||kind==='hypothesis'?'uncertain':'current');
 const defaultConfidence=kind==='fact'||kind==='user_statement'?1:kind==='observation'?0.72:kind==='rin_opinion'?0.8:kind==='hypothesis'?0.3:0.2;
 const evidence=unique(input.evidence,6,280); const provenance=unique(input.provenance,6,280);
 return { id:clean(input.id,120)||beliefId({subject,predicate,value}), kind, subject,predicate,value, source:clean(input.source,120)||'unknown', confidence:clamp01(input.confidence,defaultConfidence), status,
   validFrom:Number.isFinite(Number(input.validFrom))?Number(input.validFrom):null, validUntil:Number.isFinite(Number(input.validUntil))?Number(input.validUntil):null,
   evidence, provenance, supersedes:unique(input.supersedes,8,120), correctedBy:clean(input.correctedBy,120)||null, updatedAt:Number.isFinite(Number(input.updatedAt))?Number(input.updatedAt):null };
}
export function isAssertableBelief(input={}) { const b=normalizeBelief(input); if(!['current','historical'].includes(b.status)) return false; if(['fact','user_statement'].includes(b.kind)) return b.confidence>=0.85; if(b.kind==='observation') return b.confidence>=0.7 && b.evidence.length>=2; if(b.kind==='rin_opinion') return b.confidence>=0.55; return false; }
export function normalizeEpistemicState(input={}) { const beliefs=(Array.isArray(input.beliefs)?input.beliefs:[]).map(normalizeBelief).slice(-48); return {schema:EPISTEMIC_SCHEMA,beliefs,lastCorrection:input.lastCorrection&&typeof input.lastCorrection==='object'?input.lastCorrection:null,updatedAt:Number(input.updatedAt)||0}; }
