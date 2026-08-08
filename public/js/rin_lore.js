import { fetchWithTimeout } from './http_client.js';


const DATA_URLS = {
  triggers: '/data/rin_triggers.json',
  memories: '/data/rin_memories.json',
  backstory: '/data/rin_backstory.json',
  phrases: '/data/rin_phrases.json',
  schedule: '/data/rin_schedule.json'
};

let cache = null;
const RECENT_LORE_KEY = 'rin-lore-recent-v1';

export function resetLoreCache() {
  cache = null;
  try { localStorage.removeItem(RECENT_LORE_KEY); } catch {}
}

async function fetchJson(url) {
  const response = await fetchWithTimeout(url, { cache: 'no-store' }, 12_000);
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

function words(text = '') {
  return new Set(
    normalize(text)
      .split(' ')
      .filter(word => word.length >= 3)
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
  let score = 0;

  for (const word of userWords) {
    if (candidateNorm.includes(word)) {
      score += word.length >= 7 ? 3 : 1;
    }
  }

  if (
    normalizedUser.includes('сест') &&
    candidateNorm.includes('нацуми')
  ) {
    score += 6;
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

    const hits = rule.keywords.filter(keyword =>
      normalizedUser.includes(normalize(keyword))
    );

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

  const triggerTerms = new Set(
    triggers.flatMap(item => [
      item.id,
      ...item.hits,
      item.chapterHint,
      item.sectionHint
    ]).map(normalize).filter(Boolean)
  );

  const expandedWords = new Set([
    ...userWords,
    ...triggerTerms
  ]);

  const recent = new Set(getRecent());

  const memoryCandidates = collectMemories(data.memories)
    .map(item => ({
      ...item,
      score: scoreText(item.text, expandedWords, normalizedUser)
    }))
    .filter(item => item.score > 0 && !recent.has(item.id))
    .sort((a, b) => b.score - a.score);

  const backstoryCandidates = collectBackstory(data.backstory)
    .map(item => ({
      ...item,
      score: scoreText(
        `${item.chapter} ${item.section} ${item.text}`,
        expandedWords,
        normalizedUser
      )
    }))
    .filter(item => item.score > 0 && !recent.has(item.id))
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

  return {
    matchedTriggers: triggers.slice(0, 4),
    memories: selectedMemories,
    backstory: selectedBackstory,
    _selectedIds: [
      ...selectedMemories.map(item => item.id),
      ...selectedBackstory.map(item => item.id)
    ]
  };
}

export function commitLorePayload(payload = null) {
  if (!payload || typeof payload !== 'object') return false;
  const ids = Array.isArray(payload._selectedIds) ? payload._selectedIds : [];
  if (!ids.length) return false;
  remember(ids);
  return true;
}

export function lorePayloadForApi(payload = null) {
  if (!payload || typeof payload !== 'object') return null;
  return {
    matchedTriggers: Array.isArray(payload.matchedTriggers) ? payload.matchedTriggers : [],
    memories: Array.isArray(payload.memories) ? payload.memories : [],
    backstory: Array.isArray(payload.backstory) ? payload.backstory : []
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
