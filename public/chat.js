import {
  createChatMessage,
  createReplySnapshot,
  createSerialQueue,
  loadChatHistory,
  isInternalNonverbalMetaText,
  normalizeReplySnapshot,
  resetApplicationStorage,
  saveChatHistory,
  toApiHistory,
  updateMessage
} from './js/chat_store.js';
import { RIN_RELEASE_ID } from './js/release.js';
import { createMemoryJobRunner, enqueueMemoryJob } from './js/memory_job_queue.js';
import { canAutoInitiate, canGreet, chooseConfiguredStarter, resolveInitiationPolicy } from './js/conversation_policy.js';
import { shouldRefreshEnvironment } from './js/environment_intent.js';
import { authenticatedHeaders, fetchWithTimeout, getStoredPin, removeStoredPin } from './js/http_client.js';
import { createPresenceController } from './js/presence_controller.js';
import { createChatViewportController } from './js/chat_viewport.js';

/* public/chat.js — фронт чата Рин, согласованный с твоим index.html (профиль из persona_ui/rin_memory) */

const RIN_BUILD_VERSION = RIN_RELEASE_ID;

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

function safeLocalGet(key, fallback = '') {
  try {
    const value = localStorage.getItem(key);
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

function safeLocalRemove(key) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function safeLocalSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.error(`[Rin storage] Не удалось сохранить ${key}`, error);
    return false;
  }
}

function safeLocalJson(key, fallback = {}) {
  try {
    const parsed = JSON.parse(safeLocalGet(key, 'null'));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/* DOM */
const chatEl        = document.getElementById('chat');
const formEl        = document.getElementById('form');
const inputEl       = document.getElementById('input');
const replyPreviewEl = document.getElementById('replyPreview');
const replyPreviewJump = document.getElementById('replyPreviewJump');
const replyPreviewAuthor = document.getElementById('replyPreviewAuthor');
const replyPreviewText = document.getElementById('replyPreviewText');
const replyPreviewThumb = document.getElementById('replyPreviewThumb');
const replyCancelEl = document.getElementById('replyCancel');
const peerStatus    = document.getElementById('peerStatus');

const chatViewport = createChatViewportController({
  root: document.documentElement,
  chat: chatEl,
  input: inputEl,
  windowRef: window,
  documentRef: document
});

const settingsToggle= document.getElementById('settingsToggle');
const settingsPanel = document.getElementById('settingsPanel');
const closeSettings = document.getElementById('closeSettings');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const settingsPages    = [...document.querySelectorAll('[data-settings-page]')];
const settingsTargets  = [...document.querySelectorAll('[data-settings-target]')];
const settingsBackBtns = [...document.querySelectorAll('[data-settings-back]')];

const themeChoices  = [...document.querySelectorAll('[data-theme-choice]')];

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
const voiceRateCard = document.getElementById('voiceRateCard');

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
    const r = await fetchWithTimeout(u, { headers: authenticatedHeaders() }, 12_000);
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

/* === Debug helpers (в панели настроек) === */
let _debugOn = safeLocalGet(LS_DEBUG_ENABLED) === '1';
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
    safeLocalSet(LS_DEBUG_ENABLED, _debugOn ? '1' : '0');
    if (!_debugOn && debugLogEl) debugLogEl.innerHTML='';
    dbg('debug enabled');
  };
}

/* Данные */
const resetApp      = document.getElementById('resetApp');

/* state */
let profile = null;         // профиль из persona_ui / rin_memory
const dossierCaches = new Map();
let loreLib = null;

/**
 * Единый загрузчик JSON-досье. Сохраняет прежнее поведение,
 * но убирает четыре одинаковых fetch/cache/error блока.
 */
