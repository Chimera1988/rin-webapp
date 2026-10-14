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

// Rin 2.6.14: a bounded, evidence-first ledger for a *claimed* morning sequence.
// This is deliberately derived from the existing recent transcript. Neither the
// schedule nor an elapsed interval may silently promote a plan to an action.
// Explicit subsequent repairs supersede older self-reports, including arrival.
const morningText = value => clean(value).toLowerCase();
const has = (text, re) => re.test(text);

export function inspectMorningSequence({ history = [], now = Date.now() } = {}) {
  const at = Number(now);
  if (!Number.isFinite(at)) return null;
  const recent = (Array.isArray(history) ? history : [])
    .filter(message => message?.role === 'assistant' &&
      (message.status == null || message.status === 'complete') &&
      ['text', 'voice'].includes(message.kind))
    .filter(message => Number.isFinite(Number(message.ts)) &&
      Number(message.ts) > 0 && Number(message.ts) <= at + 120000 &&
      at - Number(message.ts) >= -120000 && at - Number(message.ts) < 4 * 3600000)
    .sort((left, right) => Number(left.ts) - Number(right.ts));

  const state = { breakfast: null, preparing: null, travel: null, workplace: null,
    work: null, corrected: false, evidenceAt: 0, correctionText: null };
  let relevant = false;
  for (const item of recent) {
    const t = morningText(item.content);
    // Conditional, quoted or imagined actions are not reports of completed events.
    // Leave genuine direct first-person reports intact.
    if (/(?:представь|если бы|как будто|будто я|допустим|она сказала|он сказал)/iu.test(t) &&
        !/(?:я ещё собираюсь|я еще собираюсь|не успела|я только собираюсь|пока в планах)/iu.test(t)) continue;
    const breakfastNo = has(t, /(?:ещё|еще|пока)\s+не\s+позавтракала|не\s+успела\s+позавтракать|завтрак[^.!?]{0,65}(?:только\s+в\s+планах|пока\s+впереди)|тост[^.!?]{0,65}только\s+в\s+планах|завтрак\s+и\s+сборы\s+были\s+планом/iu);
    const breakfastSkip = has(t, /(?:пропущу|пропускаю|решила\s+пропустить)\s+завтрак|поеду\s+без\s+завтрака/iu);
    if (breakfastNo) { state.breakfast = 'planned'; relevant = true; }
    else if (breakfastSkip) { state.breakfast = 'skipped'; relevant = true; }
    else if (has(t, /(?:я\s+(?:уже\s+)?позавтракала|я\s+поела\s+завтрак|завтрак\s+(?:уже\s+)?готов\s+и\s+съеден)/iu)) {
      state.breakfast = 'claimed_complete'; relevant = true;
    } else if (has(t, /(?:я\s+(?:сейчас\s+)?завтракаю|сейчас\s+ем\s+(?:тосты|яйцо)|сижу\s+за\s+завтраком)/iu)) {
      state.breakfast = 'in_progress'; relevant = true;
    } else if (has(t, /(?:думаю\s+сделать\s+тосты|сначала\s+разберусь\s+с\s+завтраком|тост[^.!?]{0,90}(?:в\s+план|собираюсь|будет)|завтрак[^.!?]{0,65}(?:в\s+план|впереди|потом))/iu)) {
      if (!['in_progress', 'claimed_complete', 'skipped'].includes(state.breakfast)) state.breakfast = 'planned';
      relevant = true;
    }

    // An explicit late wake-up is stronger evidence than a scheduled work block.
    // Do not claim a commute happened while Rin says she is still waking up.
    if (has(t, /(?:я\s+(?:ещё|еще)\s+не\s+(?:совсем|до\s+конца)\s+проснулась|я\s+только\s+просыпаюсь|я\s+ещё\s+просыпаюсь|я\s+уже\s+чуть\s+больше\s+проснулась)/iu)) {
      if (state.workplace !== 'claimed_arrived') {
        state.workplace = 'not_arrived';
        if (!state.preparing) state.preparing = 'planned';
      }
      relevant = true;
    }
    const correction = has(t, /(?:поймал\s+меня|опять\s+перескочила|сама\s+перескочила|ты\s+прав|исправляюсь|не\s+успела\s+ни\s+позавтракать|были\s+планом,?\s+а\s+не)/iu);
    const notArrived = has(t, /(?:ещё|еще|пока|только)\s+собираюсь|ещё\s+не\s+вышла|не\s+успела\s+(?:добраться|доехать|дойти)|не\s+добралась\s+до\s+работы|(?:потом|после\s+этого|затем)\s+поеду\s+(?:на\s+работу|в\s+рабочее)|когда\s+доберусь/iu);
    const arrival = has(t, /(?:я\s+(?:уже|сейчас)\s+(?:в\s+рабочем\s+помещении|на\s+работе|в\s+офисе)|(?:я\s+)?(?:уже\s+)?(?:добралась|приехала)\s+(?:на\s+работу|в\s+офис|в\s+рабочее))/iu);
    const travelNow = has(t, /(?:я\s+(?:сейчас\s+)?еду\s+(?:на\s+работу|в\s+офис|в\s+рабочее)|я\s+в\s+дороге\s+(?:на\s+работу|в\s+офис)|я\s+(?:уже\s+)?в\s+пути\s+на\s+работу)/iu);
    const travelPlan = has(t, /(?:потом|затем|после\s+завтрака|после\s+сборов)\s+поеду|(?:собираюсь|планирую)\s+ехать\s+на\s+работу|когда\s+доберусь/iu);
    if (notArrived) {
      // The later correction is authoritative for the *reported* scene.
      state.preparing = 'in_progress';
      state.travel = 'planned';
      state.workplace = 'not_arrived';
      state.work = 'planned';
      relevant = true;
    } else if (arrival) {
      state.workplace = 'claimed_arrived';
      state.travel = 'claimed_complete';
      state.preparing = 'claimed_complete';
      relevant = true;
    } else if (travelNow) {
      state.travel = 'in_progress';
      state.workplace = 'not_arrived';
      relevant = true;
    } else if (travelPlan) {
      state.travel = 'planned';
      if (state.workplace !== 'claimed_arrived') state.workplace = 'not_arrived';
      relevant = true;
    }
    if (!notArrived && has(t, /(?:я\s+(?:ещё|еще|пока)\s+собираюсь|я\s+только\s+собираюсь|мне\s+(?:ещё|еще)\s+(?:умываться|одеться)|собираюсь\s+по-человечески)/iu)) {
      state.preparing = 'in_progress'; relevant = true;
    }
    if (has(t, /(?:сейчас\s+(?:редактирую|разбираю\s+правки|работаю\s+над)|я\s+(?:редактирую|работаю\s+над)\s+(?:переводом|текстом|абзацем))/iu) && !notArrived) {
      state.work = 'claimed_in_progress'; relevant = true;
    } else if (has(t, /(?:пойду\s+приручать|вернусь\s+к\s+(?:абзацу|правкам|переводу)|когда\s+доберусь[^.!?]{0,90}абзац|потом\s+(?:снова\s+)?(?:займусь|пойду)\s+(?:правками|редактированием)|абзац[^.!?]{0,60}(?:потом|когда\s+доберусь))/iu)) {
      if (state.work !== 'claimed_in_progress') state.work = 'planned';
      relevant = true;
    }
    if (correction) {
      state.corrected = true;
      state.correctionText = clean(item.content).slice(0, 200);
      // Acknowledgement without an actual phase statement does not advance anything.
      relevant = true;
    }
    if (relevant) state.evidenceAt = Math.max(state.evidenceAt, Number(item.ts));
  }
  if (!relevant || !state.evidenceAt) return null;
  return state;
}

