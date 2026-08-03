/* public/chat.js — фронт чата Рин, согласованный с твоим index.html (профиль из persona_ui/rin_memory) */

const RIN_BUILD_VERSION = '2026-08-02-project-wide-prompt-compact-v1';

const STORAGE_KEY    = 'rin-history-v2';
const DAILY_INIT_KEY = 'rin-init-count';
const THEME_KEY      = 'rin-theme';

/* настройки, что храним в LS */
const LS_STICKER_PROB   = 'rin-sticker-prob';    // 0..100 (%)
const LS_STICKER_MODE   = 'rin-sticker-mode';    // smart | off | always
const LS_STICKER_LAST_MODE = 'rin-sticker-last-mode';
const LS_STICKER_SAFE   = 'rin-sticker-safe';    // '1' | '0'  (доп. запреты при негативном контексте)
const LS_STICKER_OPACITY = 'rin-sticker-opacity'; // 20..100 (%)
const LS_SPEAK_ENABLED  = 'rin-speak-enabled';   // '1' | '0'
const LS_SPEAK_RATE     = 'rin-speak-rate';      // 0..50 (%)
const LS_WP_DATA        = 'rin-wallpaper-data';  // dataURL
const LS_WP_OPACITY     = 'rin-wallpaper-opacity'; // 0..100
const LS_DEBUG_ENABLED  = 'rin-debug-enabled';   // '1' | '0'

/* DOM */
const chatEl        = document.getElementById('chat');
const formEl        = document.getElementById('form');
const inputEl       = document.getElementById('input');
const peerStatus    = document.getElementById('peerStatus');

const settingsToggle= document.getElementById('settingsToggle');
const settingsPanel = document.getElementById('settingsPanel');
const closeSettings = document.getElementById('closeSettings');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const settingsPages    = [...document.querySelectorAll('[data-settings-page]')];
const settingsTargets  = [...document.querySelectorAll('[data-settings-target]')];
const settingsBackBtns = [...document.querySelectorAll('[data-settings-back]')];

const themeToggle   = document.getElementById('themeToggle');

/* Обои */
const wpFile        = document.getElementById('wallpaperFile');
const wpClear       = document.getElementById('wallpaperClear');
const wpOpacity     = document.getElementById('wallpaperOpacity');
const wpOpacityVal  = document.getElementById('wallpaperOpacityVal');

/* Стикеры (ползунки UI) */
const stickerEnabled= document.getElementById('stickerEnabled');
const stickerProb   = document.getElementById('stickerProb');
const stickerProbVal= document.getElementById('stickerProbVal');
const stickerMode   = document.getElementById('stickerMode');
const stickerSafe   = document.getElementById('stickerSafe');
const stickerOpacity= document.getElementById('stickerOpacity');
const stickerOpacityVal = document.getElementById('stickerOpacityVal');
const stickerModeBtns = [...document.querySelectorAll('[data-sticker-mode]')];
const stickerSettingsCard = document.getElementById('stickerSettingsCard');

/* Голос */
const voiceEnabled  = document.getElementById('voiceEnabled');
const voiceRate     = document.getElementById('voiceRate');
const voiceRateVal  = document.getElementById('voiceRateVal');

/* Debug (в настройках) */
const debugToggle   = document.getElementById('debugToggle');
const debugLogEl    = document.getElementById('debugLog');

/* === Окружение Рин (время/сезон/погода) === */
const RIN_TZ     = 'Asia/Tokyo';
const RIN_CITY   = 'Kanazawa';
const RIN_COUNTRY= 'JP';
const WEATHER_REFRESH_MS = 20 * 60 * 1000; // раз в 20 минут

/* ✔️ РАННЕЕ БЕЗОПАСНОЕ ОБЪЯВЛЕНИЕ — чтобы не ловить "Can't find variable: currentEnv" */
let currentEnv = {
  rinTz: RIN_TZ,
  rinHuman: '',
  season: '',
  month: '',
  partOfDay: '',
  userVsRinHoursDiff: 0,
  weather: null,
  _ts: 0
};

function nowInTz(tz) {
  try {
    const here = new Date();
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    });
    const parts = fmt.formatToParts(here);
    const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return new Date(`${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}`);
  } catch {
    return new Date();
  }
}
function monthNameRu(m){ // 0..11
  return ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'][m];
}
function seasonFromMonth(m){ // северное полушарие
  if (m===11 || m<=1) return 'зима';
  if (m>=2 && m<=4)   return 'весна';
  if (m>=5 && m<=7)   return 'лето';
  return 'осень';
}
function partOfDayFromHour(h){
  if (h>=5 && h<12) return 'утро';
  if (h>=12 && h<18) return 'день';
  if (h>=18 && h<23) return 'вечер';
  return 'ночь';
}
function fmtRinHuman(d){ // "YYYY-MM-DD HH:mm"
  const Y=d.getFullYear();
  const M=String(d.getMonth()+1).padStart(2,'0');
  const D=String(d.getDate()).padStart(2,'0');
  const h=String(d.getHours()).padStart(2,'0');
  const m=String(d.getMinutes()).padStart(2,'0');
  return `${Y}-${M}-${D} ${h}:${m}`;
}
function hoursDiffWithRin(){
  const here = new Date();
  const rin  = nowInTz(RIN_TZ);
  return Math.round((rin - here) / 3600000);
}

/* — API погоды (через наш /api/weather) — */
async function fetchRinWeather(){
  try{
    const u = `/api/weather?q=${encodeURIComponent(RIN_CITY)},${RIN_COUNTRY}&units=metric&lang=ru`;
    const r = await fetch(u);
    if (!r.ok) return null;
    const w = await r.json();
    if (w && w.weather){
      return {
        desc:  w.weather || '',
        temp:  typeof w.temp === 'number' ? Math.round(w.temp) : (typeof w.main?.temp === 'number' ? Math.round(w.main.temp) : null),
        feels: typeof w.feels_like === 'number' ? Math.round(w.feels_like) : (typeof w.main?.feels_like === 'number' ? Math.round(w.main.feels_like) : null),
        icon:  w.icon || null
      };
    }
    const d = w?.weather?.[0]?.description || w?.current?.weather?.[0]?.description || '';
    const t = w?.main?.temp ?? w?.current?.temp ?? null;
    const f = w?.main?.feels_like ?? w?.current?.feels_like ?? null;
    return {
      desc: d,
      temp: typeof t === 'number' ? Math.round(t) : null,
      feels: typeof f === 'number' ? Math.round(f) : null,
      icon: w?.weather?.[0]?.icon || w?.current?.weather?.[0]?.icon || null
    };
  }catch{ return null; }
}

/* — форматирование и естественная фраза о погоде — */
function fmtC(n){
  if (typeof n !== 'number' || !isFinite(n)) return null;
  const s = Math.round(n);
  const sign = s > 0 ? '+' : (s < 0 ? '−' : '');
  return `${sign}${Math.abs(s)}°C`;
}
function pickWeatherEmoji(desc=''){
  const t = (desc||'').toLowerCase();
  if (/гроза|thunder|storm/.test(t)) return '⛈️';
  if (/дожд|rain/.test(t))          return '🌧️';
  if (/снег|snow/.test(t))          return '❄️';
  if (/туман|mist|fog/.test(t))     return '🌫️';
  if (/пасмур|облач|cloud/.test(t)) return '☁️';
  if (/ясн|солнеч|clear|sun/.test(t)) return '☀️';
  return '🌤️';
}
function buildWeatherPhrase(env){
  const city = 'Канадзаве';
  const pod  = env?.partOfDay || 'сейчас';
  const w = env?.weather || null;

  if (w){
    const desc = (w.desc || '').replace(/^\w/u, c=>c.toLowerCase());
    const t    = fmtC(w.temp);
    const f    = fmtC(w.feels);
    const emo  = pickWeatherEmoji(w.desc);

    let main = `Сейчас в ${city} ${desc}${t?`, ${t}`:''}${f && f!==t?` (ощущается как ${f})`:''}.`;
    let tail = '';
    if (pod==='утро')  tail = ' Хорошее время начать день спокойно.';
    if (pod==='день')  tail = ' В такой день приятно немного пройтись.';
    if (pod==='вечер') tail = ' Вечером город становится уютнее, хочется чая.';
    if (pod==='ночь')  tail = ' Ночью тихо — люблю слушать город за окном.';

    return `${main} ${emo}${tail}`.trim();
  }
  return '';
}

