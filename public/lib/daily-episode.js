// Shared, evidence-only daily episode: used by both the browser and Rin Mind.
const clean = value => String(value || '').replace(/\s+/gu, ' ').trim().slice(0, 3000);

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
    work: null, lunch: null, conflict: false, corrected: false, evidenceAt: 0, correctionText: null };
  let anyRelevant = false;
  for (const item of recent) {
    let relevant = false;
    const t = morningText(item.content);
    // Conditional, quoted or imagined actions are not reports of completed events.
    // Leave genuine direct first-person reports intact.
    if (/(?:представь|если бы|как будто|будто я|допустим|она сказала|он сказал)/iu.test(t) &&
        !/(?:я ещё собираюсь|я еще собираюсь|не успела|я только собираюсь|пока в планах)/iu.test(t)) continue;
    const breakfastNo = has(t, /(?:ещё|еще|пока)\s+не\s+позавтракала|не\s+успела\s+позавтракать|завтрак[^.!?]{0,65}(?:только\s+в\s+планах|пока\s+впереди)|тост[^.!?]{0,65}только\s+в\s+планах|завтрак\s+и\s+сборы\s+были\s+планом|завтрак\s+(?:пока\s+)?не\s+состоялся/iu);
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
    // Once Rin has reported lunch or resumed work, an isolated regression to
    // morning preparations is contradictory, not evidence of time travel.
    // An explicit, specific correction can still revise her earlier report.
    const lunchNotDone = has(t, /(?:не\s+(?:успела\s+)?пообедать|не\s+обедала|обеда\s+(?:ещё\s+)?не\s+было)/iu);
    const lunchCompleted = has(t, /(?:я\s+(?:уже\s+)?пообедала|(?:уже\s+)?пообедала\s+и|после\s+обеда\s+(?:я\s+)?(?:вернулась|снова)|обед\s+(?:уже\s+)?закончила)/iu);
    const lunchOngoing = has(t, /(?:я\s+(?:сейчас\s+)?обедаю|сейчас\s+на\s+обеде|я\s+ем\s+обед)/iu);
    const lunchPlanned = has(t, /(?:пойду\s+пообедаю|собираюсь\s+пообедать|планирую\s+обед|хочу\s+пообедать)/iu);
    const resumedWork = has(t, /(?:вернулась\s+к\s+(?:правкам|редактированию|тексту|работе)|снова\s+(?:редактирую|занимаюсь\s+правками)|после\s+обеда[^.!?]{0,80}(?:правк|редактир|работаю))/iu);
    if (lunchNotDone) { state.lunch='planned'; relevant=true; }
    else if (lunchCompleted) {state.lunch='claimed_complete'; relevant=true;}
    else if (lunchOngoing) {state.lunch='in_progress'; relevant=true;}
    else if (lunchPlanned && !state.lunch) {state.lunch='planned'; relevant=true;}
    if (resumedWork) {
      state.work='claimed_in_progress'; relevant=true;
      // Editing can resume from home: neither inferred office arrival nor a
      // stale morning 'not arrived' remains the authoritative current setting.
      if (state.workplace === 'not_arrived') state.workplace=null;
      if (state.preparing === 'in_progress') state.preparing=null;
      if (state.travel === 'planned') state.travel=null;
    }
    const earlierProgress = ['in_progress','claimed_complete'].includes(state.lunch) ||
      state.work === 'claimed_in_progress';
    const explicitRollback = correction && lunchNotDone;
    if (notArrived && earlierProgress && !explicitRollback) {
      state.conflict = true;
      relevant=true;
    } else if (notArrived) {
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
    if (relevant) { anyRelevant = true; state.evidenceAt = Math.max(state.evidenceAt, Number(item.ts)); }
  }
  if (!anyRelevant || !state.evidenceAt) return null;
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
    ['редакторская работа', state.work], ['обед', state.lunch]
  ].filter(([, phase]) => phase);
  if (!rows.length) return '';
  return `- ПРИЧИННАЯ ПОСЛЕДОВАТЕЛЬНОСТЬ ДНЯ (сведения только из недавних слов Рин): ${rows.map(([name, phase]) => `${name}: ${phases[phase] || phase}`).join('; ')}. ` +
    `Это сообщения о действиях, не независимое наблюдение. Рабочий интервал расписания НЕ доказывает, что она уже доехала, поела или открыла текст. ` +
    `Не переносить запланированное действие в прошлое автоматически; изменение плана и пропуск еды допустимы по её собственному решению. ` +
    (state.conflict ? 'Обнаружено противоречие между поздним этапом дня и повторными утренними сборами: не выдавать оба состояния за истинные одновременно. ' : '') +
    (state.corrected ? 'Она уже исправляла собственную хронологию: последняя явная поправка приоритетнее старого заявления о месте/занятии. ' : '') +
    `Если описывает новый шаг — он должен следовать из последнего состояния, реального прошедшего времени или явно озвученного изменения плана.`;
}


