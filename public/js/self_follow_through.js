// Rin 2.6.6: read-only pointers to Rin's EXPLICIT promises in her own dialogue.
// No user suggestions are promoted to obligations; no timers or automatic messages.
const RULES=Object.freeze([
  {key:'evening_surprise',pattern:/(?:вспомню[^.!?]{0,90}вечером|вечером[^.!?]{0,120}сюрприз|сюрприз[^.!?]{0,120}вечером)/iu,
    completion:/(?:сюрприз[^.!?]{0,80}(?:готов|вот)|обещанн[^.!?]{0,70}сюрприз|вечерн[^.!?]{0,80}сюрприз)/iu,
    earliestMinute:18*60,latestMinute:23*60,maxAgeMinutes:12*60},
  {key:'return_to_work',pattern:/(?:сама[^.!?]{0,70}подам сигнал[^.!?]{0,100}(?:комментар|работ)|сама[^.!?]{0,70}(?:скажу|напомню)[^.!?]{0,100}(?:работ|текст)|потом[^.!?]{0,50}вернусь[^.!?]{0,50}(?:к комментар|к тексту|к работ))/iu,
    completion:/(?:пожалуй,?\s*пора|пора[^.!?]{0,45}(?:вернуться|за работу)|возвращаюсь[^.!?]{0,65}(?:к работ|к тексту|к комментар)|вернулась[^.!?]{0,60}(?:к работ|к тексту|к комментар)|закончила[^.!?]{0,65}(?:комментар|работ))/iu,
    minMinutes:4,maxAgeMinutes:100},
  {key:'finish_work',pattern:/(?:закончу[^.!?]{0,80}(?:комментар|работ|перевод)[^.!?]{0,90}(?:вернусь|напишу)|допишу[^.!?]{0,75}(?:вернусь|напишу))/iu,
    completion:/(?:закончила[^.!?]{0,60}(?:комментар|работ|перевод)|дописала[^.!?]{0,50}комментар)/iu,
    minMinutes:20,maxAgeMinutes:5*60}
]);
const SELF_CANCEL=/(?:передумала|отменяю|не\s+получится|не\s+смогу|отложу)/iu;
function localParts(ts,timezone) {
  try {
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(ts).map(p=>[p.type,p.value]));
    return {day:`${parts.year}-${parts.month}-${parts.day}`,minute:Number(parts.hour)*60+Number(parts.minute)};
  } catch {return null;}
}
export function selfFollowThrough(history=[],now=Date.now(),timezone='Europe/Moscow') {
  if(!Number.isFinite(Number(now)))return [];
  const current=localParts(now,timezone);
  if(!current)return [];
  const ordered=(Array.isArray(history)?history:[])
    .filter(m=>m?.role==='assistant' && ['text','voice'].includes(m.kind) &&
      (m.status == null || m.status==='complete') && typeof m.content==='string' &&
      Number.isFinite(Number(m.ts)) && Number(m.ts)>0 && Number(m.ts)<=now)
    .sort((a,b)=>Number(a.ts)-Number(b.ts));
  const pending=new Map();
  for(const message of ordered) {
    const text=message.content.trim();
    const ts=Number(message.ts);
    for(const rule of RULES) {
      if(rule.completion.test(text) || (SELF_CANCEL.test(text) && pending.has(rule.key))) {
        pending.delete(rule.key);
        continue;
      }
      if(rule.pattern.test(text))pending.set(rule.key,{rule,ts,quote:text.slice(0,240),sourceId:String(message.id || '').slice(0,100)});
    }
  }
  const due=[];
  for (const {rule,ts,quote,sourceId} of pending.values()) {
    const start=localParts(ts,timezone);
    const minutes=Math.floor((now-ts)/60000);
    if(!start || start.day!==current.day || minutes<0 || minutes>rule.maxAgeMinutes)continue;
    const ready=rule.earliestMinute != null ? current.minute>=rule.earliestMinute && current.minute<=rule.latestMinute : minutes>=rule.minMinutes;
    if(!ready)continue;
    due.push({key:rule.key,minutesSince:minutes,sourceId,quote});
  }
  return due.slice(-2);
}