/* === Debug helpers (в панели настроек) === */
let _debugOn = localStorage.getItem(LS_DEBUG_ENABLED) === '1';
function dbg(line){
  if (!_debugOn) return;
  try{
    if (!debugLogEl) return;
    const time = new Date();
    const ts = `${String(time.getHours()).padStart(2,'0')}:${String(time.getMinutes()).padStart(2,'0')}:${String(time.getSeconds()).padStart(2,'0')}`;
    const div = document.createElement('div');
    div.innerText = `[${ts}] ${line}`;
    debugLogEl.appendChild(div);
    while (debugLogEl.childNodes.length > 80) debugLogEl.removeChild(debugLogEl.firstChild);
    debugLogEl.scrollTop = debugLogEl.scrollHeight;
  }catch{}
}

/* Инициализация переключателя debug в панели */
if (debugToggle){
  debugToggle.checked = _debugOn;
  debugToggle.onchange = () => {
    _debugOn = debugToggle.checked;
    localStorage.setItem(LS_DEBUG_ENABLED, _debugOn ? '1' : '0');
    if (!_debugOn && debugLogEl) debugLogEl.innerHTML='';
    dbg('debug enabled');
  };
}

/* Данные */
const resetApp      = document.getElementById('resetApp');

/* state */
let profile = null;         // профиль из persona_ui / rin_memory
const dossierCaches = new Map();
let responsePostprocessor = null;
let loreLib = null;

/**
 * Единый загрузчик JSON-досье. Сохраняет прежнее поведение,
 * но убирает четыре одинаковых fetch/cache/error блока.
 */
async function loadDossierForChat(key, url, invalidMessage) {
  if (dossierCaches.has(key)) return dossierCaches.get(key);

  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const value = await response.json();
    if (!value || typeof value !== 'object') {
      throw new Error(invalidMessage || `invalid ${key} dossier`);
    }

    dossierCaches.set(key, value);
    return value;
  } catch (error) {
    dbg(`${key} dossier load failed: ${error?.message || error}`);
    return null;
  }
}

const loadPromptProfileForChat = () =>
  loadDossierForChat('prompt profile', '/data/rin_prompt_profile.json', 'invalid prompt profile');

async function ensureLoreReady() {
  if (loreLib) return loreLib;

  try {
    loreLib = await import('/js/rin_lore.js');
    await loreLib.loadLoreData();
    dbg('lore data ready');
    return loreLib;
  } catch (error) {
    dbg(
      'lore data load failed: ' +
      (error?.message || error)
    );
    return null;
  }
}

async function ensureResponsePostprocessor() {
  if (responsePostprocessor) {
    return responsePostprocessor;
  }

  try {
    responsePostprocessor =
      await import('/js/response_postprocessor.js');

    return responsePostprocessor;
  } catch (error) {
    dbg(
      'response postprocessor load failed: ' +
      (error?.message || error)
    );

    return null;
  }
}

async function ensureActiveProfile() {
  // persona_ui может обновить пользовательские поля позже chat.js.
  const globalProfile = window.RIN_PROFILE;
  if (globalProfile && typeof globalProfile === 'object') profile = globalProfile;
  if (!profile || typeof profile !== 'object') profile = {};

  const promptProfile =
    profile.prompt_profile ||
    await loadPromptProfileForChat();

  // В API отправляется единый компактный профиль. Полные JSON-досье остаются
  // источниками UI/lore, но больше не дублируются в каждом запросе модели.
  profile = {
    name: profile.name || 'Рин Акихара',
    description: profile.description || '',
    base_rules: profile.base_rules || '',
    instructions_extra: profile.instructions_extra || '',
    knowledge: profile.knowledge || '',
    starters: Array.isArray(profile.starters) ? profile.starters : [],
    initiation: profile.initiation || null,
    ...(promptProfile ? { prompt_profile: promptProfile } : {})
  };

  return profile;
}

let history=[];
let chainStickerCount=0;
/* === Долгосрочная память Рин === */

let memoryLib = null;

/**
 * Загружает библиотеку памяти только при первом обращении.
 * chat.js остаётся обычным скриптом — переводить весь файл в module не нужно.
 */
async function ensureMemoryReady() {
  if (memoryLib) return memoryLib;

  try {
    memoryLib = await import('/js/rin_memory.js');
    dbg('memory module loaded');
    return memoryLib;
  } catch (error) {
    dbg(
      'memory module load failed: ' +
      (error?.message || error)
    );

    return null;
  }
}

/**
 * Формирует компактный пакет памяти для модели.
 * Весь дневник не отправляем, чтобы не раздувать запрос.
 */
async function buildMemoryPayload() {
  try {
    const lib = await ensureMemoryReady();

    if (!lib?.loadDiary) {
      return null;
    }

    const diary = await lib.loadDiary();

    if (!diary || typeof diary !== 'object') {
      return null;
    }

    const recentEvents = Array.isArray(diary.events)
      ? diary.events
          .slice(-12)
          .map(event => ({
            ts: Number(event?.ts) || null,
            type: String(event?.type || 'note').slice(0, 30),
            text: String(event?.text || '')
              .trim()
              .slice(0, 500),
            tags: Array.isArray(event?.tags)
              ? event.tags
                  .slice(0, 8)
                  .map(tag => String(tag).slice(0, 40))
              : []
          }))
          .filter(event => event.text)
      : [];

    return {
  facts:
    diary.facts &&
    typeof diary.facts === 'object'
      ? diary.facts
      : {
          self: {},
          user: {},
          world: {}
        },

  recentEvents,

  mood:
    diary.mood &&
    typeof diary.mood === 'object'
      ? {
          affection:
            Number(diary.mood.affection) || 50,

          energy:
            Number(diary.mood.energy) || 50,

          playfulness:
            Number(diary.mood.playfulness) || 50,

          trust:
            Number(diary.mood.trust) || 50,

          label:
            String(
              diary.mood.label || 'спокойная'
            ).slice(0, 30),

          lastInteractionAt:
            Number(
              diary.mood.lastInteractionAt
            ) || null
        }
      : null,

  innerLife:
    diary.innerLife && typeof diary.innerLife === 'object'
      ? {
          activity: String(diary.innerLife.activity || '').slice(0, 180),
          trace: String(diary.innerLife.trace || '').slice(0, 220),
          focus: String(diary.innerLife.focus || '').slice(0, 220),
          privateThought: String(diary.innerLife.privateThought || '').slice(0, 260),
          part: String(diary.innerLife.part || '').slice(0, 20),
          startedAt: Number(diary.innerLife.startedAt) || null,
          expiresAt: Number(diary.innerLife.expiresAt) || null,
          lastSpontaneousAt: Number(diary.innerLife.lastSpontaneousAt) || null,
          interactionCount: Number(diary.innerLife.interactionCount) || 0
        }
      : null
};
  } catch (error) {
    dbg(
      'memory payload failed: ' +
      (error?.message || error)
    );

    return null;
  }
}

/**
 * Сохраняет результат анализа памяти в локальный дневник.
 */
