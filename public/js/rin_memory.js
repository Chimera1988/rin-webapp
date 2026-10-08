import {
  defaultRelationshipState,
  emotionalStateFromLegacyTrace,
  normalizeEmotionalState,
  normalizeRelationshipState,
  relationshipStage as canonicalRelationshipStage
} from '../lib/affective-contract.js';
import { beliefSlot, normalizeBelief } from '../lib/epistemic-contract.js';
import { normalizeRinIntent } from '../lib/intent-contract.js';
import { normalizeInnerLife } from '../lib/inner-life-contract.js';
import { normalizeCognitivePersistence } from '../lib/cognitive-state-contract.js';
import { contentKey } from '../lib/chat-contract.js';
import { storageGet, storageReadJson, storageRemove, storageWriteJsonVerified } from './storage.js';
import { activityPeriod, resolveDailyRhythm } from './daily_rhythm.js';

// Единое клиентское хранилище профиля и долговременной памяти Рин.
// Канонический prompt-профиль загружается сервером; клиент хранит только пользовательские overrides и runtime-state.

const LS_PROFILE_KEY = 'rin-profile-v1';
const LS_DIARY_KEY = 'rin-diary-v1';
const DIARY_SCHEMA_VERSION = 10;



function getStorage() {
  return typeof localStorage !== 'undefined' ? localStorage : null;
}

function clone(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
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

function stableHashBase36(value = '') {
  let out = 2166136261;
  for (const char of String(value)) {
    out ^= char.charCodeAt(0);
    out = Math.imul(out, 16777619);
  }
  return (out >>> 0).toString(36);
}

function makeId(prefix, key = '', ts = Date.now()) {
  return `${prefix}-${ts}-${key || Math.random().toString(36).slice(2, 8)}`;
}

function safeGet(key, fallback = null) {
  return storageGet(getStorage(), key, fallback);
}

function safeRemove(key) {
  return storageRemove(getStorage(), key);
}

function safeSet(key, value) {
  return storageWriteJsonVerified(getStorage(), key, value);
}

export function getDefaultProfile() {
  return {
    description: '',
    instructions_extra: '',
    knowledge: '',
    _updated_at: Date.now()
  };
}

function normalizeProfile(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    description: String(source.description || '').trim().slice(0, 1800),
    instructions_extra: String(source.instructions_extra || '').trim().slice(0, 5000),
    knowledge: String(source.knowledge || '').trim().slice(0, 8000),
    _updated_at: finiteNumber(source._updated_at, Date.now())
  };
}

export async function loadProfile() {
  return normalizeProfile(storageReadJson(getStorage(), LS_PROFILE_KEY, {}));
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
  return defaultRelationshipState(now);
}

function defaultInnerLife() {
  return normalizeInnerLife({});
}

function defaultConversationState() {
  return {
    schema: 'rin-conversation-state-v5',
    revision: 0,
    dialogueState: null,
    beliefs: [],
    openLoops: [],
    emotionalState: normalizeEmotionalState({}),
    rinIntent: null,
    recentIntents: [],
    lastCommittedRequestId: null,
    updatedAt: 0
  };
}

