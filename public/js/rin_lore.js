
const DATA_URLS = {
  triggers: '/data/rin_triggers.json',
  memories: '/data/rin_memories.json',
  backstory: '/data/rin_backstory.json',
  phrases: '/data/rin_phrases.json',
  schedule: '/data/rin_schedule.json'
};

let cache = null;
const RECENT_LORE_KEY = 'rin-lore-recent-v1';
const DAY_STORIES_KEY = 'rin-day-stories-v1';

const DAY_STORY_TEMPLATES = [
  {
    topic: 'сложная глава',
    morning: 'У меня сегодня упрямая глава: одно предложение никак не хочет звучать по-человечески.',
    day: 'Кажется, я наконец нашла ритм для той сложной главы. Иногда текст сдаётся, если ненадолго от него отойти.',
    evening: 'Я всё-таки закончила ту упрямую главу. Последняя правка оказалась совсем маленькой — и именно её не хватало.'
  },
  {
    topic: 'дождливая прогулка',
    morning: 'В Канадзаве с утра дождь. Думаю после работы пройтись без спешки, если он станет тише.',
    day: 'Дождь стал мягче, и я всё-таки вышла за чаем. Воздух пахнет мокрым камнем и листьями.',
    evening: 'Та короткая прогулка под дождём неожиданно спасла мой вечер. Вернулась с холодными руками и ясной головой.'
  },
  {
    topic: 'акварель',
    morning: 'Я оставила рядом с рабочим столом акварель — хочу сегодня хотя бы на десять минут вернуться к ней.',
    day: 'В перерыве всё-таки взяла акварель. Получилось всего несколько серых и зелёных пятен, но они почему-то успокоили меня.',
    evening: 'Мои утренние десять минут с акварелью растянулись почти на час. Рисунок неровный, зато живой.'
  },
  {
    topic: 'семейный звонок',
    morning: 'Нацуми обещала сегодня позвонить. У неё обычно «на пять минут» превращается в целую семейную хронику.',
    day: 'Нацуми всё-таки позвонила — и, конечно, наши пять минут стали сорока. Я даже не заметила.',
    evening: 'После разговора с Нацуми дома почему-то стало тише, но по-хорошему. Семейные голоса ещё немного остаются в комнате.'
  }
];

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  return response.json();
}

export async function loadLoreData() {
  if (cache) return cache;

  const [triggers, memories, backstory, phrases, schedule] =
    await Promise.all([
      fetchJson(DATA_URLS.triggers),
      fetchJson(DATA_URLS.memories),
      fetchJson(DATA_URLS.backstory),
      fetchJson(DATA_URLS.phrases),
      fetchJson(DATA_URLS.schedule)
    ]);

  cache = { triggers, memories, backstory, phrases, schedule };
  return cache;
}