function sanitizeMoodDelta(userText, moodDelta) {
  const text = String(userText || '').toLowerCase();
  const source =
    moodDelta && typeof moodDelta === 'object'
      ? moodDelta
      : {};

  const explicitWarm =
    /(люблю|соскучил|обнимаю|целую|ты мне нравишься|мне хорошо с тобой|спасибо за поддержку|очень благодарен)/iu.test(text);

  const explicitPlayful =
    /(шучу|ахаха|хаха|😏|😉|😁|подкол|флирт)/iu.test(text);

  const explicitTrust =
    /(доверяю|никому не говорил|только тебе|хочу поделиться чем-то важным|мне важно твоё мнение)/iu.test(text);

  const explicitNegative =
    /(заткнись|отстань|бесишь|ненавижу|глупая|тупая|замолчи)/iu.test(text);

  const ordinaryQuestion =
    /\?/.test(text) &&
    !explicitWarm &&
    !explicitPlayful &&
    !explicitTrust &&
    !explicitNegative;

  const neutralReason =
    /(нейтраль|обычн(?:ый|ого) вопрос|не вызывает|без эмоциональ|значительных эмоциональных изменений)/iu.test(
      String(source.reason || '')
    );

  const result = {
    affection: Number(source.affection) || 0,
    energy: Number(source.energy) || 0,
    playfulness: Number(source.playfulness) || 0,
    trust: Number(source.trust) || 0,
    reason: String(source.reason || ''),
    confidence: Number(source.confidence) || 0
  };

  if (ordinaryQuestion || neutralReason) {
    result.affection = Math.min(0, result.affection);
    result.playfulness = Math.min(0, result.playfulness);
    result.trust = Math.min(0, result.trust);

    if (!explicitNegative) {
      result.energy = Math.min(0, result.energy);
    }
  }

  if (!explicitWarm) result.affection = Math.min(1, result.affection);
  if (!explicitPlayful) result.playfulness = Math.min(1, result.playfulness);
  if (!explicitTrust) result.trust = Math.min(1, result.trust);

  // Энергия — отдельная шкала. Теплота, забота и комплименты не должны
  // автоматически восстанавливать силы Рин.
  const explicitEnergizing =
    /(взбодрил|взбодрила|появились силы|отдохнула|выспалась|стало бодрее|зарядил энергией)/iu.test(text);

  if (!explicitEnergizing && result.energy > 0) {
    result.energy = 0;
  }

  // Малые модельные колебания не должны создавать постоянный дрейф шкал.
  for (const key of ['affection', 'energy', 'playfulness', 'trust']) {
    result[key] = Math.max(-6, Math.min(6, Math.round(result[key])));
  }

  return result;
}

async function applyExtractedMemory(extracted, userText = '') {
  try {
    const lib = await ensureMemoryReady();

    if (!lib) {
      return;
    }

    const facts = Array.isArray(extracted?.facts)
      ? extracted.facts
      : [];

    const events = Array.isArray(extracted?.events)
      ? extracted.events
      : [];

    for (const fact of facts) {
      const path = String(fact?.path || '').trim();
      const value = String(fact?.value || '').trim();
      const confidence = Number(fact?.confidence);

      if (!path.startsWith('user.')) {
        continue;
      }

      if (!value) {
        continue;
      }

      if (
        Number.isFinite(confidence) &&
        confidence < 0.75
      ) {
        continue;
      }

      await lib.upsertFact(path, value);

      dbg(`memory fact saved: ${path}`);
    }

    for (const event of events) {
      const text = String(event?.text || '').trim();

      if (!text) {
        continue;
      }

      const importance =
        Number(event?.importance) || 5;

      if (importance < 6) {
        continue;
      }

      await lib.addEvent(text, {
        type: String(event?.type || 'memory'),
        tags: Array.isArray(event?.tags)
          ? event.tags.slice(0, 8)
          : []
      });

      dbg(
        `memory event saved: ${text.slice(0, 80)}`
      );
    }
 const moodDelta = sanitizeMoodDelta(userText, extracted?.moodDelta);
const moodConfidence = Number(
  moodDelta?.confidence
);

if (
  moodDelta &&
  typeof moodDelta === 'object' &&
  Number.isFinite(moodConfidence) &&
  moodConfidence >= 0.55 &&
  lib?.updateMood
) {
  if (lib?.applyMoodTimeDecay) {
    await lib.applyMoodTimeDecay();
  }

  const mood = await lib.updateMood({
    affection:
      Number(moodDelta.affection) || 0,

    energy:
      Number(moodDelta.energy) || 0,

    playfulness:
      Number(moodDelta.playfulness) || 0,

    trust:
      Number(moodDelta.trust) || 0,

    lastInteractionAt: Date.now()
  });

  if (mood) {
  dbg(
    `AI mood updated: ${mood.label}; ` +
    `affection=${mood.affection}, ` +
    `energy=${mood.energy}, ` +
    `playfulness=${mood.playfulness}, ` +
    `trust=${mood.trust}; ` +
    `reason=${moodDelta.reason || 'нет причины'}`
  );

  return true;
}

  return false;
}
    
} catch (error) {
    dbg(
      'apply extracted memory failed: ' +
      (error?.message || error)
    );
  }
}

const LS_MEMORY_TURN = 'rin-memory-analysis-turn';

function shouldAnalyzeConversationForMemory(userText = '') {
  const text = String(userText || '').replace(/\s+/g, ' ').trim();
  if (!text) return false;

  const turn = (Number(localStorage.getItem(LS_MEMORY_TURN)) || 0) + 1;
  localStorage.setItem(LS_MEMORY_TURN, String(turn));

  // Явные устойчивые факты, планы, предпочтения и эмоционально значимые признания.
  const meaningful = /(меня зовут|мне \d{1,3} (?:лет|года|год)|мой день рождения|я живу|я работаю|моя работа|мой проект|я разрабатываю|я люблю|мне нравится|я предпочитаю|обычно я|кажд(?:ый|ую) (?:день|неделю)|завтра|послезавтра|на следующей неделе|собеседован|встреча|поездк|обещаю|решил|решила|планирую|хочу рассказать|только тебе|доверяю тебе|важно для меня)/iu.test(text);
  const substantial = text.length >= 220;
  const periodicCatchUp = turn % 8 === 0 && text.length >= 45;

  const trivial = /^(?:привет|доброе утро|добрый день|добрый вечер|пока|до завтра|спокойной ночи|спасибо|ага|да|нет|ок(?:ей)?|хорошо|понятно|мм+|ха+|[\p{Emoji_Presentation}\p{Extended_Pictographic}\s.!?]+)$/iu.test(text);

  return !trivial && (meaningful || substantial || periodicCatchUp);
}

/**
 * Отправляет значимую пару сообщений на скрытый анализ памяти.
 * Обычные короткие ходы не создают второй платный запрос.
 */
async function analyzeConversationForMemory(
  userText,
  assistantText
) {
  if (!shouldAnalyzeConversationForMemory(userText)) {
    dbg('memory analysis skipped: no durable signal');
    return false;
  }

  try {
    const existingMemory =
      await buildMemoryPayload();

    const res = await fetch('/api/memory', {
      method: 'POST',

      headers: {
        'Content-Type': 'application/json'
      },

      body: JSON.stringify({
        pin: localStorage.getItem('rin-pin'),
        userText,
        assistantText,
        existingMemory:
          existingMemory || undefined
      })
    });

    if (res.status === 401) {
      dbg('memory API unauthorized');
      return false;
    }

    if (!res.ok) {
      dbg(`memory API failed: HTTP ${res.status}`);
      return false;
    }

    const extracted = await res.json();

    if (extracted?.warning) {
      dbg(`memory API warning: ${extracted.warning}`);
    }

    return await applyExtractedMemory(extracted, userText);
  } catch (error) {
    dbg(
      'memory analysis failed: ' +
      (error?.message || error)
    );
    return false;
  }
}

/* ============================= */
/* НАСТРОЕНИЕ РИН */
/* ============================= */

