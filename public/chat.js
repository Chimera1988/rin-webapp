import {
  assignMessageBatch,
  createChatMessage,
  createReplySnapshot,
  createSerialQueue,
  hasBlockingTurn,
  loadChatHistory,
  isInternalNonverbalMetaText,
  normalizeReplySnapshot,
  reconcilePendingDeliveryHistory,
  resetApplicationStorage,
  saveChatHistory,
  persistChatHistoryMutation,
  toApiHistory,
  updateMessage
} from './js/chat_store.js';
import { RIN_RELEASE_ID } from './js/release.js';
import { createMemoryJobRunner, enqueueMemoryJob } from './js/memory_job_queue.js';
import { activeInitiationWindow, canAutoInitiate, canGreet, initiationWindowKey, resolveInitiationPolicy } from './js/conversation_policy.js';
import { createInitiationStateStore } from './js/initiation_state.js';
import { createLocalSettings } from './js/local_settings.js';
import { environmentIntent } from './js/environment_intent.js';
import { authenticatedHeaders, fetchWithTimeout, getStoredPin, removeStoredPin } from './js/http_client.js';
import { createPresenceController } from './js/presence_controller.js';
import { createHumanDeliveryScheduler, createInputAggregator } from './js/delivery_scheduler.js';
import { createChatViewportController } from './js/chat_viewport.js';
import { createWallpaperStore } from './js/wallpaper_store.js';

/* public/chat.js — фронт чата Рин, согласованный с твоим index.html (профиль из persona_ui/rin_memory) */

const RIN_BUILD_VERSION = RIN_RELEASE_ID;

const THEME_KEY      = 'rin-theme';

/* настройки, что храним в LS */
const LS_STICKER_PROB   = 'rin-sticker-prob';    // 0..100 (%)
const LS_STICKER_MODE   = 'rin-sticker-mode';    // smart | off | always
const LS_STICKER_LAST_MODE = 'rin-sticker-last-mode';
const LS_STICKER_SAFE   = 'rin-sticker-safe';    // '1' | '0'  (доп. запреты при негативном контексте)
const LS_STICKER_OPACITY = 'rin-sticker-opacity'; // 20..100 (%)
const LS_SPEAK_ENABLED  = 'rin-speak-enabled';   // '1' | '0'
const LS_SPEAK_RATE     = 'rin-speak-rate';      // 0..50 (%)
const LS_WP_OPACITY     = 'rin-wallpaper-opacity'; // 0..100
const LS_DEBUG_ENABLED  = 'rin-debug-enabled';   // '1' | '0'
const DEFAULT_DEBUG_ENABLED = true;
const localSettings = createLocalSettings(localStorage);
const safeLocalGet = localSettings.get;
const safeLocalSet = localSettings.set;


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
const chatActionsToggle = document.getElementById('chatActionsToggle');
const chatActionsMenu = document.getElementById('chatActionsMenu');
const selectMessagesAction = document.getElementById('selectMessagesAction');
const copyConversationAction = document.getElementById('copyConversationAction');
const messageSelectionBar = document.getElementById('messageSelectionBar');
const messageSelectionCount = document.getElementById('messageSelectionCount');
const cancelMessageSelection = document.getElementById('cancelMessageSelection');
const copySelectedMessages = document.getElementById('copySelectedMessages');
const chatToast = document.getElementById('chatToast');

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
const WEATHER_REFRESH_MS = 20 * 60 * 1000; // раз в 20 минут

