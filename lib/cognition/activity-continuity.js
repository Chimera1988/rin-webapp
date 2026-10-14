// Rin 2.6.4 — conservative continuity of explicitly described daily actions.
// This is a *conversation-consistency* cue, not a claim about physical reality.
// Historical self-reports must not be treated as externally observed facts.
const clean = value => String(value || '').replace(/\s+/gu, ' ').trim().slice(0, 3000);

const RULES = Object.freeze([
  {
    key:'meal', minMinutes:12, maxMinutes:240,
    planned:/(?:иду|пойду|собираюсь|планирую|решила|решаю|пора|хочу)[^.!?]{0,70}(?:пообедать|обедать|на обед|перекусить)|(?:пообедаю|перекушу)/iu,
    inProgress:/(?:сейчас|пока|уже)\s+(?:обедаю|ем\s+обед)|(?:я\s+)?обедаю/iu,
    completed:/(?:я\s+)?(?:уже\s+)?(?:пообедала|перекусила|поела)|на обед (?:была|был|съела|ела)|после обеда[^.!?]{0,45}(?:уже|снова|теперь)/iu,
    plannedSummary:'Рин заявила о намерении пообедать.',
    inProgressSummary:'Рин сообщила, что сейчас обедает.',
    completedSummary:'Рин сообщила о завершении обеда.'
  },
  {
    key:'rest', minMinutes:10, maxMinutes:180,
    planned:/(?:пойду|собираюсь|решила|хочу|пора)[^.!?]{0,65}(?:отдохнуть|на перерыв|сделать перерыв)/iu,
    inProgress:/(?:я\s+)?(?:сейчас\s+)?(?:отдыхаю|на перерыве)/iu,
    completed:/(?:я\s+)?(?:отдохнула|вернулась после перерыва|закончила перерыв)/iu,
    plannedSummary:'Рин заявила о намерении сделать перерыв.',
    inProgressSummary:'Рин сообщила, что отдыхает.',
    completedSummary:'Рин сообщила о завершении перерыва.'
  },
  {
    key:'walk', minMinutes:15, maxMinutes:360,
    planned:/(?:пойду|собираюсь|решила|хочу)[^.!?]{0,65}(?:погулять|прогуляться|на прогулку)/iu,
    inProgress:/(?:сейчас|пока)\s+(?:гуляю|на прогулке)|(?:я\s+)?гуляю/iu,
    completed:/(?:я\s+)?(?:погуляла|прогулялась|вернулась с прогулки)/iu,
    plannedSummary:'Рин заявила о намерении прогуляться.',
    inProgressSummary:'Рин сообщила, что находится на прогулке.',
    completedSummary:'Рин сообщила о завершении прогулки.'
  }
]);

// These are intentionally narrow detectors, favoring omission over invented actions.
function uncertain(text) {
  return /(?:не\s+(?:пойду|иду|собираюсь|хочу|решила|планирую|пообедала|поела|погуляла|отдохнула)|если\s+бы|могла\s+бы|представь|допустим|он\s+сказал|она\s+сказала)/iu.test(text);
}
export function classifyExplicitActivity(message = null) {
  if (!message || message.role !== 'assistant' || (message.status != null && message.status !== 'complete') || !['text','voice'].includes(message.kind)) return null;
  const text=clean(message.content);
  if (!text || uncertain(text)) return null;
  for (const rule of RULES) {
    const completed=rule.completed.test(text);
    const inProgress=rule.inProgress?.test(text)===true;
    const planned=rule.planned.test(text);
    if (!completed && !inProgress && !planned) continue;
    return {activity:rule.key,phase:completed?'claimed_complete':inProgress?'in_progress':'planned',minMinutes:rule.minMinutes,
      maxMinutes:rule.maxMinutes,summary:completed?rule.completedSummary:inProgress?rule.inProgressSummary:rule.plannedSummary};
  }
  return null;
}