function analyzeUserMoodImpact(userText = '') {
  const text = String(userText)
    .toLowerCase()
    .trim();

  const delta = {
    affection: 0,
    energy: 0,
    playfulness: 0,
    trust: 0
  };

  if (!text) {
    return delta;
  }

  const warm =
    /(спасибо|благодарю|ты милая|ты хорошая|рад тебя видеть|соскучился|обнимаю|целую|люблю тебя|мне приятно с тобой|ты мне нравишься)/i;

  const playful =
    /(шучу|шутка|хаха|ахаха|😁|😏|😉|подкол|пофлиртуем|флирт)/i;

  const trust =
    /(хочу рассказать|никому не говорил|только тебе|поделюсь с тобой|мне важно твоё мнение|я доверяю тебе)/i;

  const tired =
    /(устал|вымотался|тяжёлый день|нет сил|выгорел|хочу спать|очень тяжело)/i;

  const sad =
    /(мне грустно|плохо на душе|расстроен|одиноко|обидно|печально|не получилось)/i;

  const hostile =
    /(заткнись|отстань|бесишь|глупая|тупая|ненавижу тебя|замолчи)/i;

  const goodbye =
    /(пока|до завтра|спокойной ночи|доброй ночи|до встречи|увидимся|бай|bye)/i;

  if (warm.test(text)) {
    delta.affection += 3;
    delta.trust += 1;
  }

  if (playful.test(text)) {
    delta.playfulness += 4;
    delta.affection += 1;
  }

  if (trust.test(text)) {
    delta.trust += 4;
    delta.affection += 2;
  }

  if (tired.test(text)) {
    delta.energy -= 3;
    delta.affection += 1;
    delta.playfulness -= 2;
  }

  if (sad.test(text)) {
    delta.energy -= 3;
    delta.affection += 2;
    delta.playfulness -= 3;
  }

  if (hostile.test(text)) {
    delta.affection -= 8;
    delta.energy -= 5;
    delta.playfulness -= 6;
    delta.trust -= 5;
  }

  if (goodbye.test(text)) {
    delta.energy -= 2;
  }

  return delta;
}

async function updateRinMoodFromMessage(userText) {
  try {
    const lib = await ensureMemoryReady();

    if (
      !lib?.updateMood ||
      !lib?.applyMoodTimeDecay
    ) {
      return null;
    }

    await lib.applyMoodTimeDecay();

    const delta =
      analyzeUserMoodImpact(userText);

    const mood = await lib.updateMood({
      ...delta,
      lastInteractionAt: Date.now()
    });

    dbg(
      `mood updated: ${mood.label}; ` +
      `affection=${mood.affection}, ` +
      `energy=${mood.energy}, ` +
      `playfulness=${mood.playfulness}, ` +
      `trust=${mood.trust}`
    );

    return mood;
  } catch (error) {
    dbg(
      'mood update failed: ' +
      (error?.message || error)
    );

    return null;
  }
}

/* 🔒 защита от гонок показа стикеров */
let stickerBusy = false;

/* === stickers v5: смысловая двухканальная система === */
let STICKERS_CFG = null;
let stickersLib = null;

async function ensureStickersReady(){
  if (!stickersLib) {
    try { stickersLib = await import('/lib/stickers-v4.js'); }
    catch(e){ dbg('stickers v5 import failed: '+(e?.message||e)); stickersLib=null; }
  }
  if (stickersLib && !STICKERS_CFG) {
    try { STICKERS_CFG = await stickersLib.loadStickerConfig('/data/stickers-v4.json'); dbg('stickers v5 loaded'); }
    catch(e){ dbg('stickers v5 load failed: '+(e?.message||e)); STICKERS_CFG=null; }
  }
}

/* utils */
const fmtDateKey = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const fmtTime = d => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function loadHistory(){
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
}
function saveHistory(h){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(h.slice(-60)));
}
function getInitCountFor(k){
  const m = JSON.parse(localStorage.getItem(DAILY_INIT_KEY) || '{}');
  return m[k] || 0;
}
function bumpInitCount(k){
  const m = JSON.parse(localStorage.getItem(DAILY_INIT_KEY) || '{}');
  m[k] = (m[k] || 0) + 1;
  localStorage.setItem(DAILY_INIT_KEY, JSON.stringify(m));
}

/* === UI: SETTINGS === */
function showSettingsPage(name='main'){
  const next = settingsPages.find(page => page.dataset.settingsPage === name)
    || settingsPages.find(page => page.dataset.settingsPage === 'main');
  settingsPages.forEach(page => page.classList.toggle('is-active', page === next));
  if (next) next.scrollTop = 0;
}

function openSettings(){
  if (!settingsPanel) return;
  showSettingsPage('main');
  settingsPanel.classList.remove('hidden');
  document.body.classList.add('settings-open');
}
function closeSettingsPanel(){
  if (!settingsPanel) return;
  settingsPanel.classList.add('hidden');
  document.body.classList.remove('settings-open');
  showSettingsPage('main');
}

if (settingsToggle) settingsToggle.onclick = openSettings;
if (closeSettings) closeSettings.onclick = closeSettingsPanel;
if (closeSettingsBtn) closeSettingsBtn.onclick = closeSettingsPanel;
settingsTargets.forEach(button => {
  button.addEventListener('click', () => showSettingsPage(button.dataset.settingsTarget));
});
settingsBackBtns.forEach(button => {
  button.addEventListener('click', () => showSettingsPage('main'));
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || !settingsPanel || settingsPanel.classList.contains('hidden')) return;
  const activePage = settingsPages.find(page => page.classList.contains('is-active'))?.dataset.settingsPage;
  if (activePage && activePage !== 'main') showSettingsPage('main');
  else closeSettingsPanel();
});

/* — Тема — */
if (themeToggle){
  themeToggle.onclick = () => {
    const isDark = document.documentElement.classList.contains('theme-dark');
    const next = isDark ? 'theme-light' : 'theme-dark';
    document.documentElement.classList.remove('theme-dark', 'theme-light');
    document.documentElement.classList.add(next);
    localStorage.setItem(THEME_KEY, next);
  };
}

/* — Обои — */
function applyWallpaper(){
  const data = localStorage.getItem(LS_WP_DATA) || '';
  const op   = +(localStorage.getItem(LS_WP_OPACITY) || '90') / 100;

  document.documentElement.style.setProperty('--wallpaper-url', data ? `url("${data}")` : 'none');
  document.documentElement.style.setProperty('--wallpaper-opacity', String(op));

  if (wpOpacity) wpOpacity.value = Math.round(op * 100);
  if (wpOpacityVal) wpOpacityVal.textContent = `${Math.round(op * 100)}%`;
}
applyWallpaper();

if (wpFile){
  wpFile.addEventListener('change', (e)=>{
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      localStorage.setItem(LS_WP_DATA, reader.result);
      applyWallpaper();
    };
    reader.readAsDataURL(f);
  });
}
if (wpClear){
  wpClear.onclick=()=>{
    localStorage.removeItem(LS_WP_DATA);
    applyWallpaper();
  };
}
if (wpOpacity){
  wpOpacity.oninput=()=>{
    localStorage.setItem(LS_WP_OPACITY, String(wpOpacity.value));
    applyWallpaper();
  };
}

/* — Стикеры: настройки UI — */
function lsStickerProb(){ return +(localStorage.getItem(LS_STICKER_PROB) || '30'); } // %
function lsStickerMode(){
  const raw = localStorage.getItem(LS_STICKER_MODE) || 'smart';
  if (raw === 'keywords') return 'smart';
  return ['smart','always','off'].includes(raw) ? raw : 'smart';
}
function lsStickerSafe(){ return localStorage.getItem(LS_STICKER_SAFE)==='1'; }
function lsStickerOpacity(){
  return Math.max(20, Math.min(100, +(localStorage.getItem(LS_STICKER_OPACITY) || '100')));
}

function applyStickerOpacity(){
  const value = lsStickerOpacity();
  document.documentElement.style.setProperty('--sticker-opacity', String(value / 100));
  if (stickerOpacity) stickerOpacity.value = String(value);
  if (stickerOpacityVal) stickerOpacityVal.textContent = `${value}%`;
}

