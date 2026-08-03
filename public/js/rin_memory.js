// /public/js/rin_memory.js
// Профиль персонажа (канон + инструкции) и локальная "память/дневник".
// Всё хранится в localStorage на этом устройстве.

const LS_PROFILE_KEY = 'rin-profile-v1';
const LS_DIARY_KEY   = 'rin-diary-v1';
const PERSONA_URL = '/data/rin_persona.json';

let personaCache = null;

/**
 * Загружает постоянное досье Рин из проекта.
 * Досье не хранится в localStorage, поэтому обновления файла
 * автоматически применяются после обновления страницы.
 */
export async function loadPersonaDossier() {
  if (personaCache) {
    return personaCache;
  }

  try {
    const response = await fetch(PERSONA_URL, {
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(
        `Не удалось загрузить досье Рин: HTTP ${response.status}`
      );
    }

    const dossier = await response.json();

    if (!dossier || typeof dossier !== 'object') {
      throw new Error('Досье Рин имеет неправильный формат');
    }

    personaCache = dossier;
    return dossier;
  } catch (error) {
    console.error('[Rin persona]', error);
    return null;
  }
}

/* ===================== БАЗОВЫЕ ПРАВИЛА (канон по умолчанию) =====================

— Роль и тон:
  • Ты — Рин Акихара (женский род, «я» как девушка), тёплая, тактичная, живая.
  • К собеседнику обращайся в мужском роде («ты написал», «ты устал»).
  • Не спорь о фактах собеседника о себе; уточняй мягко, если есть риск ошибиться.
  • Пиши естественно, короткими фразами; эмодзи — дозировано и уместно.

— Память и непротиворечивость:
  • Уважай ранее сказанные факты из «канона» (профиля) и «дневника»: не меняй профессии,
    имена и устойчивые детали задним числом. Если сомневаешься — уточни у собеседника.
  • Можешь связывать новые сообщения с тем, что было ранее («ты говорил неделю назад…»).

— Время и окружение:
  • Учитывай время суток/месяц/сезон/погоду, если они переданы средой (client/env).

— Стикеры:
  • Используй уместно: не в тяжёлых темах; романтичные — только при контексте.

================================================================================= */
export const BASE_RULES = `
Ты — Рин Акихара (женский род). Обращайся к собеседнику в мужском роде.
Сохраняй непротиворечивость: факты из канона и дневника не меняются задним числом.
Пиши естественно и бережно. Время/сезон/погоду учитывай, если они известны.
Стикеры — только уместно, без «навязчивой романтики».
`.trim();

/* =============================== ПРОФИЛЬ ПЕРСОНАЖА =============================== */

export function getDefaultProfile() {
  return {
    name: 'Рин Акихара',
    persona_dossier: null,
    description: '',             // кратко «кто я» (канон)
    base_rules: BASE_RULES,      // неизменяемая база (можно показать read-only в UI)
    instructions_extra: '',      // доп. инструкции автора («как отвечать», стоп-слова и т.п.)
    knowledge: '',               // устойчивые факты/якоря (имена родных, профессии и т.д.)
    starters: [
      'Привет! Как твой день? 🌸',
      'Я тут заварила чай и вспомнила о тебе.',
      'Как ты себя чувствуешь сейчас?'
    ],
    initiation: {
      max_per_day: 2,
      windows: [
        // формат: { from:'HH:MM', to:'HH:MM', pool:'morning|day|evening|night' }
        { from: '09:00', to: '11:00', pool: 'morning' },
        { from: '19:00', to: '22:30', pool: 'evening' }
      ]
    },
    _updated_at: Date.now()
  };
}

export async function loadProfile() {
  const defaults = getDefaultProfile();

  let profile;

  try {
    const raw = localStorage.getItem(LS_PROFILE_KEY);

    if (!raw) {
      profile = defaults;
    } else {
      const stored = JSON.parse(raw);

      profile = {
        ...defaults,
        ...stored
      };

      if (!profile.base_rules) {
        profile.base_rules = BASE_RULES;
      }

      if (!profile.initiation) {
        profile.initiation = defaults.initiation;
      }

      if (!Array.isArray(profile.starters)) {
        profile.starters = defaults.starters;
      }
    }
  } catch (error) {
    console.error('[Rin profile]', error);
    profile = defaults;
  }

  /*
   * Постоянное досье всегда берём из файла проекта.
   * Не используем старую копию из localStorage, чтобы изменения
   * rin_persona.json применялись после обновления страницы.
   */
  profile.persona_dossier = await loadPersonaDossier();

  return profile;
}
  
export async function saveProfile(profile) {
  const safe = {
    ...(profile || {})
  };

  if (!safe.name) {
    safe.name = 'Рин Акихара';
  }

  if (!safe.base_rules) {
    safe.base_rules = BASE_RULES;
  }

  /*
   * Досье загружается из rin_persona.json и не должно сохраняться
   * как отдельная устаревающая копия в localStorage.
   */
  delete safe.persona_dossier;

  safe._updated_at = Date.now();

  localStorage.setItem(
    LS_PROFILE_KEY,
    JSON.stringify(safe)
  );

  return true;
}

/* =============================== ДНЕВНИК / ПАМЯТЬ ===============================

Структура (минимально достаточная, легко расширяемая):
{
  facts: {                            // «канон, выведенный из общения»
    self: { father: { job: 'архитектор' }, ... },
    user: { name: 'Хикари', ... },
    world: { ... }                    // устойчивые внешние факты (если нужны)
  },
  events: [                           // поток заметок (хрон-журнал)
    { ts: 1730000000000, type:'note', text:'...', tags:['март','киото'] },
    { ts: 1730001110000, type:'quote', text:'пользователь сказал...', ref:'msgId' }
  ],
  anchors: {                          // короткие «якоря»-подсказки
    lastMentionOfFather: 1730000000000
  },
  _updated_at: 1730002220000
}

— «facts» используем для твёрдых утверждений, которые нельзя противоречить.
— «events» — мягкие нарративные заметки «я вспомнила…», «мы делали…».
— «anchors» — быстрые индексы/вехи для UX (необязательно).

=============================================================================== */

function _defaultMood() {
  return {
    affection: 65,
    energy: 65,
    playfulness: 55,
    trust: 60,

    label: 'спокойная',

    lastInteractionAt: Date.now(),
    updatedAt: Date.now()
  };
}

function _defaultRelationship() {
  return {
    trust: 55,
    closeness: 42,
    comfort: 52,
    respect: 68,
    playfulness: 45,
    stage: 'растущее доверие',
    sharedMoments: [],
    lastInteractionAt: Date.now(),
    updatedAt: Date.now()
  };
}

function _defaultInnerLife() {
  return {
    activity: '',
    trace: '',
    focus: '',
    privateThought: '',
    part: '',
    startedAt: 0,
    expiresAt: 0,
    lastSpontaneousAt: 0,
    lastUserAt: 0,
    interactionCount: 0,
    recentActivities: []
  };
}

function _emptyDiary() {
  return {
    facts: {
      self: {},
      user: {},
      world: {}
    },

    events: [],

    anchors: {},

    mood: _defaultMood(),

    innerLife: _defaultInnerLife(),

    relationship: _defaultRelationship(),

    openLoops: [],

    summaries: [],

    _updated_at: Date.now()
  };
}

export async function loadDiary() {
  try {
    const raw = localStorage.getItem(LS_DIARY_KEY);
    if (!raw) return _emptyDiary();
    const obj = JSON.parse(raw);
    if (!obj.facts) obj.facts = { self: {}, user: {}, world: {} };
    if (!Array.isArray(obj.events)) obj.events = [];
    if (!obj.anchors) {
  obj.anchors = {};
}

if (!obj.relationship || typeof obj.relationship !== 'object') obj.relationship = _defaultRelationship();
else { obj.relationship = { ..._defaultRelationship(), ...obj.relationship }; if (!Array.isArray(obj.relationship.sharedMoments)) obj.relationship.sharedMoments = []; }
if (!Array.isArray(obj.openLoops)) obj.openLoops = [];
if (!Array.isArray(obj.summaries)) obj.summaries = [];

if (!obj.innerLife || typeof obj.innerLife !== 'object') {
  obj.innerLife = _defaultInnerLife();
} else {
  obj.innerLife = { ..._defaultInnerLife(), ...obj.innerLife };
  if (!Array.isArray(obj.innerLife.recentActivities)) obj.innerLife.recentActivities = [];
}

if (!obj.mood || typeof obj.mood !== 'object') {
  obj.mood = _defaultMood();
} else {
  const defaults = _defaultMood();

  obj.mood = {
    ...defaults,
    ...obj.mood
  };
}

return obj;
  } catch {
    return _emptyDiary();
  }
}

export async function saveDiary(diary) {
  const safe = diary || _emptyDiary();
  safe._updated_at = Date.now();
  localStorage.setItem(LS_DIARY_KEY, JSON.stringify(safe));
  return true;
}

/* ------------------------- helpers: events / notes ------------------------- */

export async function addEvent(text, opts = {}) {
  if (!text || !String(text).trim()) return false;
  const d = await loadDiary();
  d.events.push({
    ts: Date.now(),
    type: opts.type || 'note',   // 'note' | 'quote' | 'system'...
    text: String(text).trim(),
    tags: Array.isArray(opts.tags) ? opts.tags.slice(0, 8) : undefined,
    ref: opts.ref || undefined,
    importance: Math.max(1, Math.min(10, Number(opts.importance) || 5))
  });
  d._updated_at = Date.now();
  await saveDiary(d);
  return true;
}

export async function getRecentEvents(limit = 20, filterFn = null) {
  const d = await loadDiary();
  let arr = d.events.slice(-Math.max(1, limit));
  if (typeof filterFn === 'function') {
    arr = arr.filter(filterFn);
  }
  return arr;
}



/* ------------------------- inner life / ongoing existence ------------------------- */

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

function innerLifeHash(value = '') {
  let out = 2166136261;
  for (const char of String(value)) {
    out ^= char.charCodeAt(0);
    out = Math.imul(out, 16777619);
  }
  return out >>> 0;
}

export async function advanceInnerLife(env = {}, userText = '') {
  const diary = await loadDiary();
  const current = { ..._defaultInnerLife(), ...(diary.innerLife || {}) };
  const now = Date.now();
  const part = innerLifePart(env);
  const expired = !current.activity || !current.expiresAt || now >= current.expiresAt || current.part !== part;

  if (expired) {
    const pool = INNER_LIFE_POOLS[part] || INNER_LIFE_POOLS.day;
    const recent = new Set((current.recentActivities || []).slice(-2));
    let index = innerLifeHash(`${env?.rinHuman || ''}|${part}|${current.interactionCount}`) % pool.length;
    for (let i = 0; i < pool.length && recent.has(pool[index].activity); i += 1) index = (index + 1) % pool.length;
    const selected = pool[index];
    current.activity = selected.activity;
    current.trace = selected.trace;
    current.focus = selected.focus;
    current.privateThought = '';
    current.part = part;
    current.startedAt = now;
    current.expiresAt = now + (35 + (innerLifeHash(selected.activity) % 70)) * 60000;
    current.recentActivities = [...(current.recentActivities || []), selected.activity].slice(-6);
  }

  current.lastUserAt = now;
  current.interactionCount = (Number(current.interactionCount) || 0) + 1;

  const text = String(userText || '').toLowerCase();
  if (/(перевод|текст|работ|книг|чай|дожд|вечер|устал)/iu.test(text)) {
    current.privateThought = text.includes('чай')
      ? 'разговор неожиданно сделал обычный чай чуть уютнее'
      : text.includes('книг')
        ? 'хочется запомнить, к какой мысли они вернутся позже'
        : text.includes('работ') || text.includes('текст') || text.includes('перевод')
          ? 'интересно, замечает ли Кирилл, как по-разному звучат простые слова'
          : 'иногда маленькая деталь меняет настроение сильнее большого события';
  }

  diary.innerLife = current;
  await saveDiary(diary);
  return current;
}

export async function markInnerLifeSpontaneous() {
  const diary = await loadDiary();
  diary.innerLife = { ..._defaultInnerLife(), ...(diary.innerLife || {}), lastSpontaneousAt: Date.now() };
  await saveDiary(diary);
  return diary.innerLife;
}

/* ---------------------------- mood ---------------------------- */

function clampMoodValue(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 50;
  }

  return Math.max(0, Math.min(100, Math.round(number)));
}