async function loadDossierForChat(key, url, invalidMessage) {
  if (dossierCaches.has(key)) return dossierCaches.get(key);

  try {
    const response = await fetchWithTimeout(url, { cache: 'no-store' }, 12_000);
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

async function ensureLoreReady() {
  if (loreLib) return loreLib;

  try {
    loreLib = await import(`/js/rin_lore.js?v=${encodeURIComponent(RIN_BUILD_VERSION)}`);
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

async function ensureActiveProfile() {
  // persona_ui может обновить пользовательские поля позже chat.js.
  const globalProfile = window.RIN_PROFILE;
  if (globalProfile && typeof globalProfile === 'object') profile = globalProfile;
  if (!profile || typeof profile !== 'object') profile = {};

  // Канонический prompt-профиль принадлежит серверу. Клиент передаёт только
  // пользовательские overrides и настройки инициативы, но не может подменить canon.
  profile = {
    name: profile.name || 'Рин Акихара',
    description: profile.description || '',
    instructions_extra: profile.instructions_extra || '',
    knowledge: profile.knowledge || '',
    starters: Array.isArray(profile.starters) ? profile.starters : [],
    initiation: profile.initiation || null
  };

  return profile;
}

let history=[];
/* === Долгосрочная память Рин === */

let memoryLib = null;

/**
 * Загружает библиотеку памяти только при первом обращении.
 * Модуль загружается лениво, чтобы не блокировать старт интерфейса.
 */
async function ensureMemoryReady() {
  if (memoryLib) return memoryLib;

  try {
    memoryLib = await import(`/js/rin_memory.js?v=${encodeURIComponent(RIN_BUILD_VERSION)}`);
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
async function buildMemoryPayload({ innerLifeOverride = null } = {}) {
  const numberOr = (value, fallback = null) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };

  try {
    const lib = await ensureMemoryReady();
    if (!lib?.loadDiary) return null;
    const diary = await lib.loadDiary();
    if (!diary || typeof diary !== 'object') return null;

    return {
      schemaVersion: 2,
      facts: diary.facts && typeof diary.facts === 'object'
        ? diary.facts
        : { self: {}, user: {}, world: {} },
      recentEvents: Array.isArray(diary.events)
        ? diary.events.slice(-12).map(event => ({
            id: String(event?.id || '').slice(0, 100) || null,
            key: String(event?.key || '').slice(0, 100) || null,
            ts: numberOr(event?.ts),
            type: String(event?.type || 'note').slice(0, 30),
            text: String(event?.text || '').trim().slice(0, 500),
            importance: numberOr(event?.importance, 5),
            tags: Array.isArray(event?.tags) ? event.tags.slice(0, 8).map(tag => String(tag).slice(0, 40)) : []
          })).filter(event => event.text)
        : [],
      mood: diary.mood && typeof diary.mood === 'object'
        ? {
            affection: numberOr(diary.mood.affection, 65),
            energy: numberOr(diary.mood.energy, 65),
            label: String(diary.mood.label || 'спокойная').slice(0, 30),
            lastInteractionAt: numberOr(diary.mood.lastInteractionAt)
          }
        : null,
      relationship: diary.relationship && typeof diary.relationship === 'object'
        ? {
            trust: numberOr(diary.relationship.trust, 55),
            closeness: numberOr(diary.relationship.closeness, 42),
            comfort: numberOr(diary.relationship.comfort, 52),
            respect: numberOr(diary.relationship.respect, 68),
            playfulness: numberOr(diary.relationship.playfulness, 45),
            stage: String(diary.relationship.stage || '').slice(0, 60),
            lastInteractionAt: numberOr(diary.relationship.lastInteractionAt),
            sharedMoments: Array.isArray(diary.relationship.sharedMoments)
              ? diary.relationship.sharedMoments.slice(-6).map(item => ({
                  id: String(item?.id || '').slice(0, 100) || null,
                  key: String(item?.key || '').slice(0, 100) || null,
                  text: String(item?.text || '').slice(0, 400),
                  importance: numberOr(item?.importance, 6),
                  ts: numberOr(item?.ts)
                }))
              : []
          }
        : null,
      openLoops: Array.isArray(diary.openLoops)
        ? diary.openLoops.slice(-8).map(item => ({
            id: String(item?.id || '').slice(0, 100) || null,
            key: String(item?.key || '').slice(0, 100) || null,
            text: String(item?.text || '').slice(0, 400),
            type: String(item?.type || 'topic').slice(0, 30),
            importance: numberOr(item?.importance, 5),
            createdAt: numberOr(item?.createdAt)
          }))
        : [],
      summaries: Array.isArray(diary.summaries)
        ? diary.summaries.slice(-4).map(item => ({
            id: String(item?.id || '').slice(0, 100) || null,
            text: String(item?.text || '').slice(0, 1400),
            ts: numberOr(item?.ts)
          })).filter(item => item.text)
        : [],
      innerLife: (innerLifeOverride || diary.innerLife) && typeof (innerLifeOverride || diary.innerLife) === 'object'
        ? (() => {
            const state = innerLifeOverride || diary.innerLife;
            return {
              activity: String(state.activity || '').slice(0, 180),
              trace: String(state.trace || '').slice(0, 220),
              focus: String(state.focus || '').slice(0, 220),
              privateThought: String(state.privateThought || '').slice(0, 260),
              part: String(state.part || '').slice(0, 20),
              startedAt: numberOr(state.startedAt),
              expiresAt: numberOr(state.expiresAt),
              lastSpontaneousAt: numberOr(state.lastSpontaneousAt),
              interactionCount: numberOr(state.interactionCount, 0)
            };
          })()
        : null,
      conversationState: diary.conversationState && typeof diary.conversationState === 'object'
        ? diary.conversationState
        : null
    };
  } catch (error) {
    dbg('memory payload failed: ' + (error?.message || error));
    return null;
  }
}

/**
 * Сохраняет результат анализа памяти в локальный дневник.
 */
async function applyExtractedMemory(extracted, userText = '') {
  try {
    const lib = await ensureMemoryReady();
    if (!lib) return false;

    for (const fact of Array.isArray(extracted?.facts) ? extracted.facts : []) {
      const path = String(fact?.path || '').trim();
      const value = String(fact?.value || '').trim();
      const confidence = Number(fact?.confidence);
      if (!path.startsWith('user.') || !value || (Number.isFinite(confidence) && confidence < 0.75)) continue;
      await lib.upsertFact(path, value);
      dbg(`memory fact saved: ${path}`);
    }

    for (const event of Array.isArray(extracted?.events) ? extracted.events : []) {
      const text = String(event?.text || '').trim();
      const importance = Number.isFinite(Number(event?.importance)) ? Number(event.importance) : 5;
      if (!text || importance < 6) continue;
      await lib.addEvent(text, {
        id: event?.id || null,
        key: event?.key || null,
        type: String(event?.type || 'memory'),
        tags: Array.isArray(event?.tags) ? event.tags.slice(0, 8) : [],
        importance
      });
    }

    for (const loop of Array.isArray(extracted?.openLoops) ? extracted.openLoops : []) await lib.addOpenLoop?.(loop);
    for (const loop of Array.isArray(extracted?.resolvedLoops) ? extracted.resolvedLoops : []) await lib.resolveOpenLoop?.(loop);
    for (const moment of Array.isArray(extracted?.sharedMoments) ? extracted.sharedMoments : []) {
      if ((Number(moment?.importance) || 0) >= 7) await lib.addSharedMoment?.(moment);
    }
    await lib.consolidateDiary?.();

    return true;
  } catch (error) {
    dbg('apply extracted memory failed: ' + (error?.message || error));
    return false;
  }
}

function shouldAnalyzeConversationForMemory(userText = '') {
  const text = String(userText || '').replace(/\s+/g, ' ').trim();
  if (!text) return false;
  const completedUserTurns = history.filter(item => item?.role === 'user' && item?.status === 'complete' && ['text', 'voice'].includes(item?.kind || 'text')).length;
  const meaningful = /(меня зовут|мне \d{1,3} (?:лет|года|год)|мой день рождения|я живу|я работаю|моя работа|мой проект|я разрабатываю|я люблю|мне нравится|я предпочитаю|обычно я|кажд(?:ый|ую) (?:день|неделю)|завтра|послезавтра|на следующей неделе|собеседован|встреча|поездк|обещаю|решил|решила|планирую|хочу рассказать|только тебе|доверяю тебе|важно для меня)/iu.test(text);
  const substantial = text.length >= 220;
  const periodicCatchUp = completedUserTurns > 0 && completedUserTurns % 8 === 0 && text.length >= 45;
  const trivial = /^(?:привет|доброе утро|добрый день|добрый вечер|ну пока|до завтра|спокойной ночи|спасибо|ага|да|нет|ок(?:ей)?|хорошо|понятно|мм+|ха+|[\p{Emoji_Presentation}\p{Extended_Pictographic}\s.!?]+)$/iu.test(text);
  return !trivial && (meaningful || substantial || periodicCatchUp);
}

async function analyzeConversationForMemory(userText, assistantText) {
  try {
    const existingMemory = await buildMemoryPayload();
    const res = await fetchWithTimeout('/api/memory', {
      method: 'POST',
      headers: authenticatedHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ userText, assistantText, existingMemory: existingMemory || undefined })
    }, 25_000);
    if (res.status === 401) return { ok: false, code: 'UNAUTHORIZED' };
    if (!res.ok) return { ok: false, code: 'MEMORY_HTTP_ERROR' };
    const extracted = await res.json();
    if (extracted?.warning) return { ok: false, code: extracted.warning };
    const applied = await applyExtractedMemory(extracted, userText);
    return { ok: applied, code: applied ? null : 'MEMORY_APPLY_FAILED' };
  } catch (error) {
    dbg('memory analysis failed: ' + (error?.message || error));
    return { ok: false, code: error?.name === 'AbortError' ? 'MEMORY_TIMEOUT' : 'MEMORY_REQUEST_FAILED' };
  }
}

const memoryJobRunner = createMemoryJobRunner(
  job => analyzeConversationForMemory(job.userText, job.assistantText),
  { storage: localStorage }
);
setTimeout(() => { void memoryJobRunner.drain(); }, 0);
setInterval(() => { void memoryJobRunner.drain(); }, 30_000);

/* ============================= */
/* НАСТРОЕНИЕ РИН */
/* ============================= */

async function commitSuccessfulTurnState({ memoryModule, userMessage, data, preparedInnerLife, loreModule, preparedLore }) {
  const transition = data?.stateTransition || null;
  const spontaneous = data?.coreDecision?.initiative?.mode === 'small_observation';
  const committed = await memoryModule?.commitTurnState?.({
    requestId: userMessage.requestId,
    innerLife: preparedInnerLife,
    stateTransition: transition,
    moodDelta: transition?.moodDelta || null,
    relationshipDelta: transition?.relationshipDelta || null,
    spontaneous,
    now: Date.now()
  });
  if (preparedLore) loreModule?.commitLorePayload?.(preparedLore);
  if (committed?.mood) dbg(`turn state committed: rev=${committed.conversationState?.revision || 0}; mood=${committed.mood.label}`);
  return committed;
}

/* Стикеры вызываются внутри сериализованного диалогового потока. */
/* === stickers v6: смысловая двухканальная система === */
let STICKERS_CFG = null;
let stickersLib = null;

async function ensureStickersReady(){
  if (!stickersLib) {
    try { stickersLib = await import(`/lib/stickers-v6.js?v=${encodeURIComponent(RIN_BUILD_VERSION)}`); }
    catch(e){ dbg('stickers v6 import failed: '+(e?.message||e)); stickersLib=null; }
  }
  if (stickersLib && !STICKERS_CFG) {
    try { STICKERS_CFG = await stickersLib.loadStickerConfig('/data/stickers-v6.json'); dbg('stickers v6 loaded'); }
    catch(e){ dbg('stickers v6 load failed: '+(e?.message||e)); STICKERS_CFG=null; }
  }
}

/* utils */
const fmtDateKey = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const fmtTime = d => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function loadHistory(){
  return loadChatHistory(localStorage);
}
function saveHistory(h){
  const ok = saveChatHistory(h, localStorage);
  if (!ok) dbg('history save failed: storage quota or unavailable');
  return ok;
}
function getInitCountFor(k){
  const m = safeLocalJson(DAILY_INIT_KEY, {});
  return m[k] || 0;
}
function bumpInitCount(k){
  const m = safeLocalJson(DAILY_INIT_KEY, {});
  m[k] = (m[k] || 0) + 1;
  safeLocalSet(DAILY_INIT_KEY, JSON.stringify(m));
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
  if (event.key !== 'Escape') return;
  if (replySelection) {
    clearReplySelection({ focus: true });
    return;
  }
  if (!settingsPanel || settingsPanel.classList.contains('hidden')) return;
  const activePage = settingsPages.find(page => page.classList.contains('is-active'))?.dataset.settingsPage;
  if (activePage && activePage !== 'main') showSettingsPage('main');
  else closeSettingsPanel();
});

/* — Тема: один выбор управляет чатом и всеми экранами настроек — */
function normalizeTheme(value){
  return value === 'theme-light' ? 'theme-light' : 'theme-dark';
}
function activeTheme(){
  return document.documentElement.classList.contains('theme-light') ? 'theme-light' : 'theme-dark';
}
function syncThemeChoices(){
  const current = activeTheme();
  themeChoices.forEach(button => {
    const selected = button.dataset.themeChoice === current;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
}
function applyTheme(next, { persist = true } = {}){
  const normalized = normalizeTheme(next);
  if (typeof window.__rinSetTheme === 'function') window.__rinSetTheme(normalized, persist);
  else {
    document.documentElement.classList.remove('theme-dark', 'theme-light');
    document.documentElement.classList.add(normalized);
  }
  syncThemeChoices();
}
themeChoices.forEach(button => {
  button.addEventListener('click', () => applyTheme(button.dataset.themeChoice));
});
window.addEventListener('storage', event => {
  if (event.key !== THEME_KEY || !event.newValue) return;
  applyTheme(event.newValue, { persist: false });
});
syncThemeChoices();

/* — Обои — */
function applyWallpaper(){
  const data = safeLocalGet(LS_WP_DATA) || '';
  const op   = +(safeLocalGet(LS_WP_OPACITY) || '90') / 100;

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
    if (f.size > 2_000_000) {
      alert('Файл обоев слишком большой. Используй изображение до 2 МБ.');
      wpFile.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (!safeLocalSet(LS_WP_DATA, reader.result)) {
        alert('Не удалось сохранить обои: локальное хранилище заполнено.');
        return;
      }
      applyWallpaper();
    };
    reader.readAsDataURL(f);
  });
}
if (wpClear){
  wpClear.onclick=()=>{
    safeLocalRemove(LS_WP_DATA);
    applyWallpaper();
  };
}
if (wpOpacity){
  wpOpacity.oninput=()=>{
    safeLocalSet(LS_WP_OPACITY, String(wpOpacity.value));
    applyWallpaper();
  };
}

/* — Стикеры: настройки UI — */
function lsStickerProb(){ return +(safeLocalGet(LS_STICKER_PROB) || '30'); } // %
function lsStickerMode(){
  const raw = safeLocalGet(LS_STICKER_MODE) || 'smart';
  if (raw === 'keywords') return 'smart';
  return ['smart','always','off'].includes(raw) ? raw : 'smart';
}
function lsStickerSafe(){ return safeLocalGet(LS_STICKER_SAFE)==='1'; }
function lsStickerOpacity(){
  return Math.max(20, Math.min(100, +(safeLocalGet(LS_STICKER_OPACITY) || '100')));
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
  if (next !== 'off') safeLocalSet(LS_STICKER_LAST_MODE, next);
  safeLocalSet(LS_STICKER_MODE, next);
  updateStickerModeUI(next);
}

if (stickerProb){
  stickerProb.value = String(lsStickerProb());
  if (stickerProbVal) stickerProbVal.textContent = `${stickerProb.value}%`;
  stickerProb.oninput = () => {
    safeLocalSet(LS_STICKER_PROB, String(stickerProb.value));
    if (stickerProbVal) stickerProbVal.textContent = `${stickerProb.value}%`;
  };
}
if (stickerMode){
  const mode = lsStickerMode();
  if (mode !== (safeLocalGet(LS_STICKER_MODE) || 'smart')) {
    safeLocalSet(LS_STICKER_MODE, mode);
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
    const lastMode = safeLocalGet(LS_STICKER_LAST_MODE);
    setStickerMode(['smart','always'].includes(lastMode) ? lastMode : 'smart');
  };
}
if (stickerSafe){
  stickerSafe.checked = lsStickerSafe();
  stickerSafe.onchange = ()=>safeLocalSet(LS_STICKER_SAFE, stickerSafe.checked?'1':'0');
}
if (stickerOpacity){
  stickerOpacity.oninput = () => {
    safeLocalSet(LS_STICKER_OPACITY, String(stickerOpacity.value));
    applyStickerOpacity();
  };
}
updateStickerModeUI();
applyStickerOpacity();

/* — Голос: включение и частота живут только внутри голосового подменю — */
function lsSpeakEnabled(){ return safeLocalGet(LS_SPEAK_ENABLED) === '1'; }
function lsSpeakRate(){ return +(safeLocalGet(LS_SPEAK_RATE) || '20'); } // %
function syncVoiceSettings(){
  const enabled = Boolean(voiceEnabled?.checked);
  if (voiceRate) voiceRate.disabled = !enabled;
  if (voiceRateCard) voiceRateCard.classList.toggle('is-disabled', !enabled);
}
if (voiceEnabled){
  voiceEnabled.checked = lsSpeakEnabled();
  voiceEnabled.onchange = ()=>{
    safeLocalSet(LS_SPEAK_ENABLED, voiceEnabled.checked?'1':'0');
    syncVoiceSettings();
  };
}
if (voiceRate){
  voiceRate.value = String(lsSpeakRate());
  if (voiceRateVal) voiceRateVal.textContent = `${voiceRate.value}%`;
  voiceRate.oninput = ()=>{
    safeLocalSet(LS_SPEAK_RATE, String(voiceRate.value));
    if (voiceRateVal) voiceRateVal.textContent = `${voiceRate.value}%`;
  };
}
syncVoiceSettings();

/* — Сброс — */
if (resetApp){
  resetApp.onclick=()=>{
    if (!confirm('Удалить локальную историю, память, профиль, настройки и кэш приложения на этом устройстве? PIN входа будет сохранён.')) return;
    resetApplicationStorage(localStorage, { preservePin: true });
    try { loreLib?.resetLoreCache?.(); } catch {}
    try { stickersLib?.resetStickerState?.(); } catch {}
    dossierCaches.clear();
    window.location.reload();
  };
}

/* === Рендер сообщений и ответы на выбранные сообщения === */
let replySelection = null;
let replyFlashTimer = null;

function replyAuthorLabel(snapshot = null) {
  return snapshot?.role === 'assistant' ? 'Рин' : 'Ты';
}

function replyVisibleText(snapshot = null) {
  if (!snapshot) return '';
  if (snapshot.kind === 'sticker') return snapshot.excerpt && snapshot.excerpt !== 'Стикер' ? snapshot.excerpt : 'Стикер';
  if (snapshot.kind === 'voice') return 'Голосовое сообщение';
  return snapshot.excerpt || '';
}

function findMessageById(messageId) {
  return history.find(item => item?.id === messageId) || null;
}

function scrollToMessage(messageId) {
  const row = findMessageRow(messageId);
  if (!row) return false;
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  row.classList.remove('reply-source-flash');
  void row.offsetWidth;
  row.classList.add('reply-source-flash');
  if (replyFlashTimer) clearTimeout(replyFlashTimer);
  replyFlashTimer = setTimeout(() => row.classList.remove('reply-source-flash'), 1500);
  return true;
}

function renderReplyPreview() {
  if (!replyPreviewEl) return;
  if (!replySelection?.snapshot) {
    replyPreviewEl.hidden = true;
    replyPreviewThumb.hidden = true;
    replyPreviewThumb.removeAttribute('src');
    replyPreviewAuthor.textContent = '';
    replyPreviewText.textContent = '';
    return;
  }
  const snapshot = replySelection.snapshot;
  replyPreviewAuthor.textContent = replyAuthorLabel(snapshot);
  replyPreviewText.textContent = replyVisibleText(snapshot);
  if (snapshot.kind === 'sticker' && snapshot.stickerSrc) {
    replyPreviewThumb.src = snapshot.stickerSrc;
    replyPreviewThumb.alt = 'Миниатюра стикера';
    replyPreviewThumb.hidden = false;
  } else {
    replyPreviewThumb.hidden = true;
    replyPreviewThumb.removeAttribute('src');
  }
  replyPreviewEl.hidden = false;
}

function clearReplySelection({ focus = false } = {}) {
  replySelection = null;
  renderReplyPreview();
  if (focus) inputEl?.focus({ preventScroll: false });
}

function selectReplyMessage(message) {
  if (!message || message.status !== 'complete' || !['text', 'voice', 'sticker'].includes(message.kind || 'text')) return false;
  const snapshot = createReplySnapshot(message);
  if (!snapshot) return false;
  replySelection = { messageId: message.id, snapshot };
  renderReplyPreview();
  inputEl?.focus({ preventScroll: false });
  dbg(`reply target selected: id=${message.id}; kind=${snapshot.kind}; role=${snapshot.role}`);
  return true;
}

replyPreviewJump?.addEventListener('click', () => {
  if (replySelection?.messageId) scrollToMessage(replySelection.messageId);
});
replyCancelEl?.addEventListener('click', () => clearReplySelection({ focus: true }));

function createReplyQuote(snapshot, messageId) {
  const normalized = normalizeReplySnapshot(snapshot);
  if (!normalized) return null;
  const quote = document.createElement('button');
  quote.type = 'button';
  quote.className = 'reply-quote';
  quote.dataset.replyTargetId = String(messageId || '');
  quote.setAttribute('aria-label', `Перейти к сообщению: ${replyAuthorLabel(normalized)} — ${replyVisibleText(normalized)}`);

  const accent = document.createElement('span');
  accent.className = 'reply-quote__accent';
  accent.setAttribute('aria-hidden', 'true');
  quote.appendChild(accent);

  if (normalized.kind === 'sticker' && normalized.stickerSrc) {
    quote.classList.add('reply-quote--media');
    const thumb = document.createElement('img');
    thumb.className = 'reply-quote__thumb';
    thumb.src = normalized.stickerSrc;
    thumb.alt = 'Стикер';
    quote.appendChild(thumb);
  } else if (normalized.kind === 'voice') {
    quote.classList.add('reply-quote--media');
    const voice = document.createElement('span');
    voice.className = 'reply-quote__voice';
    voice.textContent = '▶';
    voice.setAttribute('aria-hidden', 'true');
    quote.appendChild(voice);
  }

  const copy = document.createElement('span');
  copy.className = 'reply-quote__copy';
  const author = document.createElement('strong');
  author.textContent = replyAuthorLabel(normalized);
  const text = document.createElement('span');
  text.textContent = replyVisibleText(normalized);
  copy.append(author, text);
  quote.appendChild(copy);
  quote.addEventListener('click', event => {
    event.stopPropagation();
    if (!scrollToMessage(messageId)) quote.classList.add('reply-quote--missing');
  });
  return quote;
}

function attachReplyInteraction(row, bubble, message) {
  if (!message || !['text', 'voice', 'sticker'].includes(message.kind || 'text')) return;
  const currentMessage = () => findMessageById(message.id) || message;
  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'message-reply-action';
  action.setAttribute('aria-label', 'Ответить на сообщение');
  action.title = 'Ответить';
  const replyIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 7.5 4.5 12l5 4.5M5 12h7.2c4 0 6.3 2 7.3 5.4-.1-5.8-2.5-9.4-7.3-9.4H9.5"/></svg>';
  action.innerHTML = replyIcon;
  action.addEventListener('click', event => {
    event.stopPropagation();
    selectReplyMessage(currentMessage());
  });
  const swipeIndicator = document.createElement('span');
  swipeIndicator.className = 'reply-swipe-indicator';
  swipeIndicator.setAttribute('aria-hidden', 'true');
  swipeIndicator.innerHTML = replyIcon;
  bubble.append(action, swipeIndicator);

  bubble.addEventListener('contextmenu', event => {
    if (event.target.closest('button')) return;
    event.preventDefault();
    selectReplyMessage(currentMessage());
  });

  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let shift = 0;
  let longPressTimer = null;
  let longPressed = false;

  const reset = () => {
    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = null;
    pointerId = null;
    shift = 0;
    bubble.classList.remove('reply-swipe-active');
    bubble.style.removeProperty('--reply-swipe-x');
  };

  bubble.addEventListener('pointerdown', event => {
    if (event.button != null && event.button !== 0) return;
    if (event.target.closest('button')) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    longPressed = false;
    longPressTimer = setTimeout(() => {
      longPressed = true;
      selectReplyMessage(currentMessage());
      try { navigator.vibrate?.(12); } catch {}
      reset();
    }, 520);
  });

  bubble.addEventListener('pointermove', event => {
    if (pointerId !== event.pointerId) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.abs(dy) > 18 && Math.abs(dy) > Math.abs(dx)) {
      reset();
      return;
    }
    if (dx <= 5) return;
    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = null;
    shift = Math.min(68, dx * 0.72);
    bubble.classList.add('reply-swipe-active');
    bubble.style.setProperty('--reply-swipe-x', `${shift}px`);
  });

  bubble.addEventListener('pointerup', event => {
    if (pointerId !== event.pointerId) return;
    const shouldReply = !longPressed && shift >= 42;
    reset();
    if (shouldReply) selectReplyMessage(currentMessage());
  });
  bubble.addEventListener('pointercancel', reset);
  bubble.addEventListener('lostpointercapture', reset);
}

function decorateMessageRow(row, bubble, message, options = {}) {
  row.classList.add('message-row');
  if (message?.id || options.messageId) row.dataset.messageId = message?.id || options.messageId;
  if (message?.status || options.status) row.dataset.status = message?.status || options.status;
  if (message?.replySnapshot) {
    const quote = createReplyQuote(message.replySnapshot, message.inReplyTo);
    if (quote) bubble.prepend(quote);
  }
  attachReplyInteraction(row, bubble, message);
}

function addBubble(text, who='assistant', ts=Date.now(), options={}){
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
  msg.className='bubble-text';
  msg.textContent=text;
  const time=document.createElement('span');
  time.className='bubble-time';
  time.textContent=fmtTime(d);
  wrap.appendChild(msg);
  wrap.appendChild(time);

  if (options.retry) {
    const retry=document.createElement('button');
    retry.type='button';
    retry.className='message-retry';
    retry.textContent='Повторить';
    retry.addEventListener('click', options.retry);
    wrap.appendChild(retry);
  }

  row.appendChild(wrap);
  decorateMessageRow(row, wrap, options.message || null, options);
  chatEl.appendChild(row);
  chatViewport.requestScrollToBottom({ force: options.forceScroll !== false });
  return row;
}

function addTyping(){
  const row=document.createElement('div');
  row.className='row her typing-row';
  row.innerHTML=`<img class="avatar small" src="/avatar.jpg" alt="Рин"/>
    <div class="bubble her typing"><span></span><span></span><span></span></div>`;
  chatEl.appendChild(row);
  chatViewport.requestScrollToBottom({ force: true });
  return row;
}

/* === Стикеры: рендер === */
function addStickerBubble(src, who='assistant', utterance=null, ts=Date.now(), options={}){
  return new Promise(resolve => {
    if (src && typeof src === 'object' && src.src) src = src.src;
    if (!/^\/stickers\/[a-z0-9_]+\.webp$/i.test(String(src || ''))) return resolve(null);
    const row = document.createElement('div');
    row.className = 'row ' + (who === 'user' ? 'me' : 'her') + ' sticker-loading';
    if (who !== 'user') {
      const avatar = document.createElement('img'); avatar.className = 'avatar small'; avatar.src = '/avatar.jpg'; avatar.alt = 'Рин'; row.appendChild(avatar);
    } else {
      const spacer = document.createElement('div'); spacer.className = 'avatar small spacer'; row.appendChild(spacer);
    }
    const bubble = document.createElement('div'); bubble.className = `bubble ${who === 'user' ? 'me' : 'her'} sticker-only`;
    const image = document.createElement('img'); image.className = 'sticker'; image.alt = 'стикер';
    bubble.appendChild(image);
    if (utterance) { const label = document.createElement('div'); label.className = 'sticker-utter'; label.textContent = utterance; bubble.appendChild(label); }
    const time = document.createElement('span'); time.className = 'bubble-time'; time.textContent = fmtTime(new Date(ts));
    bubble.appendChild(time);
    row.appendChild(bubble);
    decorateMessageRow(row, bubble, options.message || null, options);
    chatEl.appendChild(row);
    image.onload = () => { row.classList.remove('sticker-loading'); chatViewport.requestScrollToBottom({ force: options.forceScroll !== false }); resolve(row); };
    image.onerror = () => { dbg(`sticker asset failed: ${src}`); row.remove(); resolve(null); };
    image.src = src;
  });
}

/* === Voice bubble === */
function addVoiceBubble(audioUrl, text, who='assistant', ts=Date.now(), options={}){
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
  for (let i=0;i<18;i++){
    const bar=document.createElement('i');
    bar.style.height = (8 + Math.round(Math.random()*18)) + 'px';
    wave.appendChild(bar);
  }
  const act=document.createElement('button');
  act.type='button';
  act.className='voice-tg__action';
  act.textContent='→A';
  act.title='Показать текст';
  top.append(btn, wave, act);

  const meta=document.createElement('div');
  meta.className='voice-tg__meta';
  const dur=document.createElement('span');
  dur.className='voice-tg__dur';
  dur.textContent='0:00';
  const timeStamp=document.createElement('span');
  timeStamp.className='bubble-time';
  timeStamp.textContent=fmtTime(d);
  meta.append(dur, timeStamp);
  wrap.append(top, meta);
  row.appendChild(wrap);
  decorateMessageRow(row, wrap, options.message || null, options);
  chatEl.appendChild(row);
  chatViewport.requestScrollToBottom({ force: options.forceScroll !== false });

  const audio=new Audio(audioUrl);
  const secToMMSS = value => {
    const seconds=Math.max(0, Math.floor(value||0));
    return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
  };
  audio.ontimeupdate = () => {
    const cur = audio.currentTime || 0;
    dur.textContent = secToMMSS(cur);
    wave.style.setProperty('--progress', `${(cur / Math.max(1, audio.duration || 1)) * 100}%`);
  };
  btn.addEventListener('click', () => {
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
  });
  audio.onended=()=>{
    btn.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';
    wrap.classList.remove('playing');
    try{ URL.revokeObjectURL(audioUrl); }catch{}
  };
  act.addEventListener('click', () => {
    act.remove();
    const transcript=document.createElement('div');
    transcript.className='voice-transcript';
    transcript.textContent=text;
    wrap.appendChild(transcript);
  });
  return row;
}

/* === ЕДИНЫЙ КОНТРОЛЛЕР ДИАЛОГА === */
let activeRequests = 0;
let greetingActive = false;

function newRequestId() {
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const presence = createPresenceController({
  render: (mode, label) => {
    peerStatus.textContent = label;
    peerStatus.dataset.mode = mode;
  },
  isTransportOnline: () => navigator.onLine !== false,
  isVisible: () => document.visibilityState !== 'hidden'
});

function syncPeerAvailability() {
  presence.syncAvailability();
}

window.addEventListener('online', syncPeerAvailability);
window.addEventListener('offline', syncPeerAvailability);
document.addEventListener('visibilitychange', syncPeerAvailability);
window.addEventListener('pagehide', () => presence.dispose(), { once: true });

function inWindow(local, from, to) {
  if (!from || !to) return false;
  const [fh, fm] = from.split(':').map(Number);
  const [th, tm] = to.split(':').map(Number);
  if (![fh, fm, th, tm].every(Number.isFinite)) return false;
  const minute = local.getHours() * 60 + local.getMinutes();
  return minute >= fh * 60 + fm && minute <= th * 60 + tm;
}


async function renderStoredMessage(message) {
  if (message.kind === 'silence') return null;
  if (message.role === 'assistant' && ['text', 'voice'].includes(message.kind) && isInternalNonverbalMetaText(message.content)) return null;
  if (message.kind === 'sticker' && message.sticker?.src) {
    return addStickerBubble(message.sticker.src, message.role, message.sticker.utterance || null, message.ts, {
      message,
      forceScroll: false
    });
  }
  const prefix = message.kind === 'voice' ? '🎙️ ' : '';
  return addBubble(prefix + message.content, message.role, message.ts, {
    message,
    retry: message.role === 'user' && message.status === 'failed'
      ? () => retryMessage(message.id)
      : null,
    forceScroll: false
  });
}

(async function init(){
  syncPeerAvailability();
  try {
    await ensureActiveProfile();
    await ensureLoreReady();
    await ensureStickersReady();
    await refreshRinEnv();
  } catch (error) {
    dbg('init error: ' + (error?.message || error));
  }

  window.addEventListener('rin:profile-updated', async event => {
    profile = event.detail || profile;
    await ensureActiveProfile();
  });

  history = loadHistory();
  for (const message of history) await renderStoredMessage(message);
  chatViewport.requestScrollToBottom({ force: true });
  if (!history.length) await greet();

  setInterval(refreshRinEnv, WEATHER_REFRESH_MS);
  setInterval(() => { void tryInitiateBySchedule(); }, 60_000);
  void tryInitiateBySchedule();
})();

async function greet() {
  if (!canGreet({ history, greetingActive, activeRequests })) return false;
  greetingActive = true;
  try {
    const part = currentEnv?.partOfDay;
    const pool = part === 'утро' ? 'morning' : part === 'вечер' ? 'evening' : part === 'ночь' ? 'night' : 'day';
    let greeting = null;
    try {
      const lore = await ensureLoreReady();
      greeting = chooseConfiguredStarter(profile);
      if (!greeting) greeting = await lore?.pickGreeting?.(pool, nowInTz(RIN_TZ));
    } catch (error) {
      dbg('greeting phrase failed: ' + (error?.message || error));
    }
    if (!greeting) greeting = pool === 'morning' ? 'Доброе утро. Как ты?' : pool === 'evening' ? 'Добрый вечер. Как твой день?' : pool === 'night' ? 'Тихая ночь тут… ты как?' : 'Привет. Как ты?';

    const message = createChatMessage({ role: 'assistant', kind: 'text', status: 'complete', content: greeting });
    addBubble(greeting, 'assistant', message.ts, { message });
    history.push(message);
    saveHistory(history);
    return true;
  } finally {
    greetingActive = false;
  }
}

function shouldVoiceFor(text) {
  if (!lsSpeakEnabled()) return false;
  if (Math.random() > lsSpeakRate() / 100) return false;
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  return Boolean(normalized && normalized.length <= 180);
}

async function getTTSUrl(text) {
  try {
    const response = await fetchWithTimeout('/api/tts', {
      method: 'POST',
      headers: authenticatedHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ text })
    }, 25_000);
    if (response.status === 401) return null;
    if (!response.ok) return null;
    return URL.createObjectURL(await response.blob());
  } catch {
    return null;
  }
}