/* ✔️ РАННЕЕ БЕЗОПАСНОЕ ОБЪЯВЛЕНИЕ — чтобы не ловить "Can't find variable: currentEnv" */
let currentEnv = {
  rinTz: '',
  rinHuman: '',
  season: '',
  month: '',
  partOfDay: '',
  userVsRinHoursDiff: 0,
  weather: null,
  _ts: 0,
  _weatherTs: 0
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
function hoursDiffWithRin(timezone){
  const here = new Date();
  const rin = nowInTz(timezone);
  return Math.round((rin - here) / 3600000);
}

/* — API погоды (через наш /api/weather) — */
async function fetchRinWeather(location = null){
  try{
    const lat = Number(location?.lat);
    const lon = Number(location?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const u = `/api/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&units=metric&lang=ru`;
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
let _debugOn = safeLocalGet(LS_DEBUG_ENABLED, DEFAULT_DEBUG_ENABLED ? '1' : '0') !== '0';
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
if (_debugOn) dbg('debug enabled');

/* Данные */
const resetApp      = document.getElementById('resetApp');

/* state */
let profile = null;         // поддерживаемые пользовательские дополнения
let loreLib = null;
let runtimeSchedule = null;
const initiationState = createInitiationStateStore(localStorage);
const wallpaperStore = createWallpaperStore({ indexedDBRef: window.indexedDB, legacyStorage: localStorage });

async function ensureLoreReady() {
  if (loreLib) return loreLib;

  try {
    const module = await import(`/js/rin_lore.js?v=${encodeURIComponent(RIN_BUILD_VERSION)}`);
    if (typeof module?.getSchedule !== 'function') throw new Error('rin_lore schedule API is unavailable');
    runtimeSchedule = await module.getSchedule();
    loreLib = module;
    dbg('lore schedule metadata ready');
    return loreLib;
  } catch (error) {
    dbg(
      'lore schedule load failed: ' +
      (error?.message || error)
    );
    return null;
  }
}

async function ensureRuntimeSchedule() {
  if (runtimeSchedule) return runtimeSchedule;
  const lore = await ensureLoreReady();
  if (!lore?.getSchedule) return null;
  runtimeSchedule = await lore.getSchedule();
  return runtimeSchedule;
}

async function ensureActiveProfile() {
  // Клиент передаёт только поддерживаемые пользовательские дополнения.
  const globalProfile = window.RIN_PROFILE;
  if (globalProfile && typeof globalProfile === 'object') profile = globalProfile;
  if (!profile || typeof profile !== 'object') profile = {};
  profile = {
    description: String(profile.description || ''),
    instructions_extra: String(profile.instructions_extra || ''),
    knowledge: String(profile.knowledge || '')
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
      schemaVersion: 4,
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
            attraction: numberOr(diary.relationship.attraction, 34),
            vulnerability: numberOr(diary.relationship.vulnerability, 28),
            stage: String(diary.relationship.stage || '').slice(0, 60),
            recentDynamic: diary.relationship.recentDynamic && typeof diary.relationship.recentDynamic === 'object'
              ? {
                  lastSignal: String(diary.relationship.recentDynamic.lastSignal || 'neutral').slice(0, 60),
                  positiveStreak: numberOr(diary.relationship.recentDynamic.positiveStreak, 0),
                  negativeStreak: numberOr(diary.relationship.recentDynamic.negativeStreak, 0),
                  repairPending: Boolean(diary.relationship.recentDynamic.repairPending),
                  lastCause: String(diary.relationship.recentDynamic.lastCause || '').slice(0, 320),
                  turn: numberOr(diary.relationship.recentDynamic.turn, 0)
                }
              : null,
            lastInteractionAt: numberOr(diary.relationship.lastInteractionAt),
            sharedMoments: Array.isArray(diary.relationship.sharedMoments)
              ? diary.relationship.sharedMoments.slice(-6).map(item => ({
                  id: String(item?.id || '').slice(0, 100) || null,
                  key: String(item?.key || '').slice(0, 100) || null,
                  text: String(item?.text || '').slice(0, 400),
                  importance: numberOr(item?.importance, 6),
                  ts: numberOr(item?.ts)
                }))
              : [],
            sharedSymbols: Array.isArray(diary.relationship.sharedSymbols)
              ? diary.relationship.sharedSymbols.slice(-8).map(item => ({
                  id: String(item?.id || '').slice(0, 80),
                  label: String(item?.label || '').slice(0, 80),
                  scope: String(item?.scope || 'relationship_private').slice(0, 40),
                  privacy: String(item?.privacy || 'private').slice(0, 40),
                  origin: String(item?.origin || '').slice(0, 400),
                  meaning: String(item?.meaning || '').slice(0, 700),
                  aliases: Array.isArray(item?.aliases) ? item.aliases.slice(0, 8).map(value => String(value).slice(0, 80)) : [],
                  associations: Array.isArray(item?.associations) ? item.associations.slice(0, 12).map(value => String(value).slice(0, 140)) : [],
                  manifestations: Array.isArray(item?.manifestations) ? item.manifestations.slice(0, 8).map(value => String(value).slice(0, 240)) : [],
                  avoid: Array.isArray(item?.avoid) ? item.avoid.slice(0, 8).map(value => String(value).slice(0, 240)) : [],
                  salience: numberOr(item?.salience, 55),
                  minCloseness: numberOr(item?.minCloseness, 45),
                  updatedAt: numberOr(item?.updatedAt)
                })).filter(item => item.id && item.meaning)
              : []
          }
        : null,
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
              schema: String(state.schema || 'rin-inner-life-v5').slice(0, 40),
              activity: String(state.activity || '').slice(0, 180),
              trace: String(state.trace || '').slice(0, 220),
              focus: String(state.focus || '').slice(0, 220),
              activityGoal: String(state.activityGoal || '').slice(0, 220),
              part: String(state.part || '').slice(0, 20),
              realityMode: String(state.realityMode || 'simulated_character_world').slice(0, 40),
              source: String(state.source || 'schedule_simulation').slice(0, 80),
              sceneId: String(state.sceneId || '').slice(0, 120) || null,
              dayType: String(state.dayType || 'weekday').slice(0, 24),
              dayOfWeek: numberOr(state.dayOfWeek, 1),
              workday: state.workday !== false,
              workMode: String(state.workMode || 'normal').slice(0, 24),
              activitySetting: String(state.activitySetting || 'unknown').slice(0, 24),
              weatherGrounded: state.weatherGrounded === true,
              weatherContext: String(state.weatherContext || '').slice(0, 220),
              energy: numberOr(state.energy),
              mentalLoad: numberOr(state.mentalLoad, 42),
              needForQuiet: numberOr(state.needForQuiet, 35),
              desireToShare: numberOr(state.desireToShare, 48),
              unfinishedThought: String(state.unfinishedThought || '').slice(0, 260),
              carryover: String(state.carryover || '').slice(0, 320),
              sleepPhase: String(state.sleepPhase || 'awake').slice(0, 40),
              sleepCycle: String(state.sleepCycle || '').slice(0, 16),
              plannedSleepAt: numberOr(state.plannedSleepAt),
              plannedWakeAt: numberOr(state.plannedWakeAt),
              sleepStartedAt: numberOr(state.sleepStartedAt),
              lastWakeAt: numberOr(state.lastWakeAt),
              lastSleepMinutes: numberOr(state.lastSleepMinutes),
              sleepDebtMinutes: numberOr(state.sleepDebtMinutes),
              sleepInterruptions: numberOr(state.sleepInterruptions),
              lateConversationMinutes: numberOr(state.lateConversationMinutes),
              wakeReason: String(state.wakeReason || 'unknown').slice(0, 40),
              sleepCarryover: String(state.sleepCarryover || '').slice(0, 360),
              startedAt: numberOr(state.startedAt),
              expiresAt: numberOr(state.expiresAt),
              lastChangedAt: numberOr(state.lastChangedAt),
              lastStateAt: numberOr(state.lastStateAt),
              lastUserAt: numberOr(state.lastUserAt),
              interactionCount: numberOr(state.interactionCount, 0),
              recentActivities: Array.isArray(state.recentActivities)
                ? state.recentActivities.slice(-8).map(item => String(item || '').slice(0, 180)).filter(Boolean)
                : []
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
async function applyExtractedMemory(extracted, _userText = '', jobId = '') {
  try {
    const lib = await ensureMemoryReady();
    if (!lib?.applyMemoryExtraction) return false;
    const result = await lib.applyMemoryExtraction(extracted, { jobId, now: Date.now() });
    for (const path of Array.isArray(result?.savedFactPaths) ? result.savedFactPaths : []) {
      dbg(`memory fact saved: ${path}`);
    }
    return result?.applied === true || result?.duplicate === true;
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

async function analyzeConversationForMemory(userText, assistantText, jobId = '') {
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
    const applied = await applyExtractedMemory(extracted, userText, jobId);
    return { ok: applied, code: applied ? null : 'MEMORY_APPLY_FAILED' };
  } catch (error) {
    dbg('memory analysis failed: ' + (error?.message || error));
    return { ok: false, code: error?.name === 'AbortError' ? 'MEMORY_TIMEOUT' : 'MEMORY_REQUEST_FAILED' };
  }
}

const memoryJobRunner = createMemoryJobRunner(
  job => analyzeConversationForMemory(job.userText, job.assistantText, job.id),
  {
    storage: localStorage,
    isCompleted: async job => {
      const lib = await ensureMemoryReady();
      return Boolean(await lib?.hasProcessedMemoryJob?.(job.id));
    }
  }
);
setTimeout(() => { void memoryJobRunner.drain(); }, 0);
setInterval(() => { void memoryJobRunner.drain(); }, 30_000);

/* ============================= */
/* НАСТРОЕНИЕ РИН */
/* ============================= */


function buildTurnDebugSnapshot(data = null, committed = null) {
  const decision = data?.turnDecision || null;
  const transitionIntent = data?.stateTransition?.rinIntent || null;
  const storedIntent = committed?.conversationState?.rinIntent || null;
  const intent = storedIntent || (['completed', 'cancelled'].includes(transitionIntent?.status) ? transitionIntent : transitionIntent);
  const intentTelemetry = data?.cognition?.intentTelemetry || {};
  const sceneControl = data?.cognition?.sceneControl || {};
  const fallbackNoveltyPressure = Number(data?.cognition?.behaviorState?.novelty?.pressure || 0);
  return {
    intent,
    operation: decision?.intentTransition?.operation || intentTelemetry?.operation || 'none',
    kind: intent?.kind || decision?.intentTransition?.kind || intentTelemetry?.kind || '-',
    phase: intent?.phase || decision?.intentTransition?.phase || intentTelemetry?.phase || '-',
    age: intent?.turnCount ?? intentTelemetry?.activeAge ?? 0,
    progress: intent?.progress ?? null,
    engagement: intent?.engagement ?? decision?.intentTransition?.engagement ?? intentTelemetry?.engagement ?? null,
    saturation: intent?.saturation ?? decision?.intentTransition?.saturation ?? intentTelemetry?.saturation ?? null,
    similarity: intentTelemetry?.recentSimilarity ?? 0,
    sceneMotif: sceneControl?.sceneMotif || data?.mind?.sceneMotif || '-',
    motifRepeat: Number(sceneControl?.motifRepeat || 0),
    motifPressure: Number(sceneControl?.motifPressure ?? fallbackNoveltyPressure),
    frameAlignment: sceneControl?.frameAlignment || data?.mind?.frameAlignment || '-',
    literalCorrection: sceneControl?.literalCorrection || data?.mind?.literalCorrection || 'none',
    referenceAnchor: sceneControl?.referenceAnchor || data?.mind?.referenceAnchor || '-',
    lifeDomain: sceneControl?.lifeDomain || data?.mind?.lifeDomain || 'none',
    lifeMotif: sceneControl?.lifeMotif || data?.mind?.lifeMotif || '-',
    lifeMotifAppearances: Number(sceneControl?.lifeMotifAppearances || 0),
    lifeNoveltyPressure: Number(sceneControl?.lifeNoveltyPressure ?? data?.cognition?.behaviorState?.lifeNovelty?.pressure ?? 0),
    lifeEnergy: Number(sceneControl?.lifeEnergy ?? data?.cognition?.innerLife?.energy ?? 0),
    mentalLoad: Number(sceneControl?.mentalLoad ?? data?.cognition?.innerLife?.mentalLoad ?? 0),
    needForQuiet: Number(sceneControl?.needForQuiet ?? data?.cognition?.innerLife?.needForQuiet ?? 0),
    desireToShare: Number(sceneControl?.desireToShare ?? data?.cognition?.innerLife?.desireToShare ?? 0),
    dayType: sceneControl?.dayType || data?.cognition?.innerLife?.dayType || 'weekday',
    workMode: sceneControl?.workMode || data?.cognition?.innerLife?.workMode || 'normal',
    sleepPhase: sceneControl?.sleepPhase || data?.cognition?.innerLife?.sleepPhase || 'awake',
    sleepDebtMinutes: Number(sceneControl?.sleepDebtMinutes ?? data?.cognition?.innerLife?.sleepDebtMinutes ?? 0),
    sleepInterruptions: Number(sceneControl?.sleepInterruptions ?? data?.cognition?.innerLife?.sleepInterruptions ?? 0),
    lateConversationMinutes: Number(sceneControl?.lateConversationMinutes ?? data?.cognition?.innerLife?.lateConversationMinutes ?? 0),
    wakeReason: sceneControl?.wakeReason || data?.cognition?.innerLife?.wakeReason || 'unknown',
    activitySetting: sceneControl?.activitySetting || data?.cognition?.innerLife?.activitySetting || 'unknown',
    weatherGrounded: Boolean(sceneControl?.weatherGrounded ?? data?.cognition?.innerLife?.weatherGrounded),
    contactStance: sceneControl?.contactStance || data?.mind?.contactStance || 'open',
    selfStateDisclosure: sceneControl?.selfStateDisclosure || data?.mind?.selfStateDisclosure || 'none',
    selfStateDisclosureReason: sceneControl?.selfStateDisclosureReason || data?.mind?.selfStateDisclosureReason || '-',
    relationalSafety: Number(sceneControl?.relationalSafety ?? data?.cognition?.relationalConstancy?.relationalSafety ?? 0),
    relationalStatePressure: Number(sceneControl?.relationalStatePressure ?? data?.cognition?.relationalConstancy?.statePressure ?? 0),
    quietPresencePreferred: Boolean(sceneControl?.quietPresencePreferred ?? data?.cognition?.relationalConstancy?.quietPresencePreferred),
    disclosureOpportunity: Boolean(sceneControl?.disclosureOpportunity ?? data?.cognition?.relationalConstancy?.disclosureOpportunity),
    responseDepth: sceneControl?.responseDepth || decision?.delivery?.responseDepth || 'normal',
    responseShortLock: Number(sceneControl?.responseShortLock ?? data?.cognition?.behaviorState?.responseRhythm?.shortLockPressure ?? 0),
    responseSingleLock: Number(sceneControl?.responseSingleLock ?? data?.cognition?.behaviorState?.responseRhythm?.singleLockPressure ?? 0),
    vocativePressure: Number(sceneControl?.vocativePressure ?? data?.cognition?.behaviorState?.vocative?.pressure ?? 0),
    vocativeRawPressure: Number(sceneControl?.vocativeRawPressure ?? data?.cognition?.behaviorState?.vocative?.rawPressure ?? 0),
    vocativeRecentTurns: Number(sceneControl?.vocativeRecentTurns ?? data?.cognition?.behaviorState?.vocative?.recentVocativeTurns ?? 0),
    vocativeRecent6: Number(sceneControl?.vocativeRecent6 ?? data?.cognition?.behaviorState?.vocative?.recent6 ?? 0),
    vocativeStreak: Number(sceneControl?.vocativeStreak ?? data?.cognition?.behaviorState?.vocative?.streak ?? 0),
    vocativeTurnsSinceAny: Number(sceneControl?.vocativeTurnsSinceAny ?? data?.cognition?.behaviorState?.vocative?.turnsSinceAny ?? 0),
    vocativeLastExact: sceneControl?.vocativeLastExact || data?.cognition?.behaviorState?.vocative?.lastExact || '-',
    vocativeLastClass: sceneControl?.vocativeLastClass || data?.cognition?.behaviorState?.vocative?.lastClass || '-',
    vocativeExactGapRemaining: Number(sceneControl?.vocativeExactGapRemaining ?? data?.cognition?.behaviorState?.vocative?.exactGapRemaining ?? 0),
    vocativeClassGapRemaining: Number(sceneControl?.vocativeClassGapRemaining ?? data?.cognition?.behaviorState?.vocative?.classGapRemaining ?? 0),
    vocativeAnyGapRemaining: Number(sceneControl?.vocativeAnyGapRemaining ?? data?.cognition?.behaviorState?.vocative?.anyGapRemaining ?? 0),
    vocativeStrongAvoid: Boolean(sceneControl?.vocativeStrongAvoid ?? data?.cognition?.behaviorState?.vocative?.strongAvoid),
    vocativeDirectRequest: Boolean(sceneControl?.vocativeDirectRequest ?? data?.cognition?.behaviorState?.vocative?.directRequest),
    vocativeUsed: sceneControl?.vocativeUsed || '-',
    vocativeUsedClass: sceneControl?.vocativeUsedClass || '-',
    vocativeUsedCount: Number(sceneControl?.vocativeUsedCount || 0),
    vocativeOverride: Boolean(sceneControl?.vocativeOverride),
    messageShape: decision?.delivery?.messageShape || ((decision?.delivery?.segments || []).filter(item => item?.type === 'text').length >= 2 ? 'split' : 'single'),
    commitmentAction: sceneControl?.commitmentAction || data?.mind?.commitmentAction || 'none',
    commitmentRequestedAction: sceneControl?.commitmentRequestedAction || data?.mind?.commitmentAction || 'none',
    commitmentConflict: sceneControl?.commitmentConflict || data?.mind?.commitmentConflict || 'none',
    commitmentSubject: sceneControl?.commitmentSubject || data?.mind?.commitmentSubject || '-',
    commitmentHorizon: sceneControl?.commitmentHorizon || '-',
    activeCommitments: Number(sceneControl?.activeCommitments || 0),
    futureCallbackDetected: Boolean(sceneControl?.futureCallbackDetected),
    futureCallbackId: sceneControl?.futureCallbackId || '-',
    futureCallbackSubject: sceneControl?.futureCallbackSubject || '-',
    futureCallbackCue: sceneControl?.futureCallbackCue || '-',
    futureCallbackActive: Number(sceneControl?.futureCallbackActive || 0),
    futureCallbackResolvedId: sceneControl?.futureCallbackResolvedId || '-',
    sharedSymbolCandidateId: sceneControl?.sharedSymbolCandidateId || '-',
    sharedSymbolCandidateActivation: Number(sceneControl?.sharedSymbolCandidateActivation || 0),
    sharedSymbolCandidateDirectRecall: Boolean(sceneControl?.sharedSymbolCandidateDirectRecall),
    sharedSymbolId: sceneControl?.sharedSymbolId || data?.mind?.sharedSymbolId || '-',
    sharedSymbolExpression: sceneControl?.sharedSymbolExpression || data?.mind?.sharedSymbolExpression || 'none',
    sharedSymbolActivation: Number(sceneControl?.sharedSymbolActivation || 0),
    sharedSymbolRepeat: Number(sceneControl?.sharedSymbolRepetitionPressure || 0),
    reciprocityPressure: Number(data?.cognition?.reciprocity?.attentionPressure || 0),
    reciprocityOpportunity: Boolean(data?.cognition?.reciprocity?.attentionOpportunity),
    reciprocityAnchor: data?.cognition?.reciprocity?.attentionAnchor?.text || '-'
  };
}

async function commitSuccessfulTurnState({ memoryModule, userMessage = null, requestId = null, data, preparedInnerLife }) {
  const transition = data?.stateTransition || null;
  const decision = data?.turnDecision || null;
  const committedRequestId = requestId || userMessage?.requestId || null;
  const committed = await memoryModule?.commitTurnState?.({
    requestId: committedRequestId,
    innerLife: preparedInnerLife,
    stateTransition: transition,
    now: Date.now()
  });


  if (committed?.mood) {
    const questionReason = String(decision?.question?.reason || '-').replace(/\s+/g, ' ').trim().slice(0, 120);
    const questionPressure = String(data?.cognition?.reciprocity?.reciprocalQuestionReason || '-').replace(/\s+/g, ' ').trim().slice(0, 120);
    const snapshot = buildTurnDebugSnapshot(data, committed);
    dbg(`turn state committed: rev=${committed.conversationState?.revision || 0}; mood=${committed.mood.label}; emotion=${committed.conversationState?.emotionalState?.primary?.type || 'none'}; momentum=${committed.conversationState?.emotionalState?.momentum?.direction || 'steady'}; intent=${snapshot.intent?.status || 'none'}:${snapshot.intent?.goal || '-'}; intentKind=${snapshot.kind}; intentPhase=${snapshot.phase}; intentOp=${snapshot.operation}; intentAge=${snapshot.age}; intentProgress=${snapshot.progress ?? '-'}; intentEngagement=${snapshot.engagement ?? '-'}; intentSaturation=${snapshot.saturation ?? '-'}; intentSimilarity=${snapshot.similarity}; sceneMotif=${snapshot.sceneMotif}; motifRepeat=${snapshot.motifRepeat}; motifPressure=${snapshot.motifPressure}; frameAlignment=${snapshot.frameAlignment}; literalCorrection=${snapshot.literalCorrection}; referenceAnchor=${String(snapshot.referenceAnchor || '-').replace(/\s+/g, ' ').slice(0, 80)}; lifeDomain=${snapshot.lifeDomain}; lifeMotif=${snapshot.lifeMotif}; lifeRepeat=${snapshot.lifeMotifAppearances}; lifeNovelty=${snapshot.lifeNoveltyPressure}; lifeEnergy=${snapshot.lifeEnergy}; mentalLoad=${snapshot.mentalLoad}; needQuiet=${snapshot.needForQuiet}; desireShare=${snapshot.desireToShare}; dayType=${snapshot.dayType}; workMode=${snapshot.workMode}; sleep=${snapshot.sleepPhase}; sleepDebt=${snapshot.sleepDebtMinutes}; sleepInterrupt=${snapshot.sleepInterruptions}; lateChat=${snapshot.lateConversationMinutes}; wakeReason=${snapshot.wakeReason}; activitySetting=${snapshot.activitySetting}; weatherGrounded=${snapshot.weatherGrounded ? 'yes' : 'no'}; contact=${snapshot.contactStance}; selfDisclosure=${snapshot.selfStateDisclosure}; relSafety=${snapshot.relationalSafety}; statePressure=${snapshot.relationalStatePressure}; quietPresence=${snapshot.quietPresencePreferred ? 'yes' : 'no'}; shareOpportunity=${snapshot.disclosureOpportunity ? 'yes' : 'no'}; responseDepth=${snapshot.responseDepth}; depthLock=${snapshot.responseShortLock}; messageShape=${snapshot.messageShape}; shapeLock=${snapshot.responseSingleLock}; vocative=${String(snapshot.vocativeUsed || '-').replace(/\s+/g, ' ').slice(0, 48)}/${snapshot.vocativeUsedClass}; vocPressure=${snapshot.vocativePressure}; vocRecent=${snapshot.vocativeRecent6}/6; vocStreak=${snapshot.vocativeStreak}; vocGap=${snapshot.vocativeTurnsSinceAny}; vocCooldown=${snapshot.vocativeAnyGapRemaining}/${snapshot.vocativeClassGapRemaining}/${snapshot.vocativeExactGapRemaining}; vocLast=${String(snapshot.vocativeLastExact || '-').replace(/\s+/g, ' ').slice(0, 48)}/${snapshot.vocativeLastClass}; vocAvoid=${snapshot.vocativeStrongAvoid ? 'yes' : 'no'}; vocDirect=${snapshot.vocativeDirectRequest ? 'yes' : 'no'}; vocOverride=${snapshot.vocativeOverride ? 'yes' : 'no'}; commitment=${snapshot.commitmentAction}/${snapshot.commitmentConflict}:${String(snapshot.commitmentSubject || '-').replace(/\s+/g, ' ').slice(0, 72)}; commitmentRequested=${snapshot.commitmentRequestedAction}; commitmentHorizon=${snapshot.commitmentHorizon}; activeCommitments=${snapshot.activeCommitments}; callback=${snapshot.futureCallbackDetected ? 'new' : 'carry'}:${snapshot.futureCallbackCue}:${String(snapshot.futureCallbackSubject || '-').replace(/\s+/g, ' ').slice(0, 72)}; callbackActive=${snapshot.futureCallbackActive}; callbackResolved=${String(snapshot.futureCallbackResolvedId || '-').slice(-12)}; symbolCandidate=${snapshot.sharedSymbolCandidateId}@${snapshot.sharedSymbolCandidateActivation}${snapshot.sharedSymbolCandidateDirectRecall ? ':direct' : ''}; sharedSymbol=${snapshot.sharedSymbolId}/${snapshot.sharedSymbolExpression}; symbolActivation=${snapshot.sharedSymbolActivation}; symbolRepeat=${snapshot.sharedSymbolRepeat}; reciprocityPressure=${snapshot.reciprocityPressure}; reciprocityOpportunity=${snapshot.reciprocityOpportunity ? 'yes' : 'no'}; reciprocityAnchor=${String(snapshot.reciprocityAnchor || '-').replace(/\s+/g, ' ').slice(0, 80)}; action=${decision?.act || 'respond_personally'}; q=${decision?.question?.mode || 'none'}:${questionReason}; qPressure=${questionPressure}`);
  }
  return committed;
}

/* Стикеры вызываются внутри сериализованного диалогового потока. */
/* === stickers v7: смысловая двухканальная система === */
let STICKERS_CFG = null;
let stickersLib = null;

async function ensureStickersReady(){
  if (!stickersLib) {
    try { stickersLib = await import(`/lib/stickers-v7.js?v=${encodeURIComponent(RIN_BUILD_VERSION)}`); }
    catch(e){ dbg('stickers v7 import failed: '+(e?.message||e)); stickersLib=null; }
  }
  if (stickersLib && !STICKERS_CFG) {
    try { STICKERS_CFG = await stickersLib.loadStickerConfig('/data/stickers-v7.json'); dbg('stickers v7 loaded'); }
    catch(e){ dbg('stickers v7 load failed: '+(e?.message||e)); STICKERS_CFG=null; }
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

/* === UI: SETTINGS === */
function showSettingsPage(name='main'){
  const next = settingsPages.find(page => page.dataset.settingsPage === name)
    || settingsPages.find(page => page.dataset.settingsPage === 'main');
  settingsPages.forEach(page => page.classList.toggle('is-active', page === next));
  if (next) next.scrollTop = 0;
}

function openSettings(){
  if (!settingsPanel) return;
  closeChatActionsMenu();
  if (messageSelectionActive) exitMessageSelection();
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
  if (messageSelectionActive) {
    exitMessageSelection();
    return;
  }
  if (chatActionsMenu && !chatActionsMenu.hidden) {
    closeChatActionsMenu();
    chatActionsToggle?.focus();
    return;
  }
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
    if (persist) safeLocalSet(THEME_KEY, normalized);
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
async function applyWallpaper(){
  const data = await wallpaperStore.get();
  const op = +(safeLocalGet(LS_WP_OPACITY) || '90') / 100;

  document.documentElement.style.setProperty('--wallpaper-url', data ? `url("${data}")` : 'none');
  document.documentElement.style.setProperty('--wallpaper-opacity', String(op));

  if (wpOpacity) wpOpacity.value = Math.round(op * 100);
  if (wpOpacityVal) wpOpacityVal.textContent = `${Math.round(op * 100)}%`;
}
void applyWallpaper();

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
    reader.onload = async () => {
      if (!await wallpaperStore.set(reader.result)) {
        alert('Не удалось сохранить обои в локальном медиахранилище.');
        return;
      }
      await applyWallpaper();
    };
    reader.readAsDataURL(f);
  });
}
if (wpClear){
  wpClear.onclick=async()=>{
    await wallpaperStore.remove();
    await applyWallpaper();
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
function lsStickerSafe(){
  const raw = safeLocalGet(LS_STICKER_SAFE, '');
  return raw === '' ? true : raw === '1';
}
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
  const smart = mode === 'smart';
  if (stickerMode) stickerMode.value = mode;
  if (stickerEnabled) stickerEnabled.checked = enabled;
  if (stickerSettingsCard) stickerSettingsCard.classList.toggle('is-disabled', !enabled);
  if (stickerProb) {
    stickerProb.disabled = !smart;
    stickerProb.setAttribute('aria-disabled', smart ? 'false' : 'true');
    stickerProb.closest('.settings-range-block')?.classList.toggle('is-disabled-control', !smart);
  }
  stickerModeBtns.forEach(button => {
    const active = button.dataset.stickerMode === mode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function setStickerMode(mode){
  const next = ['smart','always','off'].includes(mode) ? mode : 'smart';
  if (next !== 'off' && !safeLocalSet(LS_STICKER_LAST_MODE, next)) {
    dbg(`sticker last mode persistence failed: ${next}`);
  }
  const saved = safeLocalSet(LS_STICKER_MODE, next);
  const effective = saved ? next : lsStickerMode();
  updateStickerModeUI(effective);
  if (!saved) dbg(`sticker mode persistence failed: ${next}; effective=${effective}`);
  return effective;
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
  resetApp.onclick=async()=>{
    if (!confirm('Удалить локальную историю, память, профиль, настройки и кэш приложения на этом устройстве? PIN входа будет сохранён.')) return;
    await wallpaperStore.remove();
    resetApplicationStorage(localStorage, { preservePin: true });
    try { loreLib?.resetLoreCache?.(); } catch {}
    try { stickersLib?.resetStickerState?.(localStorage); } catch {}
    window.location.reload();
  };
}

/* === Управление сообщениями: выбор, копирование и статусы доставки === */
let messageSelectionActive = false;
const selectedMessageIds = new Set();
let chatToastTimer = null;

function setChatActionsMenuOpen(open = false) {
  if (!chatActionsMenu || !chatActionsToggle) return;
  const next = Boolean(open);
  chatActionsMenu.hidden = !next;
  chatActionsToggle.setAttribute('aria-expanded', next ? 'true' : 'false');
}

function closeChatActionsMenu() {
  setChatActionsMenuOpen(false);
}

function showChatToast(text, duration = 1800) {
  if (!chatToast) return;
  if (chatToastTimer) clearTimeout(chatToastTimer);
  chatToast.textContent = String(text || '');
  chatToast.hidden = false;
  chatToastTimer = setTimeout(() => {
    chatToast.hidden = true;
    chatToast.textContent = '';
  }, Math.max(700, Number(duration) || 1800));
}

function isCopyableMessage(message = null) {
  if (!message?.id || !['user', 'assistant'].includes(message.role)) return false;
  if (message.kind === 'silence') return false;
  return ['text', 'voice', 'sticker'].includes(message.kind || 'text');
}

function renderedCopyableMessages() {
  return [...chatEl.querySelectorAll('.message-row[data-message-id]')]
    .map(row => findMessageById(row.dataset.messageId))
    .filter(isCopyableMessage);
}

function clipboardMessageText(message = null) {
  if (!message) return '';
  const kind = message.kind || 'text';
  if (kind === 'sticker') {
    const utterance = String(message.sticker?.utterance || '').trim();
    return utterance ? `[Стикер] ${utterance}` : '[Стикер]';
  }
  if (kind === 'voice') {
    const transcript = String(message.content || '').trim();
    return transcript ? `[Голосовое сообщение] ${transcript}` : '[Голосовое сообщение]';
  }
  return String(message.content || '').trim();
}

function formatMessagesForClipboard(messages = []) {
  return messages
    .filter(isCopyableMessage)
    .map(message => {
      const author = message.role === 'assistant' ? 'Рин' : 'Ты';
      const time = fmtTime(new Date(message.ts || Date.now()));
      const body = clipboardMessageText(message);
      return `[${time}] ${author}: ${body}`;
    })
    .filter(Boolean)
    .join('\n\n');
}

async function writeClipboardText(text = '') {
  const value = String(text || '');
  if (!value) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {}

  try {
    const helper = document.createElement('textarea');
    helper.value = value;
    helper.setAttribute('readonly', '');
    helper.style.position = 'fixed';
    helper.style.left = '-9999px';
    helper.style.top = '0';
    document.body.appendChild(helper);
    helper.focus();
    helper.select();
    helper.setSelectionRange(0, helper.value.length);
    const ok = document.execCommand('copy');
    helper.remove();
    return Boolean(ok);
  } catch {
    return false;
  }
}

function renderMessageSelectionUI() {
  chatEl.classList.toggle('is-selecting', messageSelectionActive);
  formEl.classList.toggle('is-selecting', messageSelectionActive);
  if (messageSelectionBar) messageSelectionBar.hidden = !messageSelectionActive;
  if (messageSelectionCount) messageSelectionCount.textContent = String(selectedMessageIds.size);
  if (copySelectedMessages) copySelectedMessages.disabled = selectedMessageIds.size === 0;

  for (const row of chatEl.querySelectorAll('.message-row[data-message-id]')) {
    row.classList.toggle('is-selected', selectedMessageIds.has(row.dataset.messageId));
  }
}

function startMessageSelection() {
  const available = renderedCopyableMessages();
  closeChatActionsMenu();
  if (!available.length) {
    showChatToast('В переписке пока нечего выбирать');
    return false;
  }
  clearReplySelection();
  inputEl?.blur();
  selectedMessageIds.clear();
  messageSelectionActive = true;
  renderMessageSelectionUI();
  return true;
}

function exitMessageSelection() {
  if (!messageSelectionActive && !selectedMessageIds.size) return;
  messageSelectionActive = false;
  selectedMessageIds.clear();
  renderMessageSelectionUI();
}

function toggleSelectedMessage(messageId) {
  const message = findMessageById(messageId);
  if (!messageSelectionActive || !isCopyableMessage(message)) return;
  if (selectedMessageIds.has(messageId)) selectedMessageIds.delete(messageId);
  else selectedMessageIds.add(messageId);
  renderMessageSelectionUI();
}

async function copyMessages(messages = [], { leaveSelection = false } = {}) {
  const text = formatMessagesForClipboard(messages);
  if (!text) {
    showChatToast('Нет сообщений для копирования');
    return false;
  }
  const ok = await writeClipboardText(text);
  if (!ok) {
    showChatToast('Не удалось скопировать сообщения', 2400);
    return false;
  }
  showChatToast(messages.length === 1 ? 'Сообщение скопировано' : `Скопировано сообщений: ${messages.length}`);
  if (!leaveSelection) exitMessageSelection();
  return true;
}

function deliveryPresentation(message = null, statusFallback = 'complete') {
  const status = message?.status || statusFallback;
  if (status === 'failed') return { text: '!', label: 'Не отправлено' };
  if (status === 'pending') return { text: '✓', label: 'Отправляется' };
  const read = Number(message?.receipt?.readAt || 0) > 0 || (status === 'complete' && !message?.receipt);
  if (read) return { text: '✓✓', label: 'Прочитано', read: true };
  return { text: '✓✓', label: 'Доставлено', read: false };
}

function syncDeliveryIndicator(row = null) {
  if (!row?.classList?.contains('me')) return;
  const indicator = row.querySelector('.delivery-checks');
  if (!indicator) return;
  const message = findMessageById(row.dataset.messageId) || null;
  const state = deliveryPresentation(message, row.dataset.status || 'complete');
  indicator.textContent = state.text;
  indicator.setAttribute('aria-label', state.label);
  indicator.title = state.label;
  row.dataset.read = state.read === true ? 'true' : 'false';
}

chatActionsToggle?.addEventListener('click', event => {
  event.stopPropagation();
  setChatActionsMenuOpen(chatActionsMenu?.hidden !== false);
});
selectMessagesAction?.addEventListener('click', startMessageSelection);
copyConversationAction?.addEventListener('click', async () => {
  closeChatActionsMenu();
  await copyMessages(renderedCopyableMessages(), { leaveSelection: true });
});
cancelMessageSelection?.addEventListener('click', exitMessageSelection);
copySelectedMessages?.addEventListener('click', async () => {
  const ordered = renderedCopyableMessages().filter(message => selectedMessageIds.has(message.id));
  await copyMessages(ordered);
});

document.addEventListener('click', event => {
  if (!chatActionsMenu || chatActionsMenu.hidden) return;
  if (chatActionsMenu.contains(event.target) || chatActionsToggle?.contains(event.target)) return;
  closeChatActionsMenu();
});

chatEl.addEventListener('click', event => {
  if (!messageSelectionActive) return;
  const target = event.target instanceof Element ? event.target : null;
  const row = target?.closest('.message-row[data-message-id]');
  if (!row || !chatEl.contains(row)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  toggleSelectedMessage(row.dataset.messageId);
}, true);

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
    if (messageSelectionActive) return;
    selectReplyMessage(currentMessage());
  });
  const swipeIndicator = document.createElement('span');
  swipeIndicator.className = 'reply-swipe-indicator';
  swipeIndicator.setAttribute('aria-hidden', 'true');
  swipeIndicator.innerHTML = replyIcon;
  bubble.append(action, swipeIndicator);

  bubble.addEventListener('contextmenu', event => {
    if (messageSelectionActive) return;
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
    if (messageSelectionActive) return;
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
    if (messageSelectionActive) return;
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
    if (messageSelectionActive) return;
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

  const selectionIndicator = document.createElement('span');
  selectionIndicator.className = 'message-select-indicator';
  selectionIndicator.textContent = '✓';
  selectionIndicator.setAttribute('aria-hidden', 'true');
  row.appendChild(selectionIndicator);

  if (row.classList.contains('me')) {
    const delivery = document.createElement('span');
    delivery.className = 'delivery-checks';
    bubble.appendChild(delivery);
    syncDeliveryIndicator(row);
  }

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
let inputEpoch = 0;
const humanDeliveryScheduler = createHumanDeliveryScheduler();

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



async function renderStoredMessage(message) {
  if (message.role === 'assistant' && message.status === 'pending') return null;
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

let resolveChatReady;
export const RIN_CHAT_READY = new Promise(resolve => { resolveChatReady = resolve; });

(async function init(){
  syncPeerAvailability();
  let initiationPolicy = null;
  try {
    await ensureActiveProfile();
    const schedule = await ensureRuntimeSchedule();
    initiationPolicy = resolveInitiationPolicy(schedule);
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
  await reconcilePendingAssistantDeliveryCommitState();
  for (const message of history) await renderStoredMessage(message);
  chatViewport.requestScrollToBottom({ force: true });
  await resumePendingAssistantDeliveries();
  resolveChatReady?.(true);
  resolveChatReady = null;
  if (!history.length) await greet();

  setInterval(refreshRinEnv, WEATHER_REFRESH_MS);
  if (initiationPolicy) {
    setInterval(() => { void tryInitiateBySchedule(); }, initiationPolicy.pollIntervalMs);
    void tryInitiateBySchedule();
  }
})();

async function greet() {
  if (!canGreet({ history, greetingActive, activeRequests })) return false;
  greetingActive = true;
  try {
    const part = currentEnv?.partOfDay;
    const pool = part === 'утро' ? 'morning' : part === 'вечер' ? 'evening' : part === 'ночь' ? 'night' : 'day';
    return await requestAssistantInitiative({ type:'greeting', reason:`начало нового контакта; часть суток ${pool}` });
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

function stickerSemanticTextFromSegment(segment = {}) {
  const semantic = segment.semantic || {};
  const sticker = segment.sticker || {};
  const meaning = String(sticker.meaning || semantic.meaning || sticker.emotion || segment.stickerIntent || 'эмоциональный жест').trim();
  const cause = String(semantic.cause || sticker.cause || '').trim();
  return `[Невербальный жест Рин: ${meaning}${cause ? `; причина: ${cause}` : ''}]`;
}

async function requestChatTurn(payload = {}) {
  return fetchWithTimeout('/api/chat', {
    method: 'POST',
    headers: authenticatedHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  }, 45_000);
}

function markUserMessageComplete(userMessage = null) {
  if (!userMessage?.id) return;
  updateMessage(history, userMessage.id, { status: 'complete', errorCode: null });
  const userRow = findMessageRow(userMessage.id);
  if (userRow) {
    userRow.dataset.status = 'complete';
    userRow.querySelector('.message-retry')?.remove();
    syncDeliveryIndicator(userRow);
  }
}

function markUserMessageRead(userMessage = null, readAt = Date.now()) {
  if (!userMessage?.id) return false;
  const timestamp = Number(readAt) || Date.now();
  const current = history.find(item => item?.id === userMessage.id && item?.role === 'user');
  if (!current) return false;
  if (Number(current?.receipt?.readAt || 0) > 0) return false;
  const next = updateMessage(history, userMessage.id, { receipt: { readAt: timestamp } });
  const userRow = findMessageRow(userMessage.id);
  if (userRow) syncDeliveryIndicator(userRow);
  return Boolean(next);
}

function markUserBatchRead(messageIds = []) {
  let changed = false;
  const readAt = Date.now();
  for (const id of messageIds) {
    const message = history.find(item => item?.id === id && item?.role === 'user');
    if (message && markUserMessageRead(message, readAt)) changed = true;
  }
  if (changed) saveHistory(history);
  return changed;
}

function markUserBatchComplete(messageIds = []) {
  for (const id of messageIds) {
    const message = history.find(item => item?.id === id && item?.role === 'user');
    if (message) markUserMessageComplete(message);
  }
  saveHistory(history);
}


function plannedReplyLink(data = null) {
  return replyLinkFromTarget(data?.visualReply) || { inReplyTo: null, replySnapshot: null };
}

async function prepareAssistantDelivery({ data, requestId, userText = '' } = {}) {
  const plan = data?.deliveryPlan;
  const turnId = String(plan?.turnId || data?.turnId || `rin-turn-${requestId}`).slice(0, 120);
  const deliveryId = `delivery-${turnId}`.slice(0, 120);
  const replyLink = plannedReplyLink(data);

  if (plan?.mode === 'silence' || data?.turnDecision?.delivery?.mode === 'silence') {
    const message = createChatMessage({
      id: `${turnId}-silence`,
      role: 'assistant',
      kind: 'silence',
      status: 'pending',
      content: '',
      requestId,
      turnId,
      deliveryId,
      segmentId: `${turnId}-silence`,
      segmentIndex: 0,
      inReplyTo: null,
      replySnapshot: null,
      silence: {
        reason: data?.turnDecision?.focus || 'осознанное молчание',
        scene: data?.cognition?.scene?.type || null
      }
    });
    return { type: 'silence', mode: 'silence', turnId, deliveryId, segments: [], silenceMessage: message, reply: '' };
  }

  const rawSegments = Array.isArray(plan?.segments) ? plan.segments.slice(0, 3) : [];
  if (!rawSegments.length) {
    const error = new Error('Empty delivery plan');
    error.code = 'EMPTY_DELIVERY_PLAN';
    throw error;
  }

  const segments = [];
  for (let index = 0; index < rawSegments.length; index += 1) {
    const segment = rawSegments[index] || {};
    const segmentId = String(segment.id || `${turnId}-seg-${index + 1}`).slice(0, 120);
    const firstReply = index === 0 ? replyLink : { inReplyTo: null, replySnapshot: null };

    if (segment.type === 'text') {
      let text = String(segment.text || '').trim();
      if (isInternalNonverbalMetaText(text)) {
        const error = new Error('Internal nonverbal metadata leaked into text segment');
        error.code = 'NONVERBAL_META_LEAK';
        throw error;
      }
      if (!text) {
        const error = new Error('Empty text segment');
        error.code = 'EMPTY_MODEL_RESPONSE';
        throw error;
      }
      const audioUrl = shouldVoiceFor(text) ? await getTTSUrl(text) : null;
      const message = createChatMessage({
        id: segmentId,
        role: 'assistant',
        kind: 'text',
        status: 'pending',
        content: text,
        requestId,
        turnId,
        deliveryId,
        segmentId,
        segmentIndex: Number.isFinite(Number(segment.segmentIndex)) ? Number(segment.segmentIndex) : index,
        inReplyTo: firstReply.inReplyTo,
        replySnapshot: firstReply.replySnapshot
      });
      segments.push({ type: 'text', purpose: segment.purpose || `message_${index + 1}`, text, audioUrl, message });
      continue;
    }

    if (segment.type === 'sticker' && /^\/stickers\/[a-z0-9_]+\.webp$/i.test(String(segment.sticker?.src || ''))) {
      const semantic = segment.semantic || {};
      const sticker = segment.sticker || {};
      const message = createChatMessage({
        id: segmentId,
        role: 'assistant',
        kind: 'sticker',
        status: 'pending',
        content: stickerSemanticTextFromSegment(segment),
        requestId,
        turnId,
        deliveryId,
        segmentId,
        segmentIndex: Number.isFinite(Number(segment.segmentIndex)) ? Number(segment.segmentIndex) : index,
        inReplyTo: firstReply.inReplyTo,
        replySnapshot: firstReply.replySnapshot,
        sticker: {
          id: sticker.id || null,
          src: sticker.src,
          emotion: sticker.emotion || segment.stickerIntent || null,
          meaning: sticker.meaning || semantic.meaning || segment.stickerIntent || 'эмоциональный жест',
          cause: semantic.cause || sticker.cause || data?.turnDecision?.focus || null,
          utterance: sticker.utterance || null,
          delivery: semantic.delivery || (plan.mode === 'sticker_only' ? 'sticker_only' : 'after_text'),
          intensity: semantic.intensity || 50,
          canExplain: semantic.canExplain !== false,
          expiresAfterTurns: semantic.expiresAfterTurns || 0
        }
      });
      segments.push({ type: 'sticker', purpose: segment.purpose || 'nonverbal_reaction', sticker, semantic, message });
    }
  }

  if (!segments.length) {
    const error = new Error('Delivery plan contained no renderable segments');
    error.code = 'INVALID_DELIVERY_PLAN';
    throw error;
  }

  return {
    type: plan.mode || (segments.length > 1 ? 'multi_message' : segments[0].type),
    mode: plan.mode || 'single_text',
    turnId,
    deliveryId,
    segments,
    fallbackText: String(plan.fallbackText || 'Мм.').trim(),
    reply: segments.filter(item => item.type === 'text').map(item => item.text).join('\n\n')
  };
}

function preparedDeliveryMessages(prepared = null) {
  return prepared?.type === 'silence'
    ? [prepared.silenceMessage].filter(Boolean)
    : (prepared?.segments || []).map(item => item.message).filter(Boolean);
}

function persistPreparedDelivery(prepared = null) {
  const messages = preparedDeliveryMessages(prepared);
  return persistChatHistoryMutation(history, draft => {
    for (const message of messages) {
      if (!draft.some(item => item?.id === message.id)) draft.push(message);
    }
  }, localStorage);
}

function persistPreparedDeliveryOrThrow(prepared = null) {
  if (persistPreparedDelivery(prepared)) return true;
  const error = new Error('Prepared delivery journal could not be persisted');
  error.code = 'DELIVERY_JOURNAL_STORAGE_FAILED';
  throw error;
}

function discardPreparedDelivery(prepared = null) {
  const ids = new Set(preparedDeliveryMessages(prepared).map(item => item?.id).filter(Boolean));
  if (!ids.size) return false;
  const before = history.length;
  history = history.filter(item => !ids.has(item?.id));
  if (history.length === before) return false;
  if (!saveHistory(history)) dbg('prepared delivery rollback remains pending only in persisted recovery journal');
  return true;
}

async function reconcilePendingAssistantDeliveryCommitState() {
  const pending = history.filter(item => item?.role === 'assistant' && item?.status === 'pending' && item?.deliveryId);
  if (!pending.length) return new Set();
  try {
    const memoryModule = await ensureMemoryReady();
    const diary = await memoryModule?.loadDiary?.();
    const committedRequestId = String(diary?.conversationState?.lastCommittedRequestId || '').trim();
    const verified = new Set(committedRequestId ? [committedRequestId] : []);
    history = reconcilePendingDeliveryHistory(history, committedRequestId);
    saveHistory(history);
    return verified;
  } catch (error) {
    dbg(`pending delivery commit reconciliation failed: ${error?.message || error}`);
    return new Set();
  }
}

function setTypingRow(currentRow, mode) {
  if (mode === 'typing') return currentRow?.isConnected ? currentRow : addTyping();
  if (currentRow?.isConnected) currentRow.remove();
  return null;
}

async function renderPreparedSegment(segment, prepared) {
  if (!segment?.message) return null;
  if (segment.type === 'text') {
    const next = updateMessage(history, segment.message.id, {
      status: 'complete',
      kind: segment.audioUrl ? 'voice' : 'text',
      errorCode: null
    }) || segment.message;
    saveHistory(history);
    try {
      if (segment.audioUrl) addVoiceBubble(segment.audioUrl, segment.text, 'assistant', next.ts, { message: next });
      else addBubble(segment.text, 'assistant', next.ts, { message: next });
    } catch (error) {
      dbg(`post-commit text render failed: segment=${next.segmentId || next.id}; ${error?.message || error}`);
    }
    return next.kind;
  }

  if (segment.type === 'sticker') {
    let rendered = null;
    try {
      const completed = { ...segment.message, status: 'complete' };
      rendered = await addStickerBubble(segment.message.sticker?.src, 'assistant', segment.message.sticker?.utterance || null, segment.message.ts, { message: completed });
    } catch (error) {
      dbg(`post-commit sticker render failed: segment=${segment.message.segmentId || segment.message.id}; ${error?.message || error}`);
    }
    if (rendered) {
      const next = updateMessage(history, segment.message.id, { status: 'complete', errorCode: null }) || segment.message;
      saveHistory(history);
      stickersLib?.markStickerSent?.(next.sticker);
      return 'sticker';
    }

    if (prepared?.mode === 'sticker_only' && prepared?.fallbackText) {
      const fallback = createChatMessage({
        id: `${segment.message.id}-fallback`,
        role: 'assistant', kind: 'text', status: 'complete', content: prepared.fallbackText,
        requestId: segment.message.requestId, turnId: segment.message.turnId, deliveryId: segment.message.deliveryId,
        segmentId: `${segment.message.segmentId || segment.message.id}-fallback`, segmentIndex: segment.message.segmentIndex,
        inReplyTo: segment.message.inReplyTo, replySnapshot: segment.message.replySnapshot
      });
      const index = history.findIndex(item => item?.id === segment.message.id);
      if (index >= 0) history.splice(index, 1, fallback); else history.push(fallback);
      saveHistory(history);
      addBubble(fallback.content, 'assistant', fallback.ts, { message: fallback });
      return 'text';
    }
    updateMessage(history, segment.message.id, { status: 'failed', errorCode: 'STICKER_RENDER_FAILED' });
    saveHistory(history);
    return 'sticker_failed';
  }
  return null;
}

async function deliverCommittedAssistantTurn(prepared, { presenceTurn = null, scheduler = null, startIndex = 0 } = {}) {
  if (prepared?.type === 'silence') {
    const message = prepared.silenceMessage;
    if (message) updateMessage(history, message.id, { status: 'complete', errorCode: null });
    saveHistory(history);
    return 'silence';
  }

  let lastKind = null;
  let typingRow = null;
  const setPresence = mode => {
    if (mode === 'typing') {
      presence.setTyping(presenceTurn);
      typingRow = setTypingRow(typingRow, 'typing');
    } else {
      presence.setOnline(presenceTurn);
      typingRow = setTypingRow(typingRow, 'online');
    }
  };

  for (let index = Math.max(0, startIndex); index < prepared.segments.length; index += 1) {
    const segment = prepared.segments[index];
    if (index > startIndex && scheduler) {
      await scheduler.waitBetweenSegments({ nextSegment: segment, onPresence: setPresence, shouldCancel: () => false });
    }
    typingRow = setTypingRow(typingRow, 'online');
    lastKind = await renderPreparedSegment(segment, prepared);
  }
  typingRow = setTypingRow(typingRow, 'online');
  return lastKind || prepared.type || 'text';
}

async function resumePendingAssistantDeliveries() {
  const verifiedRequests = await reconcilePendingAssistantDeliveryCommitState();
  const pending = history
    .filter(item => item?.role === 'assistant' && item?.status === 'pending' && item?.deliveryId && verifiedRequests.has(String(item.requestId || '')))
    .sort((a, b) => Number(a.segmentIndex || 0) - Number(b.segmentIndex || 0));
  if (!pending.length) return false;

  const groups = new Map();
  for (const message of pending) {
    if (!groups.has(message.deliveryId)) groups.set(message.deliveryId, []);
    groups.get(message.deliveryId).push(message);
  }
  for (const messages of groups.values()) {
    const turnId = messages[0]?.turnId || null;
    const presenceTurn = presence.beginTurn({ userInitiated: false });
    let typingRow = null;
    const setPresence = mode => {
      if (mode === 'typing') { presence.setTyping(presenceTurn); typingRow = setTypingRow(typingRow, 'typing'); }
      else { presence.setOnline(presenceTurn); typingRow = setTypingRow(typingRow, 'online'); }
    };
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      const segment = message.kind === 'sticker'
        ? { type: 'sticker', message, sticker: message.sticker, semantic: message.sticker }
        : message.kind === 'silence'
          ? { type: 'silence', message }
          : { type: 'text', text: message.content, message, audioUrl: null };
      if (segment.type === 'silence') {
        updateMessage(history, message.id, { status: 'complete' });
        saveHistory(history);
        continue;
      }
      if (index > 0) await humanDeliveryScheduler.waitBetweenSegments({ nextSegment: segment, onPresence: setPresence, shouldCancel: () => false });
      else await humanDeliveryScheduler.waitBeforeFirstSegment({ userChars: 0, messageCount: 1, firstSegment: segment, onPresence: setPresence, shouldCancel: () => false });
      typingRow = setTypingRow(typingRow, 'online');
      await renderPreparedSegment(segment, { mode: messages.length === 1 && message.kind === 'sticker' ? 'sticker_only' : 'multi_message', fallbackText: 'Мм.' });
    }
    typingRow = setTypingRow(typingRow, 'online');
    presence.finishTurn(presenceTurn);
    dbg(`resumed pending delivery: turn=${turnId || '-'}; segments=${messages.length}`);
  }
  return true;
}


function replyLinkFromTarget(target = null) {
  if (!target?.messageId || target.role !== 'user') return null;
  const source = findMessageById(target.messageId);
  const snapshot = source ? createReplySnapshot(source) : normalizeReplySnapshot(target);
  if (!snapshot) return null;
  return { inReplyTo: target.messageId, replySnapshot: snapshot };
}

function stickerClientPreferences() {
  return {
    mode: lsStickerMode(),
    probability: Math.max(0, Math.min(100, lsStickerProb())),
    safeMode: lsStickerSafe()
  };
}

function stickerDebugSummary(data = null, committed = null) {
  const state = data?.cognition?.stickerState || null;
  const stickerSegment = data?.deliveryPlan?.segments?.find(item => item?.type === 'sticker') || null;
  const metrics = data?.promptMetrics || null;
  if (!state && !stickerSegment && !metrics) return '';
  const budget = state?.mode === 'always'
    ? 'always'
    : `${Number(state?.usedStickerTurns || 0)}/${state?.limitStickerTurns ?? '-'}`;
  const snapshot = buildTurnDebugSnapshot(data, committed);
  const tokenSummary = metrics
    ? `; model=${data?.model?.mind || '-'}; reasoning=${metrics?.reasoningEffort || '-'}; mindCalls=${Number(metrics?.calls?.mind || 0)}; tokens=${Number(metrics?.inputTokens || 0)}/${Number(metrics?.outputTokens || 0)}/${Number(metrics?.totalTokens || 0)}; cached=${Number(metrics?.cachedInputTokens || 0)}; cacheWrite=${Number(metrics?.cacheWriteTokens || 0)}; reasoningTokens=${Number(metrics?.reasoningTokens || 0)}; semanticRetries=${Number(metrics?.semanticRetries || 0)}; transport=${Number(metrics?.calls?.transportAttempts || 0)}; modelFallback=${metrics?.modelFallback === true ? 'yes' : 'no'}; intentOp=${snapshot.operation}; intentKind=${snapshot.kind}; intentPhase=${snapshot.phase}; intentAge=${snapshot.age}; intentProgress=${snapshot.progress ?? '-'}; intentEngagement=${snapshot.engagement ?? '-'}; intentSaturation=${snapshot.saturation ?? '-'}; intentSimilarity=${snapshot.similarity}; sceneMotif=${snapshot.sceneMotif}; motifRepeat=${snapshot.motifRepeat}; motifPressure=${snapshot.motifPressure}; frameAlignment=${snapshot.frameAlignment}; literalCorrection=${snapshot.literalCorrection}; referenceAnchor=${String(snapshot.referenceAnchor || '-').replace(/\s+/g, ' ').slice(0, 80)}; lifeDomain=${snapshot.lifeDomain}; lifeMotif=${snapshot.lifeMotif}; lifeRepeat=${snapshot.lifeMotifAppearances}; lifeNovelty=${snapshot.lifeNoveltyPressure}; responseDepth=${snapshot.responseDepth}; depthLock=${snapshot.responseShortLock}; messageShape=${snapshot.messageShape}; shapeLock=${snapshot.responseSingleLock}; vocative=${String(snapshot.vocativeUsed || '-').replace(/\s+/g, ' ').slice(0, 48)}/${snapshot.vocativeUsedClass}; vocPressure=${snapshot.vocativePressure}; vocRecent=${snapshot.vocativeRecent6}/6; vocStreak=${snapshot.vocativeStreak}; vocGap=${snapshot.vocativeTurnsSinceAny}; vocCooldown=${snapshot.vocativeAnyGapRemaining}/${snapshot.vocativeClassGapRemaining}/${snapshot.vocativeExactGapRemaining}; vocLast=${String(snapshot.vocativeLastExact || '-').replace(/\s+/g, ' ').slice(0, 48)}/${snapshot.vocativeLastClass}; vocAvoid=${snapshot.vocativeStrongAvoid ? 'yes' : 'no'}; vocDirect=${snapshot.vocativeDirectRequest ? 'yes' : 'no'}; vocOverride=${snapshot.vocativeOverride ? 'yes' : 'no'}; commitment=${snapshot.commitmentAction}/${snapshot.commitmentConflict}:${String(snapshot.commitmentSubject || '-').replace(/\s+/g, ' ').slice(0, 72)}; commitmentRequested=${snapshot.commitmentRequestedAction}; commitmentHorizon=${snapshot.commitmentHorizon}; activeCommitments=${snapshot.activeCommitments}; callback=${snapshot.futureCallbackDetected ? 'new' : 'carry'}:${snapshot.futureCallbackCue}:${String(snapshot.futureCallbackSubject || '-').replace(/\s+/g, ' ').slice(0, 72)}; callbackActive=${snapshot.futureCallbackActive}; callbackResolved=${String(snapshot.futureCallbackResolvedId || '-').slice(-12)}; symbolCandidate=${snapshot.sharedSymbolCandidateId}@${snapshot.sharedSymbolCandidateActivation}${snapshot.sharedSymbolCandidateDirectRecall ? ':direct' : ''}; sharedSymbol=${snapshot.sharedSymbolId}/${snapshot.sharedSymbolExpression}; symbolActivation=${snapshot.sharedSymbolActivation}; symbolRepeat=${snapshot.sharedSymbolRepeat}; reciprocityPressure=${snapshot.reciprocityPressure}; reciprocityOpportunity=${snapshot.reciprocityOpportunity ? 'yes' : 'no'}; reciprocityAnchor=${String(snapshot.reciprocityAnchor || '-').replace(/\s+/g, ' ').slice(0, 80)}; shortTerm=${Number(metrics?.shortTermExchanges || 0)}ex/${Number(metrics?.shortTermSpeakerTurns || 0)}turns/${Number(metrics?.shortTermChars || 0)}c; cacheMode=${metrics?.cacheMode || '-'}; cachePrefixChars=${Number(metrics?.cachePrefixChars || 0)}; cacheKey=${String(metrics?.cacheKey || '-').slice(-12)}`
    : '';
  return `; stickerMode=${state?.mode || '-'}; stickerAvail=${state?.available === true ? 'yes' : 'no'}:${state?.reason || '-'}; stickerHard=${state?.hardAvailable === true ? 'yes' : 'no'}:${state?.hardReason || '-'}; stickerBudget=${budget}; stickerTurns=${state?.semanticAssistantTurns ?? '-'}; stickerGap=${state?.turnsSinceSticker ?? '-'}/${state?.requiredGapTurns ?? '-'}; stickerCooldown=${state?.cooldownRemainingTurns ?? '-'}; stickerGapOk=${state?.gapSatisfied === true ? 'yes' : 'no'}; stickerLastTurn=${String(state?.lastStickerTurnKey || '-').slice(-18)}; stickerIntent=${stickerSegment?.stickerIntent || '-'}; stickerAsset=${stickerSegment?.sticker?.id || '-'}${tokenSummary}`;
}

function updatePresenceForDelivery(presenceTurn, mode, typingRowRef) {
  if (mode === 'typing') {
    presence.setTyping(presenceTurn);
    if (!typingRowRef.current?.isConnected) typingRowRef.current = addTyping();
    return;
  }
  presence.setOnline(presenceTurn);
  if (typingRowRef.current?.isConnected) typingRowRef.current.remove();
  typingRowRef.current = null;
}

function userBatchText(messages = []) {
  return messages.map(item => String(item?.content || '').trim()).filter(Boolean).join('\n');
}

function assistantMemoryText(prepared = null) {
  if (prepared?.reply) return prepared.reply;
  return (prepared?.segments || [])
    .filter(item => item.type === 'sticker')
    .map(item => item?.message?.sticker?.meaning || item?.message?.sticker?.emotion || 'невербальная реакция')
    .join('; ');
}

function resetBatchRows(messageIds = [], status = 'pending') {
  for (const id of messageIds) {
    const row = findMessageRow(id);
    if (!row) continue;
    row.dataset.status = status;
    if (status !== 'failed') row.querySelector('.message-retry')?.remove();
    syncDeliveryIndicator(row);
  }
}

function requeueInterruptedBatch(messageIds = []) {
  const persisted = persistChatHistoryMutation(history, draft => {
    assignMessageBatch(draft, messageIds, { requestId: null, turnId: null, status: 'pending' });
  }, localStorage);
  if (!persisted) {
    markBatchFailed(messageIds, 'HISTORY_STORAGE_FAILED', { persist: false });
    return false;
  }
  resetBatchRows(messageIds, 'pending');
  inputAggregator.prepend(messageIds);
  return true;
}

function markBatchFailed(messageIds = [], code = 'CHAT_REQUEST_FAILED', { persist = true } = {}) {
  for (const id of messageIds) {
    const failed = updateMessage(history, id, { status: 'failed', errorCode: code });
    if (failed) renderFailedState(failed);
  }
  if (persist) saveHistory(history);
}

async function requestAssistantInitiative({ type = 'scheduled', reason = '' } = {}) {
  if (activeRequests > 0 || hasBlockingTurn(history)) return false;
  const requestId = newRequestId();
  const epochAtStart = inputEpoch;
  activeRequests += 1;
  let presenceFinished = false;
  let stateCommitted = false;
  let preparedDelivery = null;
  let preparedPersisted = false;
  const typingRowRef = { current: null };
  const presenceTurn = presence.beginTurn({ userInitiated: false });
  const finishPresence = () => {
    if (presenceFinished) return;
    presenceFinished = true;
    if (typingRowRef.current?.isConnected) typingRowRef.current.remove();
    typingRowRef.current = null;
    presence.finishTurn(presenceTurn);
  };
  const onPresence = mode => updatePresenceForDelivery(presenceTurn, mode, typingRowRef);

  try {
    await memoryJobRunner.drain();
    const memoryModule = await ensureMemoryReady();
    const schedule = await ensureRuntimeSchedule();
    await refreshRinEnv({ refreshWeather: environmentIsStale(schedule) });
    const preparedInnerLife = await memoryModule?.prepareInnerLife?.(currentEnv || {}, '', schedule?.innerLife || {});
    const [memory, activeProfile] = await Promise.all([
      buildMemoryPayload({ innerLifeOverride: preparedInnerLife }),
      ensureActiveProfile()
    ]);
    const response = await requestChatTurn({
      requestId,
      history: toApiHistory(history),
      trigger: { type, reason },
      env: currentEnv || undefined,
      profile: activeProfile || undefined,
      memory: memory || undefined,
      client: {
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
        sentAt: Date.now(),
        build: RIN_BUILD_VERSION,
        proactive: true,
        sticker: stickerClientPreferences()
      }
    });
    let data = {};
    try { data = await response.json(); } catch {}
    if (response.status === 401) {
      removeStoredPin();
      window.location.replace('/login');
      return false;
    }
    if (!response.ok || (data.requestId && data.requestId !== requestId)) {
      dbg(`proactive request failed: ${data?.code || response.status || 'mismatch'}`);
      return false;
    }

    // User input has priority over a proactive turn until its first segment commits.
    if (inputEpoch !== epochAtStart) {
      dbg(`proactive prepared turn cancelled by user input: request=${requestId}`);
      return false;
    }

    preparedDelivery = await prepareAssistantDelivery({ data, requestId, userText: '' });
    if (inputEpoch !== epochAtStart) return false;

    const waitResult = preparedDelivery.type === 'silence'
      ? await humanDeliveryScheduler.waitBeforeSilence({ userChars: 0, messageCount: 1, onPresence, shouldCancel: () => inputEpoch !== epochAtStart })
      : await humanDeliveryScheduler.waitBeforeFirstSegment({
          userChars: 0,
          messageCount: 1,
          firstSegment: preparedDelivery.segments[0],
          onPresence,
          shouldCancel: () => inputEpoch !== epochAtStart
        });
    if (waitResult.cancelled) {
      dbg(`proactive delivery cancelled before commit: request=${requestId}; phase=${waitResult.phase}`);
      return false;
    }

    updatePresenceForDelivery(presenceTurn, 'online', typingRowRef);
    persistPreparedDeliveryOrThrow(preparedDelivery);
    preparedPersisted = true;
    const committedState = await commitSuccessfulTurnState({ memoryModule, requestId, data, preparedInnerLife });
    stateCommitted = true;
    const kind = await deliverCommittedAssistantTurn(preparedDelivery, { presenceTurn, scheduler: humanDeliveryScheduler });
    dbg(`proactive complete: request=${requestId}; kind=${kind}; trigger=${type}; build=${RIN_BUILD_VERSION}${stickerDebugSummary(data, committedState)}`);
    return true;
  } catch (error) {
    if (stateCommitted) {
      dbg(`post-commit proactive delivery failed: request=${requestId}; ${error?.message || error}`);
      return true;
    }
    if (preparedPersisted) discardPreparedDelivery(preparedDelivery);
    dbg(`proactive request failed: ${error?.code || error?.message || error}`);
    return false;
  } finally {
    activeRequests = Math.max(0, activeRequests - 1);
    finishPresence();
  }
}

async function tryInitiateBySchedule() {
  if (!canAutoInitiate({ history, greetingActive, activeRequests })) return false;
  const schedule = await ensureRuntimeSchedule();
  const policy = resolveInitiationPolicy(schedule);
  if (!policy || policy.maxPerDay <= 0) return false;

  const localDate = nowInTz(policy.timezone);
  const dateKey = fmtDateKey(localDate);
  if (initiationState.getSentCount(dateKey) >= policy.maxPerDay) return false;

  const window = activeInitiationWindow(localDate, policy);
  if (!window) return false;
  const windowKey = initiationWindowKey(window);
  if (initiationState.hasAttempted(dateKey, windowKey)) return false;

  const last = [...history].reverse().find(item => ['text', 'voice', 'sticker', 'silence'].includes(item?.kind || 'text'));
  if (!last || last.role !== 'assistant' || Date.now() - Number(last.ts || Date.now()) < policy.minimumSilenceMinutes * 60_000) return false;
  if (!canAutoInitiate({ history, greetingActive, activeRequests })) return false;

  // Persist the draw before sampling so refreshes/timer ticks cannot re-roll the same window.
  if (!initiationState.recordAttempt(dateKey, windowKey)) {
    dbg(`initiative state write failed: ${dateKey}/${windowKey}`);
    return false;
  }
  if (Math.random() >= Number(window.probability)) {
    dbg(`initiative draw skipped: ${windowKey}`);
    return false;
  }

  const sent = await requestAssistantInitiative({
    type:'scheduled',
    reason:`окно самостоятельной инициативы ${window.pool || 'day'} после ${policy.minimumSilenceMinutes}+ минут тишины`
  });
  if (sent && !initiationState.recordSent(dateKey)) dbg(`initiative sent count write failed: ${dateKey}`);
  return sent;
}

async function beginUserBatch(messageIds = []) {
  const ids = [...new Set((Array.isArray(messageIds) ? messageIds : []).map(String).filter(Boolean))]
    .filter(id => history.some(item => item?.id === id && item?.role === 'user' && ['pending', 'failed'].includes(item.status)));
  if (!ids.length) return false;
  const requestId = newRequestId();
  const turnId = `user-turn-${requestId}`;
  const persisted = persistChatHistoryMutation(history, draft => {
    assignMessageBatch(draft, ids, { requestId, turnId, status: 'pending' });
  }, localStorage);
  if (!persisted) {
    markBatchFailed(ids, 'HISTORY_STORAGE_FAILED', { persist: false });
    dbg(`user batch blocked before request: history persistence failed; request=${requestId}`);
    return false;
  }
  resetBatchRows(ids, 'pending');
  enqueueBatch(ids);
  return true;
}

const messageQueue = createSerialQueue(processUserBatch);
const inputAggregator = createInputAggregator({
  canFlush: () => activeRequests === 0,
  onFlush: beginUserBatch
});

formEl.addEventListener('submit', event => {
  event.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;
  const selectedReply = replySelection;
  const message = createChatMessage({
    role: 'user',
    kind: 'text',
    status: 'pending',
    content: text,
    requestId: null,
    turnId: null,
    inReplyTo: selectedReply?.messageId || null,
    replySnapshot: selectedReply?.snapshot || null
  });
  const persisted = persistChatHistoryMutation(history, draft => { draft.push(message); }, localStorage);
  if (!persisted) {
    dbg('user message blocked before queue: history persistence failed');
    inputEl?.focus({ preventScroll: false });
    return;
  }

  inputEl.value = '';
  clearReplySelection();
  // Any durably stored user event invalidates a prepared-but-not-yet-committed assistant turn.
  inputEpoch += 1;
  addBubble(text, 'user', message.ts, { message });
  inputAggregator.push(message.id);
});

function enqueueBatch(messageIds) {
  return messageQueue.enqueue(messageIds).catch(error => {
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
  const persisted = persistChatHistoryMutation(history, draft => {
    assignMessageBatch(draft, [messageId], { requestId: null, turnId: null, status: 'pending' });
  }, localStorage);
  if (!persisted) {
    dbg(`retry blocked before queue: history persistence failed; message=${messageId}`);
    return;
  }
  inputEpoch += 1;
  resetBatchRows([messageId], 'pending');
  inputAggregator.push(messageId);
}

function renderFailedState(message) {
  const row = findMessageRow(message.id);
  if (!row) return;
  row.dataset.status = 'failed';
  syncDeliveryIndicator(row);
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
  if (code === 'UPSTREAM_RATE_LIMITED') return 'Сервис временно перегружен. Сообщение можно повторить.';
  if (code === 'UPSTREAM_UNAVAILABLE' || code === 'UPSTREAM_NETWORK_ERROR') return 'Связь с сервисом временно недоступна. Сообщение можно повторить.';
  if (code === 'UPSTREAM_REJECTED') return 'Сервис отклонил запрос. Сообщение не добавлено в контекст; его можно повторить.';
  if (code === 'REALIZATION_VALIDATION_FAILED' || code === 'REALIZATION_PARSE_FAILED' || code === 'INVALID_TURN_DECISION') return 'Не удалось безопасно сформировать ответ. Сообщение можно повторить.';
  return 'Не удалось получить ответ. Сообщение не включено в следующий контекст; его можно повторить.';
}

async function processUserBatch(messageIds = []) {
  const ids = [...new Set((Array.isArray(messageIds) ? messageIds : []).map(String).filter(Boolean))];
  const messages = history.filter(item => ids.includes(item?.id) && item?.role === 'user');
  if (!messages.length || messages.some(item => !['pending', 'failed'].includes(item.status))) return;

  let requestId = messages[0]?.requestId || null;
  if (!requestId || messages.some(item => item.requestId !== requestId)) requestId = newRequestId();
  const persistedForRequest = persistChatHistoryMutation(history, draft => {
    assignMessageBatch(draft, ids, { requestId, turnId: `user-turn-${requestId}`, status: 'sent' });
  }, localStorage);
  if (!persistedForRequest) {
    markBatchFailed(ids, 'HISTORY_STORAGE_FAILED', { persist: false });
    dbg(`user request blocked: sent state could not be persisted; request=${requestId}`);
    return;
  }
  resetBatchRows(ids, 'sent');

  const epochAtStart = inputEpoch;
  const combinedUserText = userBatchText(messages);
  const lastUserMessage = messages.at(-1);
  activeRequests += 1;
  let presenceFinished = false;
  let stateCommitted = false;
  let preparedDelivery = null;
  let preparedPersisted = false;
  const typingRowRef = { current: null };
  const presenceTurn = presence.beginTurn({ userInitiated: true });
  const finishPresence = () => {
    if (presenceFinished) return;
    presenceFinished = true;
    if (typingRowRef.current?.isConnected) typingRowRef.current.remove();
    typingRowRef.current = null;
    presence.finishTurn(presenceTurn);
  };
  const onPresence = mode => updatePresenceForDelivery(presenceTurn, mode, typingRowRef);

  try {
    await memoryJobRunner.drain();
    const schedule = await ensureRuntimeSchedule();
    const envIntent = environmentIntent(combinedUserText);
    await refreshRinEnv({ refreshWeather: envIntent === 'weather' || environmentIsStale(schedule) });
    const memoryModule = await ensureMemoryReady();
    const preparedInnerLife = await memoryModule?.prepareInnerLife?.(currentEnv || {}, combinedUserText, schedule?.innerLife || {});
    const [memory, activeProfile] = await Promise.all([
      buildMemoryPayload({ innerLifeOverride: preparedInnerLife }),
      ensureActiveProfile()
    ]);
    const response = await requestChatTurn({
      requestId,
      history: toApiHistory(history, requestId),
      env: currentEnv || undefined,
      profile: activeProfile || undefined,
      memory: memory || undefined,
      client: {
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
        sentAt: Date.now(),
        build: RIN_BUILD_VERSION,
        sticker: stickerClientPreferences()
      }
    });
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
      error.warnings = Array.isArray(data?.warnings) ? data.warnings.slice(0, 12) : [];
      error.hardWarnings = Array.isArray(data?.hardWarnings) ? data.hardWarnings.slice(0, 12) : [];
      error.rewriteableWarnings = Array.isArray(data?.rewriteableWarnings) ? data.rewriteableWarnings.slice(0, 12) : [];
      error.validationClass = data?.validationClass || null;
      error.attempts = Number.isFinite(Number(data?.attempts)) ? Number(data.attempts) : null;
      throw error;
    }
    if (data.requestId && data.requestId !== requestId) {
      const error = new Error('Mismatched response');
      error.code = 'MISMATCHED_RESPONSE';
      throw error;
    }

    const realizationMeta = data?.validation?.realization || null;
    if (Number(realizationMeta?.rewrites) > 0) {
      const priorWarnings = (Array.isArray(realizationMeta?.trace) ? realizationMeta.trace : [])
        .filter(item => item && item.passed === false)
        .map(item => (Array.isArray(item.warnings) ? item.warnings.join('|') : 'unknown'))
        .filter(Boolean)
        .join(' > ')
        .slice(0, 420);
      dbg(`realization recovered: request=${requestId}; attempts=${Number(realizationMeta.attempts) || 0}; rewrites=${Number(realizationMeta.rewrites) || 0}${priorWarnings ? `; warnings=${priorWarnings}` : ''}`);
    }

    // The model may already have finished while the user was still typing another
    // message. Until first delivery commits, the new event wins and this turn is discarded.
    if (inputEpoch !== epochAtStart) {
      requeueInterruptedBatch(ids);
      dbg(`prepared turn superseded before materialization: request=${requestId}`);
      return;
    }

    preparedDelivery = await prepareAssistantDelivery({
      data,
      requestId,
      userText: combinedUserText
    });
    if (inputEpoch !== epochAtStart) {
      requeueInterruptedBatch(ids);
      dbg(`prepared turn superseded before human delay: request=${requestId}`);
      return;
    }

    const waitResult = preparedDelivery.type === 'silence'
      ? await humanDeliveryScheduler.waitBeforeSilence({
          userChars: combinedUserText.length,
          messageCount: messages.length,
          onPresence,
          onRead: () => markUserBatchRead(ids),
          shouldCancel: () => inputEpoch !== epochAtStart
        })
      : await humanDeliveryScheduler.waitBeforeFirstSegment({
          userChars: combinedUserText.length,
          messageCount: messages.length,
          firstSegment: preparedDelivery.segments[0],
          onPresence,
          onRead: () => markUserBatchRead(ids),
          shouldCancel: () => inputEpoch !== epochAtStart
        });

    if (waitResult.cancelled) {
      updatePresenceForDelivery(presenceTurn, 'online', typingRowRef);
      requeueInterruptedBatch(ids);
      dbg(`prepared turn superseded during ${waitResult.phase}: request=${requestId}`);
      return;
    }

    // This is the semantic point of no return: state is committed immediately
    // before the first user-visible segment, never seconds earlier.
    updatePresenceForDelivery(presenceTurn, 'online', typingRowRef);
    persistPreparedDeliveryOrThrow(preparedDelivery);
    preparedPersisted = true;
    const committedState = await commitSuccessfulTurnState({
      memoryModule,
      userMessage: lastUserMessage,
      requestId,
      data,
      preparedInnerLife
    });
    stateCommitted = true;
    markUserBatchComplete(ids);

    const kind = await deliverCommittedAssistantTurn(preparedDelivery, {
      presenceTurn,
      scheduler: humanDeliveryScheduler
    });
    saveHistory(history);
    finishPresence();

    const memoryText = assistantMemoryText(preparedDelivery);
    if (memoryText && shouldAnalyzeConversationForMemory(combinedUserText)) {
      enqueueMemoryJob({ id: requestId, userText: combinedUserText, assistantText: memoryText }, localStorage);
      void memoryJobRunner.drain();
    }
    dbg(`reply complete: request=${requestId}; kind=${kind}; segments=${preparedDelivery.segments?.length || 0}; build=${RIN_BUILD_VERSION}${stickerDebugSummary(data, committedState)}`);
  } catch (error) {
    if (stateCommitted) {
      markUserBatchComplete(ids);
      finishPresence();
      dbg(`post-commit delivery failed: request=${requestId}; ${error?.message || error}`);
      return;
    }

    if (preparedPersisted) discardPreparedDelivery(preparedDelivery);
    const code = error?.name === 'AbortError' ? 'UPSTREAM_TIMEOUT' : error?.code || 'CHAT_REQUEST_FAILED';
    markBatchFailed(ids, code);
    addBubble(userFacingError(code), 'assistant');
    finishPresence();
    const diagnostics = [];
    if (Number.isFinite(Number(error?.attempts))) diagnostics.push(`attempts=${Number(error.attempts)}`);
    if (error?.validationClass) diagnostics.push(`class=${String(error.validationClass).slice(0, 80)}`);
    if (Array.isArray(error?.warnings) && error.warnings.length) diagnostics.push(`warnings=${error.warnings.join('|')}`);
    if (Array.isArray(error?.hardWarnings) && error.hardWarnings.length) diagnostics.push(`hard=${error.hardWarnings.join('|')}`);
    if (Array.isArray(error?.rewriteableWarnings) && error.rewriteableWarnings.length) diagnostics.push(`rewriteable=${error.rewriteableWarnings.join('|')}`);
    dbg(`chat request failed: request=${requestId}; code=${code}${diagnostics.length ? `; ${diagnostics.join('; ')}` : ''}`);
  } finally {
    activeRequests = Math.max(0, activeRequests - 1);
    finishPresence();
  }
}


function environmentIsStale(schedule = null) {
  const maxAgeMinutes = Math.max(5, Number(schedule?.weatherGrounding?.refreshMaxAgeMinutes || 20));
  const weatherTs = Number(currentEnv?._weatherTs || 0);
  return !Number.isFinite(weatherTs) || weatherTs <= 0 || Date.now() - weatherTs >= maxAgeMinutes * 60000;
}

async function refreshRinEnv({ refreshWeather = true } = {}) {
  try {
    const schedule = await ensureRuntimeSchedule();
    if (!schedule?.timezone) return;
    const rin = nowInTz(schedule.timezone);
    const monthIdx = rin.getMonth();
    const priorWeather = currentEnv?.weather || null;
    const priorWeatherTs = Number(currentEnv?._weatherTs || (priorWeather ? currentEnv?._ts : 0) || 0);
    const env = {
      _ts: Date.now(),
      _weatherTs: Number.isFinite(priorWeatherTs) ? priorWeatherTs : 0,
      rinTz: schedule.timezone,
      rinHuman: fmtRinHuman(rin),
      season: seasonFromMonth(monthIdx),
      month: monthNameRu(monthIdx),
      partOfDay: partOfDayFromHour(rin.getHours()),
      userVsRinHoursDiff: hoursDiffWithRin(schedule.timezone),
      weather: priorWeather
    };
    if (refreshWeather || !priorWeather) {
      const weather = await fetchRinWeather(schedule.location);
      if (weather) {
        env.weather = weather;
        env._weatherTs = Date.now();
      }
    }
    currentEnv = env;
  } catch (error) {
    dbg('refresh env failed: ' + (error?.message || error));
  }
}