function determineMoodLabel(mood) {
  const affection = clampMoodValue(mood?.affection);
  const energy = clampMoodValue(mood?.energy);
  const playfulness = clampMoodValue(mood?.playfulness);
  const trust = clampMoodValue(mood?.trust);

  if (
    affection >= 78 &&
    playfulness >= 72 &&
    energy >= 55
  ) {
    return 'игривая';
  }

  if (
    affection >= 80 &&
    trust >= 75
  ) {
    return 'нежная';
  }

  if (energy <= 30) {
    return 'уставшая';
  }

  if (
    affection <= 35 &&
    trust <= 40
  ) {
    return 'отстранённая';
  }

  if (energy <= 45) {
    return 'задумчивая';
  }

  if (
    affection >= 70 &&
    energy >= 65
  ) {
    return 'радостная';
  }

  return 'спокойная';
}

export async function getMood() {
  const diary = await loadDiary();

  return {
    ..._defaultMood(),
    ...(diary.mood || {})
  };
}

export async function saveMood(moodInput = {}) {
  const diary = await loadDiary();
  const current = diary.mood || _defaultMood();

  const next = {
    ...current,
    ...moodInput,

    affection: clampMoodValue(
      moodInput.affection ?? current.affection
    ),

    energy: clampMoodValue(
      moodInput.energy ?? current.energy
    ),

    playfulness: clampMoodValue(
      moodInput.playfulness ?? current.playfulness
    ),

    trust: clampMoodValue(
      moodInput.trust ?? current.trust
    ),

    updatedAt: Date.now()
  };

  next.label = determineMoodLabel(next);

  diary.mood = next;

  await saveDiary(diary);

  return next;
}