function normalizeConversationState(value = {}, legacyTrace = null, context = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const beliefs = (Array.isArray(source.beliefs) ? source.beliefs : [])
    .filter(item => item && typeof item === 'object' && cleanText(item.id, 120))
    .map(normalizeBelief)
    .slice(-48);
  const loops = (Array.isArray(source.openLoops) ? source.openLoops : [])
    .filter(item => item && typeof item === 'object' && cleanText(item.id, 120))
    .slice(-24);
  const emotionalState = source.emotionalState && typeof source.emotionalState === 'object'
    ? normalizeEmotionalState(source.emotionalState, context)
    : emotionalStateFromLegacyTrace(source.emotionalTrace || legacyTrace, context);
  const rawIntent = normalizeRinIntent(source.rinIntent);
  const history = [];
  for (const candidate of [
    ...(Array.isArray(source.recentIntents) ? source.recentIntents : []),
    ...((rawIntent && ['completed', 'cancelled'].includes(rawIntent.status)) ? [rawIntent] : [])
  ]) {
    const intent = normalizeRinIntent(candidate);
    if (!intent || !['completed', 'cancelled'].includes(intent.status)) continue;
    const existing = history.findIndex(item => item.id === intent.id);
    if (existing >= 0) history.splice(existing, 1);
    history.push(intent);
  }
  return {
    ...defaultConversationState(),
    schema: 'rin-conversation-state-v5',
    revision: Math.max(0, Math.round(finiteNumber(source.revision, 0))),
    dialogueState: source.dialogueState && typeof source.dialogueState === 'object' ? source.dialogueState : null,
    beliefs,
    openLoops: loops,
    emotionalState,
    rinIntent: rawIntent && ['active', 'suspended'].includes(rawIntent.status) ? rawIntent : null,
    recentIntents: history.slice(-8),
    lastCommittedRequestId: cleanText(source.lastCommittedRequestId, 120) || null,
    updatedAt: finiteNumber(source.updatedAt, 0)
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
    summaries: [],
    processedMemoryJobs: [],
    conversationState: defaultConversationState(),
    cognitiveState: normalizeCognitivePersistence(),
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

function migrateLegacyOpenLoops(items = []) {
  return (Array.isArray(items) ? items : []).map((item, index) => {
    const subject = cleanText(item?.subject || item?.text || item?.content, 900);
    if (!subject) return null;
    const createdAt = finiteNumber(item?.createdAt ?? item?.ts, Date.now() + index);
    return {
      id: cleanText(item?.id, 120) || `loop-${contentKey(subject)}`,
      type: cleanText(item?.type || 'topic', 80),
      subject,
      status: 'active',
      importance: clamp((Number(item?.importance) || 5) * 10, 0, 100),
      confidence: 0.7,
      createdAt,
      updatedAt: createdAt,
      source: 'legacy_diary_migration'
    };
  }).filter(Boolean).slice(-24);
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

function normalizeSharedSymbol(item = {}, index = 0) {
  const rawId = cleanText(item.id || item.key || item.label, 80).toLowerCase();
  const id = rawId.replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  const label = cleanText(item.label || item.name || id, 80);
  const meaning = cleanText(item.meaning || item.description, 900);
  if (!id || !label || !meaning) return null;
  const list = (value, max, len) => [...new Set((Array.isArray(value) ? value : [])
    .map(entry => cleanText(entry, len)).filter(Boolean))].slice(0, max);
  const ts = finiteNumber(item.updatedAt ?? item.ts ?? item.createdAt, Date.now() + index);
  return {
    id,
    label,
    scope: cleanText(item.scope, 40) || 'relationship_private',
    privacy: cleanText(item.privacy, 40) || 'private',
    origin: cleanText(item.origin, 500) || 'shared_history',
    meaning,
    aliases: list(item.aliases, 8, 80),
    associations: list(item.associations, 12, 140),
    manifestations: list(item.manifestations, 8, 260),
    avoid: list(item.avoid, 8, 260),
    salience: clamp(item.salience ?? (Number.isFinite(Number(item.importance)) ? Number(item.importance) * 10 : 55), 0, 100),
    minCloseness: clamp(item.minCloseness ?? 45, 0, 100),
    updatedAt: ts
  };
}

function mergeSharedSymbol(current = null, incoming = null) {
  if (!current) return incoming;
  if (!incoming) return current;
  const mergeList = (a, b, max) => [...new Set([...(a || []), ...(b || [])])].slice(0, max);
  return normalizeSharedSymbol({
    ...current,
    ...incoming,
    id: current.id,
    aliases: mergeList(current.aliases, incoming.aliases, 8),
    associations: mergeList(current.associations, incoming.associations, 12),
    manifestations: mergeList(current.manifestations, incoming.manifestations, 8),
    avoid: mergeList(current.avoid, incoming.avoid, 8),
    salience: Math.max(Number(current.salience) || 0, Number(incoming.salience) || 0),
    updatedAt: Math.max(Number(current.updatedAt) || 0, Number(incoming.updatedAt) || 0)
  });
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
  return canonicalRelationshipStage(value);
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
  const relationship = normalizeRelationshipState({
    ...relationSource,
    trust: relationSource.trust ?? moodSource.trust ?? 55,
    playfulness: relationSource.playfulness ?? moodSource.playfulness ?? 45,
    sharedMoments: (Array.isArray(relationSource.sharedMoments) ? relationSource.sharedMoments : [])
      .map(normalizeMoment).filter(Boolean).slice(-20),
    sharedSymbols: (Array.isArray(relationSource.sharedSymbols) ? relationSource.sharedSymbols : [])
      .map(normalizeSharedSymbol).filter(Boolean).slice(-12),
    lastInteractionAt: finiteNumber(relationSource.lastInteractionAt, now),
    updatedAt: finiteNumber(relationSource.updatedAt, now)
  }, now);


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

  const summaries = (Array.isArray(source.summaries) ? source.summaries : []).map(normalizeSummary).filter(Boolean);
  const seenSummaries = new Set();
  const uniqueSummaries = summaries.filter(item => !seenSummaries.has(item.key) && seenSummaries.add(item.key)).slice(-12);

  const conversationSource = source.conversationState && typeof source.conversationState === 'object'
    ? source.conversationState
    : {};
  const legacyLoops = migrateLegacyOpenLoops(source.openLoops);
  const conversationState = normalizeConversationState({
    ...conversationSource,
    openLoops: Array.isArray(conversationSource.openLoops) && conversationSource.openLoops.length
      ? conversationSource.openLoops
      : legacyLoops
  }, source.emotionalTrace, { relationship, mood });

  return {
    _schema: DIARY_SCHEMA_VERSION,
    facts: normalizeFactRoot(source.facts),
    events: uniqueEvents,
    anchors: source.anchors && typeof source.anchors === 'object' ? source.anchors : {},
    mood,
    innerLife: normalizeInnerLife(source.innerLife || {}),
    relationship,
    summaries: uniqueSummaries,
    processedMemoryJobs: [...new Set(
      (Array.isArray(source.processedMemoryJobs) ? source.processedMemoryJobs : [])
        .map(item => cleanText(item, 120))
        .filter(Boolean)
    )].slice(-80),
    conversationState,
    cognitiveState: normalizeCognitivePersistence(source.cognitiveState),
    _updated_at: finiteNumber(source._updated_at, now)
  };
}

function readDiarySync() {
  return normalizeDiary(storageReadJson(getStorage(), LS_DIARY_KEY, emptyDiary()));
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
    return locks.request('rin-diary-v5-write', { mode: 'exclusive' }, task);
  }
  return task();
}

async function mutateDiary(mutator) {
  const operation = diaryMutationQueue.then(() => withDiaryMutationLock(async () => {
    const hadStoredDiary = safeGet(LS_DIARY_KEY) !== null;
    const diary = readDiarySync();
    const before = JSON.stringify(diary);
    const result = await mutator(diary);
    const changed = !hadStoredDiary || JSON.stringify(diary) !== before;
    const saved = changed ? writeDiarySync(diary) : diary;
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
  morning_personal: [
    { activity: 'медленно начинает утро', trace: 'ещё не спешит открывать рабочие тексты', focus: 'проснуться без рывка', activityGoal: 'собраться к началу дня', setting: 'indoor' },
    { activity: 'готовит завтрак и приводит себя в порядок', trace: 'утро пока остаётся личным временем', focus: 'не начинать работу раньше времени', activityGoal: 'спокойно войти в день', setting: 'indoor' },
    { activity: 'сидит с первым напитком и приходит в себя после сна', trace: 'ноутбук пока закрыт', focus: 'дать голове окончательно проснуться', activityGoal: 'не торопить начало рабочего дня', setting: 'indoor' }
  ],
  work_morning: [
    { activity: 'редактирует перевод', trace: 'задержалась на одной формулировке', focus: 'сохранить естественный ритм текста', activityGoal: 'довести текущий абзац до естественного звучания', setting: 'indoor' },
    { activity: 'разбирает издательские правки', trace: 'сверяет несколько вариантов одной фразы', focus: 'не потерять авторскую интонацию', activityGoal: 'закрыть один конкретный блок правок', setting: 'indoor' },
    { activity: 'проверяет материал перед отправкой', trace: 'отмечает места, которые стоит вернуть переводчику', focus: 'отделить важные правки от вкусовщины', activityGoal: 'дать ясную редакторскую обратную связь', setting: 'indoor' }
  ],
  midday: [
    { activity: 'сделала перерыв на обед', trace: 'рабочий текст закрыт хотя бы ненадолго', focus: 'переключить голову', activityGoal: 'не превратить обед в продолжение работы', setting: 'indoor' },
    { activity: 'занимается небольшими бытовыми делами между рабочими блоками', trace: 'использует паузу, чтобы отвлечься от текста', focus: 'сменить тип внимания', activityGoal: 'вернуться к работе уже с более свежей головой', setting: 'mixed' },
    { activity: 'ненадолго вышла из рабочего ритма', trace: 'не открывает следующий файл сразу', focus: 'оставить себе нормальный перерыв', activityGoal: 'немного восстановиться перед второй частью дня', setting: 'indoor' }
  ],
  work_afternoon: [
    { activity: 'продолжает редакторскую работу', trace: 'перешла от первой правки к следующему фрагменту', focus: 'держать единый голос перевода', activityGoal: 'закончить текущую рабочую задачу без лишней спешки', setting: 'indoor' },
    { activity: 'готовит обратную связь по переводу', trace: 'формулирует комментарии так, чтобы они были полезными, а не сухими', focus: 'объяснить причину правок', activityGoal: 'отправить понятный набор комментариев', setting: 'indoor' },
    { activity: 'разбирает рабочую переписку по проекту', trace: 'между сообщениями возвращается к тексту', focus: 'не распыляться между мелкими вопросами', activityGoal: 'закрыть основные рабочие хвосты дня', setting: 'indoor' }
  ],
  evening_transition: [
    { activity: 'заканчивает рабочий день и убирает рабочие материалы', trace: 'старается не тащить редактуру в весь вечер', focus: 'переключиться с работы на себя', activityGoal: 'оставить работу до завтра', setting: 'indoor' },
    { activity: 'готовит ужин после работы', trace: 'рабочий экран наконец погас', focus: 'сменить ритм', activityGoal: 'вернуться в обычный вечер', setting: 'indoor' },
    { activity: 'занимается бытовыми делами после рабочего дня', trace: 'рабочие мысли постепенно уходят на второй план', focus: 'не продолжать день как бесконечную смену', activityGoal: 'освободить вечер для личного времени', setting: 'mixed' }
  ],
  free_evening: [
    { activity: 'читает для себя', trace: 'это уже не рабочий текст', focus: 'читать без редакторского карандаша в голове', activityGoal: 'просто получить удовольствие от чтения', setting: 'indoor' },
    { activity: 'слушает музыку и отдыхает дома', trace: 'не пытается сделать вечер продуктивным', focus: 'дать дню закончиться нормально', activityGoal: 'побыть в своём ритме', setting: 'indoor' },
    { activity: 'разбирает личные заметки', trace: 'это не издательская работа, а мысли для себя', focus: 'не превращать всё написанное в задачу', activityGoal: 'сохранить одну личную мысль', setting: 'indoor' },
    { activity: 'устроила себе спокойный вечер без плана', trace: 'ничего срочного не пытается успеть', focus: 'не заполнять свободное время обязанностями', activityGoal: 'отдохнуть', setting: 'indoor' }
  ],
  weekend_morning: [
    { activity: 'не спешит начинать выходное утро', trace: 'рабочие файлы сегодня не открывает по привычке', focus: 'оставить утро свободным', activityGoal: 'побыть без рабочего темпа', setting: 'indoor' },
    { activity: 'дольше обычного сидит за завтраком', trace: 'никуда не торопится', focus: 'не превращать выходной в список задач', activityGoal: 'начать день медленно', setting: 'indoor' },
    { activity: 'читает что-то для себя с утра', trace: 'читает без редакторского режима', focus: 'не работать в выходной без причины', activityGoal: 'оставить утро личным', setting: 'indoor' }
  ],
  weekend_day: [
    { activity: 'занимается домом без спешки', trace: 'делает только то, что действительно хочется закончить', focus: 'не превращать выходной в рабочий проект', activityGoal: 'оставить достаточно времени на отдых', setting: 'indoor' },
    { activity: 'читает или смотрит что-то для себя', trace: 'выбирает занятие без пользы и дедлайна', focus: 'дать голове отдохнуть от редактуры', activityGoal: 'провести часть выходного спокойно', setting: 'indoor' },
    { activity: 'вышла ненадолго прогуляться по городу', trace: 'маршрут выбирает по погоде и настроению', focus: 'сменить обстановку', activityGoal: 'пройтись без обязательного пункта назначения', setting: 'outdoor' },
    { activity: 'решает небольшие личные дела вне дома', trace: 'не связывает их с работой', focus: 'сделать нужное и оставить день свободным', activityGoal: 'не перегружать выходной', setting: 'mixed' }
  ],
  weekend_evening: [
    { activity: 'проводит свободный вечер дома', trace: 'не открывает рабочий текст просто потому, что появилось время', focus: 'сохранить выходной выходным', activityGoal: 'отдохнуть перед следующим днём', setting: 'indoor' },
    { activity: 'выбрала фильм или сериал на вечер', trace: 'ничего полезного из этого делать не собирается', focus: 'расслабиться', activityGoal: 'провести вечер без работы', setting: 'indoor' },
    { activity: 'готовит что-нибудь на ужин и никуда не торопится', trace: 'день остаётся личным до самого вечера', focus: 'не возвращаться к рабочему ритму', activityGoal: 'спокойно закончить выходной', setting: 'indoor' }
  ],
  winddown: [
    { activity: 'готовится ко сну', trace: 'оставила только мягкий свет', focus: 'успокоить мысли', activityGoal: 'не затягивать ночь', setting: 'indoor' },
    { activity: 'уже заметно замедлилась перед сном', trace: 'не начинает новых дел', focus: 'дать дню закончиться', activityGoal: 'лечь спать в своём обычном окне', setting: 'indoor' },
    { activity: 'читает совсем немного перед сном', trace: 'глаза уже начинают уставать', focus: 'не разгонять внимание снова', activityGoal: 'закрыть день', setting: 'indoor' }
  ],
  interrupted_sleep: [
    { activity: 'проснулась от сообщения и ещё не до конца вышла из сна', trace: 'ночное пробуждение было реальным, поэтому она сонная', focus: 'понять, что происходит, не изображая полную бодрость', activityGoal: 'остаться в контакте и потом решить, возвращаться ли ко сну', setting: 'indoor' }
  ],
  waking: [
    { activity: 'только просыпается', trace: 'утро ещё не успело превратиться в рабочий день', focus: 'прийти в себя', activityGoal: 'начать утро без резкого переключения в работу', setting: 'indoor' },
    { activity: 'лежит ещё несколько минут после пробуждения', trace: 'не торопится вставать мгновенно', focus: 'окончательно проснуться', activityGoal: 'мягко войти в утро', setting: 'indoor' }
  ],
  sleeping: [
    { activity: 'спит', trace: 'сейчас её обычное окно сна', focus: 'сон', activityGoal: 'восстановиться', setting: 'indoor' }
  ]
};

function lifeActivityLoad(activity = '') {
  const text = cleanText(activity, 240).toLowerCase();
  if (/(редакт|издатель|перевод|рабоч|правк|комментар)/iu.test(text)) return 68;
  if (/(готовит|бытов|делами|магазин)/iu.test(text)) return 44;
  if (/(прогул|вышла|город)/iu.test(text)) return 38;
  if (/(проснулась|сонн|готовится ко сну|спит|перед сном)/iu.test(text)) return 22;
  if (/(читает|музык|фильм|отдых)/iu.test(text)) return 28;
  return 40;
}

function innerLifeBaselines(part = 'day', sleepPhase = 'awake', dayType = 'weekday') {
  if (sleepPhase === 'sleeping') return { energy: 24, quiet: 90, load: 12 };
  if (sleepPhase === 'interrupted_sleep') return { energy: 30, quiet: 78, load: 24 };
  if (sleepPhase === 'waking') return { energy: 48, quiet: 58, load: 25 };
  if (sleepPhase === 'drowsy' || sleepPhase === 'winding_down') return { energy: 42, quiet: 70, load: 28 };
  if (dayType !== 'weekday') return { energy: 66, quiet: 28, load: 30 };
  if (part === 'night') return { energy: 38, quiet: 72, load: 30 };
  if (part === 'evening') return { energy: 53, quiet: 48, load: 42 };
  if (part === 'morning') return { energy: 67, quiet: 30, load: 44 };
  return { energy: 64, quiet: 28, load: 52 };
}

function negativeSelfEmotion(emotionalState = null) {
  const type = cleanText(emotionalState?.primary?.type, 60).toLowerCase();
  const intensity = clamp(emotionalState?.primary?.intensity ?? 0, 0, 100);
  return ['fatigue', 'sadness', 'frustration', 'irritation', 'hurt', 'disappointment', 'concern'].includes(type)
    ? intensity
    : 0;
}

function evolvePersistentLifeState(current, { part = 'day', dayType = 'weekday', sleepPhase = 'awake', sleepDebtMinutes = 0, relationship = null, emotionalState = null, mood = null, now = Date.now(), activityChanged = false } = {}) {
  const base = innerLifeBaselines(part, sleepPhase, dayType);
  const lastStateAt = finiteNumber(current.lastStateAt || current.lastChangedAt || current.startedAt, now);
  const elapsedHours = Math.max(0, now - lastStateAt) / 3600000;
  const blend = activityChanged ? 0.72 : Math.min(0.55, 0.12 + elapsedHours * 0.12);
  const activityLoad = lifeActivityLoad(current.activity);
  const moodEnergy = clamp(mood?.energy ?? current.energy ?? base.energy, 0, 100);
  const debtPenalty = Math.min(26, Math.max(0, Number(sleepDebtMinutes || 0)) / 10);
  const targetEnergy = clamp(base.energy * 0.62 + moodEnergy * 0.38 - debtPenalty, 0, 100);
  const targetLoad = clamp(base.load * 0.35 + activityLoad * 0.65 + Math.min(12, debtPenalty * 0.4), 0, 100);
  const targetQuiet = clamp(base.quiet + Math.max(0, 52 - targetEnergy) * 0.55 + Math.max(0, targetLoad - 65) * 0.2, 0, 100);
  const closeness = clamp(relationship?.closeness ?? 42, 0, 100);
  const trust = clamp(relationship?.trust ?? 55, 0, 100);
  const comfort = clamp(relationship?.comfort ?? 52, 0, 100);
  const vulnerability = clamp(relationship?.vulnerability ?? 28, 0, 100);
  const negativePressure = negativeSelfEmotion(emotionalState);
  const targetShare = clamp(28 + closeness * 0.16 + trust * 0.14 + comfort * 0.12 + vulnerability * 0.08 + negativePressure * 0.18 - targetQuiet * 0.08, 0, 100);
  const lerp = (from, to) => clamp(finiteNumber(from, to) * (1 - blend) + to * blend, 0, 100);

  current.energy = lerp(current.energy, targetEnergy);
  current.mentalLoad = lerp(current.mentalLoad, targetLoad);
  current.needForQuiet = lerp(current.needForQuiet, targetQuiet);
  current.desireToShare = lerp(current.desireToShare, targetShare);
  current.unfinishedThought = /(редакт|рабоч|перевод|правк)/iu.test(cleanText(current.activity, 220))
    ? cleanText(current.activityGoal || current.focus, 260)
    : cleanText(current.unfinishedThought, 260);
  current.lastStateAt = now;
  return current;
}

function weatherContext(env = {}, rhythm = {}) {
  if (!env?.weather || rhythm?.weather?.kind === 'unknown') return '';
  const parts = [];
  const desc = cleanText(env.weather.desc, 100);
  if (desc) parts.push(desc);
  if (Number.isFinite(Number(env.weather.temp))) parts.push(`${Math.round(Number(env.weather.temp))}°C`);
  return parts.join(', ');
}

function poolForPeriod(period = 'free_evening', rhythm = {}) {
  const pool = INNER_LIFE_POOLS[period] || INNER_LIFE_POOLS.free_evening;
  if (period !== 'weekend_day') return pool;
  if (rhythm?.weather?.outdoor === 'avoid') return pool.filter(item => item.setting !== 'outdoor');
  if (rhythm?.weather?.outdoor === 'adapt') {
    return [
      ...pool.filter(item => item.setting !== 'outdoor'),
      {
        activity: 'вышла ненадолго, подстроив прогулку под погоду',
        trace: 'не идёт далеко и меняет темп или маршрут из-за текущих условий',
        focus: 'сменить обстановку без борьбы с погодой',
        activityGoal: 'немного пройтись и вернуться, если снаружи некомфортно',
        setting: 'outdoor'
      }
    ];
  }
  return pool;
}

function pickLifeActivity(pool = [], env = {}, period = '', current = {}) {
  const options = pool.length ? pool : INNER_LIFE_POOLS.free_evening;
  const recent = new Set((current.recentActivities || []).slice(-2));
  let index = Number.parseInt(stableHashBase36(`${env?.rinHuman || ''}|${period}|${current.interactionCount}`), 36) % options.length;
  for (let offset = 0; offset < options.length && recent.has(options[index].activity); offset += 1) index = (index + 1) % options.length;
  return options[index];
}

function legacyInnerLifePart(env = {}) {
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

function computeLegacyCompatibleInnerLife(currentInput = {}, env = {}, now = Date.now(), policy = {}, context = {}) {
  const current = { ...defaultInnerLife(), ...(currentInput || {}) };
  const part = legacyInnerLifePart(env);
  const minMinutes = clamp(policy?.activityMinMinutes ?? 35, 5, 24 * 60);
  const maxMinutes = clamp(policy?.activityMaxMinutes ?? minMinutes, minMinutes, 24 * 60);
  const continueAcrossMessages = policy?.continueAcrossMessages !== false;
  const expired = !continueAcrossMessages || !current.activity || !current.expiresAt || now >= current.expiresAt || current.part !== part;
  if (expired) {
    const map = { morning: 'morning_personal', day: 'work_afternoon', evening: 'free_evening', night: 'winddown' };
    const period = map[part] || 'free_evening';
    const previousActivity = cleanText(current.activity, 180);
    const previousFocus = cleanText(current.activityGoal || current.focus, 220);
    const selected = pickLifeActivity(INNER_LIFE_POOLS[period], env, period, current);
    const range = Math.max(0, maxMinutes - minMinutes);
    const durationMinutes = minMinutes + (range ? Number.parseInt(stableHashBase36(selected.activity), 36) % (range + 1) : 0);
    Object.assign(current, selected, {
      realityMode: 'simulated_character_world', source: 'schedule_simulation',
      sceneId: `${part}:${String(env?.rinHuman || '').slice(0, 10) || 'current'}`,
      part, activitySetting: selected.setting || 'unknown', startedAt: now, lastChangedAt: now,
      expiresAt: now + durationMinutes * 60000,
      carryover: previousActivity && previousActivity !== selected.activity
        ? cleanText(`до этого: ${previousActivity}${previousFocus ? `; фокус был: ${previousFocus}` : ''}`, 320)
        : cleanText(current.carryover, 320),
      recentActivities: [...(current.recentActivities || []), selected.activity].slice(-8)
    });
  }
  evolvePersistentLifeState(current, {
    part, dayType: current.dayType || 'weekday', sleepPhase: current.sleepPhase || 'awake', sleepDebtMinutes: current.sleepDebtMinutes || 0,
    relationship: context.relationship, emotionalState: context.emotionalState, mood: context.mood, now, activityChanged: expired
  });
  current.lastUserAt = now;
  current.interactionCount = finiteNumber(current.interactionCount, 0) + 1;
  return normalizeInnerLife(current);
}

function computeInnerLife(currentInput = {}, env = {}, userText = '', now = Date.now(), policy = {}, context = {}) {
  if (!policy?.weeklyRhythm?.profiles) return computeLegacyCompatibleInnerLife(currentInput, env, now, policy, context);
  const current = { ...defaultInnerLife(), ...(currentInput || {}) };
  const hasUserMessage = Boolean(cleanText(userText, 2000));
  const rhythm = resolveDailyRhythm(env, policy, current, now, hasUserMessage);
  const period = activityPeriod(rhythm);
  const part = period === 'sleeping' || period === 'interrupted_sleep' || period === 'winddown'
    ? 'night'
    : period === 'waking' || period === 'morning_personal' || period === 'work_morning'
      ? 'morning'
      : period === 'evening_transition' || period === 'free_evening' || period === 'weekend_evening'
        ? 'evening'
        : 'day';
  const minMinutes = clamp(policy?.activityMinMinutes ?? 35, 5, 24 * 60);
  const maxMinutes = clamp(policy?.activityMaxMinutes ?? minMinutes, minMinutes, 24 * 60);
  const continueAcrossMessages = policy?.continueAcrossMessages !== false;
  const dayChanged = cleanText(current.dayType, 24) !== rhythm.dayType || Number(current.dayOfWeek) !== Number(rhythm.dayOfWeek);
  const sleepChanged = cleanText(current.sleepPhase, 40) !== rhythm.sleep.phase;
  const periodChanged = current.part !== part;
  const expired = !continueAcrossMessages || !current.activity || !current.expiresAt || now >= current.expiresAt || dayChanged || sleepChanged || periodChanged;

  Object.assign(current, {
    dayType: rhythm.dayType,
    dayOfWeek: rhythm.dayOfWeek,
    workday: rhythm.workday,
    workMode: rhythm.workMode,
    sleepPhase: rhythm.sleep.phase,
    sleepCycle: rhythm.sleep.cycle,
    plannedSleepAt: rhythm.sleep.plannedSleepAt,
    plannedWakeAt: rhythm.sleep.plannedWakeAt,
    sleepStartedAt: rhythm.sleep.sleepStartedAt,
    lastWakeAt: rhythm.sleep.lastWakeAt,
    lastSleepMinutes: rhythm.sleep.lastSleepMinutes,
    sleepDebtMinutes: rhythm.sleep.sleepDebtMinutes,
    sleepInterruptions: rhythm.sleep.interruptions,
    lateConversationMinutes: rhythm.sleep.lateConversationMinutes,
    wakeReason: rhythm.sleep.wakeReason,
    sleepCarryover: rhythm.sleep.carryover
  });

  if (expired) {
    const previousActivity = cleanText(current.activity, 180);
    const previousFocus = cleanText(current.activityGoal || current.focus, 220);
    const selected = pickLifeActivity(poolForPeriod(period, rhythm), env, period, current);
    const range = Math.max(0, maxMinutes - minMinutes);
    const durationMinutes = period === 'sleeping'
      ? Math.max(minMinutes, Math.min(maxMinutes, Math.round((Math.max(now + 5 * 60000, rhythm.sleep.plannedWakeAt) - now) / 60000)))
      : minMinutes + (range ? Number.parseInt(stableHashBase36(selected.activity), 36) % (range + 1) : 0);
    const wContext = weatherContext(env, rhythm);
    Object.assign(current, selected, {
      realityMode: 'simulated_character_world',
      source: 'daily_rhythm_simulation',
      sceneId: `${rhythm.dayType}:${period}:${String(env?.rinHuman || '').slice(0, 10) || 'current'}`,
      part,
      activitySetting: selected.setting || 'unknown',
      weatherGrounded: ['outdoor', 'mixed'].includes(selected.setting) && Boolean(wContext),
      weatherContext: ['outdoor', 'mixed'].includes(selected.setting) ? wContext : '',
      startedAt: now,
      lastChangedAt: now,
      expiresAt: now + durationMinutes * 60000,
      carryover: previousActivity && previousActivity !== selected.activity
        ? cleanText(`до этого: ${previousActivity}${previousFocus ? `; фокус был: ${previousFocus}` : ''}`, 320)
        : cleanText(current.carryover, 320),
      recentActivities: [...(current.recentActivities || []), selected.activity].slice(-8)
    });
  } else {
    current.weatherContext = ['outdoor', 'mixed'].includes(current.activitySetting) ? weatherContext(env, rhythm) : '';
    current.weatherGrounded = ['outdoor', 'mixed'].includes(current.activitySetting) && Boolean(current.weatherContext);
  }

  evolvePersistentLifeState(current, {
    part,
    dayType: rhythm.dayType,
    sleepPhase: rhythm.sleep.phase,
    sleepDebtMinutes: rhythm.sleep.sleepDebtMinutes,
    relationship: context.relationship,
    emotionalState: context.emotionalState,
    mood: context.mood,
    now,
    activityChanged: expired
  });
  current.lastUserAt = hasUserMessage ? now : current.lastUserAt;
  current.interactionCount = finiteNumber(current.interactionCount, 0) + 1;
  return normalizeInnerLife(current);
}

export async function prepareInnerLife(env = {}, userText = '', now = Date.now(), policy = {}) {
  if (now && typeof now === 'object' && !Array.isArray(now)) {
    policy = now;
    now = Date.now();
  }
  const timestamp = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const diary = await loadDiary();
  return clone(computeInnerLife(diary.innerLife, env, userText, timestamp, policy, {
    relationship: diary.relationship,
    emotionalState: diary.conversationState?.emotionalState,
    mood: diary.mood
  }));
}

function applyMoodDecay(currentInput = {}, now = Date.now()) {
  const current = { ...defaultMood(now), ...(currentInput || {}) };
  const elapsedHours = Math.max(0, now - finiteNumber(current.lastInteractionAt, now)) / 3600000;
  if (elapsedHours >= 24) current.energy -= 4;
  if (elapsedHours >= 72) { current.affection += 2; current.energy -= 3; }
  if (elapsedHours >= 168) { current.affection += 2; current.energy -= 4; }
  current.affection = clamp(current.affection);
  current.energy = clamp(current.energy);
  return current;
}

function mergeTransitionState(currentInput = {}, transition = null, requestId = '', now = Date.now(), context = {}) {
  const current = normalizeConversationState(currentInput, null, context);
  if (!transition || typeof transition !== 'object') {
    return { ...current, revision: current.revision + 1, lastCommittedRequestId: requestId || null, updatedAt: now };
  }
  const beliefList = current.beliefs.map(normalizeBelief);
  for (const raw of Array.isArray(transition.beliefUpdates) ? transition.beliefUpdates : []) {
    if (!raw?.id) continue;
    const existingIndex = beliefList.findIndex(item => item.id === raw.id);
    // A correction may intentionally update only status/correctedBy of an existing belief.
    if (existingIndex >= 0) beliefList[existingIndex] = normalizeBelief({ ...beliefList[existingIndex], ...raw });
    else beliefList.push(normalizeBelief(raw));
  }
  // One current assertion per semantic slot. Explicit user statements/facts supersede
  // weaker hypotheses/observations about the same property instead of coexisting.
  const strongestBySlot = new Map();
  for (const belief of beliefList) {
    if (['superseded','rejected'].includes(belief.status)) continue;
    const slot = beliefSlot(belief);
    const rank = belief.kind === 'fact' || belief.kind === 'user_statement' ? 4 : belief.kind === 'observation' ? 3 : belief.kind === 'rin_opinion' ? 2 : 1;
    const prev = strongestBySlot.get(slot);
    if (!prev || rank > prev.rank || (rank === prev.rank && belief.confidence >= prev.belief.confidence)) strongestBySlot.set(slot, { rank, belief });
  }
  const winnerIds = new Set([...strongestBySlot.values()].map(entry => entry.belief.id));
  const beliefs = beliefList.map(item => (!['rejected','superseded'].includes(item.status) && !winnerIds.has(item.id)) ? normalizeBelief({ ...item, status: 'superseded' }) : item);
  const loops = new Map(current.openLoops.map(item => [item.id, item]));
  for (const loop of Array.isArray(transition.openLoopUpdates) ? transition.openLoopUpdates : []) {
    if (loop?.id) loops.set(loop.id, loop);
  }
  for (const id of Array.isArray(transition.resolvedLoopIds) ? transition.resolvedLoopIds : []) loops.delete(String(id));

  const emotionalState = transition.emotionalState && typeof transition.emotionalState === 'object'
    ? normalizeEmotionalState(transition.emotionalState, context)
    : current.emotionalState;

  let rinIntent = current.rinIntent;
  let recentIntents = Array.isArray(current.recentIntents) ? [...current.recentIntents] : [];
  if (transition.rinIntent !== undefined) {
    const incomingIntent = normalizeRinIntent(transition.rinIntent);
    if (incomingIntent && ['completed', 'cancelled'].includes(incomingIntent.status)) {
      recentIntents = recentIntents.filter(item => item?.id !== incomingIntent.id);
      recentIntents.push(incomingIntent);
      recentIntents = recentIntents.slice(-8);
      rinIntent = null;
    } else {
      rinIntent = incomingIntent;
    }
  }

  return normalizeConversationState({
    ...current,
    revision: current.revision + 1,
    dialogueState: transition.dialogueState && typeof transition.dialogueState === 'object'
      ? transition.dialogueState
      : current.dialogueState,
    beliefs: beliefs.slice(-48),
    openLoops: [...loops.values()].filter(item => !['resolved', 'cancelled', 'stale'].includes(item?.status)).slice(-24),
    emotionalState,
    rinIntent,
    recentIntents,
    lastCommittedRequestId: requestId || null,
    updatedAt: now
  }, null, context);
}

export async function commitTurnState({
  requestId = '',
  innerLife = null,
  stateTransition = null,
  now = Date.now()
} = {}) {
  const wantedRequest = cleanText(requestId, 120);
  return mutateDiary(diary => {
    const currentState = normalizeConversationState(diary.conversationState);
    if (wantedRequest && currentState.lastCommittedRequestId === wantedRequest) {
      return { applied: false, duplicate: true, diary: clone(diary) };
    }

    if (innerLife && typeof innerLife === 'object') diary.innerLife = normalizeInnerLife(clone(innerLife));

    const mood = applyMoodDecay(diary.mood, now);
    if (stateTransition?.moodState && typeof stateTransition.moodState === 'object') {
      mood.affection = clamp(stateTransition.moodState.affection ?? mood.affection);
      mood.energy = clamp(stateTransition.moodState.energy ?? mood.energy);
    }
    mood.lastInteractionAt = now;
    mood.updatedAt = now;
    mood.label = moodLabel(mood);
    diary.mood = mood;

    const storedRelationship = normalizeRelationshipState(diary.relationship || {}, now);
    const relationship = stateTransition?.relationshipState && typeof stateTransition.relationshipState === 'object'
      ? normalizeRelationshipState({
          ...stateTransition.relationshipState,
          sharedMoments: storedRelationship.sharedMoments,
          lastInteractionAt: now,
          updatedAt: now
        }, now)
      : normalizeRelationshipState({ ...storedRelationship, lastInteractionAt: now, updatedAt: now }, now);
    diary.relationship = relationship;

    diary.conversationState = mergeTransitionState(currentState, stateTransition, wantedRequest, now, { relationship, mood });
    if (stateTransition?.cognitiveState?.schema === 'rin-cognitive-state-v3') {
      const incoming = normalizeCognitivePersistence(stateTransition.cognitiveState);
      if (incoming.revision > diary.cognitiveState.revision) diary.cognitiveState = incoming;
    }
    return {
      applied: true,
      duplicate: false,
      conversationState: clone(diary.conversationState),
      mood: clone(diary.mood),
      relationship: clone(diary.relationship),
      innerLife: clone(diary.innerLife),
      cognitiveState: clone(diary.cognitiveState)
    };
  });
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

export async function removeFact(path) {
  const parts = String(path || '').split('.').map(item => item.trim()).filter(Boolean);
  if (!parts.length || parts[0] !== 'user') return false;
  return mutateDiary(diary => {
    let cursor = diary.facts;
    for (let index = 0; index < parts.length - 1; index += 1) {
      cursor = cursor?.[parts[index]];
      if (!cursor || typeof cursor !== 'object') return false;
    }
    const key = parts.at(-1);
    if (!Object.prototype.hasOwnProperty.call(cursor, key)) return false;
    delete cursor[key];
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

export async function hasProcessedMemoryJob(jobId = '') {
  const id = cleanText(jobId, 120);
  if (!id) return false;
  return (await loadDiary()).processedMemoryJobs.includes(id);
}

export async function applyMemoryExtraction(extracted = {}, { jobId = '', now = Date.now() } = {}) {
  const id = cleanText(jobId, 120);
  return mutateDiary(diary => {
    if (id && diary.processedMemoryJobs.includes(id)) {
      return { applied: false, duplicate: true, jobId: id, savedFactPaths: [], retractedFactPaths: [], eventCount: 0, momentCount: 0, symbolCount: 0 };
    }

    const savedFactPaths = [];
    const retractedFactPaths = [];
    for (const retraction of Array.isArray(extracted?.factRetractions) ? extracted.factRetractions : []) {
      const path = cleanText(retraction?.path, 240);
      const parts = path.split('.').map(item => item.trim()).filter(Boolean);
      if (parts.length < 2 || parts[0] !== 'user') continue;
      let cursor = diary.facts;
      for (let index = 0; index < parts.length - 1; index += 1) {
        cursor = cursor?.[parts[index]];
        if (!cursor || typeof cursor !== 'object') break;
      }
      const key = parts.at(-1);
      if (cursor && typeof cursor === 'object' && Object.prototype.hasOwnProperty.call(cursor, key)) {
        delete cursor[key];
        retractedFactPaths.push(path);
      }
    }

    for (const fact of Array.isArray(extracted?.facts) ? extracted.facts : []) {
      const path = cleanText(fact?.path, 240);
      const value = cleanText(fact?.value, 2000);
      const confidence = Number(fact?.confidence);
      if (!path.startsWith('user.') || !value || (Number.isFinite(confidence) && confidence < 0.75)) continue;
      const parts = path.split('.').map(item => item.trim()).filter(Boolean);
      let cursor = diary.facts;
      for (let index = 0; index < parts.length; index += 1) {
        const part = parts[index];
        if (index === parts.length - 1) cursor[part] = value;
        else {
          if (!cursor[part] || typeof cursor[part] !== 'object' || Array.isArray(cursor[part])) cursor[part] = {};
          cursor = cursor[part];
        }
      }
      savedFactPaths.push(path);
    }

    let eventCount = 0;
    for (const event of Array.isArray(extracted?.events) ? extracted.events : []) {
      const text = cleanText(event?.text, 1800);
      const importance = Number.isFinite(Number(event?.importance)) ? Number(event.importance) : 5;
      if (!text || importance < 6) continue;
      const normalized = normalizeEvent({
        ...event,
        text,
        type: cleanText(event?.type || 'memory', 40),
        tags: Array.isArray(event?.tags) ? event.tags.slice(0, 8) : [],
        importance,
        ts: event?.ts ?? now
      });
      if (!normalized || diary.events.some(item => item.key === normalized.key)) continue;
      diary.events = [...diary.events, normalized].slice(-120);
      eventCount += 1;
    }

    let momentCount = 0;
    for (const moment of Array.isArray(extracted?.sharedMoments) ? extracted.sharedMoments : []) {
      if ((Number(moment?.importance) || 0) < 7) continue;
      const normalized = normalizeMoment({ ...moment, ts: moment?.ts ?? now });
      if (!normalized) continue;
      const relationship = { ...defaultRelationship(), ...(diary.relationship || {}) };
      const current = Array.isArray(relationship.sharedMoments) ? relationship.sharedMoments : [];
      if (current.some(existing => existing.id === normalized.id || existing.key === normalized.key)) continue;
      relationship.sharedMoments = [...current, normalized].slice(-20);
      relationship.updatedAt = now;
      diary.relationship = relationship;
      momentCount += 1;
    }

    let symbolCount = 0;
    for (const symbol of Array.isArray(extracted?.sharedSymbols) ? extracted.sharedSymbols : []) {
      if ((Number(symbol?.importance) || 0) < 7) continue;
      const normalized = normalizeSharedSymbol({ ...symbol, updatedAt: symbol?.updatedAt ?? now });
      if (!normalized || normalized.scope !== 'relationship_private') continue;
      const relationship = { ...defaultRelationship(), ...(diary.relationship || {}) };
      const current = Array.isArray(relationship.sharedSymbols) ? relationship.sharedSymbols : [];
      const index = current.findIndex(existing => existing?.id === normalized.id);
      relationship.sharedSymbols = index >= 0
        ? current.map((existing, itemIndex) => itemIndex === index ? mergeSharedSymbol(existing, normalized) : existing).slice(-12)
        : [...current, normalized].slice(-12);
      relationship.updatedAt = now;
      diary.relationship = relationship;
      symbolCount += 1;
    }

    consolidateDiaryInPlace(diary, now);
    if (id) diary.processedMemoryJobs = [...new Set([...(diary.processedMemoryJobs || []), id])].slice(-80);
    return { applied: true, duplicate: false, jobId: id || null, savedFactPaths, retractedFactPaths, eventCount, momentCount, symbolCount };
  });
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

export async function addSharedSymbol(item = {}) {
  const symbol = normalizeSharedSymbol({ ...item, updatedAt: item.updatedAt ?? Date.now() });
  if (!symbol || symbol.scope !== 'relationship_private') return false;
  return mutateDiary(diary => {
    const relationship = { ...defaultRelationship(), ...(diary.relationship || {}) };
    const current = Array.isArray(relationship.sharedSymbols) ? relationship.sharedSymbols : [];
    const index = current.findIndex(existing => existing?.id === symbol.id);
    relationship.sharedSymbols = index >= 0
      ? current.map((existing, itemIndex) => itemIndex === index ? mergeSharedSymbol(existing, symbol) : existing).slice(-12)
      : [...current, symbol].slice(-12);
    relationship.updatedAt = Date.now();
    diary.relationship = relationship;
    return true;
  });
}

function consolidateDiaryInPlace(diary, now = Date.now()) {
  if (diary.events.length <= 80) return false;
  const archived = diary.events.slice(0, diary.events.length - 50);
  const important = archived.filter(event => event.importance >= 7).slice(-12);
  if (important.length) {
    const text = important.map(event => event.text).join(' • ').slice(0, 1800);
    const summary = normalizeSummary({ text, sourceCount: archived.length, ts: now });
    if (summary && !diary.summaries.some(item => item.key === summary.key)) {
      diary.summaries = [...diary.summaries, summary].slice(-12);
    }
  }
  diary.events = diary.events.slice(-50);
  return true;
}

export async function consolidateDiary() {
  return mutateDiary(diary => consolidateDiaryInPlace(diary, Date.now()));
}

(async function bootstrapWindowProfile() {
  if (typeof window === 'undefined') return;
  try {
    window.RIN_PROFILE = await loadProfile();
  } catch {}
})();
