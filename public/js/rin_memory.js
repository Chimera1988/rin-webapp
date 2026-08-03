// Единое клиентское хранилище профиля и долговременной памяти Рин.
// Канонический prompt-профиль модели находится на сервере в rin_prompt_profile.json.

const LS_PROFILE_KEY = 'rin-profile-v1';
const LS_DIARY_KEY = 'rin-diary-v1';
const DIARY_SCHEMA_VERSION = 2;

export const BASE_RULES = `
Ты — Рин Акихара (женский род). Обращайся к собеседнику в мужском роде.
Сохраняй непротиворечивость: факты из канона и дневника не меняются задним числом.
Пиши естественно и бережно. Время/сезон/погоду учитывай, если они известны.
Стикеры — только уместно, без навязчивой романтики.
`.trim();

function getStorage() {
  return typeof localStorage !== 'undefined' ? localStorage : null;
}

function clone(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function safeParse(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function cleanText(value, max = 1200) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(finiteNumber(value, min))));
}

function hash(value = '') {
  let out = 2166136261;
  for (const char of String(value)) {
    out ^= char.charCodeAt(0);
    out = Math.imul(out, 16777619);
  }
  return (out >>> 0).toString(36);
}

function contentKey(value = '') {
  return hash(cleanText(value, 4000).toLowerCase());
}

function makeId(prefix, key = '', ts = Date.now()) {
  return `${prefix}-${ts}-${key || Math.random().toString(36).slice(2, 8)}`;
}

