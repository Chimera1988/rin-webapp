// Rin 2.6.16 — evidence-linked shared activity ledger.
// Stores reported conversational events, never verifies physical actions.
// Neither a suggestion nor elapsed time can turn into a completed activity.
const DAY_MS = 24 * 3600000;
const clean = (text, max = 220) => String(text || '').replace(/\s+/gu, ' ').trim().slice(0, max);
const timeOf = row => Number(row?.ts || 0);
const VALID_PHASES = new Set(['proposed', 'in_progress', 'claimed_complete', 'cancelled', 'corrected_not_done']);
const RULES = Object.freeze([
  {
    key: 'film', title: 'совместный просмотр фильма/сериала',
    mention: /(?:фильм|кино|комеди[юи]|сериал|что[-\s]?нибудь\s+посмотр(?:еть|им)|выберем\s+что[-\s]?нибудь\s+посмотреть)/iu,
    negative: /(?:не\s+(?:смотрели|посмотрели|включали)|так\s+и\s+не\s+(?:посмотрели|включили)|никак(?:ого|ую)\s+(?:фильма|комедии)\s+не\s+(?:смотрели|было))/iu,
    complete: /(?:мы\s+(?:(?:как\s+раз\s+)?уже\s+)?(?:посмотрели|досмотрели)|(?:фильм|комеди[юю]|сериал)\s+(?:уже\s+)?(?:посмотрели|досмотрели)|(?:только\s+что|уже)\s+досмотрели)/iu,
    progress: /(?:мы\s+(?:сейчас\s+)?(?:смотрим|начали\s+смотреть)|(?:включили|включаем)\s+(?:фильм|кино|комеди[юю]|сериал)|(?:смотрим|начали\s+смотреть)\s+(?:фильм|комеди[юю]|сериал))/iu,
    proposed: /(?:давай|предлагаю|может|хочу|планирую|будем|выберем|хочешь|можно|собираюсь|попробуем)[^.!?]{0,110}(?:посмотр(?:еть|им)|включить|кино|фильм|комеди|сериал)/iu
  },
  {
    key: 'music', title: 'совместное прослушивание музыки',
    mention: /(?:музык|песн|композици|баллад|мелоди)/iu,
    negative: /(?:не\s+(?:слушали|дослушали|включали)|так\s+и\s+не\s+послушали)/iu,
    complete: /(?:мы\s+(?:уже\s+)?дослушали|песня\s+доиграла|композиция\s+закончилась)/iu,
    progress: /(?:мы\s+(?:сейчас\s+)?слушаем|(?:песня|композиция)\s+(?:играет|звучит|доигрывает)|слушаем\s+музыку)/iu,
    proposed: /(?:давай|предлагаю|может|выбираю|хочу|будем)[^.!?]{0,100}(?:слушать|песн|музык|композици)/iu
  }
]);
const imagination = /(?:если\s+бы|представь|вообрази|как\s+будто|могли\s+бы|в\s+сказке|в\s+истории|герой|героин)/iu;

export function normalizeEventEvidence(source = null, now = Date.now(), dayKey = '') {
  if (!source || typeof source !== 'object') return null;
  const day = clean(source.dayKey, 10);
  if (dayKey && day !== dayKey) return null;
  const events = Array.isArray(source.items) ? source.items : [];
  const items = events.filter(e => RULES.some(r => r.key === e?.key) && VALID_PHASES.has(e?.phase) &&
      Number.isFinite(Number(e?.at)) && Number(e.at) > 0 && Number(e.at) <= now + 120000 && now - Number(e.at) < DAY_MS)
    .map(e => ({key:e.key, phase:e.phase, at:Number(e.at), by:e.by === 'user' ? 'user' : 'assistant', sourceId:clean(e.sourceId,100), quote:clean(e.quote,180)}))
    .slice(-6);
  return items.length ? {dayKey:day, items} : null;
}

function classify(text, rule) {
  if (!rule.mention.test(text)) return null;
  if (rule.negative.test(text)) return 'corrected_not_done';
  // Quoted, conditional or imagined activities cannot establish an occurrence.
  if (imagination.test(text)) return null;
  if (rule.proposed.test(text)) return 'proposed';
  if (rule.progress.test(text)) return 'in_progress';
  if (rule.complete.test(text)) return 'claimed_complete';
  return null;
}