function stickerSemanticText(decision) {
  const meaning = String(decision?.meaning || decision?.semanticAction || 'эмоциональный жест');
  const cause = decision?.cause ? `; причина: ${decision.cause}` : '';
  return `[Невербальный жест Рин: ${meaning}${cause}]`;
}

async function commitStickerDecision(decision, replyLink = null) {
  if (decision?.action !== 'send' || !decision?.sticker) return false;
  const message = createChatMessage({
    role: 'assistant', kind: 'sticker', status: 'complete', content: stickerSemanticText(decision),
    inReplyTo: replyLink?.inReplyTo || null,
    replySnapshot: replyLink?.replySnapshot || null,
    sticker: {
      id: decision.sticker.id, src: decision.sticker.src, emotion: decision.semanticAction,
      meaning: decision.meaning, cause: decision.cause, utterance: decision.utterance,
      delivery: decision.delivery, intensity: decision.intensity, canExplain: decision.canExplain,
      expiresAfterTurns: decision.expiresAfterTurns
    }
  });
  const rendered = await addStickerBubble(decision.sticker.src, 'assistant', decision.utterance, message.ts, { message });
  if (!rendered) return false;
  stickersLib?.markStickerSent?.(decision.sticker);
  history.push(message); saveHistory(history);
  dbg(`sticker send: id=${decision.sticker.id}; delivery=${decision.delivery}; reason=${decision.reason}`);
  return true;
}