function safeGet(key, fallback = null) {
  const storage = getStorage();
  if (!storage) return fallback;
  try {
    const value = storage.getItem(key);
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

function safeRemove(key) {
  const storage = getStorage();
  if (!storage) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function safeSet(key, value) {
  const storage = getStorage();
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error(`[Rin storage] Не удалось сохранить ${key}`, error);
    return false;
  }
}

export function getDefaultProfile() {
  return {
    name: 'Рин Акихара',
    description: '',
    base_rules: BASE_RULES,
    instructions_extra: '',
    knowledge: '',
    starters: [
      'Привет! Как твой день? 🌸',
      'Я тут заварила чай и вспомнила о тебе.',
      'Как ты себя чувствуешь сейчас?'
    ],
    initiation: {
      max_per_day: 2,
      windows: [
        { from: '09:00', to: '11:00', pool: 'morning' },
        { from: '19:00', to: '22:30', pool: 'evening' }
      ]
    },
    _updated_at: Date.now()
  };
}

function normalizeProfile(input = {}) {
  const defaults = getDefaultProfile();
  const source = input && typeof input === 'object' ? input : {};
  const initiation = source.initiation && typeof source.initiation === 'object'
    ? source.initiation
    : defaults.initiation;
  return {
    ...defaults,
    ...source,
    name: cleanText(source.name || defaults.name, 80),
    description: String(source.description || '').trim().slice(0, 1800),
    base_rules: BASE_RULES,
    instructions_extra: String(source.instructions_extra || '').trim().slice(0, 5000),
    knowledge: String(source.knowledge || '').trim().slice(0, 8000),
    starters: Array.isArray(source.starters)
      ? source.starters.map(item => cleanText(item, 280)).filter(Boolean).slice(0, 20)
      : defaults.starters,
    initiation: {
      max_per_day: clamp(initiation.max_per_day ?? defaults.initiation.max_per_day, 0, 10),
      windows: Array.isArray(initiation.windows)
        ? initiation.windows
          .map(item => ({
            from: cleanText(item?.from, 5),
            to: cleanText(item?.to, 5),
            pool: ['morning', 'day', 'evening', 'night'].includes(item?.pool) ? item.pool : 'day'
          }))
          .filter(item => /^\d{2}:\d{2}$/.test(item.from) && /^\d{2}:\d{2}$/.test(item.to))
          .slice(0, 8)
        : defaults.initiation.windows
    },
    _updated_at: finiteNumber(source._updated_at, Date.now())
  };
}

export async function loadProfile() {
  const parsed = safeParse(safeGet(LS_PROFILE_KEY), {});
  return normalizeProfile(parsed);
}

export async function saveProfile(profile) {
  const next = normalizeProfile({ ...(profile || {}), _updated_at: Date.now() });
  if (!safeSet(LS_PROFILE_KEY, next)) throw new Error('PROFILE_STORAGE_FAILED');
  return clone(next);
}

function defaultMood(now = Date.now()) {
  return {
    affection: 65,
    energy: 65,
    label: 'спокойная',
    lastInteractionAt: now,
    updatedAt: now
  };
}

function defaultRelationship(now = Date.now()) {
  return {
    trust: 55,
    closeness: 42,
    comfort: 52,
    respect: 68,
    playfulness: 45,
    stage: 'растущее доверие',
    sharedMoments: [],
    lastInteractionAt: now,
    updatedAt: now
  };
}

function defaultInnerLife() {
  return {
    activity: '', trace: '', focus: '', privateThought: '', part: '',
    startedAt: 0, expiresAt: 0, lastSpontaneousAt: 0, lastUserAt: 0,
    interactionCount: 0, recentActivities: []
  };
}

function emptyDiary() {
  return {
    _schema: DIARY_SCHEMA_VERSION,
    facts: { self: {}, user: {}, world: {} },
    events: [],
    anchors: {},
    mood: defaultMood(),
    innerLife: defaultInnerLife(),
    relationship: defaultRelationship(),
    openLoops: [],
    summaries: [],
    _updated_at: Date.now()
  };
}

function normalizeFactRoot(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    self: source.self && typeof source.self === 'object' ? source.self : {},
    user: source.user && typeof source.user === 'object' ? source.user : {},
    world: source.world && typeof source.world === 'object' ? source.world : {}
  };
}

function normalizeEvent(item = {}, index = 0) {
  const text = cleanText(item.text, 1800);
  if (!text) return null;
  const key = cleanText(item.key, 80) || contentKey(`${item.type || 'note'}:${text}`);
  const ts = finiteNumber(item.ts ?? item.createdAt, Date.now() + index);
  return {
    id: cleanText(item.id, 120) || makeId('event', key, ts),
    key,
    ts,
    type: cleanText(item.type || 'note', 40),
    text,
    tags: Array.isArray(item.tags) ? item.tags.map(tag => cleanText(tag, 40)).filter(Boolean).slice(0, 8) : [],
    ref: cleanText(item.ref, 120) || undefined,
    importance: clamp(item.importance ?? 5, 1, 10)
  };
}

function normalizeLoop(item = {}, index = 0) {
  const text = cleanText(item.text || item.content, 900);
  if (!text) return null;
  const key = cleanText(item.key, 80) || contentKey(text);
  const createdAt = finiteNumber(item.createdAt ?? item.ts, Date.now() + index);
  return {
    id: cleanText(item.id, 120) || makeId('loop', key, createdAt),
    key,
    text,
    type: cleanText(item.type || 'topic', 40),
    importance: clamp(item.importance ?? 5, 1, 10),
    createdAt,
    status: 'open'
  };
}

function normalizeMoment(item = {}, index = 0) {
  const text = cleanText(item.text, 900);
  if (!text) return null;
  const key = cleanText(item.key, 80) || contentKey(text);
  const ts = finiteNumber(item.ts ?? item.createdAt, Date.now() + index);
  return {
    id: cleanText(item.id, 120) || makeId('moment', key, ts),
    key,
    text,
    importance: clamp(item.importance ?? 6, 1, 10),
    ts
  };
}

function normalizeSummary(item = {}, index = 0) {
  const text = cleanText(item.text, 2200);
  if (!text) return null;
  const key = cleanText(item.key, 80) || contentKey(text);
  const ts = finiteNumber(item.ts ?? item.createdAt, Date.now() + index);
  return {
    id: cleanText(item.id, 120) || makeId('summary', key, ts),
    key,
    ts,
    text,
    sourceCount: Math.max(1, Math.round(finiteNumber(item.sourceCount, 1)))
  };
}

function relationshipStage(value = {}) {
  if (value.closeness >= 82 && value.trust >= 80) return 'глубокая устойчивая близость';
  if (value.closeness >= 66 && value.trust >= 65) return 'сформировавшаяся близость';
  if (value.closeness >= 48 && value.trust >= 50) return 'растущее доверие';
  if (value.closeness >= 30) return 'осторожное сближение';
  return 'начало знакомства';
}

function moodLabel(mood = {}) {
  const affection = clamp(mood.affection ?? 50);
  const energy = clamp(mood.energy ?? 50);
  if (energy <= 30) return 'уставшая';
  if (affection <= 35) return 'отстранённая';
  if (energy <= 45) return 'задумчивая';
  if (affection >= 80 && energy < 65) return 'нежная';
  if (affection >= 70 && energy >= 65) return 'радостная';
  return 'спокойная';
}

function normalizeDiary(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const now = Date.now();
  const moodSource = source.mood && typeof source.mood === 'object' ? source.mood : {};
  const relationSource = source.relationship && typeof source.relationship === 'object' ? source.relationship : {};

  // Миграция v1: trust/playfulness жили одновременно в mood и relationship.
  const relationship = {
    ...defaultRelationship(now),
    ...relationSource,
    trust: clamp(relationSource.trust ?? moodSource.trust ?? 55),
    closeness: clamp(relationSource.closeness ?? 42),
    comfort: clamp(relationSource.comfort ?? 52),
    respect: clamp(relationSource.respect ?? 68),
    playfulness: clamp(relationSource.playfulness ?? moodSource.playfulness ?? 45),
    sharedMoments: (Array.isArray(relationSource.sharedMoments) ? relationSource.sharedMoments : [])
      .map(normalizeMoment).filter(Boolean).slice(-20),
    lastInteractionAt: finiteNumber(relationSource.lastInteractionAt, now),
    updatedAt: finiteNumber(relationSource.updatedAt, now)
  };
  relationship.stage = relationshipStage(relationship);

  const mood = {
    ...defaultMood(now),
    affection: clamp(moodSource.affection ?? 65),
    energy: clamp(moodSource.energy ?? 65),
    lastInteractionAt: finiteNumber(moodSource.lastInteractionAt, now),
    updatedAt: finiteNumber(moodSource.updatedAt, now)
  };
  mood.label = moodLabel(mood);

  const events = (Array.isArray(source.events) ? source.events : []).map(normalizeEvent).filter(Boolean);
  const seenEvents = new Set();
  const uniqueEvents = events.filter(item => !seenEvents.has(item.key) && seenEvents.add(item.key)).slice(-120);

  const loops = (Array.isArray(source.openLoops) ? source.openLoops : []).map(normalizeLoop).filter(Boolean);
  const seenLoops = new Set();
  const uniqueLoops = loops.filter(item => !seenLoops.has(item.key) && seenLoops.add(item.key)).slice(-24);

  const summaries = (Array.isArray(source.summaries) ? source.summaries : []).map(normalizeSummary).filter(Boolean);
  const seenSummaries = new Set();
  const uniqueSummaries = summaries.filter(item => !seenSummaries.has(item.key) && seenSummaries.add(item.key)).slice(-12);

  return {
    _schema: DIARY_SCHEMA_VERSION,
    facts: normalizeFactRoot(source.facts),
    events: uniqueEvents,
    anchors: source.anchors && typeof source.anchors === 'object' ? source.anchors : {},
    mood,
    innerLife: {
      ...defaultInnerLife(),
      ...(source.innerLife && typeof source.innerLife === 'object' ? source.innerLife : {}),
      recentActivities: Array.isArray(source.innerLife?.recentActivities)
        ? source.innerLife.recentActivities.map(item => cleanText(item, 180)).filter(Boolean).slice(-6)
        : []
    },
    relationship,
    openLoops: uniqueLoops,
    summaries: uniqueSummaries,
    _updated_at: finiteNumber(source._updated_at, now)
  };
}

function readDiarySync() {
  return normalizeDiary(safeParse(safeGet(LS_DIARY_KEY), emptyDiary()));
}

function writeDiarySync(diary) {
  const normalized = normalizeDiary({ ...(diary || {}), _updated_at: Date.now() });
  if (!safeSet(LS_DIARY_KEY, normalized)) throw new Error('DIARY_STORAGE_FAILED');
  return normalized;
}

let diaryMutationQueue = Promise.resolve();

async function withDiaryMutationLock(task) {
  const locks = globalThis.navigator?.locks;
  if (locks?.request) {
    return locks.request('rin-diary-v2-write', { mode: 'exclusive' }, task);
  }
  return task();
}

async function mutateDiary(mutator) {
  const operation = diaryMutationQueue.then(() => withDiaryMutationLock(async () => {
    const diary = readDiarySync();
    const result = await mutator(diary);
    const saved = writeDiarySync(diary);
    return result === undefined ? clone(saved) : result;
  }));
  diaryMutationQueue = operation.catch(() => undefined);
  return operation;
}

export async function loadDiary() {
  await diaryMutationQueue;
  return clone(readDiarySync());
}

export async function saveDiary(diary) {
  return mutateDiary(target => {
    const replacement = normalizeDiary(diary);
    for (const key of Object.keys(target)) delete target[key];
    Object.assign(target, replacement);
    return clone(replacement);
  });
}

export async function addEvent(text, opts = {}) {
  const normalizedText = cleanText(text, 1800);
  if (!normalizedText) return false;
  return mutateDiary(diary => {
    const event = normalizeEvent({ ...opts, text: normalizedText, ts: opts.ts ?? Date.now() });
    if (!event || diary.events.some(item => item.key === event.key)) return false;
    diary.events = [...diary.events, event].slice(-120);
    return true;
  });
}

export async function getRecentEvents(limit = 20, filterFn = null) {
  const diary = await loadDiary();
  let events = diary.events.slice(-Math.max(1, Number(limit) || 20));
  if (typeof filterFn === 'function') events = events.filter(filterFn);
  return events;
}

const INNER_LIFE_POOLS = {
  morning: [
    { activity: 'просматривает рабочие заметки за чаем', trace: 'на столе лежит открытый блокнот', focus: 'спокойно войти в рабочий ритм' },
    { activity: 'собирается начать работу', trace: 'проверяет заметки перед первым текстом', focus: 'не распыляться с самого утра' },
    { activity: 'приводит в порядок рабочий стол', trace: 'переставила чашку подальше от ноутбука', focus: 'освободить место для работы' }
  ],
  day: [
    { activity: 'редактирует перевод', trace: 'задержалась на одной формулировке', focus: 'сохранить естественный ритм текста' },
    { activity: 'работает с текстом за ноутбуком', trace: 'несколько раз перечитала один абзац', focus: 'найти точное, но не тяжёлое слово' },
    { activity: 'сделала короткую паузу между задачами', trace: 'чай рядом уже немного остыл', focus: 'дать голове переключиться' }
  ],
  evening: [
    { activity: 'заваривает чай после работы', trace: 'слушает, как за окном стихает город', focus: 'отпустить рабочий день' },
    { activity: 'читает несколько страниц книги', trace: 'иногда возвращается к одной строке', focus: 'никуда не торопиться' },
    { activity: 'разбирает заметки на рабочем столе', trace: 'нашла старую запись и на секунду задумалась', focus: 'закончить мелкие дела' }
  ],
  night: [
    { activity: 'готовится ко сну', trace: 'оставила только мягкий свет', focus: 'успокоить мысли' },
    { activity: 'сидит в тишине с остывающим чаем', trace: 'день ещё не совсем отпустил', focus: 'не затягивать ночь' },
    { activity: 'дочитывает страницу перед сном', trace: 'уже начинает уставать', focus: 'остановиться на хорошем месте' }
  ]
};

function innerLifePart(env = {}) {
  const value = String(env?.partOfDay || '').toLowerCase();
  if (/утр|morning/.test(value)) return 'morning';
  if (/веч|evening/.test(value)) return 'evening';
  if (/ноч|night/.test(value)) return 'night';
  if (/день|day/.test(value)) return 'day';
  const hour = Number(String(env?.rinHuman || '').match(/\b(\d{1,2}):\d{2}\b/)?.[1]);
  if (Number.isFinite(hour)) {
    if (hour < 6 || hour >= 23) return 'night';
    if (hour < 11) return 'morning';
    if (hour < 18) return 'day';
    return 'evening';
  }
  return 'day';
}

export async function advanceInnerLife(env = {}, userText = '') {
  return mutateDiary(diary => {
    const current = { ...defaultInnerLife(), ...(diary.innerLife || {}) };
    const now = Date.now();
    const part = innerLifePart(env);
    const expired = !current.activity || !current.expiresAt || now >= current.expiresAt || current.part !== part;
    if (expired) {
      const pool = INNER_LIFE_POOLS[part] || INNER_LIFE_POOLS.day;
      const recent = new Set((current.recentActivities || []).slice(-2));
      let index = Number.parseInt(hash(`${env?.rinHuman || ''}|${part}|${current.interactionCount}`), 36) % pool.length;
      for (let offset = 0; offset < pool.length && recent.has(pool[index].activity); offset += 1) index = (index + 1) % pool.length;
      const selected = pool[index];
      Object.assign(current, selected, {
        privateThought: '', part, startedAt: now,
        expiresAt: now + (35 + (Number.parseInt(hash(selected.activity), 36) % 70)) * 60000,
        recentActivities: [...(current.recentActivities || []), selected.activity].slice(-6)
      });
    }
    current.lastUserAt = now;
    current.interactionCount = finiteNumber(current.interactionCount, 0) + 1;
    const text = String(userText || '').toLowerCase();
    if (/(перевод|текст|работ|книг|чай|дожд|вечер|устал)/iu.test(text)) {
      current.privateThought = text.includes('чай')
        ? 'разговор неожиданно сделал обычный чай чуть уютнее'
        : text.includes('книг')
          ? 'хочется запомнить, к какой мысли они вернутся позже'
          : /(работ|текст|перевод)/u.test(text)
            ? 'интересно, как по-разному могут звучать простые слова'
            : 'иногда маленькая деталь меняет настроение сильнее большого события';
    }
    diary.innerLife = current;
    return clone(current);
  });
}

export async function markInnerLifeSpontaneous() {
  return mutateDiary(diary => {
    diary.innerLife = { ...defaultInnerLife(), ...(diary.innerLife || {}), lastSpontaneousAt: Date.now() };
    return clone(diary.innerLife);
  });
}

export async function getMood() {
  return (await loadDiary()).mood;
}

export async function saveMood(input = {}) {
  return mutateDiary(diary => {
    const current = diary.mood || defaultMood();
    const next = {
      affection: clamp(input.affection ?? current.affection),
      energy: clamp(input.energy ?? current.energy),
      lastInteractionAt: finiteNumber(input.lastInteractionAt, current.lastInteractionAt),
      updatedAt: Date.now()
    };
    next.label = moodLabel(next);
    diary.mood = next;
    return clone(next);
  });
}

export async function updateMood(delta = {}) {
  return mutateDiary(diary => {
    const current = diary.mood || defaultMood();
    const next = {
      affection: clamp(current.affection + finiteNumber(delta.affection, 0)),
      energy: clamp(current.energy + finiteNumber(delta.energy, 0)),
      lastInteractionAt: finiteNumber(delta.lastInteractionAt, current.lastInteractionAt),
      updatedAt: Date.now()
    };
    next.label = moodLabel(next);
    diary.mood = next;
    return clone(next);
  });
}

export async function applyMoodTimeDecay() {
  const current = await getMood();
  const elapsedHours = Math.max(0, Date.now() - finiteNumber(current.lastInteractionAt, Date.now())) / 3600000;
  let affection = 0;
  let energy = 0;
  if (elapsedHours >= 24) energy -= 4;
  if (elapsedHours >= 72) { affection += 2; energy -= 3; }
  if (elapsedHours >= 168) { affection += 2; energy -= 4; }
  return affection || energy ? updateMood({ affection, energy }) : current;
}

export async function upsertFact(path, value) {
  const parts = String(path || '').split('.').map(item => item.trim()).filter(Boolean);
  if (!parts.length) return false;
  return mutateDiary(diary => {
    let cursor = diary.facts;
    parts.forEach((part, index) => {
      if (index === parts.length - 1) cursor[part] = value;
      else {
        if (!cursor[part] || typeof cursor[part] !== 'object' || Array.isArray(cursor[part])) cursor[part] = {};
        cursor = cursor[part];
      }
    });
    return true;
  });
}

export async function getFact(path, fallback = undefined) {
  const parts = String(path || '').split('.').map(item => item.trim()).filter(Boolean);
  if (!parts.length) return fallback;
  let cursor = (await loadDiary()).facts;
  for (const part of parts) {
    if (!cursor || typeof cursor !== 'object' || !(part in cursor)) return fallback;
    cursor = cursor[part];
  }
  return cursor;
}

export async function recallDays(days = 30) {
  const since = Date.now() - Math.max(1, finiteNumber(days, 30)) * 86400000;
  return (await loadDiary()).events.filter(event => event.ts >= since);
}

export async function searchDiary(query, limit = 50) {
  const normalized = cleanText(query, 300).toLowerCase();
  if (!normalized) return [];
  return (await loadDiary()).events
    .filter(event => event.text.toLowerCase().includes(normalized))
    .slice(-Math.max(1, finiteNumber(limit, 50)))
    .reverse();
}

function flattenObject(obj, prefix = '', out = {}) {
  if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) {
    if (prefix) out[prefix] = obj;
    return out;
  }
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) flattenObject(value, path, out);
    else out[path] = value;
  }
  return out;
}

