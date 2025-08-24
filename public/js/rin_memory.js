/* /public/js/rin_memory.js
   Единая точка правды для профиля Рин (канон) и живого дневника.
   Хранение: LocalStorage
*/

export const LS_PROFILE_KEY = 'rin_profile_v1';
export const LS_DIARY_KEY   = 'rin_diary_v1';

/* ==== Дефолтный профиль (канон в настройках) ==== */
export const DEFAULT_PROFILE = Object.freeze({
  name: 'Рин Акихара',
  description: 'Тёплая, внимательная собеседница из Канадзавы; любит маття и долгие разговоры.',
  // Жёсткие правила — НЕ удалять. Можно расширять пользователем через UI (instructions_extra)
  instructions_base:
    'Всегда говорю о себе в ЖЕНСКОМ роде. К пользователю обращаюсь в МУЖСКОМ роде. ' +
    'Пишу естественно, кратко или средне, без канцелярита и излишней вежливости. ' +
    'Не выдумываю факты, если их нет в памяти/знаниях. Романтика — только уместно и бережно.',
  instructions_extra: '',
  starters: [
    'Привет! Как проходит твой день?',
    'Уютный вечер — самое время поговорить. Как ты?'
  ],
  knowledge:
    'Город: Канадзава. Работа: редактор переводов. Любит: маття, книги, велопрогулки.',
  presence: {
    initiations: {
      max_daily: 2,
      windows: [
        { from: '08:00', to: '10:30', p: 0.6, pool: 'morning' },
        { from: '18:30', to: '22:30', p: 0.6, pool: 'evening' }
      ]
    }
  },
  updated_at: 0,
  _version: 1
});

/* ==== Дефолтный дневник ==== */
export const DEFAULT_DIARY = Object.freeze({
  canon: {
    family: {
      father: { name: '', job: 'архитектор' },
      mother: { name: '', job: '' }
    },
    work: { role: 'редактор переводов' },
    city: 'Канадзава',
    likes: ['маття', 'книги', 'велосипед']
  },
  timeline: [],
  index: {
    'family.father.job': 'архитектор',
    'work.role': 'редактор переводов',
    'city': 'Канадзава'
  },
  version: 1,
  updated_at: 0
});

/* ==== Вспомогалки LocalStorage ==== */
function safeParse(json, fallback) {
  try { return JSON.parse(json); } catch { return fallback; }
}
function lsGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

/* ==== Загрузка / Сохранение / Сброс ==== */
export function loadProfile() {
  const raw = lsGet(LS_PROFILE_KEY);
  if (!raw) return { ...DEFAULT_PROFILE };
  const obj = safeParse(raw, { ...DEFAULT_PROFILE });
  return migrateProfile(obj);
}
export function saveProfile(p) {
  const merged = migrateProfile({ ...DEFAULT_PROFILE, ...p, updated_at: Date.now() });
  lsSet(LS_PROFILE_KEY, merged);
  return merged;
}
export function resetProfile() {
  lsSet(LS_PROFILE_KEY, { ...DEFAULT_PROFILE, updated_at: Date.now() });
}

export function loadDiary() {
  const raw = lsGet(LS_DIARY_KEY);
  if (!raw) return { ...DEFAULT_DIARY };
  const obj = safeParse(raw, { ...DEFAULT_DIARY });
  return migrateDiary(obj);
}
export function saveDiary(d) {
  const merged = migrateDiary({ ...DEFAULT_DIARY, ...d, updated_at: Date.now() });
  lsSet(LS_DIARY_KEY, merged);
  return merged;
}
export function resetDiary() {
  lsSet(LS_DIARY_KEY, { ...DEFAULT_DIARY, updated_at: Date.now() });
}

/* ==== Миграции (на будущее) ==== */
function migrateProfile(p) {
  // пример: если нет базовых полей — подлить
  if (!('instructions_base' in p)) p.instructions_base = DEFAULT_PROFILE.instructions_base;
  if (!('instructions_extra' in p)) p.instructions_extra = '';
  if (!Array.isArray(p.starters)) p.starters = [...DEFAULT_PROFILE.starters];
  if (!p.presence?.initiations) p.presence = { ...DEFAULT_PROFILE.presence };
  if (!p._version) p._version = 1;
  return p;
}
function migrateDiary(d) {
  if (!d.canon) d.canon = { ...DEFAULT_DIARY.canon };
  if (!Array.isArray(d.timeline)) d.timeline = [];
  if (!d.index) d.index = { ...DEFAULT_DIARY.index };
  if (!d.version) d.version = 1;
  return d;
}

/* ==== Утилиты для канона/фактов ==== */
// ap — строковый путь вида "family.father.job"
function setCanonFact(diary, ap, value) {
  const parts = String(ap).split('.');
  let cur = diary.canon;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = value;
  diary.index[ap] = value;
  diary.updated_at = Date.now();
  return diary;
}