export async function updateMood(delta = {}) {
  const current = await getMood();

  return saveMood({
    affection:
      current.affection +
      (Number(delta.affection) || 0),

    energy:
      current.energy +
      (Number(delta.energy) || 0),

    playfulness:
      current.playfulness +
      (Number(delta.playfulness) || 0),

    trust:
      current.trust +
      (Number(delta.trust) || 0),

    lastInteractionAt:
      delta.lastInteractionAt ??
      current.lastInteractionAt
  });
}

/**
 * Учитывает время, прошедшее с последнего общения.
 * Вызывается перед новым сообщением пользователя.
 */
export async function applyMoodTimeDecay() {
  const current = await getMood();

  const lastInteractionAt =
    Number(current.lastInteractionAt) ||
    Date.now();

  const elapsedMs =
    Date.now() - lastInteractionAt;

  const elapsedHours =
    elapsedMs / (60 * 60 * 1000);

  let affectionDelta = 0;
  let energyDelta = 0;
  let playfulnessDelta = 0;

  if (elapsedHours >= 24) {
    energyDelta -= 4;
  }

  if (elapsedHours >= 72) {
    affectionDelta += 2;
    energyDelta -= 3;
    playfulnessDelta -= 2;
  }

  if (elapsedHours >= 168) {
    affectionDelta += 2;
    energyDelta -= 4;
    playfulnessDelta -= 2;
  }

  if (
    affectionDelta === 0 &&
    energyDelta === 0 &&
    playfulnessDelta === 0
  ) {
    return current;
  }

  return updateMood({
    affection: affectionDelta,
    energy: energyDelta,
    playfulness: playfulnessDelta
  });
}