export async function buildSystemPrompt(profileInput = null, opts = {}) {
  const profile = normalizeProfile(profileInput || await loadProfile());
  const facts = flattenObject((await loadDiary()).facts);
  const factLines = Object.entries(facts).slice(0, 20).map(([key, value]) => `• ${key}: ${cleanText(typeof value === 'string' ? value : JSON.stringify(value), 160)}`);
  return [
    'СИСТЕМНЫЕ ПРАВИЛА:', BASE_RULES,
    profile.description ? `\nОПИСАНИЕ ПЕРСОНАЖА:\n${profile.description}` : '',
    profile.instructions_extra ? `\nДОПОЛНИТЕЛЬНЫЕ ИНСТРУКЦИИ:\n${profile.instructions_extra}` : '',
    profile.knowledge ? `\nОПОРНЫЕ ФАКТЫ:\n${profile.knowledge}` : '',
    factLines.length ? `\nФАКТЫ ИЗ ДНЕВНИКА:\n${factLines.join('\n')}` : '',
    opts.env ? `\nОКРУЖЕНИЕ:\n${JSON.stringify(opts.env)}` : ''
  ].filter(Boolean).join('\n');
}

export function wipeProfile() {
  safeRemove(LS_PROFILE_KEY);
}

export function wipeDiary() {
  safeRemove(LS_DIARY_KEY);
}