export function inspectActivityContinuity({history=[],now=Date.now()}={}) {
  if (!Number.isFinite(Number(now))) return null;
  const time=Number(now);
  const observations=(Array.isArray(history)?history:[])
    .filter(m=>m?.role==='assistant' && (m?.status == null || m.status==='complete'))
    .filter(m=>Number.isFinite(Number(m?.ts)) && Number(m.ts)>0 && Number(m.ts)<=time+120000)
    .map(m=>({ts:Number(m.ts),claim:classifyExplicitActivity(m)}))
    .filter(m=>m.claim && time-m.ts<6*3600000)
    .sort((a,b)=>a.ts-b.ts);
  const states=new Map();
  for (const item of observations) {
    const c=item.claim;
    if(c.phase==='planned') {
      states.set(c.activity,{activity:c.activity,phase:'planned',startedAt:item.ts,latestAt:item.ts,
        minMinutes:c.minMinutes,maxMinutes:c.maxMinutes});
      continue;
    }
    if(c.phase==='in_progress') {
      states.set(c.activity,{activity:c.activity,phase:'in_progress',startedAt:item.ts,latestAt:item.ts,
        minMinutes:c.minMinutes,maxMinutes:c.maxMinutes});
      continue;
    }
    const previous=states.get(c.activity);
    if(!previous){states.set(c.activity,{activity:c.activity,phase:'unlinked_completion_claim',latestAt:item.ts,
      minMinutes:c.minMinutes,maxMinutes:c.maxMinutes});continue;}
    const elapsed=Math.max(0,(item.ts-previous.startedAt)/60000);
    states.set(c.activity,{...previous,phase:elapsed<c.minMinutes?'time_conflict':'claimed_complete',
      claimedCompleteAt:item.ts,latestAt:item.ts,elapsedToCompletionMinutes:Math.floor(elapsed)});
  }
  const state=[...states.values()].sort((a,b)=>b.latestAt-a.latestAt)[0];
  if(!state)return null;
  const minutesSince=Math.max(0,Math.floor((time-state.latestAt)/60000));
  if(minutesSince>state.maxMinutes || state.phase==='unlinked_completion_claim')return null;
  return {...state,minutesSince};
}

export function formatActivityContinuity(state=null, userText='') {
  if(!state)return '';
  const names={meal:'обед',rest:'перерыв',walk:'прогулка'};
  const name=names[state.activity]||'бытовое действие';
  const cue={meal:/обед|поела|пообед|лапш|перекус|еда|есть/iu,rest:/отдох|перерыв|устал|отдых/iu,walk:/гуля|прогул|улиц/iu}[state.activity];
  const relevant=cue?.test(String(userText||''))===true;
  if(state.phase==='planned' && state.minutesSince>20 && !relevant) return '';
  if(state.phase==='in_progress' && state.minutesSince>30 && !relevant) return '';
  if(state.phase==='time_conflict' && !relevant) return '';
  if(state.phase==='planned') {
    // The duration estimate is soft; the model must not invent a completed action.
    return `- ВРЕМЕННАЯ ПОСЛЕДОВАТЕЛЬНОСТЬ (${name}): Рин раньше СКАЗАЛА, что собирается это сделать. Это намерение, не доказательство начала или завершения. От последнего сообщения об этом прошло ${state.minutesSince} мин. Не говори «уже сделала» или «после этого» автоматически при коротком промежутке: если действие ещё не началось, так и скажи; если оно началось, сохрани естественную длительность. Пользователь может продолжать писать; Рин сама выбирает, когда прерваться, и может изменить план.`;
  }
  if(state.phase==='in_progress') {
    return `- ВРЕМЕННАЯ ПОСЛЕДОВАТЕЛЬНОСТЬ (${name}): Рин недавно сказала, что это действие идёт сейчас. Это её слова, а не независимо проверенное событие. Не завершай его автоматически за считанные минуты. При желании Рин может приостановить действие или изменить планы.`;
  }
  if(state.phase==='time_conflict') {
    return `- ВРЕМЕННАЯ НЕСОГЛАСОВАННОСТЬ (${name}): Рин сначала объявила о плане, а затем сама сообщила о завершении всего спустя ${state.elapsedToCompletionMinutes} мин. Это НЕ внешне подтверждённое действие. Не усугубляй противоречие выдуманными подробностями; если пользователь удивится, естественно уточни, что произошло, признай поспешную формулировку или короткий перерыв. Не исправляй прошлые сообщения задним числом.`;
  }
  return '';
}

// One shared implementation prevents disagreement between browser, background jobs and Rin Mind.
export { inspectMorningSequence, formatMorningSequence } from '../../public/lib/daily-episode.js';