function updateStickerModeUI(mode=lsStickerMode()){
  const enabled = mode !== 'off';
  if (stickerMode) stickerMode.value = mode;
  if (stickerEnabled) stickerEnabled.checked = enabled;
  if (stickerSettingsCard) stickerSettingsCard.classList.toggle('is-disabled', !enabled);
  stickerModeBtns.forEach(button => {
    const active = button.dataset.stickerMode === mode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function setStickerMode(mode){
  const next = ['smart','always','off'].includes(mode) ? mode : 'smart';
  if (next !== 'off') localStorage.setItem(LS_STICKER_LAST_MODE, next);
  localStorage.setItem(LS_STICKER_MODE, next);
  updateStickerModeUI(next);
}

if (stickerProb){
  stickerProb.value = String(lsStickerProb());
  if (stickerProbVal) stickerProbVal.textContent = `${stickerProb.value}%`;
  stickerProb.oninput = () => {
    localStorage.setItem(LS_STICKER_PROB, String(stickerProb.value));
    if (stickerProbVal) stickerProbVal.textContent = `${stickerProb.value}%`;
  };
}
if (stickerMode){
  const mode = lsStickerMode();
  if (mode !== (localStorage.getItem(LS_STICKER_MODE) || 'smart')) {
    localStorage.setItem(LS_STICKER_MODE, mode);
  }
  stickerMode.onchange = ()=>setStickerMode(stickerMode.value);
}
stickerModeBtns.forEach(button => {
  button.addEventListener('click', () => setStickerMode(button.dataset.stickerMode));
});
if (stickerEnabled){
  stickerEnabled.onchange = () => {
    if (!stickerEnabled.checked) {
      setStickerMode('off');
      return;
    }
    const lastMode = localStorage.getItem(LS_STICKER_LAST_MODE);
    setStickerMode(['smart','always'].includes(lastMode) ? lastMode : 'smart');
  };
}
if (stickerSafe){
  stickerSafe.checked = lsStickerSafe();
  stickerSafe.onchange = ()=>localStorage.setItem(LS_STICKER_SAFE, stickerSafe.checked?'1':'0');
}
if (stickerOpacity){
  stickerOpacity.oninput = () => {
    localStorage.setItem(LS_STICKER_OPACITY, String(stickerOpacity.value));
    applyStickerOpacity();
  };
}
updateStickerModeUI();
applyStickerOpacity();

/* — Голос — */
function lsSpeakEnabled(){ return localStorage.getItem(LS_SPEAK_ENABLED) === '1'; }
function lsSpeakRate(){ return +(localStorage.getItem(LS_SPEAK_RATE) || '20'); } // %
if (voiceEnabled){
  voiceEnabled.checked = lsSpeakEnabled();
  voiceEnabled.onchange = ()=>localStorage.setItem(LS_SPEAK_ENABLED, voiceEnabled.checked?'1':'0');
}
if (voiceRate){
  voiceRate.value = String(lsSpeakRate());
  if (voiceRateVal) voiceRateVal.textContent = `${voiceRate.value}%`;
  voiceRate.oninput = ()=>{
    localStorage.setItem(LS_SPEAK_RATE, String(voiceRate.value));
    if (voiceRateVal) voiceRateVal.textContent = `${voiceRate.value}%`;
  };
}

/* — Сброс — */
if (resetApp){
  resetApp.onclick=()=>{
    if (!confirm('Сбросить историю чата, настройки и кэш?')) return;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(DAILY_INIT_KEY);
    [LS_STICKER_PROB,LS_STICKER_MODE,LS_STICKER_LAST_MODE,LS_STICKER_SAFE,LS_STICKER_OPACITY,LS_SPEAK_ENABLED,LS_SPEAK_RATE,LS_WP_DATA,LS_WP_OPACITY,LS_DEBUG_ENABLED].forEach(k=>localStorage.removeItem(k));
    chatEl.innerHTML='';
    history=[];
    applyWallpaper();
    applyStickerOpacity();
    updateStickerModeUI('smart');
    if (stickerProb) stickerProb.value = '30';
    if (stickerProbVal) stickerProbVal.textContent = '30%';
    if (stickerSafe) stickerSafe.checked = false;
    if (voiceEnabled) voiceEnabled.checked = false;
    if (voiceRate) voiceRate.value = '20';
    if (voiceRateVal) voiceRateVal.textContent = '20%';
    if (debugToggle) debugToggle.checked = false;
    _debugOn = false;
    if (debugLogEl) debugLogEl.innerHTML='';
    greet();
    closeSettingsPanel();
  };
}

/* === Рендер сообщений === */
function addBubble(text, who='assistant', ts=Date.now()){
  const d = new Date(ts);
  const row = document.createElement('div');
  row.className = 'row ' + (who==='user' ? 'me' : 'her');

  if (who !== 'user'){
    const ava=document.createElement('img');
    ava.className='avatar small';
    ava.src='/avatar.jpg'; ava.alt='Рин';
    row.appendChild(ava);
  } else {
    const spacer=document.createElement('div');
    spacer.className='avatar small spacer';
    row.appendChild(spacer);
  }

  const wrap=document.createElement('div');
  wrap.className='bubble ' + (who==='user'?'me':'her');

  const msg=document.createElement('span');
  msg.textContent=text;

  const time=document.createElement('span');
  time.className='bubble-time';
  time.textContent=fmtTime(d);

  wrap.appendChild(msg); wrap.appendChild(time);
  row.appendChild(wrap);
  chatEl.appendChild(row);
  chatEl.scrollTop=chatEl.scrollHeight;
}

function addTyping(){
  const row=document.createElement('div');
  row.className='row her typing-row';
  row.innerHTML=`<img class="avatar small" src="/avatar.jpg" alt="Рин"/>
    <div class="bubble her typing"><span></span><span></span><span></span></div>`;
  chatEl.appendChild(row);
  chatEl.scrollTop=chatEl.scrollHeight;
  return row;
}

/* === Стикеры: рендер === */
function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function addStickerBubble(src, who='assistant', utterance=null){
  if (src && typeof src === 'object' && src.src) src = src.src;

  const row = document.createElement('div');
  row.className = 'row ' + (who==='user' ? 'me' : 'her');
  const timeStr = fmtTime(new Date());

  const utterHtml = utterance ? `<div class="sticker-utter">${escapeHtml(utterance)}</div>` : '';

  if (who === 'user') {
    row.innerHTML = `<div class="bubble me sticker-only">
        <img class="sticker" src="${src}" alt="стикер"/>
        ${utterHtml}
        <span class="bubble-time">${timeStr}</span>
      </div>`;
  } else {
    row.innerHTML = `<img class="avatar small" src="/avatar.jpg" alt="Рин"/>
      <div class="bubble her sticker-only">
        <img class="sticker" src="${src}" alt="стикер"/>
        ${utterHtml}
        <span class="bubble-time">${timeStr}</span>
      </div>`;
  }

  const stickerImg = row.querySelector('img.sticker');
  if (stickerImg) {
    stickerImg.onerror = () => {
      dbg(`stickers v5 asset missing: ${src}`);
      row.remove();
    };
  }

  chatEl.appendChild(row);
  chatEl.scrollTop = chatEl.scrollHeight;
  return row;
}

/* === Voice bubble === */
function addVoiceBubble(audioUrl, text, who='assistant', ts=Date.now()){
  const d = new Date(ts);

  const row = document.createElement('div');
  row.className = 'row ' + (who==='user' ? 'me' : 'her');

  if (who !== 'user'){
    const ava=document.createElement('img');
    ava.className='avatar small';
    ava.src='/avatar.jpg'; ava.alt='Рин';
    row.appendChild(ava);
  } else {
    const spacer=document.createElement('div');
    spacer.className='avatar small spacer';
    row.appendChild(spacer);
  }

  const wrap=document.createElement('div');
  wrap.className='bubble voice-tg ' + (who==='user'?'me':'her');

  const top=document.createElement('div');
  top.className='voice-tg__row';

  const btn=document.createElement('button');
  btn.className='voice-tg__play';
  btn.setAttribute('aria-label','Проиграть голосовое');
  btn.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';

  const wave=document.createElement('div');
  wave.className='voice-tg__wave';
  const BAR_COUNT = 18;
  for (let i=0;i<BAR_COUNT;i++){
    const bar=document.createElement('i');
    bar.style.height = (8 + Math.round(Math.random()*18)) + 'px';
    wave.appendChild(bar);
  }

  const act=document.createElement('div');
  act.className='voice-tg__action';
  act.textContent='→A';
  act.title='Показать текст';

  top.appendChild(btn);
  top.appendChild(wave);
  top.appendChild(act);

  const meta=document.createElement('div');
  meta.className='voice-tg__meta';

  const dur=document.createElement('span');
  dur.className='voice-tg__dur';
  dur.textContent='0:00';

  const timeStamp=document.createElement('span');
  timeStamp.className='bubble-time';
  timeStamp.textContent=fmtTime(d);

  meta.appendChild(dur);
  meta.appendChild(timeStamp);

  wrap.appendChild(top);
  wrap.appendChild(meta);
  row.appendChild(wrap);
  chatEl.appendChild(row);
  chatEl.scrollTop=chatEl.scrollHeight;

  const audio=new Audio(audioUrl);

  const secToMMSS = s => {
    const v=Math.max(0, Math.floor(s||0));
    return `${Math.floor(v/60)}:${String(v%60).padStart(2,'0')}`;
  };

  audio.ontimeupdate = () => {
    const cur = audio.currentTime || 0;
    dur.textContent = secToMMSS(cur);
    const p = (cur / Math.max(1, audio.duration || 1)) * 100;
    wave.style.setProperty('--progress', `${p}%`);
  };

  btn.onclick=()=>{
    if (audio.paused){
      audio.play().then(()=>{
        btn.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
        wrap.classList.add('playing');
      }).catch(()=>{});
    } else {
      audio.pause();
      btn.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';
      wrap.classList.remove('playing');
    }
  };

  audio.onended=()=>{
    btn.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';
    wrap.classList.remove('playing');
    try{ URL.revokeObjectURL(audioUrl); }catch(e){}
  };

  act.onclick=()=>{
    act.remove();
    const tr=document.createElement('div');
    tr.className='voice-transcript';
    tr.textContent=text;
    wrap.appendChild(tr);
  };
}

/* === INIT === */
(async function init(){
  try{
    // 1) Загружаем профиль и обязательно присоединяем постоянное досье.
    await ensureActiveProfile();
    dbg('compact prompt profile ready: ' + Boolean(profile?.prompt_profile));
    await ensureLoreReady();

    // 2) stickers v5
    await ensureStickersReady();

    // 3) окружение
    await refreshRinEnv();
    setInterval(refreshRinEnv, WEATHER_REFRESH_MS);
  }catch(e){ dbg('init error: '+(e?.message||e)); }

  // подхватываем обновления профиля из редактора
  window.addEventListener('rin:profile-updated', async (ev)=>{
    profile = ev.detail || profile;
    await ensureActiveProfile();
  });

  history=loadHistory();
  if (history.length){
    for (const m of history) addBubble(m.content, m.role==='user'?'user':'assistant', m.ts);
  } else {
    greet();
  }

  setInterval(()=>{ peerStatus.textContent = Math.random()<0.85?'онлайн':'была недавно'; },15000);

  setInterval(tryInitiateBySchedule, 60_000);
  tryInitiateBySchedule();
})();

/* — приветствие на основе профиля — */
function greet(){
  // пул по времени суток
  let pool = 'day';
  if (currentEnv && currentEnv.partOfDay){
    const p = currentEnv.partOfDay;
    if (p === 'утро') pool = 'morning';
    else if (p === 'день') pool = 'day';
    else if (p === 'вечер') pool = 'evening';
    else pool = 'night';
  } else {
    const h = new Date().getHours();
    if (h >= 5 && h < 12) pool = 'morning';
    else if (h >= 12 && h < 18) pool = 'day';
    else if (h >= 18 && h < 23) pool = 'evening';
    else pool = 'night';
  }

  (async () => {
    let greeting = null;

    try {
      const lore = await ensureLoreReady();
      greeting = await lore?.pickGreeting(
        pool,
        nowInTz(RIN_TZ)
      );
    } catch (error) {
      dbg(
        'greeting phrase failed: ' +
        (error?.message || error)
      );
    }

    if (!greeting) {
      const starters =
        Array.isArray(profile?.starters)
          ? profile.starters
          : [];

      if (starters.length) {
        greeting =
          starters[
            Math.floor(Math.random() * starters.length)
          ];
      }
    }

    if (!greeting) {
      const pod = currentEnv?.partOfDay || 'сейчас';

      greeting =
        pod === 'утро'
          ? 'Доброе утро. Как ты?'
          : pod === 'вечер'
            ? 'Добрый вечер. Как твой день?'
            : pod === 'ночь'
              ? 'Тихая ночь тут… ты как?'
              : 'Привет. Как ты?';
    }

    addBubble(greeting, 'assistant');

    await maybeSticker('', greeting);

    history.push({
      role: 'assistant',
      content: greeting,
      ts: Date.now()
    });

    saveHistory(history);
  })();
}

function inWindow(local,from,to){
  const [fh,fm]=from.split(':').map(Number);
  const [th,tm]=to.split(':').map(Number);
  const min=local.getHours()*60+local.getMinutes();
  const a=fh*60+fm, b=th*60+tm;
  return min>=a && min<=b;
}
function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

/* === Voice-only шанс — без изменений === */
function shouldVoiceFor(text){
  if (!lsSpeakEnabled()) return false;
  const rate = lsSpeakRate()/100; // 0..0.5
  if (Math.random()>rate) return false;
  const t=(text||'').replace(/\s+/g,' ').trim();
  if (!t || t.length>180) return false;
  return true;
}
async function getTTSUrl(text){
  try{
    const r = await fetch('/api/tts',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ text }) });
    if (!r.ok) return null;
    const blob=await r.blob();
    return URL.createObjectURL(blob);
  }catch{ return null; }
}