export function wipeAllPersona() {
  wipeProfile();
  wipeDiary();
}

export async function updateRelationship(delta = {}) {
  return mutateDiary(diary => {
    const current = { ...defaultRelationship(), ...(diary.relationship || {}) };
    const next = { ...current };
    for (const key of ['trust', 'closeness', 'comfort', 'respect', 'playfulness']) {
      next[key] = clamp(finiteNumber(current[key], 0) + finiteNumber(delta[key], 0));
    }
    next.stage = relationshipStage(next);
    next.lastInteractionAt = finiteNumber(delta.lastInteractionAt, Date.now());
    next.updatedAt = Date.now();
    next.sharedMoments = Array.isArray(current.sharedMoments) ? current.sharedMoments : [];
    diary.relationship = next;
    return clone(next);
  });
}

export async function addOpenLoop(item = {}) {
  const loop = normalizeLoop({ ...item, createdAt: item.createdAt ?? Date.now() });
  if (!loop) return false;
  return mutateDiary(diary => {
    if (diary.openLoops.some(existing => existing.id === loop.id || existing.key === loop.key)) return false;
    diary.openLoops = [...diary.openLoops, loop].slice(-24);
    return true;
  });
}

export async function resolveOpenLoop(input = '') {
  const id = cleanText(typeof input === 'object' ? input.id : '', 120);
  const key = cleanText(typeof input === 'object' ? input.key : '', 80);
  const text = cleanText(typeof input === 'object' ? (input.text || input.content) : input, 900);
  if (!id && !key && !text) return false;
  return mutateDiary(diary => {
    const before = diary.openLoops.length;
    const textKey = text ? contentKey(text) : '';
    diary.openLoops = diary.openLoops.filter(loop => {
      if (id) return loop.id !== id;
      if (key) return loop.key !== key;
      if (textKey && loop.key === textKey) return false;
      return text ? loop.text.toLowerCase() !== text.toLowerCase() : true;
    });
    return diary.openLoops.length < before;
  });
}