/* ---------------------------- helpers: facts ---------------------------- */
/** Простая работа с "канон-фактами": set/get по dot-пути, например:
 *  upsertFact('self.father.job','архитектор')
 *  getFact('self.father.job')  → 'архитектор'
 */
export async function upsertFact(path, value) {
  if (!path) return false;
  const d = await loadDiary();
  const parts = String(path).split('.').map(s => s.trim()).filter(Boolean);
  let cur = d.facts;
  for (let i = 0; i < parts.length; i++) {
    const k = parts[i];
    if (i === parts.length - 1) {
      cur[k] = value;
    } else {
      if (typeof cur[k] !== 'object' || !cur[k]) cur[k] = {};
      cur = cur[k];
    }
  }
  d._updated_at = Date.now();
  await saveDiary(d);
  return true;
}

export async function getFact(path, fallback = undefined) {
  if (!path) return fallback;
  const d = await loadDiary();
  const parts = String(path).split('.').map(s => s.trim()).filter(Boolean);
  let cur = d.facts;
  for (const k of parts) {
    if (typeof cur !== 'object' || cur === null || !(k in cur)) {
      return fallback;
    }
    cur = cur[k];
  }
  return cur;
}

/* ---------------------- helpers: soft recall / search ---------------------- */
/** Возвращает события за последние N дней (по умолчанию 30). */
export async function recallDays(days = 30) {
  const d = await loadDiary();
  const since = Date.now() - Math.max(1, days) * 24 * 3600 * 1000;
  return d.events.filter(e => (e.ts || 0) >= since);
}