/* === stickers v5: решение по смыслу сообщения пользователя и ответа Рин === */
async function maybeSticker(userText, replyText, responseMeta = null){
  if (stickerBusy) return;
  stickerBusy = true;
  try {
    await ensureStickersReady();
    if (!stickersLib || !STICKERS_CFG) { dbg('stickers v5 unavailable'); return; }

    const mode = lsStickerMode();
    if (mode === 'off') { dbg('stickers v5 none: reason=mode_off'); return; }

    const NEG = /(тяжел|тяжёл|груст|больно|тревог|сложно|проблем|помоги|помощ|совет|паник|плач|плохо)/i;
    if (lsStickerSafe() && userText && NEG.test(String(userText || ''))) {
      dbg('stickers v5 none: reason=safe_blocked');
      return;
    }

    let mood = {};
    try { mood = (await buildMemoryPayload())?.mood || {}; } catch {}

    const decision = stickersLib.decideSticker(STICKERS_CFG, {
      userText: userText || '',
      replyText: replyText || '',
      mood,
      mode: mode === 'always' ? 'always' : 'smart',
      baseProbability: lsStickerProb(),
      context: {
        scene: responseMeta?.conversationBrain?.activeScene?.type || responseMeta?.coreDecision?.conversationBrain?.activeScene?.type || '',
        intent: responseMeta?.coreDecision?.intent || '',
        userEmotion: responseMeta?.coreDecision?.userEmotion || '',
        deliveryStyle: responseMeta?.coreDecision?.deliveryStyle || '',
        hiddenIntent: responseMeta?.conversationBrain?.hiddenIntent?.type || responseMeta?.coreDecision?.conversationBrain?.hiddenIntent?.type || ''
      }
    });

    if (decision?.action !== 'send' || !decision?.sticker) {
      const top = Array.isArray(decision?.top) ? decision.top.map(x => `${x.src}:${x.score}`).join(', ') : '';
      dbg(`stickers v5 none: reason=${decision?.reason || 'unknown'}${Number.isFinite(decision?.probability) ? `; probability=${decision.probability}` : ''}${decision?.candidate ? `; candidate=${decision.candidate}` : ''}${decision?.probabilityReason ? `; probabilityReason=${decision.probabilityReason}` : ''}${top ? `; top=[${top}]` : ''}`);
      return;
    }

    dbg(`stickers v5 decision: sticker=${decision.sticker.src}; probability=${decision.probability ?? 100}; probabilityReason=${decision.probabilityReason || 'always'}; ${decision.reason || ''}`);
    addStickerBubble(decision.sticker.src, 'assistant', decision.utterance || null);
    stickersLib.markStickerSent(decision.sticker);
    chainStickerCount = 0;
    dbg(`stickers v5 decision: mode=${decision.mode}; timing=${decision.timing}; sticker=${decision.sticker.src}; confidence=${Number(decision.confidence || 0).toFixed(2)}; reason=${decision.reason}`);
  } catch (e) {
    dbg('stickers v5 error: ' + (e?.message || e));
  } finally {
    stickerBusy = false;
  }
}