export function reconcileEventEvidence({prior=null, history=[], now=Date.now(), dayKey=''}={}) {
  const old = normalizeEventEvidence(prior, now, dayKey);
  const states = new Map((old?.items || []).map(item => [item.key,item]));
  const rows = (Array.isArray(history) ? history : []).filter(item =>
    ['user','assistant'].includes(item?.role) && ['text','voice'].includes(item.kind || 'text') &&
    (item.status == null || item.status === 'complete') && Number.isFinite(timeOf(item)) &&
    timeOf(item) > 0 && timeOf(item) <= now + 120000 && now - timeOf(item) < DAY_MS)
    .sort((a,b)=>timeOf(a)-timeOf(b));
  for (const row of rows) {
    const text = clean(row.content, 3000);
    for (const rule of RULES) {
      const phase = classify(text,rule);
      if (!phase) continue;
      const previous = states.get(rule.key);
      if (previous && timeOf(row) < previous.at) continue;
      // A later suggestion does not undo an already reported ongoing/completed event.
      if (phase === 'proposed' && previous && ['in_progress','claimed_complete'].includes(previous.phase)) continue;
      // Rin saying "we watched it" does not establish completion when neither
      // participant previously reported that the joint activity even began.
      if (phase === 'claimed_complete' && row.role === 'assistant' &&
          !previous?.phase?.match(/^(in_progress|claimed_complete)$/u)) continue;
      states.set(rule.key,{key:rule.key,phase,at:timeOf(row),by:row.role,sourceId:clean(row.id,100),quote:clean(text,180)});
    }
  }
  return normalizeEventEvidence({dayKey,items:[...states.values()].sort((a,b)=>a.at-b.at).slice(-6)},now,dayKey);
}

export function formatEventEvidence(ledger=null, userText='') {
  if (!ledger?.items?.length) return '';
  const callback = /(?:помнишь|программ|что\s+мы\s+(?:делали|планировали)|наш\s+вечер|чем\s+занимались)/iu.test(String(userText||''));
  const relevant = ledger.items.filter(item => {
    const rule = RULES.find(r=>r.key===item.key);
    return rule && (callback || rule.mention.test(String(userText || '')) || item.phase === 'in_progress');
  }).slice(-3);
  if (!relevant.length) return '';
  const labels={proposed:'только предложено',in_progress:'начато по словам участников',claimed_complete:'сообщили о завершении',cancelled:'отменено',corrected_not_done:'участник уточнил, что не произошло'};
  return `- ЖУРНАЛ СОВМЕСТНЫХ СОБЫТИЙ: ${relevant.map(item=>`${RULES.find(r=>r.key===item.key).title}: ${labels[item.phase]} (${item.by === 'user' ? 'пользователь' : 'Рин'}: «${item.quote}»)`).join('; ')}. `+
    'Не выдавай предложения за совершённые действия; прошедшее время само по себе не доказывает выполнение. ' +
    'Исправление пользователя имеет приоритет. Сообщения — свидетельства слов, а не независимая запись внешнего мира.';
}

// Server-side safety net: only neutralize an unsupported explicit claim of a
// completed *shared* film; do not rewrite creative fiction or unrelated prose.
export function guardUnsupportedSharedCompletion(segments=[], ledger=null) {
  const film = ledger?.items?.find(item=>item.key==='film');
  if (!film || !['proposed','cancelled','corrected_not_done'].includes(film.phase)) return segments;
  return (Array.isArray(segments)?segments:[]).map(item=>{
    if (item?.type!=='text' || typeof item.text!=='string') return item;
    if (!/(?:мы\s+(?:(?:как\s+раз\s+)?уже\s+)?(?:посмотрели|досмотрели)|(?:фильм|комеди[юю]|сериал)\s+(?:уже\s+)?(?:посмотрели|досмотрели))/iu.test(item.text)) return item;
    if (imagination.test(item.text)) return item;
    return {...item,text:'Помню, я предлагала нам что-нибудь посмотреть. Но в нашей переписке нет подтверждения, что мы действительно это посмотрели.'};
  });
}