export async function addSharedMoment(item = {}) {
  const moment = normalizeMoment({ ...item, ts: item.ts ?? Date.now() });
  if (!moment) return false;
  return mutateDiary(diary => {
    const relationship = { ...defaultRelationship(), ...(diary.relationship || {}) };
    const current = Array.isArray(relationship.sharedMoments) ? relationship.sharedMoments : [];
    if (current.some(existing => existing.id === moment.id || existing.key === moment.key)) return false;
    relationship.sharedMoments = [...current, moment].slice(-20);
    relationship.updatedAt = Date.now();
    diary.relationship = relationship;
    return true;
  });
}

export async function consolidateDiary() {
  return mutateDiary(diary => {
    if (diary.events.length <= 80) return false;
    const archived = diary.events.slice(0, diary.events.length - 50);
    const important = archived.filter(event => event.importance >= 7).slice(-12);
    if (important.length) {
      const text = important.map(event => event.text).join(' • ').slice(0, 1800);
      const summary = normalizeSummary({ text, sourceCount: archived.length, ts: Date.now() });
      if (summary && !diary.summaries.some(item => item.key === summary.key)) {
        diary.summaries = [...diary.summaries, summary].slice(-12);
      }
    }
    diary.events = diary.events.slice(-50);
    return true;
  });
}

(async function bootstrapWindowProfile() {
  if (typeof window === 'undefined') return;
  try {
    window.RIN_PROFILE = await loadProfile();
  } catch {}
})();