async function maybeSticker(userText, replyText, responseMeta = null, options = {}) {
  try {
    await ensureStickersReady();
    if (!stickersLib || !STICKERS_CFG || lsStickerMode() === 'off') return null;

    // Для модельного хода семантика стикера уже определена серверным TurnDecision.
    // Клиент может только применить пользовательскую display-policy (off/smart/always),
    // но не выбирает другую эмоцию или другой стикер по тексту повторно.
    if (responseMeta) {
      const planned = responseMeta?.delivery?.nonverbal || null;
      if (!planned) return null;
      const decision = stickersLib.decidePlannedSticker?.(STICKERS_CFG, {
        planned,
        mode: lsStickerMode() === 'always' ? 'always' : 'smart',
        baseProbability: lsStickerProb(),
        safeMode: lsStickerSafe()
      }) || null;
      if (decision?.action === 'send' && decision?.sticker && options.render !== false) await commitStickerDecision(decision);
      return decision;
    }

    // Proactive/greeting messages do not yet pass through /api/chat. Foundation v1
    // therefore keeps them text-only rather than reviving a second semantic sticker
    // classifier. Their full TurnDecision migration belongs to the autonomy stage.
    return null;
  } catch (error) {
    dbg('stickers error: ' + (error?.message || error));
    return null;
  }
}

