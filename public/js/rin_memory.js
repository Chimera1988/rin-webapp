// /public/js/rin_memory.js
// Профиль персонажа (канон + инструкции) и локальная "память/дневник".
// Всё хранится в localStorage на этом устройстве.

const LS_PROFILE_KEY = 'rin-profile-v1';
const LS_DIARY_KEY   = 'rin-diary-v1';

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
  try {
    const raw = localStorage.getItem(LS_PROFILE_KEY);
    if (!raw) return getDefaultProfile();
    const obj = JSON.parse(raw);
    // мягкая миграция: доклеим обязательные поля
    if (!obj.base_rules) obj.base_rules = BASE_RULES;
    if (!obj.initiation) obj.initiation = getDefaultProfile().initiation;
    if (!Array.isArray(obj.starters)) obj.starters = [];
    return obj;
  } catch {
    return getDefaultProfile();
  }
}

export async function saveProfile(profile) {
  const safe = { ...(profile || {}) };
  if (!safe.name) safe.name = 'Рин Акихара';
  if (!safe.base_rules) safe.base_rules = BASE_RULES;
  safe._updated_at = Date.now();
  localStorage.setItem(LS_PROFILE_KEY, JSON.stringify(safe));
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

function _emptyDiary() {
  return {
    facts: { self: {}, user: {}, world: {} },
    events: [],
    anchors: {},
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
    if (!obj.anchors) obj.anchors = {};
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
    ref: opts.ref || undefined
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