/* === Автоинициации (используем profile.initiation) — stickers v5 уже работает === */
async function tryInitiateBySchedule(){
  if (!profile) return;

  const lore = await ensureLoreReady();
  const schedule =
    await lore?.getSchedule?.();

  const d = nowInTz(RIN_TZ);
  const dateKey = fmtDateKey(d);

  const counts = JSON.parse(
    localStorage.getItem(DAILY_INIT_KEY) || '{}'
  );

  const lastKey = Object.keys(counts).pop();

  if (lastKey && lastKey !== dateKey) {
    localStorage.setItem(
      DAILY_INIT_KEY,
      JSON.stringify({})
    );
    chainStickerCount = 0;
  }

  const maxDaily = Math.max(
    0,
    Number(
      schedule?.max_daily_initiations ??
      profile?.initiation?.max_per_day ??
      2
    )
  );

  if (getInitCountFor(dateKey) >= maxDaily) {
    return;
  }

  const windows =
    Array.isArray(schedule?.windows)
      ? schedule.windows
      : Array.isArray(profile?.initiation?.windows)
        ? profile.initiation.windows
        : [];

  const win = windows.find(window => {
    return (
      inWindow(d, window.from, window.to) &&
      Math.random() < (window.probability ?? 0.35)
    );
  });

  if (!win) return;

  const minimumSilenceMinutes = Math.max(
    15,
    Number(schedule?.minimum_silence_minutes || 45)
  );

  const last = history[history.length - 1];

  if (
    last &&
    last.role === 'assistant' &&
    d - new Date(last.ts || Date.now()) <
      minimumSilenceMinutes * 60 * 1000
  ) {
    return;
  }

  let text = await lore?.pickInitiationPhrase?.(
    win.pool || 'day',
    d
  );

  if (!text) {
    const starters =
      Array.isArray(profile?.starters)
        ? profile.starters
        : [];

    if (starters.length) {
      text = pick(starters);
    }
  }

  if (!text) return;

  peerStatus.textContent = 'печатает…';
  const trow = addTyping();

  setTimeout(async () => {
    trow.remove();
    peerStatus.textContent = 'онлайн';

    let voiced = false;

    if (shouldVoiceFor(text)) {
      const url = await getTTSUrl(text);

      if (url) {
        addVoiceBubble(url, text, 'assistant');
        voiced = true;
      }
    }

    if (!voiced) {
      addBubble(text, 'assistant');
    }

    await maybeSticker('', text);

    history.push({
      role: 'assistant',
      content: text,
      ts: Date.now()
    });

    saveHistory(history);
    bumpInitCount(dateKey);
  }, 900 + Math.random() * 900);
}