async function tryInitiateBySchedule() {
  if (!canAutoInitiate({ profile, history, greetingActive, activeRequests })) return false;
  const lore = await ensureLoreReady();
  const defaults = await lore?.getSchedule?.();
  const policy = resolveInitiationPolicy(profile, defaults || {});
  const date = nowInTz(RIN_TZ);
  const dateKey = fmtDateKey(date);
  if (getInitCountFor(dateKey) >= policy.maxPerDay) return false;

  const windows = policy.windows;
  const window = windows.find(item => inWindow(date, item.from, item.to) && Math.random() < Number(item.probability ?? 0.35));
  if (!window) return false;

  const last = [...history].reverse().find(item => ['text', 'voice', 'sticker', 'silence'].includes(item?.kind || 'text'));
  const silenceMinutes = policy.minimumSilenceMinutes;
  if (!last || last.role !== 'assistant' || Date.now() - Number(last.ts || Date.now()) < silenceMinutes * 60_000) return false;

  let text = chooseConfiguredStarter(profile);
  if (!text) text = await lore?.pickInitiationPhrase?.(window.pool || 'day', date);
  if (!text) return false;

  await new Promise(resolve => setTimeout(resolve, 450));
  if (!canAutoInitiate({ profile, history, greetingActive, activeRequests })) return false;
  let typing = null;
  let resolveTypingStarted;
  const typingStarted = new Promise(resolve => { resolveTypingStarted = resolve; });
  const presenceTurn = presence.beginTurn({
    userInitiated: false,
    onTyping: () => {
      if (!typing) typing = addTyping();
      resolveTypingStarted();
    }
  });
  if (presenceTurn == null) {
    await new Promise(resolve => setTimeout(resolve, 500));
  } else {
    await Promise.race([
      typingStarted,
      new Promise(resolve => setTimeout(resolve, 6_500))
    ]);
    await new Promise(resolve => setTimeout(resolve, 350));
  }
  if (typing?.isConnected) typing.remove();

  const message = createChatMessage({ role: 'assistant', kind: 'text', status: 'complete', content: text });
  addBubble(text, 'assistant', message.ts, { message });
  history.push(message);
  saveHistory(history);
  bumpInitCount(dateKey);
  presence.finishTurn(presenceTurn);
  return true;
}

