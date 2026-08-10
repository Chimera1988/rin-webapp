import { readFile } from 'node:fs/promises';

const MEMORIES_URL = new URL('../../public/data/rin_memories.json', import.meta.url);
const BACKSTORY_URL = new URL('../../public/data/rin_backstory.json', import.meta.url);
const TRIGGERS_URL = new URL('../../public/data/rin_triggers.json', import.meta.url);
const PROFILE_URL = new URL('../../public/data/rin_prompt_profile.json', import.meta.url);

let cached = null;

const clean = (value, max = 1200) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const normalize = (value = '') => clean(value, 5000)
  .toLowerCase()
  .replace(/ё/g, 'е')
  .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const STOPWORDS = new Set('как что это ты тебя твой твоя твое твоё твои меня мне мой моя мое моё мои мы вы он она они тут там где когда почему зачем какой какая какие который которая которые расскажи рассказать история историю про для или если еще ещё уже просто сейчас сегодня тогда быть был была были есть очень можно хочу хочешь называешь называю зовут'.split(' '));

function words(value = '') {
  return new Set(normalize(value).split(' ').filter(word => word.length >= 3 && !STOPWORDS.has(word)));
}

async function loadCanonData({ fresh = false } = {}) {
  if (cached && !fresh) return cached;
  const [memories, backstory, triggers, profile] = await Promise.all([
    readFile(MEMORIES_URL, 'utf8').then(JSON.parse),
    readFile(BACKSTORY_URL, 'utf8').then(JSON.parse),
    readFile(TRIGGERS_URL, 'utf8').then(JSON.parse),
    readFile(PROFILE_URL, 'utf8').then(JSON.parse)
  ]);
  cached = Object.freeze({ memories, backstory, triggers, profile });
  return cached;
}

function collectMemories(memories = {}) {
  const result = [];
  for (const text of memories.core_memories || []) {
    if (clean(text)) result.push({ id: `memory:core:${clean(text, 60)}`, bucket: 'core', text: clean(text, 1200) });
  }
  for (const bucket of memories.buckets || []) {
    for (const text of bucket?.memories || []) {
      if (!clean(text)) continue;
      result.push({
        id: `memory:${clean(bucket.id, 80)}:${clean(text, 60)}`,
        bucket: clean(bucket.id, 80) || null,
        title: clean(bucket.title, 120) || null,
        years: clean(bucket.years, 80) || null,
        text: clean(text, 1200)
      });
    }
  }
  return result;
}

function collectBackstory(backstory = {}) {
  const result = [];
  for (const chapter of backstory.chapters || []) {
    for (const [section, items] of Object.entries(chapter?.sections || {})) {
      for (const text of Array.isArray(items) ? items : []) {
        if (!clean(text)) continue;
        result.push({
          id: `backstory:${clean(chapter.title, 100)}:${clean(section, 80)}:${clean(text, 50)}`,
          chapter: clean(chapter.title, 120) || null,
          years: clean(chapter.years, 80) || null,
          section: clean(section, 100) || null,
          text: clean(text, 1200)
        });
      }
    }
  }
  return result;
}

function collectProfileCanon(profile = {}) {
  const identity = profile.identity || {};
  const canon = profile.canon || {};
  const relationship = profile.relationship || {};
  const result = [];
  const add = (section, text, aliases = '') => {
    const value = clean(text, 1200);
    if (!value) return;
    result.push({ id: `profile:${section}`, section, text: value, aliases: clean(aliases, 500) || null });
  };
  add('identity.name', `${identity.full_name || 'Рин Акихара'}; японское имя ${identity.name_japanese || '秋原 凛'}`, 'имя как зовут Рин');
  add('identity.origin', `Родилась ${identity.birthdate || ''} в ${identity.birthplace || ''}; живёт: ${identity.location || ''}; национальность: ${identity.nationality || ''}`, 'родилась день рождения возраст Канадзава где живёт откуда');
  add('identity.languages', (identity.languages || []).join('; '), 'языки русский японский английский говорит');
  add('canon.occupation', canon.occupation, 'работа профессия редактор переводы издательство чем занимается');
  add('canon.home', canon.home, 'дом квартира живёт быт');
  add('canon.daily_life', (canon.daily_life || []).join('; '), 'повседневность обычный день привычки');
  add('canon.likes', (canon.likes || []).join('; '), 'любит нравится хобби увлечения интересы');
  add('canon.dislikes', (canon.dislikes || []).join('; '), 'не любит не нравится раздражает');
  add('relationship.history', relationship.history, 'знакомство отношения история ICQ давно знакомы');
  add('relationship.private_name', relationship.private_name, 'Хикари Ринсей личное имя как называешь меня');
  return result;
}

function matchedTriggers(triggers = {}, query = '') {
  const normalizedQuery = normalize(query);
  const result = [];
  for (const [id, rule] of Object.entries(triggers || {})) {
    const hits = (Array.isArray(rule?.keywords) ? rule.keywords : [])
      .filter(keyword => normalizedQuery.includes(normalize(keyword)));
    if (!hits.length) continue;
    result.push({
      id: clean(id, 80),
      hits: hits.map(item => clean(item, 80)),
      chapterHint: clean(rule.chapterHint, 120) || null,
      sectionHint: clean(rule.sectionHint, 120) || null
    });
  }
  return result.sort((a, b) => b.hits.length - a.hits.length).slice(0, 4);
}