function normalize(text = '') {
  return String(text)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOPWORDS = new Set(
  'как дела это этот эта эти она он они оно кто что где когда почему зачем привет пока да нет хорошо просто очень сейчас сегодня там тут тебе тебя мне меня мой моя твой твоя про расскажи говорила говорил'.split(' ')
);

function stem(word) {
  if (word.length < 5) return word;
  return word.replace(/(иями|ями|ами|ого|ему|ому|ыми|ими|ией|ей|ой|ий|ый|ая|яя|ое|ее|ов|ев|ам|ям|ах|ях|ом|ем|у|ю|а|я|ы|и|е)$/u, '');
}

function words(text = '') {
  return new Set(
    normalize(text)
      .split(' ')
      .filter(word => word.length >= 3 && !STOPWORDS.has(word))
      .map(stem)
  );
}

function getRecent() {
  try {
    const value = JSON.parse(
      localStorage.getItem(RECENT_LORE_KEY) || '[]'
    );
    return Array.isArray(value) ? value.slice(0, 12) : [];
  } catch {
    return [];
  }
}

function remember(ids = []) {
  try {
    const next = [
      ...ids,
      ...getRecent()
    ].filter(Boolean);

    localStorage.setItem(
      RECENT_LORE_KEY,
      JSON.stringify([...new Set(next)].slice(0, 12))
    );
  } catch {}
}

function scoreText(candidate, userWords, normalizedUser) {
  const candidateNorm = normalize(candidate);
  const candidateWords = words(candidateNorm);
  let score = 0;

  for (const word of userWords) {
    if (candidateWords.has(word)) score += word.length >= 7 ? 4 : 3;
    else if ([...candidateWords].some(value => value.startsWith(word) || word.startsWith(value))) score += 1;
  }

  if (
    normalizedUser.includes('сест') &&
    candidateNorm.includes('нацуми')
  ) {
    score += 8;
  }

  if (
    normalizedUser.includes('кицун') &&
    /кицун|лис/.test(candidateNorm)
  ) {
    score += 6;
  }

  if (
    /перевод|редактор|работ/.test(normalizedUser) &&
    /перевод|редактор|текст|рукопис/.test(candidateNorm)
  ) {
    score += 5;
  }

  return score;
}

function collectBackstory(backstory) {
  const result = [];

  for (const chapter of backstory?.chapters || []) {
    for (const [section, items] of Object.entries(
      chapter?.sections || {}
    )) {
      for (const text of Array.isArray(items) ? items : []) {
        result.push({
          id: `backstory:${chapter.title}:${section}:${text.slice(0, 40)}`,
          chapter: chapter.title,
          years: chapter.years,
          section,
          text
        });
      }
    }
  }

  return result;
}

function collectMemories(memories) {
  const result = [];

  for (const text of memories?.core_memories || []) {
    result.push({
      id: `memory:core:${text.slice(0, 50)}`,
      bucket: 'core',
      text
    });
  }

  for (const bucket of memories?.buckets || []) {
    for (const text of bucket?.memories || []) {
      result.push({
        id: `memory:${bucket.id}:${text.slice(0, 50)}`,
        bucket: bucket.id,
        title: bucket.title,
        years: bucket.years,
        text
      });
    }
  }

  return result;
}

function matchedTriggers(triggers, normalizedUser) {
  const matches = [];

  for (const [id, rule] of Object.entries(triggers || {})) {
    if (!rule || !Array.isArray(rule.keywords)) continue;

    const userWords = words(normalizedUser);
    const hits = rule.keywords.filter(keyword => {
      const normalizedKeyword = normalize(keyword);
      if (normalizedKeyword.includes(' ')) return normalizedUser.includes(normalizedKeyword);
      const keywordStem = stem(normalizedKeyword);
      return userWords.has(keywordStem) || [...userWords].some(word => word.startsWith(keywordStem) || keywordStem.startsWith(word));
    });

    if (hits.length) {
      matches.push({
        id,
        hits,
        chapterHint: rule.chapterHint || '',
        sectionHint: rule.sectionHint || ''
      });
    }
  }

  return matches.sort((a, b) => b.hits.length - a.hits.length);
}

export async function buildLorePayload(userText, {
  maxMemories = 2,
  maxBackstory = 2
} = {}) {
  const data = await loadLoreData();
  const normalizedUser = normalize(userText);
  const userWords = words(userText);
  const triggers = matchedTriggers(
    data.triggers,
    normalizedUser
  );

  const recent = new Set(getRecent());

  // Короткие реплики без содержательной темы не должны вытаскивать биографию.
  if (!userWords.size && !triggers.length) {
    return { matchedTriggers: [], memories: [], backstory: [] };
  }

  const memoryCandidates = collectMemories(data.memories)
    .map(item => ({
      ...item,
      score: scoreText(`${item.title || ''} ${item.text}`, userWords, normalizedUser)
    }))
    .filter(item => item.score >= 3 && !recent.has(item.id))
    .sort((a, b) => b.score - a.score);

  const backstoryCandidates = collectBackstory(data.backstory)
    .map(item => ({
      ...item,
      score: scoreText(
        `${item.chapter} ${item.section} ${item.text}`,
        userWords,
        normalizedUser
      )
    }))
    .filter(item => item.score >= 3 && !recent.has(item.id))
    .sort((a, b) => b.score - a.score);

  const selectedMemories = memoryCandidates
    .slice(0, maxMemories)
    .map(({ id, bucket, title, years, text }) => ({
      id, bucket, title, years, text
    }));

  const selectedBackstory = backstoryCandidates
    .slice(0, maxBackstory)
    .map(({ id, chapter, years, section, text }) => ({
      id, chapter, years, section, text
    }));

  remember([
    ...selectedMemories.map(item => item.id),
    ...selectedBackstory.map(item => item.id)
  ]);

  return {
    matchedTriggers: triggers.slice(0, 4),
    memories: selectedMemories,
    backstory: selectedBackstory
  };
}

export async function getSchedule() {
  const data = await loadLoreData();
  return data.schedule || null;
}

function monthKey(date) {
  return [
    'january', 'february', 'march', 'april',
    'may', 'june', 'july', 'august',
    'september', 'october', 'november', 'december'
  ][date.getMonth()];
}

function pick(items = []) {
  if (!Array.isArray(items) || !items.length) return null;
  return items[Math.floor(Math.random() * items.length)];
}

function dayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function loadDayStories() {
  try {
    const value = JSON.parse(localStorage.getItem(DAY_STORIES_KEY) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

export function getOrCreateDayStory(rinDate = new Date()) {
  const key = dayKey(rinDate);
  const stories = loadDayStories();
  if (!stories[key]) {
    const seed = Number(key.replace(/-/g, '')) || 0;
    const template = DAY_STORY_TEMPLATES[seed % DAY_STORY_TEMPLATES.length];
    stories[key] = { ...template, createdAt: Date.now(), mentioned: [] };
    const recentKeys = Object.keys(stories).sort().slice(-7);
    const compact = Object.fromEntries(recentKeys.map(item => [item, stories[item]]));
    try { localStorage.setItem(DAY_STORIES_KEY, JSON.stringify(compact)); } catch {}
  }
  return { key, story: stories[key] };
}

function pickDayStoryPhrase(pool, rinDate) {
  const { key, story } = getOrCreateDayStory(rinDate);
  const stage = ['morning', 'day', 'evening'].includes(pool) ? pool : null;
  if (!stage || !story?.[stage] || story.mentioned?.includes(stage)) return null;
  if (Math.random() >= 0.55) return null;
  const stories = loadDayStories();
  stories[key] = { ...story, mentioned: [...(story.mentioned || []), stage] };
  try { localStorage.setItem(DAY_STORIES_KEY, JSON.stringify(stories)); } catch {}
  return story[stage];
}

export async function pickInitiationPhrase(
  pool,
  rinDate = new Date()
) {
  const data = await loadLoreData();
  const phrases = data.phrases || {};

  const poolItems =
    phrases[pool] ||
    (pool === 'night' ? phrases.night : null) ||
    [];

  const monthly =
    phrases.month_special?.[monthKey(rinDate)] || [];

  // Сначала создаётся и сохраняется событие дня, затем оно может быть упомянуто.
  const dayStory = pickDayStoryPhrase(pool, rinDate);
  if (dayStory) return dayStory;

  // Сезонная фраза появляется редко.
  if (monthly.length && Math.random() < 0.18) {
    return pick(monthly);
  }

  return pick(poolItems);
}

export async function pickGreeting(
  pool,
  rinDate = new Date()
) {
  return pickInitiationPhrase(pool, rinDate);
}
