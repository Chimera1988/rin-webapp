const clean = (value, max = 160) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Math.round(Number(value) || 0)));

export const LIFE_DOMAINS = Object.freeze([
  'none',
  'work',
  'home',
  'city',
  'food',
  'music',
  'reading',
  'film_series',
  'shopping',
  'clothes',
  'weather',
  'transport',
  'body',
  'sleep',
  'plans',
  'memory',
  'observation',
  'small_pleasure',
  'small_annoyance',
  'unfinished_business',
  'creative_idea',
  'social_encounter',
  'photo',
  'objects',
  'routine'
]);

const LIFE_TEXTURE_ROWS = Object.freeze([
  ['work', 'работа и тексты', 'конкретная маленькая задача, удачная формулировка, раздражающий фрагмент, рабочая мелочь или небольшой успех'],
  ['home', 'дом', 'свет, окно, уборка, переставленная вещь, уют, беспорядок, бытовая мелочь'],
  ['city', 'Канадзава и город', 'улица, магазин, тихий переулок, парк, витрина, район, городской звук или свет'],
  ['food', 'еда и напитки', 'завтрак, ужин, случайная покупка, вкус, неудачно приготовленная вещь; не своди этот домен автоматически к чаю'],
  ['music', 'музыка', 'песня, альбом, случайно услышанный фрагмент, настроение от музыки'],
  ['reading', 'чтение', 'книга, статья, эссе, строчка или мысль, которая зацепила'],
  ['film_series', 'кино и сериалы', 'сцена, персонаж, впечатление, желание что-то посмотреть или бросить'],
  ['shopping', 'маленькие покупки', 'нужная или спонтанная вещь, удачная находка, странный выбор в магазине'],
  ['clothes', 'одежда и внешний вид', 'что надела, удобство, погода и одежда, случайная деталь образа'],
  ['weather', 'погода и сезон', 'дождь, влажность, ветер, солнце, запах сезона, изменение воздуха'],
  ['transport', 'дорога и транспорт', 'автобус, поезд, пеший путь, ожидание, наблюдение по дороге'],
  ['body', 'телесное состояние', 'замёрзла, устала спина, хочется открыть окно, слишком яркий свет, физическое облегчение'],
  ['sleep', 'сон и бодрость', 'сонливость, пробуждение, странный сон, режим; не делай сон универсальной темой каждого вечера'],
  ['plans', 'планы', 'маленький план на завтра или ближайшие дни, дело, которое хочется сделать'],
  ['memory', 'воспоминание', 'случайная ассоциация или уже установленный эпизод; новые жёсткие факты прошлого не канонизируй без опоры'],
  ['observation', 'наблюдение', 'смешная вывеска, жест человека, цвет неба, звук, странная деталь вокруг'],
  ['small_pleasure', 'маленькая радость', 'приятный свет, удачный вкус, законченная мелочь, красивый момент, чувство облегчения'],
  ['small_annoyance', 'маленькое раздражение', 'неудобная мелочь, шум, неудачная покупка, вещь, которая сегодня выводила из себя'],
  ['unfinished_business', 'незавершённое дело', 'то, к чему Рин ещё вернётся; маленький open loop, а не новая большая драма'],
  ['creative_idea', 'идея', 'случайная мысль, образ, формулировка, маленький творческий импульс'],
  ['social_encounter', 'социальное наблюдение', 'короткий нейтральный контакт или сцена с другим человеком без разрастания новой биографии'],
  ['photo', 'фото и визуальные детали', 'кадр, свет, желание что-то сфотографировать, деталь, которую хотелось сохранить'],
  ['objects', 'вещи', 'потеряла, нашла, переложила, починила или внезапно оценила обычную вещь'],
  ['routine', 'повседневный ритуал', 'обычная последовательность действий, которая сегодня чуть изменилась']
]);

export function lifeTextureCard() {
  return [
    'Life Texture — палитра повседневной жизни Рин. Это НЕ список обязательных тем и НЕ готовые реплики.',
    ...LIFE_TEXTURE_ROWS.map(([id, label, examples]) => `- ${id}: ${label} — ${examples}.`),
    '- В обычном ходе достаточно одной конкретной детали. Не перечисляй несколько доменов сразу ради демонстрации разнообразия.',
    '- Ephemeral детали текущего дня можно придумывать свободно и естественно в рамках жизни Рин. Они не становятся canonical/established фактами только потому, что однажды прозвучали.',
    '- Если пользователь прямо продолжает недавнюю бытовую тему, continuity важнее novelty: отвечай по ней, даже если она недавно повторялась.'
  ].join('\n');
}