formEl.addEventListener('submit', event => {
  event.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;
  const selectedReply = replySelection;
  inputEl.value = '';
  clearReplySelection();

  const requestId = newRequestId();
  const message = createChatMessage({
    role: 'user',
    kind: 'text',
    status: 'pending',
    content: text,
    requestId,
    inReplyTo: selectedReply?.messageId || null,
    replySnapshot: selectedReply?.snapshot || null
  });
  history.push(message);
  saveHistory(history);
  addBubble(text, 'user', message.ts, { message });
  enqueueMessage(message.id);
});

const messageQueue = createSerialQueue(processUserMessage);

function enqueueMessage(messageId) {
  return messageQueue.enqueue(messageId).catch(error => {
    dbg('message queue error: ' + (error?.message || error));
  });
}

function findMessageRow(messageId) {
  return [...chatEl.querySelectorAll('[data-message-id]')]
    .find(row => row.dataset.messageId === messageId) || null;
}

function retryMessage(messageId) {
  const message = history.find(item => item.id === messageId);
  if (!message || message.status !== 'failed') return;
  updateMessage(history, messageId, { status: 'pending', requestId: newRequestId(), errorCode: null });
  const row = findMessageRow(messageId);
  if (row) {
    row.dataset.status = 'pending';
    row.querySelector('.message-retry')?.remove();
  }
  saveHistory(history);
  enqueueMessage(messageId);
}

