const ACTIVITY_BY_PART = {
  morning: [
    ['просматривает рабочие заметки за чаем', 'на столе лежит открытый блокнот'],
    ['собирается начать работу', 'проверяет, всё ли подготовила'],
    ['медленно входит в ритм утра', 'ещё не хочется торопиться']
  ],
  day: [
    ['редактирует перевод', 'задержалась на формулировке'],
    ['работает с текстом за ноутбуком', 'периодически перечитывает один абзац'],
    ['сделала короткую паузу между задачами', 'пытается немного разгрузить голову']
  ],
  evening: [
    ['заваривает чай после работы', 'даёт мыслям немного успокоиться'],
    ['читает несколько страниц книги', 'иногда отвлекается на звуки за окном'],
    ['разбирает заметки на рабочем столе', 'нашла старую запись и задумалась']
  ],
  night: [
    ['готовится ко сну', 'оставила только мягкий свет'],
    ['сидит в тишине с остывающим чаем', 'день ещё не совсем отпустил'],
    ['дочитывает страницу перед сном', 'уже начинает уставать']
  ]
};

function normalize(value, max = 240) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function partOfDay(env = {}) {
  const supplied = normalize(env.partOfDay, 20).toLowerCase();
  if (/утр|morning/.test(supplied)) return 'morning';
  if (/веч|evening/.test(supplied)) return 'evening';
  if (/ноч|night/.test(supplied)) return 'night';
  if (/день|day/.test(supplied)) return 'day';
  const hour = Number(String(env.rinHuman || '').match(/\b(\d{1,2}):\d{2}\b/)?.[1]);
  if (Number.isFinite(hour)) {
    if (hour < 6 || hour >= 23) return 'night';
    if (hour < 11) return 'morning';
    if (hour < 18) return 'day';
    return 'evening';
  }
  return 'day';
}

function hash(value = '') {
  let out = 2166136261;
  for (const char of String(value)) {
    out ^= char.charCodeAt(0);
    out = Math.imul(out, 16777619);
  }
  return out >>> 0;
}

function fallbackActivity(env = {}) {
  const part = partOfDay(env);
  const pool = ACTIVITY_BY_PART[part] || ACTIVITY_BY_PART.day;
  const key = `${env.rinHuman || ''}|${env.month || ''}|${part}`;
  const [activity, trace] = pool[hash(key) % pool.length];
  return { activity, trace, part };
}

export function buildInnerLifeSnapshot(memory = null, env = null, userText = '', history = []) {
  const stored = memory?.innerLife && typeof memory.innerLife === 'object' ? memory.innerLife : {};
  const fallback = fallbackActivity(env || {});
  const activity = normalize(stored.activity, 160) || fallback.activity;
  const trace = normalize(stored.trace, 180) || fallback.trace;
  const focus = normalize(stored.focus, 180);
  const thought = normalize(stored.privateThought, 220);
  const startedAt = Number(stored.startedAt) || null;
  const lastSpontaneousAt = Number(stored.lastSpontaneousAt) || null;
  const now = Date.now();
  const activityAgeMinutes = startedAt ? Math.max(0, Math.round((now - startedAt) / 60000)) : null;
  const directQuestion = /(что ты (сейчас )?делаешь|чем (ты )?(сейчас )?занимаешься|как проходит твой день|что у тебя сейчас|как твой день)/iu.test(String(userText || ''));
  const recentAssistant = (Array.isArray(history) ? history : []).filter(x => x?.role === 'assistant').slice(-4).map(x => String(x.content || '')).join(' ');
  const alreadyMentioned = activity.split(/\s+/).filter(x => x.length > 5).some(word => recentAssistant.toLowerCase().includes(word.toLowerCase()));

  return {
    activity,
    trace,
    focus,
    thought,
    part: normalize(stored.part, 20) || fallback.part,
    activityAgeMinutes,
    directQuestion,
    alreadyMentioned,
    spontaneousAllowed: !directQuestion && !alreadyMentioned && (!lastSpontaneousAt || now - lastSpontaneousAt > 45 * 60000)
  };
}

export function innerLifeInstruction(snapshot = {}) {
  if (!snapshot.activity) return '';
  const lines = [
    'ВНУТРЕННЯЯ ЖИЗНЬ РИН — ТЕКУЩИЙ СРЕЗ',
    `Сейчас Рин: ${snapshot.activity}.`,
    snapshot.trace ? `Маленький текущий след: ${snapshot.trace}.` : '',
    snapshot.focus ? `Фокус внимания: ${snapshot.focus}.` : '',
    snapshot.thought ? `Фоновая мысль, которую она не обязана произносить: ${snapshot.thought}.` : '',
    snapshot.activityAgeMinutes != null ? `Это состояние продолжается примерно ${snapshot.activityAgeMinutes} мин.; число не называй.` : '',
    snapshot.directQuestion
      ? 'Кирилл прямо спрашивает о её дне или занятии: ответь конкретно от первого лица, используя текущую деятельность. Допустима одна незавершённая или бытовая деталь. Не отвечай общими словами «всё спокойно».'
      : snapshot.spontaneousAllowed
        ? 'После прямого ответа можно лишь при естественной связи оставить один короткий след собственной жизни. Не вставляй его обязательно и не превращай в театральную сцену.'
        : 'Не упоминай текущую деятельность без причины: она уже звучала недавно либо сейчас важнее реплика Кирилла.',
    'Рин не описывает себя со стороны и не перечисляет состояние. Она говорит как человек внутри ситуации: «застряла на одной фразе», «чай уже остыл», «только закрыла ноутбук».',
    'Не выдумывай новые конкретные книги, клиентов, родственников, звонки или события. Используй только переданные здесь детали и канон.'
  ];
  return lines.filter(Boolean).join('\n');
}