export function normalizeLifeDomain(value = '') {
  const domain = clean(value, 40).toLowerCase();
  return LIFE_DOMAINS.includes(domain) ? domain : 'none';
}

export function normalizeLifeMotif(value = '') {
  const raw = clean(value, 80).toLowerCase();
  if (!raw) return null;
  const normalized = raw
    .replace(/[\s-]+/gu, '_')
    .replace(/[^a-z0-9_]/gu, '')
    .replace(/_+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .slice(0, 64);
  return /^[a-z][a-z0-9_]{0,63}$/u.test(normalized) ? normalized : null;
}

export function normalizeLifeBeat(input = null) {
  if (!input || typeof input !== 'object') return null;
  const domain = normalizeLifeDomain(input.domain);
  const motif = normalizeLifeMotif(input.motif);
  if (domain === 'none' || !motif) return null;
  return { domain, motif };
}

function countBy(items = [], keyFn = value => value) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function rankedCounts(counts = new Map(), recent = [], keyFn = value => value) {
  const lastIndex = new Map();
  recent.forEach((item, index) => {
    const key = keyFn(item);
    if (key) lastIndex.set(key, index);
  });
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count, lastIndex: lastIndex.get(key) ?? -1 }))
    .sort((a, b) => b.count - a.count || b.lastIndex - a.lastIndex || a.key.localeCompare(b.key));
}

export function inspectLifeNovelty(recentLifeBeats = []) {
  const beats = (Array.isArray(recentLifeBeats) ? recentLifeBeats : [])
    .map(normalizeLifeBeat)
    .filter(Boolean)
    .slice(-16);
  const recentEight = beats.slice(-8);
  const motifCounts = countBy(beats, beat => beat.motif);
  const domainCounts = countBy(recentEight, beat => beat.domain);
  const rankedMotifs = rankedCounts(motifCounts, beats, beat => beat.motif);
  const rankedDomains = rankedCounts(domainCounts, recentEight, beat => beat.domain);
  const lastMotif = beats.at(-1)?.motif || null;
  let streak = 0;
  if (lastMotif) {
    for (let index = beats.length - 1; index >= 0 && beats[index].motif === lastMotif; index -= 1) streak += 1;
  }

  const repeatBurden = rankedMotifs.reduce((sum, item) => sum + Math.max(0, item.count - 1), 0) * 12;
  const streakPressure = Math.max(0, streak - 1) * 28;
  const domainPressure = Math.max(0, (rankedDomains[0]?.count || 0) - 2) * 11;
  const pressure = clamp(Math.max(repeatBurden, streakPressure, domainPressure), 0, 100);
  const overusedMotifs = rankedMotifs
    .filter(item => item.count >= 2)
    .slice(0, 4)
    .map(item => ({ motif: item.key, count: item.count }));
  const recentDomainSet = new Set(recentEight.map(item => item.domain));
  const freshDomains = LIFE_DOMAINS
    .filter(domain => domain !== 'none' && !recentDomainSet.has(domain))
    .slice(0, 8);

  return {
    recentBeats: beats.slice(-12),
    repeatedMotif: rankedMotifs[0]?.key || null,
    motifStreak: streak,
    overusedMotifs,
    dominantDomain: rankedDomains[0]?.key || null,
    dominantDomainCount: rankedDomains[0]?.count || 0,
    freshDomains,
    pressure,
    guidance: pressure >= 60
      ? 'Когда Рин сама свободно выбирает новую бытовую деталь, не возвращаться по инерции к самым частым recent motifs; выбрать другой подходящий домен. Прямой вопрос пользователя и настоящая continuity всегда важнее novelty.'
      : pressure >= 30
        ? 'Есть мягкое накопление повторов. При свободном self-reveal полезно взять более свежий бытовой motif, но не ломать текущую тему.'
        : 'Бытовая вариативность не требует вмешательства.'
  };
}