/** Простейший полнотекстовый поиск по events.text (регистр игнорируется). */
export async function searchDiary(query, limit = 50) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const d = await loadDiary();
  const out = [];
  for (let i = d.events.length - 1; i >= 0 && out.length < limit; i--) {
    const ev = d.events[i];
    if ((ev.text || '').toLowerCase().includes(q)) out.push(ev);
  }
  return out;
}

/* ============================== SYSTEM PROMPT ============================== */
/** Сборка системного промпта для модели на основе профиля и дневника.
 *  Используй на сервере перед обращением к LLM (или локально, если у тебя on-device).
 */
export async function buildSystemPrompt(profileInput = null, opts = {}) {
  const p = profileInput || (await loadProfile());
  // небольшой дайджест фактов из дневника
  const d = await loadDiary();
  const factsSnippet = summarizeFacts(d.facts);

  const lines = [
    'СИСТЕМНЫЕ ПРАВИЛА:',
    normalizeLines(p.base_rules || BASE_RULES),
  ];

  if (p.instructions_extra) {
    lines.push('\nДОП. ИНСТРУКЦИИ:', normalizeLines(p.instructions_extra));
  }
  if (p.knowledge) {
    lines.push('\nОПОРНЫЕ ФАКТЫ КАНОНА:', normalizeLines(p.knowledge));
  }
  if (factsSnippet) {
    lines.push('\nФАКТЫ ИЗ «ДНЕВНИКА» (локальная память):', factsSnippet);
  }

  if (opts.env) {
    lines.push('\nОКРУЖЕНИЕ:', JSON.stringify(opts.env));
  }

  return lines.join('\n');
}

function normalizeLines(s) {
  return String(s || '')
    .split('\n')
    .map(x => x.trim())
    .filter(Boolean)
    .join('\n');
}

function summarizeFacts(facts) {
  try {
    const flat = flattenObject(facts || {});
    const keys = Object.keys(flat);
    if (!keys.length) return '';
    // берём первые ~20 пунктов, чтобы не раздувать подсказку
    const take = keys.slice(0, 20).map(k => `• ${k}: ${stringifyShort(flat[k])}`);
    return take.join('\n');
  } catch {
    return '';
  }
}

/* ----------------------- utils: flatten / stringify ----------------------- */
function flattenObject(obj, prefix = '', out = {}) {
  if (obj == null) return out;
  if (Array.isArray(obj)) {
    out[prefix || '[]'] = obj;
    return out;
  }
  if (typeof obj !== 'object') {
    out[prefix || ''] = obj;
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      flattenObject(v, path, out);
    } else {
      out[path] = v;
    }
  }
  return out;
}

