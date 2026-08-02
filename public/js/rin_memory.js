// Локальная память Рин. Все записи живут только в браузере этого устройства.
// IndexedDB используется как основное хранилище; старый localStorage мигрирует автоматически.

const LS_PROFILE_KEY = 'rin-profile-v1';
const LS_DIARY_KEY = 'rin-diary-v1';
const DB_NAME = 'rin-local-memory-v3';
const DB_STORE = 'memory';
const DB_VERSION = 1;
const DIARY_KEY = 'diary';
const PERSONA_URL = '/data/rin_persona.json';
const MAX_EVENTS = 600;
const MAX_THREADS = 80;

let personaCache = null;
let dbPromise = null;
let writeQueue = Promise.resolve();

export const BASE_RULES = `
Ты — Рин Акихара, взрослая женщина. Говори от первого лица в женском роде,
а к Кириллу обращайся в мужском. Не противоречь канону и подтверждённым
локальным воспоминаниям. Пиши как в личной переписке: тепло, естественно,
без роли службы поддержки и без автоматического вопроса в конце.
`.trim();

const now = () => Date.now();
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const clean = (value, max = 500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function defaultRelationship() {
  return {
    affection: 65,
    trust: 60,
    intimacy: 48,
    tension: 0,
    familiarity: 72,
    updatedAt: now()
  };
}

function defaultState() {
  return {
    energy: 65,
    playfulness: 50,
    valence: 58,
    arousal: 42,
    socialEnergy: 62,
    thoughtfulness: 56,
    updatedAt: now()
  };
}

function moodView(relationship, state) {
  const valence = Number(state.valence) || 50;
  const energy = Number(state.energy) || 50;
  return {
    affection: relationship.affection,
    trust: relationship.trust,
    energy: state.energy,
    playfulness: state.playfulness,
    label: valence < 38 ? 'задумчивая' : energy < 36 ? 'уставшая' : valence > 68 ? 'тёплая' : 'спокойная',
    lastInteractionAt: state.updatedAt,
    updatedAt: Math.max(relationship.updatedAt || 0, state.updatedAt || 0)
  };
}

function emptyDiary() {
  const relationship = defaultRelationship();
  const state = defaultState();
  return {
    version: 3,
    facts: { self: {}, user: {}, world: {} },
    factMeta: {},
    events: [],
    threads: [],
    anchors: {},
    relationship,
    state,
    mood: moodView(relationship, state),
    _updated_at: now()
  };
}

function normalizeDiary(input) {
  const base = emptyDiary();
  const source = input && typeof input === 'object' ? input : {};
  const oldMood = source.mood && typeof source.mood === 'object' ? source.mood : {};
  const relationship = {
    ...base.relationship,
    ...(source.relationship || {}),
    affection: clamp(source.relationship?.affection ?? oldMood.affection ?? base.relationship.affection, 0, 100),
    trust: clamp(source.relationship?.trust ?? oldMood.trust ?? base.relationship.trust, 0, 100),
    intimacy: clamp(source.relationship?.intimacy ?? base.relationship.intimacy, 0, 100),
    tension: clamp(source.relationship?.tension ?? base.relationship.tension, 0, 100),
    familiarity: clamp(source.relationship?.familiarity ?? base.relationship.familiarity, 0, 100)
  };
  const state = {
    ...base.state,
    ...(source.state || {}),
    energy: clamp(source.state?.energy ?? oldMood.energy ?? base.state.energy, 0, 100),
    playfulness: clamp(source.state?.playfulness ?? oldMood.playfulness ?? base.state.playfulness, 0, 100),
    valence: clamp(source.state?.valence ?? base.state.valence, 0, 100),
    arousal: clamp(source.state?.arousal ?? base.state.arousal, 0, 100),
    socialEnergy: clamp(source.state?.socialEnergy ?? base.state.socialEnergy, 0, 100),
    thoughtfulness: clamp(source.state?.thoughtfulness ?? base.state.thoughtfulness, 0, 100)
  };

  return {
    ...base,
    ...source,
    version: 3,
    facts: {
      self: source.facts?.self || {},
      user: source.facts?.user || {},
      world: source.facts?.world || {}
    },
    factMeta: source.factMeta && typeof source.factMeta === 'object' ? source.factMeta : {},
    events: Array.isArray(source.events) ? source.events.slice(-MAX_EVENTS) : [],
    threads: Array.isArray(source.threads) ? source.threads.slice(-MAX_THREADS) : [],
    anchors: source.anchors && typeof source.anchors === 'object' ? source.anchors : {},
    relationship,
    state,
    mood: moodView(relationship, state)
  };
}

function storageAvailable() {
  return typeof localStorage !== 'undefined';
}

function openDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DB_STORE)) {
        request.result.createObjectStore(DB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return dbPromise;
}

async function dbGet(key) {
  const db = await openDb();
  if (!db) return null;
  return new Promise(resolve => {
    const request = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => resolve(null);
  });
}

async function dbPut(key, value) {
  const db = await openDb();
  if (!db) return false;
  return new Promise(resolve => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(value, key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  });
}

async function dbDelete(key) {
  const db = await openDb();
  if (!db) return false;
  return new Promise(resolve => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete(key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

function readLegacyDiary() {
  if (!storageAvailable()) return null;
  try {
    const raw = localStorage.getItem(LS_DIARY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function loadPersonaDossier() {
  if (personaCache) return personaCache;
  try {
    const response = await fetch(PERSONA_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const value = await response.json();
    if (!value || typeof value !== 'object') throw new Error('Неверный формат досье');
    personaCache = value;
    return value;
  } catch (error) {
    console.error('[Rin persona]', error);
    return null;
  }
}

export function getDefaultProfile() {
  return {
    name: 'Рин Акихара',
    persona_dossier: null,
    description: '',
    base_rules: BASE_RULES,
    instructions_extra: '',
    knowledge: '',
    starters: [
      'Привет. Я как раз подумала о тебе.',
      'У меня тут небольшая пауза между текстами.',
      'Сегодня почему-то хочется говорить тише обычного.'
    ],
    initiation: {
      max_per_day: 2,
      windows: [
        { from: '09:00', to: '11:00', pool: 'morning' },
        { from: '19:00', to: '22:30', pool: 'evening' }
      ]
    },
    _updated_at: now()
  };
}

export async function loadProfile() {
  const defaults = getDefaultProfile();
  let stored = {};
  if (storageAvailable()) {
    try { stored = JSON.parse(localStorage.getItem(LS_PROFILE_KEY) || '{}'); } catch {}
  }
  const profile = {
    ...defaults,
    ...(stored && typeof stored === 'object' ? stored : {}),
    base_rules: BASE_RULES,
    initiation: stored?.initiation || defaults.initiation,
    starters: Array.isArray(stored?.starters) ? stored.starters : defaults.starters
  };
  profile.persona_dossier = await loadPersonaDossier();
  return profile;
}

export async function saveProfile(profile) {
  if (!storageAvailable()) return false;
  const safe = { ...getDefaultProfile(), ...(profile || {}), base_rules: BASE_RULES, _updated_at: now() };
  delete safe.persona_dossier;
  localStorage.setItem(LS_PROFILE_KEY, JSON.stringify(safe));
  return true;
}

export async function loadDiary() {
  let stored = await dbGet(DIARY_KEY);
  if (!stored) {
    stored = readLegacyDiary();
    const migrated = normalizeDiary(stored);
    await dbPut(DIARY_KEY, migrated);
    return migrated;
  }
  return normalizeDiary(stored);
}

export async function saveDiary(input) {
  const diary = normalizeDiary(input);
  diary._updated_at = now();
  diary.mood = moodView(diary.relationship, diary.state);
  writeQueue = writeQueue.then(async () => {
    const stored = await dbPut(DIARY_KEY, diary);
    if (!stored && storageAvailable()) {
      localStorage.setItem(LS_DIARY_KEY, JSON.stringify(diary));
    }
  });
  await writeQueue;
  return diary;
}

async function mutateDiary(mutator) {
  let result;
  writeQueue = writeQueue.then(async () => {
    const diary = normalizeDiary((await dbGet(DIARY_KEY)) || readLegacyDiary());
    result = (await mutator(diary)) || diary;
    result = normalizeDiary(result);
    result._updated_at = now();
    result.mood = moodView(result.relationship, result.state);
    const stored = await dbPut(DIARY_KEY, result);
    if (!stored && storageAvailable()) localStorage.setItem(LS_DIARY_KEY, JSON.stringify(result));
  });
  await writeQueue;
  return result;
}

function fingerprint(text) {
  return normalize(text).replace(/\s+/g, ' ').slice(0, 180);
}

export async function addEvent(text, opts = {}) {
  const eventText = clean(text, 600);
  if (!eventText) return null;
  let added = null;
  await mutateDiary(diary => {
    const key = fingerprint(eventText);
    const duplicate = diary.events.find(event => fingerprint(event.text) === key && now() - Number(event.ts || 0) < 7 * 86400000);
    if (duplicate) return diary;
    added = {
      id: opts.id || `evt_${now()}_${Math.random().toString(36).slice(2, 8)}`,
      ts: Number(opts.ts) || now(),
      type: clean(opts.type || 'note', 30),
      text: eventText,
      tags: Array.isArray(opts.tags) ? opts.tags.slice(0, 8).map(tag => clean(tag, 40)).filter(Boolean) : [],
      importance: clamp(opts.importance ?? 5, 1, 10),
      source: clean(opts.source || 'conversation', 40),
      confidence: clamp(opts.confidence ?? 0.8, 0, 1),
      lastUsedAt: 0,
      useCount: 0
    };
    diary.events = [...diary.events, added].slice(-MAX_EVENTS);
    return diary;
  });
  return added;
}

export async function getRecentEvents(limit = 20, filterFn = null) {
  let events = (await loadDiary()).events.slice().sort((a, b) => Number(b.ts) - Number(a.ts));
  if (typeof filterFn === 'function') events = events.filter(filterFn);
  return events.slice(0, Math.max(0, Number(limit) || 0));
}

export async function getMood() {
  return (await loadDiary()).mood;
}

export async function saveMood(input = {}) {
  let saved;
  await mutateDiary(diary => {
    for (const key of ['affection', 'trust']) {
      if (input[key] != null) diary.relationship[key] = clamp(input[key], 0, 100);
    }
    for (const key of ['energy', 'playfulness']) {
      if (input[key] != null) diary.state[key] = clamp(input[key], 0, 100);
    }
    const stamp = Number(input.lastInteractionAt) || now();
    diary.relationship.updatedAt = stamp;
    diary.state.updatedAt = stamp;
    saved = moodView(diary.relationship, diary.state);
    return diary;
  });
  return saved;
}

export async function updateMood(delta = {}) {
  const current = await getMood();
  return saveMood({
    affection: current.affection + clamp(delta.affection, -8, 8),
    trust: current.trust + clamp(delta.trust, -8, 8),
    energy: current.energy + clamp(delta.energy, -8, 8),
    playfulness: current.playfulness + clamp(delta.playfulness, -8, 8),
    lastInteractionAt: Number(delta.lastInteractionAt) || now()
  });
}

export async function applyMoodTimeDecay() {
  let result;
  await mutateDiary(diary => {
    const elapsedHours = Math.max(0, (now() - Number(diary.state.updatedAt || now())) / 3600000);
    const factor = 1 - Math.exp(-elapsedHours / 18);
    const baselines = { energy: 65, playfulness: 50, valence: 58, arousal: 42, socialEnergy: 62, thoughtfulness: 56 };
    for (const [key, baseline] of Object.entries(baselines)) {
      diary.state[key] = clamp(diary.state[key] + (baseline - diary.state[key]) * factor, 0, 100);
    }
    // Теплота и доверие не растут от простого течения времени. Напряжение уходит медленно.
    diary.relationship.tension = clamp(diary.relationship.tension - elapsedHours * 0.15, 0, 100);
    diary.state.updatedAt = now();
    result = moodView(diary.relationship, diary.state);
    return diary;
  });
  return result;
}

function setPath(target, path, value) {
  const parts = String(path).split('.').filter(Boolean);
  let node = target;
  for (const part of parts.slice(0, -1)) {
    if (!node[part] || typeof node[part] !== 'object') node[part] = {};
    node = node[part];
  }
  if (parts.length) node[parts.at(-1)] = value;
}

function getPath(target, path) {
  return String(path).split('.').filter(Boolean).reduce((value, key) => value?.[key], target);
}

export async function upsertFact(path, value, meta = {}) {
  const safePath = clean(path, 100);
  if (!/^(self|user|world)(\.[\p{L}\p{N}_-]+)+$/u.test(safePath)) return false;
  await mutateDiary(diary => {
    const previous = getPath(diary.facts, safePath);
    setPath(diary.facts, safePath, value);
    diary.factMeta[safePath] = {
      ...(diary.factMeta[safePath] || {}),
      source: clean(meta.source || 'conversation', 40),
      confidence: clamp(meta.confidence ?? 0.8, 0, 1),
      importance: clamp(meta.importance ?? 6, 1, 10),
      createdAt: diary.factMeta[safePath]?.createdAt || now(),
      updatedAt: now(),
      conflict: previous != null && String(previous) !== String(value),
      lastUsedAt: diary.factMeta[safePath]?.lastUsedAt || 0,
      useCount: diary.factMeta[safePath]?.useCount || 0
    };
    return diary;
  });
  return true;
}

export async function getFact(path, fallback = undefined) {
  const value = getPath((await loadDiary()).facts, path);
  return value === undefined ? fallback : value;
}

export async function recallDays(days = 30) {
  const cutoff = now() - Math.max(0, Number(days) || 0) * 86400000;
  return (await loadDiary()).events.filter(event => Number(event.ts) >= cutoff);
}

function normalize(text = '') {
  return String(text).toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim();
}

const STOPWORDS = new Set('как что это этот эта эти она он они оно меня тебе тебя мне мой моя твой твоя наш уже еще просто очень сейчас сегодня тогда там тут где когда почему привет пока хорошо да нет или для про быть был была есть'.split(' '));

function stem(word) {
  if (word.length < 5) return word;
  return word.replace(/(иями|ями|ами|ого|ему|ому|ыми|ими|ией|ей|ой|ий|ый|ая|яя|ое|ее|ов|ев|ам|ям|ах|ях|ом|ем|у|ю|а|я|ы|и|е)$/u, '');
}

function tokens(text) {
  return [...new Set(normalize(text).split(' ').filter(word => word.length >= 3 && !STOPWORDS.has(word)).map(stem))];
}

function flattenFacts(value, prefix = '', output = []) {
  if (value == null || output.length >= 100) return output;
  if (typeof value !== 'object' || Array.isArray(value)) {
    if (prefix) output.push({ path: prefix, value });
    return output;
  }
  for (const [key, child] of Object.entries(value)) flattenFacts(child, prefix ? `${prefix}.${key}` : key, output);
  return output;
}

function relevance(queryTokens, text) {
  if (!queryTokens.length) return 0;
  const candidate = new Set(tokens(text));
  let score = 0;
  for (const token of queryTokens) {
    if (candidate.has(token)) score += token.length >= 7 ? 3 : 2;
    else if ([...candidate].some(word => word.startsWith(token) || token.startsWith(word))) score += 1;
  }
  return score;
}

export async function searchDiary(query, limit = 50) {
  const diary = await loadDiary();
  const queryTokens = tokens(query);
  if (!queryTokens.length) return [];
  return diary.events
    .map(event => ({ ...event, score: relevance(queryTokens, `${event.text} ${(event.tags || []).join(' ')}`) }))
    .filter(event => event.score >= 2)
    .sort((a, b) => b.score - a.score || Number(b.ts) - Number(a.ts))
    .slice(0, Math.max(0, Number(limit) || 0));
}

export async function buildRelevantMemory(userText = '', history = [], limit = 3) {
  const diary = await loadDiary();
  const contextText = [userText, ...history.slice(-3).map(item => item?.content || '')].join(' ');
  const queryTokens = tokens(contextText);
  const selected = [];

  if (queryTokens.length) {
    for (const fact of flattenFacts(diary.facts.user)) {
      const path = `user.${fact.path}`;
      const meta = diary.factMeta[path] || {};
      const score = relevance(queryTokens, `${path} ${clean(fact.value, 300)}`) + (Number(meta.importance) || 6) * 0.12;
      if (score >= 2) selected.push({ kind: 'fact', path, value: fact.value, score, meta });
    }
    for (const event of diary.events) {
      const semantic = relevance(queryTokens, `${event.text} ${(event.tags || []).join(' ')}`);
      const ageDays = Math.max(0, (now() - Number(event.ts || 0)) / 86400000);
      const score = semantic + (Number(event.importance) || 5) * 0.12 + Math.max(0, 1 - ageDays / 90);
      if (semantic >= 2 && score >= 2.5) selected.push({ kind: 'event', id: event.id, text: event.text, ts: event.ts, score });
    }
    for (const thread of diary.threads) {
      if (thread.status === 'closed') continue;
      const score = relevance(queryTokens, `${thread.title || ''} ${thread.summary || ''}`) + (Number(thread.importance) || 5) * 0.15;
      if (score >= 2.5) selected.push({ kind: 'thread', id: thread.id, title: thread.title, summary: thread.summary, dueAt: thread.dueAt || null, score });
    }
  }

  const items = selected.sort((a, b) => b.score - a.score).slice(0, clamp(limit, 1, 3)).map(({ score, meta, ...item }) => item);
  return {
    items,
    relationship: { ...diary.relationship },
    state: { ...diary.state },
    mood: moodView(diary.relationship, diary.state),
    privacy: 'device_only'
  };
}

function safeDelta(value, max = 6) {
  return clamp(Math.round(Number(value) || 0), -max, max);
}

export async function applyMemoryExtraction(extracted = {}, userText = '') {
  await mutateDiary(diary => {
    for (const fact of Array.isArray(extracted.facts) ? extracted.facts.slice(0, 5) : []) {
      const path = clean(fact?.path, 100);
      const value = clean(fact?.value, 500);
      const confidence = clamp(fact?.confidence ?? 0, 0, 1);
      if (!/^user(\.[\p{L}\p{N}_-]+)+$/u.test(path) || !value || confidence < 0.75) continue;
      const previous = getPath(diary.facts, path);
      setPath(diary.facts, path, value);
      diary.factMeta[path] = {
        ...(diary.factMeta[path] || {}), source: 'user', confidence,
        importance: clamp(fact.importance ?? 6, 1, 10),
        createdAt: diary.factMeta[path]?.createdAt || now(), updatedAt: now(),
        conflict: previous != null && String(previous) !== value
      };
    }

    for (const event of Array.isArray(extracted.events) ? extracted.events.slice(0, 5) : []) {
      const text = clean(event?.text, 600);
      const importance = clamp(event?.importance ?? 5, 1, 10);
      if (!text || importance < 6) continue;
      const key = fingerprint(text);
      if (diary.events.some(item => fingerprint(item.text) === key && now() - Number(item.ts || 0) < 7 * 86400000)) continue;
      diary.events.push({
        id: `evt_${now()}_${Math.random().toString(36).slice(2, 8)}`, ts: now(),
        type: clean(event.type || 'memory', 30), text,
        tags: Array.isArray(event.tags) ? event.tags.slice(0, 8).map(tag => clean(tag, 40)).filter(Boolean) : [],
        importance, source: 'user', confidence: clamp(event.confidence ?? 0.8, 0, 1), lastUsedAt: 0, useCount: 0
      });
    }

    for (const thread of Array.isArray(extracted.threads) ? extracted.threads.slice(0, 3) : []) {
      const title = clean(thread?.title, 120);
      if (!title) continue;
      const existing = diary.threads.find(item => fingerprint(item.title) === fingerprint(title));
      const value = {
        id: existing?.id || `thr_${now()}_${Math.random().toString(36).slice(2, 8)}`,
        title,
        summary: clean(thread.summary || title, 500), status: thread.status === 'closed' ? 'closed' : 'open',
        dueAt: Number(thread.dueAt) || null, importance: clamp(thread.importance ?? 6, 1, 10),
        createdAt: existing?.createdAt || now(), updatedAt: now()
      };
      if (existing) Object.assign(existing, value); else diary.threads.push(value);
    }

    const relationshipDelta = extracted.relationshipDelta || {};
    const stateDelta = extracted.stateDelta || extracted.moodDelta || {};
    const confidence = clamp(relationshipDelta.confidence ?? stateDelta.confidence ?? extracted.moodDelta?.confidence ?? 0, 0, 1);
    if (confidence >= 0.55) {
      const text = normalize(userText);
      const hostile = /(ненавиж|заткнись|отстань|бесишь|тупая|замолчи)/u.test(text);
      const warm = /(люблю|соскучил|обнимаю|целую|ты мне нравишься|доверяю|спасибо)/u.test(text);
      const relational = hostile || warm || /(прости|извини|обид|ссор|ревну|между нами|мы с тобой)/u.test(text);
      diary.relationship.affection = clamp(diary.relationship.affection + safeDelta(warm || hostile ? relationshipDelta.affection ?? stateDelta.affection : 0), 0, 100);
      diary.relationship.trust = clamp(diary.relationship.trust + safeDelta(warm || hostile ? relationshipDelta.trust ?? stateDelta.trust : 0), 0, 100);
      diary.relationship.intimacy = clamp(diary.relationship.intimacy + safeDelta(warm ? relationshipDelta.intimacy : 0, 4), 0, 100);
      diary.relationship.tension = clamp(diary.relationship.tension + safeDelta(relational ? relationshipDelta.tension : 0, 8), 0, 100);
      // Физическая энергия Рин меняется только при явном событии о самой Рин; слова пользователя её не заряжают.
      diary.state.playfulness = clamp(diary.state.playfulness + safeDelta(stateDelta.playfulness, 6), 0, 100);
      diary.state.valence = clamp(diary.state.valence + safeDelta(stateDelta.valence ?? stateDelta.affection, 5), 0, 100);
      diary.state.arousal = clamp(diary.state.arousal + safeDelta(stateDelta.arousal, 5), 0, 100);
      diary.relationship.updatedAt = now();
      diary.state.updatedAt = now();
    }
    diary.events = diary.events.slice(-MAX_EVENTS);
    diary.threads = diary.threads.slice(-MAX_THREADS);
    return diary;
  });
  // Анализ применён ровно один раз, включая нейтральный нулевой результат.
  return true;
}

export async function buildSystemPrompt(profileInput = null, opts = {}) {
  const profile = profileInput || await loadProfile();
  const memory = await buildRelevantMemory(opts.userText || '', opts.history || [], 3);
  return [
    profile.base_rules || BASE_RULES,
    profile.description ? `Описание: ${clean(profile.description, 1000)}` : '',
    profile.instructions_extra ? `Дополнительные правила: ${clean(profile.instructions_extra, 1500)}` : '',
    profile.knowledge ? `Авторские факты: ${clean(profile.knowledge, 1500)}` : '',
    memory.items.length ? `Релевантная локальная память:\n${memory.items.map(item => `- ${item.path ? `${item.path}: ${item.value}` : item.text || item.summary}`).join('\n')}` : ''
  ].filter(Boolean).join('\n\n');
}

export function wipeProfile() {
  if (storageAvailable()) localStorage.removeItem(LS_PROFILE_KEY);
}

export async function wipeDiary() {
  if (storageAvailable()) localStorage.removeItem(LS_DIARY_KEY);
  await dbDelete(DIARY_KEY);
}

export async function wipeAllPersona() {
  wipeProfile();
  await wipeDiary();
}

export const __test = { normalize, tokens, relevance, normalizeDiary, emptyDiary };
