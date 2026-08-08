export const INNER_LIFE_SCHEMA = 'rin-inner-life-v1';
const clean=(v,max=300)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,max);
const num=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
const clamp=(v,min=0,max=100,f=50)=>Math.max(min,Math.min(max,num(v,f)));
export function normalizeInnerLife(input={}) {
  const s=input&&typeof input==='object'?input:{};
  return {
    schema:INNER_LIFE_SCHEMA,
    activity:clean(s.activity,180), trace:clean(s.trace,220), focus:clean(s.focus,220), privateThought:clean(s.privateThought,260),
    activityGoal:clean(s.activityGoal,220), continuityKey:clean(s.continuityKey,160), part:clean(s.part,30),
    energy:clamp(s.energy,0,100,60), startedAt:Math.max(0,num(s.startedAt,0)), expiresAt:Math.max(0,num(s.expiresAt,0)),
    lastChangedAt:Math.max(0,num(s.lastChangedAt,s.startedAt||0)), lastSpontaneousAt:Math.max(0,num(s.lastSpontaneousAt,0)), lastUserAt:Math.max(0,num(s.lastUserAt,0)),
    interactionCount:Math.max(0,Math.round(num(s.interactionCount,0))),
    recentActivities:(Array.isArray(s.recentActivities)?s.recentActivities:[]).map(x=>clean(x,180)).filter(Boolean).slice(-8),
    recentThoughts:(Array.isArray(s.recentThoughts)?s.recentThoughts:[]).map(x=>clean(x,220)).filter(Boolean).slice(-6)
  };
}