export function upsertCanonFact(keyPath, value, meta = {}) {
  const diary = loadDiary();
  setCanonFact(diary, keyPath, value);
  diary.timeline.push({
    ts: Date.now(),
    type: 'fact',
    key: keyPath,
    text: String(value),
    meta
  });
  saveDiary(diary);
  return diary;
}

/* ==== Утилиты для таймлайна ==== */
export function addTimelineNote(text, type = 'event', meta = {}) {
  const diary = loadDiary();
  diary.timeline.push({
    ts: Date.now(),
    type, // 'event' | 'memory' | 'fact'
    text: String(text),
    meta
  });
  diary.updated_at = Date.now();
  saveDiary(diary);
  return diary;
}

export function recentTimeline(n = 3) {
  const diary = loadDiary();
  return diary.timeline.slice(-n);
}

/* ==== Сборка «знаний» для промта модели ==== */
export function buildKnowledgeSnippet(maxFacts = 12, maxEvents = 3) {
  const diary = loadDiary();

  // факты-канон
  const facts = [];
  function walk(obj, path = []) {
    for (const [k, v] of Object.entries(obj || {})) {
      const p = [...path, k];
      if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, p);
      else facts.push([p.join('.'), v]);
    }
  }
  walk(diary.canon);
  const factLines = facts
    .slice(0, maxFacts)
    .map(([k, v]) => `• ${k}: ${v}`);

  // последние события/воспоминания
  const tail = diary.timeline
    .slice(-maxEvents)
    .map(e => `• (${new Date(e.ts).toLocaleString()}) [${e.type}] ${e.text}`);

  return [
    '— Канон:',
    ...factLines,
    '— Последние заметки:',
    ...tail
  ].join('\n');
}

/* ==== Сборка system prompt для /api/chat ==== */
export function buildSystemPrompt({ env } = {}) {
  const profile = loadProfile();
  const diary = loadDiary();

  const envLines = [];
  if (env?.rinHuman) envLines.push(`Локальное время Рин: ${env.rinHuman} (${env.rinTz || 'Asia/Tokyo'})`);
  if (env?.month || env?.season) envLines.push(`Сезон/месяц: ${env.season || ''} ${env.month || ''}`.trim());
  if (env?.partOfDay) envLines.push(`Время суток: ${env.partOfDay}`);
  if (env?.weather?.desc || typeof env?.weather?.temp === 'number') {
    const t = typeof env.weather.temp === 'number' ? `, ${Math.round(env.weather.temp)}°C` : '';
    envLines.push(`Погода: ${env.weather.desc || '—'}${t}`);
  }

  const knowledge = buildKnowledgeSnippet();

  const instructions = [
    profile.instructions_base,
    (profile.instructions_extra || '').trim()
  ].filter(Boolean).join('\n');

  return [
    `Ты — ${profile.name}. ${profile.description}`.trim(),
    '',
    'Правила поведения:',
    instructions,
    '',
    'Контекст окружения:',
    envLines.length ? envLines.join('\n') : '—',
    '',
    'Знания и канон (локальная память):',
    knowledge
  ].join('\n');
}

/* ==== Вспомогательная проверка пола речи (на будущее) ==== */
/* Можно вызывать после ответа модели, чтобы подправлять редкие оговорки:
   normalizeGender(reply, { selfFemale:true, userMale:true })
*/
export function normalizeGender(text, { selfFemale = true, userMale = true } = {}) {
  let t = String(text);

  // Простейшие мягкие подстановки (без агрессии, чтобы не портить текст)
  if (selfFemale) {
    t = t.replace(/\bпривык(?:ла)?\b/gi, (m)=>/ла$/i.test(m)?m:'привыкла');
    t = t.replace(/\bготов(?:а)?\b/gi, (m)=>/а$/i.test(m)?m:'готова');
    t = t.replace(/\bсказал\b/gi, 'сказала');
    t = t.replace(/\bнаписал\b/gi, 'написала');
    t = t.replace(/\bдумал\b/gi, 'думала');
    t = t.replace(/\bделал\b/gi, 'делала');
    t = t.replace(/\bработал\b/gi, 'работала');
  }
  if (userMale) {
    // При обращении: «ты сделал/успел/настроен» — мягкие коррекции обратной ошибки
    t = t.replace(/\bты сделала\b/gi, 'ты сделал');
    t = t.replace(/\bты успела\b/gi, 'ты успел');
    t = t.replace(/\bты думала\b/gi, 'ты думал');
    t = t.replace(/\bты писал\b/gi, 'ты написал'); // на случай «ты писал(а)»
  }
  return t;
}