function renderFailedState(message) {
  const row = findMessageRow(message.id);
  if (!row) return;
  row.dataset.status = 'failed';
  if (row.querySelector('.message-retry')) return;
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'message-retry';
  retry.textContent = 'Повторить';
  retry.addEventListener('click', () => retryMessage(message.id));
  row.querySelector('.bubble')?.appendChild(retry);
}

function userFacingError(code) {
  if (code === 'MODEL_RESPONSE_TRUNCATED') return 'Ответ оборвался на стороне модели. Повтори отправку.';
  if (code === 'UPSTREAM_TIMEOUT') return 'Сервис не успел ответить. Повтори отправку.';
  return 'Не удалось получить ответ. Сообщение не включено в следующий контекст; его можно повторить.';
}


function replyLinkFromResponsePlan(plan = null) {
  const target = plan?.replyTarget;
  if (!target?.messageId || target.role !== 'user') return null;
  const source = findMessageById(target.messageId);
  const snapshot = source ? createReplySnapshot(source) : normalizeReplySnapshot(target);
  if (!snapshot) return null;
  return { inReplyTo: target.messageId, replySnapshot: snapshot };
}

async function processUserMessage(messageId) {
  const userMessage = history.find(item => item.id === messageId);
  if (!userMessage || !['pending', 'failed'].includes(userMessage.status)) return;
  updateMessage(history, messageId, { status: 'sent' });
  saveHistory(history);
  activeRequests += 1;
  let typingRow = null;
  let presenceFinished = false;
  const presenceTurn = presence.beginTurn({
    userInitiated: true,
    onTyping: () => { if (!typingRow) typingRow = addTyping(); }
  });
  const finishPresence = () => {
    if (presenceFinished) return;
    presenceFinished = true;
    presence.finishTurn(presenceTurn);
  };

  try {
    // Перед новым модельным запросом завершаем уже запущенную память предыдущего хода.
    // Ошибочные jobs остаются в retry-очереди, но успешные изменения гарантированно входят в следующий context snapshot.
    await memoryJobRunner.drain();
    if (shouldRefreshEnvironment(userMessage.content)) await refreshRinEnv();
    const memoryModule = await ensureMemoryReady();
    const preparedInnerLife = await memoryModule?.prepareInnerLife?.(currentEnv || {}, userMessage.content);
    const [memory, activeProfile, loreModule] = await Promise.all([
      buildMemoryPayload({ innerLifeOverride: preparedInnerLife }),
      ensureActiveProfile(),
      ensureLoreReady()
    ]);
    const preparedLore = await loreModule?.buildLorePayload?.(userMessage.content);
    const lore = loreModule?.lorePayloadForApi?.(preparedLore) || null;
    const response = await fetchWithTimeout('/api/chat', {
      method: 'POST',
      headers: authenticatedHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        requestId: userMessage.requestId,
        history: toApiHistory(history, userMessage.requestId),
        env: currentEnv || undefined,
        profile: activeProfile || undefined,
        memory: memory || undefined,
        lore: lore || undefined,
        client: {
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
          sentAt: Date.now(),
          build: RIN_BUILD_VERSION
        }
      })
    }, 45_000);
    let data = {};
    try { data = await response.json(); } catch {}
    if (response.status === 401) {
      removeStoredPin();
      window.location.replace('/login');
      return;
    }
    if (!response.ok) {
      const error = new Error(data?.error || `HTTP ${response.status}`);
      error.code = data?.code || 'CHAT_REQUEST_FAILED';
      throw error;
    }
    if (data.requestId && data.requestId !== userMessage.requestId) {
      const error = new Error('Mismatched response');
      error.code = 'MISMATCHED_RESPONSE';
      throw error;
    }
    const intentionalSilence = data?.delivery?.type === 'silence';
    if (intentionalSilence) {
      if (typingRow?.isConnected) typingRow.remove();
      await commitSuccessfulTurnState({ memoryModule, userMessage, data, preparedInnerLife, loreModule, preparedLore });
      const silenceMessage = createChatMessage({
        role: 'assistant', kind: 'silence', status: 'complete', content: '',
        requestId: userMessage.requestId, inReplyTo: userMessage.id,
        silence: { reason: data.delivery.reason, scene: data.delivery.scene }
      });
      updateMessage(history, userMessage.id, { status: 'complete' });
      const userRow = findMessageRow(userMessage.id);
      if (userRow) userRow.dataset.status = 'complete';
      history.push(silenceMessage);
      saveHistory(history);
      finishPresence();
      dbg(`reply complete: request=${userMessage.requestId}; kind=silence; reason=${data.delivery.reason || 'semantic'}; build=${RIN_BUILD_VERSION}`);
      return;
    }
    let reply = typeof data.reply === 'string' ? data.reply.trim() : '';
    if (isInternalNonverbalMetaText(reply)) {
      dbg('blocked internal nonverbal meta reply on client');
      reply = String(data?.delivery?.fallbackText || 'Мм.').trim();
    }
    if (!reply) {
      const error = new Error('Empty response');
      error.code = 'EMPTY_MODEL_RESPONSE';
      throw error;
    }

    if (typingRow?.isConnected) typingRow.remove();
    await commitSuccessfulTurnState({ memoryModule, userMessage, data, preparedInnerLife, loreModule, preparedLore });
    const stickerDecision = await maybeSticker(userMessage.content, reply, data, { render: false });
    const stickerOnly = stickerDecision?.action === 'send' && stickerDecision?.delivery === 'sticker_only';
    const plannedReplyLink = replyLinkFromResponsePlan(data?.responsePlan);
    if (!stickerOnly && stickerDecision?.timing === 'before_reply') await commitStickerDecision(stickerDecision);

    let kind = stickerOnly ? 'sticker' : 'text';
    const audioUrl = !stickerOnly && shouldVoiceFor(reply) ? await getTTSUrl(reply) : null;
    const assistantMessage = stickerOnly ? null : createChatMessage({
      role: 'assistant',
      kind: audioUrl ? 'voice' : 'text',
      status: 'complete',
      content: reply,
      requestId: userMessage.requestId,
      inReplyTo: plannedReplyLink?.inReplyTo || userMessage.id,
      replySnapshot: plannedReplyLink?.replySnapshot || null
    });
    if (assistantMessage) kind = assistantMessage.kind;
    if (stickerOnly) {
      const sent = await commitStickerDecision(stickerDecision, plannedReplyLink);
      if (!sent) {
        const fallbackMessage = createChatMessage({
          role: 'assistant', kind: 'text', status: 'complete', content: reply,
          requestId: userMessage.requestId,
          inReplyTo: plannedReplyLink?.inReplyTo || userMessage.id,
          replySnapshot: plannedReplyLink?.replySnapshot || null
        });
        addBubble(reply, 'assistant', fallbackMessage.ts, { message: fallbackMessage });
        history.push(fallbackMessage);
        kind = 'text';
      }
    } else if (audioUrl) addVoiceBubble(audioUrl, reply, 'assistant', assistantMessage.ts, { message: assistantMessage });
    else addBubble(reply, 'assistant', assistantMessage.ts, { message: assistantMessage });

    updateMessage(history, userMessage.id, { status: 'complete' });
    const userRow = findMessageRow(userMessage.id);
    if (userRow) userRow.dataset.status = 'complete';
    if (assistantMessage) history.push(assistantMessage);
    saveHistory(history);
    if (!stickerOnly && stickerDecision?.timing !== 'before_reply') await commitStickerDecision(stickerDecision);
    finishPresence();

    if (shouldAnalyzeConversationForMemory(userMessage.content)) {
      enqueueMemoryJob({ id: userMessage.id, userText: userMessage.content, assistantText: reply }, localStorage);
      void memoryJobRunner.drain();
    }
    dbg(`reply complete: request=${userMessage.requestId}; kind=${kind}; build=${RIN_BUILD_VERSION}`);
  } catch (error) {
    if (typingRow?.isConnected) typingRow.remove();
    const code = error?.name === 'AbortError' ? 'UPSTREAM_TIMEOUT' : error?.code || 'CHAT_REQUEST_FAILED';
    const failed = updateMessage(history, userMessage.id, { status: 'failed', errorCode: code });
    saveHistory(history);
    if (failed) renderFailedState(failed);
    addBubble(userFacingError(code), 'assistant');
    finishPresence();
    dbg(`chat request failed: code=${code}`);
  } finally {
    activeRequests = Math.max(0, activeRequests - 1);
    finishPresence();
  }
}

async function refreshRinEnv() {
  try {
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
    const weather = await fetchRinWeather();
    if (weather) env.weather = weather;
    currentEnv = env;
  } catch (error) {
    dbg('refresh env failed: ' + (error?.message || error));
  }
}