/* === Отправка: время, погода и запрос к модели === */
formEl.addEventListener('submit', async (e) => {
  e.preventDefault();

  const text = (inputEl.value || '').trim();
  if (!text) return;

  addBubble(text, 'user');

  history.push({
    role: 'user',
    content: text,
    ts: Date.now()
  });

  saveHistory(history);

  inputEl.value = '';
  inputEl.focus();

  // Увеличиваем счётчик сообщений до следующего стикера
  chainStickerCount++;

  const t = text.toLowerCase();

  /*
   * ВАЖНО:
   * Локальный обработчик smalltalk полностью удалён.
   *
   * Фразы:
   * — «Как дела?»
   * — «Чем занимаешься?»
   * — «Что сейчас происходит в твоём городе?»
   * — «Как настроение?»
   *
   * теперь отправляются модели и не заменяются шаблонной
   * фразой о времени, сезоне и погоде.
   */

  // Вопросы именно о времени Рин
  const RE_TIME =
    /(сколько\s+у\s+тебя\s+сейчас\s+времен(и|я)|сколько\s+у\s+тебя\s+времен(и|я)|который\s+час|время\s+у\s+тебя|что\s+у\s+тебя\s+по\s+времени)/i;

  // Вопросы именно о погоде
  const RE_WEATHER =
    /(?:какая[^?]*погода|что там с погодой|как[^?]*погода|сколько[^?]*градус|ид[её]т ли[^?]*(дождь|снег)|(?:холодно|тепло|жарко|дождь|снег)[^?]*у тебя)\s*\??$/i;

  function composeWeatherMood(env) {
    const w = env?.weather;
    if (!w) return '';

    const bits = [];

    if (typeof w.temp === 'number') {
      bits.push(`${w.temp}°C`);
    }

    if (w.desc) {
      bits.push(w.desc);
    }

    return bits.length
      ? `Сейчас в Канадзаве ${bits.join(', ')}.`
      : '';
  }

  function formatRinTime(env) {
    let d;

    if (env?.rinHuman) {
      d = new Date(env.rinHuman.replace(' ', 'T') + ':00');
    } else {
      d = nowInTz(RIN_TZ);
    }

    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');

    return `${hh}:${mm} по Канадзаве`;
  }

  async function renderAssistantReply(reply, responseMeta = null) {
    let voiced = false;

    if (shouldVoiceFor(reply)) {
      const url = await getTTSUrl(reply);

      if (url) {
        addVoiceBubble(url, reply, 'assistant');
        voiced = true;
      }
    }

    if (!voiced) {
      addBubble(reply, 'assistant');
    }

    await maybeSticker(text, reply, responseMeta);

    history.push({
  role: 'assistant',
  content: reply,
  ts: Date.now()
});

saveHistory(history);
chainStickerCount++;

if (responseMeta?.coreDecision?.initiative?.mode === 'small_observation') {
  try {
    const lib = await ensureMemoryReady();
    await lib?.markInnerLifeSpontaneous?.();
  } catch (error) {
    dbg('inner life mark failed: ' + (error?.message || error));
  }
}

// Фоновый анализ для долгосрочной памяти.
const aiMoodApplied =
  await analyzeConversationForMemory(
    text,
    reply
  );

if (!aiMoodApplied) {
  await updateRinMoodFromMessage(text);
}
  }

  // 1. Локальный ответ только на прямой вопрос о времени
  if (RE_TIME.test(t)) {
    try {
      await refreshRinEnv();
    } catch (error) {
      dbg(
        'time env refresh failed: ' +
        (error?.message || error)
      );
    }

    const env = currentEnv || null;
    const timeStr = formatRinTime(env);

    const rinHour = nowInTz(RIN_TZ).getHours();

    const pod =
      env?.partOfDay ||
      partOfDayFromHour(rinHour);

    const tail =
      pod === 'утро'
        ? 'У меня ещё утро — люблю это спокойствие.'
        : pod === 'день'
          ? 'У меня день — в хорошем темпе, но без спешки.'
          : pod === 'вечер'
            ? 'У меня вечер — тянет к чаю и тишине.'
            : 'У меня глубокая ночь — город почти не дышит.';

    const reply = `У меня сейчас ${timeStr}. ${tail}`;

    await renderAssistantReply(reply, data);
    return;
  }

  // 2. Локальный ответ только на прямой вопрос о погоде
  if (RE_WEATHER.test(t)) {
    try {
      await refreshRinEnv();
    } catch (error) {
      dbg(
        'weather env refresh failed: ' +
        (error?.message || error)
      );
    }

    const env = currentEnv || null;

    const head = 'Смотрю в окно и на погоду…';

    const weatherPhrase =
      buildWeatherPhrase(env) ||
      composeWeatherMood(env) ||
      'Пока не получилось узнать точную погоду.';

    const reply = `${head} ${weatherPhrase}`.trim();

    await renderAssistantReply(reply, data);
    return;
  }

  // 3. Все остальные сообщения отправляются модели
  peerStatus.textContent = 'печатает…';

  const typingRow = addTyping();

  try {
    const memoryModule = await ensureMemoryReady();
    await memoryModule?.advanceInnerLife?.(currentEnv || {}, text);
    const memory = await buildMemoryPayload();
    const activeProfile = await ensureActiveProfile();

    dbg(`build=${RIN_BUILD_VERSION}`);

    const loreModule = await ensureLoreReady();
    const lore = await loreModule?.buildLorePayload?.(text);

    if (lore) {
      const triggerNames =
        (lore.matchedTriggers || [])
          .map(item => item.id)
          .join(', ');

      dbg(
        'lore selected: ' +
        `${lore.memories?.length || 0} memories, ` +
        `${lore.backstory?.length || 0} backstory` +
        (triggerNames ? `; triggers=${triggerNames}` : '; triggers=none')
      );
    } else {
      dbg('lore unavailable');
    }

  const res = await fetch('/api/chat', {
      method: 'POST',

      headers: {
        'Content-Type': 'application/json'
      },

      body: JSON.stringify({
        history,

        pin: localStorage.getItem('rin-pin'),

        env: currentEnv || undefined,

        profile: activeProfile || undefined,

        memory: memory || undefined,

        lore: lore || undefined,

        client: {
          tz:
            Intl.DateTimeFormat()
              .resolvedOptions()
              .timeZone || null,

          sentAt: Date.now()
        }
      })
    });

    let data;

    try {
      data = await res.json();
    } catch {
      data = {};
    }

    typingRow.remove();

    if (res.status === 401) {
      try {
        localStorage.removeItem('rin-pin');
      } catch {}

      window.location.href = '/login';
      return;
    }

    if (!res.ok) {
      throw new Error(
        data?.detail ||
        data?.error ||
        `HTTP ${res.status}`
      );
    }

    const rawReply =
      typeof data?.reply === 'string'
        ? data.reply.trim()
        : '';

    if (!rawReply) {
      throw new Error('Сервер вернул пустой ответ');
    }

    let reply = rawReply;

    const postprocessor =
      await ensureResponsePostprocessor();

    if (postprocessor?.postProcessRinReply) {
      reply = postprocessor.postProcessRinReply({
        userText: text,
        reply: rawReply,
        longMode: Boolean(data.long)
      });

      dbg(
        `reply normalized: ${rawReply.length} -> ${reply.length}`
      );
    }

    if (data.coreDecision) {
      const core = data.coreDecision;
      const state = core.state || {};
      dbg(`core ${core.version || 'unknown'}: userEmotion=${core.userEmotion || 'unknown'}; intent=${core.intent || 'unknown'}; style=${core.replyStyle || 'unknown'}`);
      dbg(
        'core state: ' +
        `tenderness=${state.tenderness ?? '-'}, ` +
        `curiosity=${state.curiosity ?? '-'}, ` +
        `thoughtfulness=${state.thoughtfulness ?? '-'}, ` +
        `fatigue=${state.fatigue ?? '-'}, ` +
        `desireToTalk=${state.desireToTalk ?? '-'}, ` +
        `desireToFlirt=${state.desireToFlirt ?? '-'}, ` +
        `focus=${state.focus ?? '-'}, ` +
        `emotionality=${state.emotionality ?? '-'}`
      );
      if (core.habit) dbg(`core habit: ${core.habit}`);
      if (core.character) dbg(`core character: move=${core.character.move}; shape=${core.character.shape}`);
      if (core.deliveryStyle) dbg(`core delivery: ${core.deliveryStyle}`);
      if (core.reason) dbg(`core reason: ${core.reason}`);
      const brain = data.conversationBrain || core.conversationBrain;
      if (brain) {
        dbg(`brain ${brain.version || 'v1'}: literal=${brain.literalIntent}; hidden=${brain.hiddenIntent?.type || 'none'} (${brain.hiddenIntent?.confidence ?? '-'}%); relation=${brain.relation?.type || 'unknown'}`);
        dbg(`brain scene: ${brain.activeScene?.type || 'unknown'}; direction=${brain.activeScene?.emotionalDirection || 'unknown'}; topic=${brain.activeScene?.topic || '-'}`);
        if (brain.responseFocus) dbg(`brain focus: ${brain.responseFocus}`);
        (brain.obligations || []).forEach(item => dbg(`brain obligation: ${item}`));
      } else {
        dbg('conversation brain: missing from API response');
      }
    } else {
      dbg('personality core: missing from API response');
    }

    if (data.promptMetrics) {
      const pm = data.promptMetrics;
      dbg(
        'tokens: ' +
        `input=${pm.inputTokens ?? '-'}, output=${pm.outputTokens ?? '-'}, ` +
        `cached=${pm.cachedInputTokens ?? '-'}; ` +
        `systemChars=${pm.systemChars ?? '-'}, historyChars=${pm.historyChars ?? '-'}, ` +
        `historyItems=${pm.historyItems ?? '-'}`
      );
    }

    if (data.voiceMode) {
      dbg(
        'voice mode: ' +
        [
          data.voiceMode.mode,
          data.voiceMode.opening,
          data.voiceMode.ending
        ].filter(Boolean).join(' / ')
      );
    } else {
      dbg('voice mode: missing from API response');
    }

    if (data.long) {
      const previousStatus = peerStatus.textContent;

      peerStatus.textContent = '📖 рассказывает…';

      setTimeout(() => {
        peerStatus.textContent =
          previousStatus || 'онлайн';
      }, 2500);
    } else {
      peerStatus.textContent = 'онлайн';
    }

    await renderAssistantReply(reply, data);
  } catch (err) {
    if (typingRow?.isConnected) {
      typingRow.remove();
    }

    peerStatus.textContent = 'онлайн';

    const message =
      err && typeof err.message === 'string'
        ? err.message
        : typeof err === 'string'
          ? err
          : 'Неизвестная ошибка';

    dbg(`chat request failed: ${message}`);

    addBubble(
      'Ой… связь шалит. ' +
      (message || 'Попробуем ещё раз?'),
      'assistant'
    );
  }
});

/* совместимость: старый maybeSpeak больше не используется */
async function maybeSpeak(_text){ return false; }

/* — обновление окружения */
async function refreshRinEnv(){
  try{
    const rin = nowInTz(RIN_TZ);
    const monthIdx = rin.getMonth();
    const env = {
      _ts: Date.now(),
      rinTz: RIN_TZ,
      rinHuman: fmtRinHuman(rin),
      season: seasonFromMonth(monthIdx),
      month: monthNameRu(monthIdx),
      partOfDay: partOfDayFromHour(rin.getHours()),
      userVsRinHoursDiff: hoursDiffWithRin(),
      weather: null
    };
    const w = await fetchRinWeather();
    if (w) env.weather = w;
    currentEnv = env;
  }catch(e){
    dbg('refresh env failed: '+(e?.message||e));
  }
}