// Persistent, bounded causal ledger (reported events, not verified physical facts).
const FIELDS = ['breakfast', 'preparing', 'travel', 'workplace', 'work', 'lunch'];
const PHASES = new Set(['planned','in_progress','claimed_complete','claimed_arrived','not_arrived','claimed_in_progress','skipped']);
const FRESHNESS_MS = 4 * 60 * 60 * 1000;
const SAME_SCENE_MINUTES = 30;

export function normalizeDailyEpisode(source = null, now = Date.now(), dayKey = null) {
  if (!source || typeof source !== 'object') return null;
  const at = Number(source.evidenceAt);
  if (!Number.isFinite(at) || at <= 0 || at > now + 120000 || now - at > FRESHNESS_MS) return null;
  if (dayKey && String(source.dayKey || '') !== String(dayKey)) return null;
  const episode = {dayKey:String(source.dayKey || '').slice(0,10), evidenceAt:at,
    corrected:source.corrected === true, conflict:source.conflict === true, correctionText:clean(source.correctionText).slice(0,200)};
  for (const field of FIELDS) episode[field] = PHASES.has(source[field]) ? source[field] : null;
  return FIELDS.some(key => episode[key]) ? episode : null;
}

export function reconcileDailyEpisode({ prior = null, history = [], now = Date.now(), dayKey = '' } = {}) {
  const old = normalizeDailyEpisode(prior, now, dayKey);
  const observed = inspectMorningSequence({history, now});
  if (!observed) return old;
  const next = normalizeDailyEpisode({...observed,dayKey}, now, dayKey);
  // History can be truncated while the persistent ledger remains newer.
  if (!next) return old;
  if (old && old.evidenceAt > next.evidenceAt) return old;
  const progressed = old && (old.lunch === 'claimed_complete' || old.work === 'claimed_in_progress');
  const regressed = next.workplace === 'not_arrived' && next.preparing === 'in_progress' &&
    !['claimed_complete','in_progress'].includes(next.lunch) && next.work !== 'claimed_in_progress';
  if (progressed && regressed && !next.corrected) {
    return {...old, evidenceAt:next.evidenceAt, conflict:true};
  }
  // Carry forward uncontradicted reported steps if old history is no longer present.
  if (old && old.evidenceAt < next.evidenceAt && !next.corrected) {
    for (const field of FIELDS) {
      if (next[field]) continue;
      if (['preparing','travel','workplace'].includes(field) &&
          (next.work === 'claimed_in_progress' || next.lunch === 'claimed_complete')) continue;
      next[field] = old[field];
    }
  }
  return next;
}

// A planned schedule never constitutes evidence of commuting or workplace arrival.
// This projection corrects *state before Mind*, while retaining Rin's freedom to
// report a genuine change at the next conversational turn.
export function projectDailyEpisodeActivity(innerLife = {}, episode = null, now = Date.now()) {
  const valid = normalizeDailyEpisode(episode, now);
  const current = {...innerLife, dailyEpisode:valid};
  if (!valid || current.workMode === 'off' || ['sleeping','interrupted_sleep','drowsy','winding_down'].includes(current.sleepPhase)) return current;
  const ageMinutes = (now - valid.evidenceAt) / 60000;
  // Explicit on-site statements have priority over an older plan.
  if (valid.workplace === 'claimed_arrived' || valid.work === 'claimed_in_progress' ||
      ['in_progress','claimed_complete'].includes(valid.lunch)) return current;
  if (valid.workplace !== 'not_arrived') return current;
  let activity, goal, trace;
  if (valid.travel === 'in_progress' && ageMinutes <= SAME_SCENE_MINUTES) {
    activity = 'едет на работу (по её последнему сообщению)';
    goal = 'добраться до места, если планы не изменились';
    trace = 'дорога начата по словам Рин; прибытие не подтверждено';
  } else if (valid.preparing === 'in_progress' && ageMinutes <= SAME_SCENE_MINUTES) {
    activity = 'ещё собирается к выходу (по её последнему сообщению)';
    goal = 'самостоятельно решить, закончить ли сборы, поесть и когда выходить';
    trace = 'завтрак, дорога и прибытие не считаются автоматически завершёнными';
  } else {
    activity = 'текущий этап дня не подтверждён после ранее озвученных сборов';
    goal = 'свободно выбрать следующий шаг; не выдавать расписание за уже случившиеся события';
    trace = 'после последнего сообщения прошло время; возможны перемены, но их не сообщали';
  }
  return {...current, activity, activityGoal:goal, trace,
    source:'causal_daily_episode', activitySetting:ageMinutes > SAME_SCENE_MINUTES ? 'unknown' : 'indoor', weatherGrounded:false, weatherContext:''};
}