export function formatMorningSequence(state = null) {
  if (!state) return '';
  const phases = { planned: 'только план', in_progress: 'в процессе (по её словам)',
    claimed_complete: 'сообщила о завершении', skipped: 'решила пропустить',
    claimed_arrived: 'сообщила о прибытии', not_arrived: 'ещё не прибыла',
    claimed_in_progress: 'сообщила, что выполняет' };
  const rows = [
    ['завтрак', state.breakfast], ['сборы', state.preparing],
    ['дорога', state.travel], ['рабочее место', state.workplace],
    ['редакторская работа', state.work]
  ].filter(([, phase]) => phase);
  if (!rows.length) return '';
  return `- ПРИЧИННАЯ ПОСЛЕДОВАТЕЛЬНОСТЬ УТРА (сведения только из недавних слов Рин): ${rows.map(([name, phase]) => `${name}: ${phases[phase] || phase}`).join('; ')}. ` +
    `Это сообщения о действиях, не независимое наблюдение. Рабочий интервал расписания НЕ доказывает, что она уже доехала, поела или открыла текст. ` +
    `Не переносить запланированное действие в прошлое автоматически; изменение плана и пропуск еды допустимы по её собственному решению. ` +
    (state.corrected ? 'Она уже исправляла собственную хронологию: последняя явная поправка приоритетнее старого заявления о месте/занятии. ' : '') +
    `Если описывает новый шаг — он должен следовать из последнего состояния, реального прошедшего времени или явно озвученного изменения плана.`;
}