function scoreText(candidate = '', queryWords = new Set(), query = '', triggerTerms = new Set()) {
  const candidateNorm = normalize(candidate);
  if (!candidateNorm) return 0;
  let score = 0;
  for (const word of queryWords) {
    if (candidateNorm.includes(word)) score += word.length >= 7 ? 3 : 1;
  }
  for (const term of triggerTerms) {
    if (term && candidateNorm.includes(term)) score += 3;
  }
  if (/сест/u.test(query) && /нацуми/u.test(candidateNorm)) score += 8;
  const asksKitsune = /кицун|(?:^|\s)лис(?:а|ы|у|е|ой|ами)?(?:\s|$)|лисиц/u.test(query);
  const candidateKitsune = /кицун|(?:^|\s)лис(?:а|ы|у|е|ой|ами)?(?:\s|$)|лисиц/u.test(candidateNorm);
  if (asksKitsune && candidateKitsune) score += 7;
  if (/перевод|редактор|работ/u.test(query) && /перевод|редактор|издатель|рукопис|работ/u.test(candidateNorm)) score += 6;
  const asksUserPrivateName = /хикари|ринсей|как.{0,30}меня.{0,30}(?:называ|зов)|(?:мо[её]|мое) имя/u.test(query);
  if (asksUserPrivateName && /хикари|ринсей/u.test(candidateNorm)) score += 12;
  if (/родител|отец|мать|семь/u.test(query) && /такеш|эми|родител|семь/u.test(candidateNorm)) score += 7;
  return score;
}

function profileSectionBoost(section = '', query = '') {
  if (section === 'relationship.private_name') return /хикари|ринсей|как.{0,30}меня.{0,30}(?:называ|зов)|(?:мо[её]|мое) имя/u.test(query) ? 16 : 0;
  if (section === 'identity.name') return /как.{0,20}тебя.{0,20}зов|тво[её] имя|имя рин/u.test(query) ? 12 : 0;
  if (section === 'identity.origin') return /родил|день рожден|возраст|откуда|где.{0,12}жив|канадзав/u.test(query) ? 9 : 0;
  if (section === 'identity.languages') return /язык|говориш|русск|японск|английск/u.test(query) ? 9 : 0;
  if (section === 'canon.occupation') return /работ|професс|занима|редактор|перевод/u.test(query) ? 10 : 0;
  if (section === 'canon.home') return /дом|квартир|где.{0,12}жив|жиль/u.test(query) ? 9 : 0;
  if (section === 'canon.daily_life') return /обычн.{0,10}день|повседнев|привыч|чем.{0,15}вечер/u.test(query) ? 7 : 0;
  if (section === 'canon.likes') return /люб|нрав|хобб|увлеч|интерес/u.test(query) ? 10 : 0;
  if (section === 'canon.dislikes') return /не люб|не нрав|раздраж|терпеть не/u.test(query) ? 11 : 0;
  if (section === 'relationship.history') return /как.{0,20}познаком|давно.{0,15}знаком|icq|истори.{0,15}(?:нас|отнош)/u.test(query) ? 9 : 0;
  return 0;
}

export async function retrieveCanonicalLore(query = '', { maxMemories = 2, maxBackstory = 2, maxCanon = 3, fresh = false } = {}) {
  const data = await loadCanonData({ fresh });
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return { source: 'server_canon_store', matchedTriggers: [], canon: [], memories: [], backstory: [] };
  const queryWords = words(query);
  const triggers = matchedTriggers(data.triggers, query);
  const triggerTerms = new Set(triggers.flatMap(item => [item.id, ...(item.hits || []), item.chapterHint, item.sectionHint]).map(normalize).filter(Boolean));

  const canon = collectProfileCanon(data.profile)
    .map(item => ({ ...item, score: scoreText(`${item.aliases || ''} ${item.text}`, queryWords, normalizedQuery, triggerTerms) + profileSectionBoost(item.section, normalizedQuery) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id, 'ru'))
    .slice(0, Math.max(0, maxCanon))
    .map(({ score, aliases, ...item }) => item);

  const memories = collectMemories(data.memories)
    .map(item => ({ ...item, score: scoreText(`${item.title || ''} ${item.text}`, queryWords, normalizedQuery, triggerTerms) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id, 'ru'))
    .slice(0, Math.max(0, maxMemories))
    .map(({ score, ...item }) => item);

  const backstory = collectBackstory(data.backstory)
    .map(item => ({ ...item, score: scoreText(`${item.chapter || ''} ${item.section || ''} ${item.text}`, queryWords, normalizedQuery, triggerTerms) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id, 'ru'))
    .slice(0, Math.max(0, maxBackstory))
    .map(({ score, ...item }) => item);

  return { source: 'server_canon_store', matchedTriggers: triggers, canon, memories, backstory };
}

export function resetCanonicalLoreCache() { cached = null; }