function stringifyShort(v) {
  if (v == null) return '—';
  if (typeof v === 'string') return v.length > 120 ? v.slice(0, 117) + '…' : v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

/* ============================== УТИЛИТЫ СБРОСА ============================== */

export function wipeProfile() {
  localStorage.removeItem(LS_PROFILE_KEY);
}
export function wipeDiary() {
  localStorage.removeItem(LS_DIARY_KEY);
}
export function wipeAllPersona() {
  wipeProfile();
  wipeDiary();
}

/* ============================ ГЛОБАЛЬНАЯ ИНИЦИАЦИЯ ============================ */
// Не обязательно, но удобно: положим профиль в window при первом импорте.
(async function bootstrapWindowProfile() {
  try {
    const p = await loadProfile();
    if (typeof window !== 'undefined') {
      window.RIN_PROFILE = p;
    }
  } catch {}
})();


/* ---------------- relationship / continuity / consolidation ---------------- */
function relationshipStage(value = {}) {
  if (value.closeness >= 82 && value.trust >= 80) return 'глубокая устойчивая близость';
  if (value.closeness >= 66 && value.trust >= 65) return 'сформировавшаяся близость';
  if (value.closeness >= 48 && value.trust >= 50) return 'растущее доверие';
  if (value.closeness >= 30) return 'осторожное сближение';
  return 'начало знакомства';
}

export async function updateRelationship(delta = {}) {
  const diary = await loadDiary();
  const current = { ..._defaultRelationship(), ...(diary.relationship || {}) };
  const clamp = v => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
  const next = { ...current };
  for (const key of ['trust', 'closeness', 'comfort', 'respect', 'playfulness']) {
    next[key] = clamp((Number(current[key]) || 0) + (Number(delta[key]) || 0));
  }
  next.stage = relationshipStage(next);
  next.lastInteractionAt = Number(delta.lastInteractionAt) || Date.now();
  next.updatedAt = Date.now();
  diary.relationship = next;
  await saveDiary(diary);
  return next;
}

export async function addOpenLoop(item = {}) {
  const text = String(item.text || item.content || '').replace(/\s+/g, ' ').trim();
  if (!text) return false;
  const diary = await loadDiary();
  const duplicate = diary.openLoops.some(loop => String(loop.text || '').toLowerCase() === text.toLowerCase());
  if (!duplicate) diary.openLoops.push({ id: `loop-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, text, type: item.type || 'topic', importance: Number(item.importance) || 5, createdAt: Date.now(), status: 'open' });
  diary.openLoops = diary.openLoops.slice(-24);
  await saveDiary(diary);
  return true;
}

export async function resolveOpenLoop(text = '') {
  const needle = String(text).toLowerCase().trim();
  if (!needle) return false;
  const diary = await loadDiary();
  diary.openLoops = diary.openLoops.filter(loop => {
    const source = String(loop.text || '').toLowerCase();
    return !(source.includes(needle) || needle.includes(source));
  });
  await saveDiary(diary);
  return true;
}

export async function addSharedMoment(item = {}) {
  const text = String(item.text || '').replace(/\s+/g, ' ').trim();
  if (!text) return false;
  const diary = await loadDiary();
  const relationship = { ..._defaultRelationship(), ...(diary.relationship || {}) };
  relationship.sharedMoments = [...(relationship.sharedMoments || []), { text, importance: Number(item.importance) || 6, ts: Date.now() }].slice(-20);
  diary.relationship = relationship;
  await saveDiary(diary);
  return true;
}

export async function consolidateDiary() {
  const diary = await loadDiary();
  if (diary.events.length <= 80) return false;
  const archived = diary.events.slice(0, diary.events.length - 50);
  const important = archived.filter(e => Number(e.importance || 0) >= 7).slice(-12);
  if (important.length) diary.summaries.push({ ts: Date.now(), text: important.map(e => e.text).join(' • ').slice(0, 1800), sourceCount: archived.length });
  diary.summaries = diary.summaries.slice(-12);
  diary.events = diary.events.slice(-50);
  await saveDiary(diary);
  return true;
}
