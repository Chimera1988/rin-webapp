import {
  assignMessageBatch,
  createChatMessage,
  createReplySnapshot,
  createSerialQueue,
  hasBlockingTurn,
  loadChatHistory,
  normalizeStoredHistory,
  CHAT_HISTORY_CACHE_LIMIT,
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
import { createCloudMemorySync } from './js/cloud_memory_sync.js';
import { activeInitiationWindow, canAutoInitiate, canGreet, initiationWindowKey, resolveInitiationPolicy } from './js/conversation_policy.js';
import { createInitiationStateStore } from './js/initiation_state.js';
import { createLocalSettings } from './js/local_settings.js';
import { environmentIntent } from './js/environment_intent.js';
import { weatherRefreshIntent, verifiedWeatherEvidence } from './js/weather_evidence.js';
import { selfFollowThrough } from './js/self_follow_through.js';
import { authenticatedHeaders, fetchWithTimeout, setCsrfToken } from './js/http_client.js';
import { createPresenceController } from './js/presence_controller.js';
import { createHumanDeliveryScheduler, createInputAggregator } from './js/delivery_scheduler.js';
import { createChatViewportController, preserveChatScrollDuringLayout } from './js/chat_viewport.js?v=2026-10-14-ui-fix-1';
import { createWallpaperStore } from './js/wallpaper_store.js';
import { createBackup, parseBackup, restoreBackup, MAX_BACKUP_IMPORT_BYTES } from './js/data_backup.js';
import { createPushController } from './js/push_client.js';
import { createDebugLogBuffer } from './js/debug_compact.js';
import { collectRecentArchiveWindow, createCloudArchive, mergeArchiveHistory } from './js/cloud_archive.js';
import { chatDayLabel, localDayKey } from './js/chat_day_groups.js';
import { createVoicePlayer } from './js/voice_player.js';

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
const voicePlayer = createVoicePlayer({
  root: document.getElementById('voiceMiniPlayer'),
  onError: error => dbg(`voice player unavailable: ${error?.message || error}`)
});

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
const debugCopyCompact = document.getElementById('debugCopyCompact');
const debugCopyFull = document.getElementById('debugCopyFull');
const debugCopyStatus = document.getElementById('debugCopyStatus');

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
        icon:  w.icon || null,
        source: 'openweather', checkedAt: Date.now()
      };
    }
    const d = w?.weather?.[0]?.description || w?.current?.weather?.[0]?.description || '';
    const t = w?.main?.temp ?? w?.current?.temp ?? null;
    const f = w?.main?.feels_like ?? w?.current?.feels_like ?? null;
    return {
      desc: d,
      temp: typeof t === 'number' ? Math.round(t) : null,
      feels: typeof f === 'number' ? Math.round(f) : null,
      icon: w?.weather?.[0]?.icon || w?.current?.weather?.[0]?.icon || null,
      source: 'openweather', checkedAt: Date.now()
    };
  }catch{ return null; }
}

/* === Debug helpers: reversible compact display; full records remain intact. === */
let _debugOn = safeLocalGet(LS_DEBUG_ENABLED, DEFAULT_DEBUG_ENABLED ? '1' : '0') !== '0';
const debugBuffer = createDebugLogBuffer({limit: 1000});
function renderDebugLog() {
  if (!debugLogEl) return;
  // Every visible 80-event slice is independently decodable (its own baselines).
  const content = debugBuffer.count() ? debugBuffer.compact({last:80}) : '';
  debugLogEl.replaceChildren();
  if (content) {
    const rows = document.createDocumentFragment();
    for (const line of content.split('\n')) {
      const div = document.createElement('div');
      div.textContent = line;
      rows.appendChild(div);
    }
    debugLogEl.appendChild(rows);
  }
  debugLogEl.scrollTop = debugLogEl.scrollHeight;
}
function dbg(line) {
  if (!_debugOn) return;
  try {
    const time = new Date();
    const ts = `${String(time.getHours()).padStart(2,'0')}:${String(time.getMinutes()).padStart(2,'0')}:${String(time.getSeconds()).padStart(2,'0')}`;
    debugBuffer.push(line,ts);
    renderDebugLog();
  } catch {} // Debugging must never interrupt a chat turn.
}
async function copyDebugLog(format) {
  if (!debugBuffer.count()) {
    if (debugCopyStatus) debugCopyStatus.textContent = 'Пока нет событий для копирования.';
    return;
  }
  const output = format === 'full' ? debugBuffer.full() : debugBuffer.compact();
  const success = await writeClipboardText(output);
  if (debugCopyStatus) debugCopyStatus.textContent = success
    ? `Скопировано событий: ${debugBuffer.count()}. ${format === 'full' ? 'Исходный лог.' : 'Компактный лог с возможностью восстановления.'}`
    : 'Не удалось скопировать. Можно выделить и скопировать текст лога вручную.';
}
if (debugCopyCompact) debugCopyCompact.onclick = () => { void copyDebugLog('compact'); };
if (debugCopyFull) debugCopyFull.onclick = () => { void copyDebugLog('full'); };
if (debugToggle) {
  debugToggle.checked = _debugOn;
  debugToggle.onchange = () => {
    _debugOn = debugToggle.checked;
    safeLocalSet(LS_DEBUG_ENABLED, _debugOn ? '1' : '0');
    if (!_debugOn) { debugBuffer.clear(); renderDebugLog(); }
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
              outdoorConditions: String(state.outdoorConditions || 'unknown').slice(0, 12),
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
              dailyEpisode: state.dailyEpisode || null,
              personalActions: Array.isArray(state.personalActions) ? state.personalActions.slice(-10) : [],
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
    if (result?.applied === true) void cloudMemorySync.sync();
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
  // Episodic curation needs enough shared context; sample approximately every
  // six user turns, never for one-word acknowledgement or every intimacy beat.
  const periodicCatchUp = completedUserTurns > 0 && completedUserTurns % 6 === 0 && text.length >= 18;
  const strongEpisode = /(?:помирил|разобрал(?:ись|ась|ся)|я\s+люблю\s+тебя|люблю\s+тебя|ты\s+мне\s+важн|наш\s+мир|доверя|нашу\s+истори|истори[юя]\s+про|как\s+тебе\s+(?:эта\s+)?истори|я\s+не\s+знаю\s+что\s+думать)/iu.test(text);
  // A bare date is meaningful only when answering Rin's actual question about
  // the user's birthday. Never turn a bare date about Rin into user.birthday.
  let ownBirthdayAnswer = false;
  if (/^(?:[0-3]?\d)(?:-?(?:ое|го|е|й))?\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s+\d{4})?[.!\s]*$/iu.test(text)) {
    const current = history.findLastIndex(item => item?.role === 'user' && String(item?.content || '').trim() === text);
    const before = current >= 0 ? history.slice(Math.max(0, current - 8), current) : [];
    const previousRin = [...before].reverse().find(item => item?.role === 'assistant');
    const previousUser = [...before].reverse().find(item => item?.role === 'user');
    const rinQuestion = String(previousRin?.content || '').toLowerCase();
    const userContext = String(previousUser?.content || '').toLowerCase();
    ownBirthdayAnswer = /(?:когда\s+именно|когда\s+у\s+тебя\s+день\s+рождения)/iu.test(rinQuestion)
      && /(?:у\s+меня\s+тоже|мой\s+день\s+рождения)/iu.test(userContext);
  }
  const trivial = /^(?:привет|доброе утро|добрый день|добрый вечер|ну пока|до завтра|спокойной ночи|спасибо|ага|да|нет|ок(?:ей)?|хорошо|понятно|мм+|ха+|[\p{Emoji_Presentation}\p{Extended_Pictographic}\s.!?]+)$/iu.test(text);
  return !trivial && (meaningful || substantial || periodicCatchUp || strongEpisode || ownBirthdayAnswer);
}

// A late cloud-archive upload must not silently discard a qualified episode.
// Retry only the source verification/write, never the AI extraction itself.
const EPISODE_PENDING_KEY = 'rin-episode-capture-v1';
let episodeCaptureBusy = false;
function episodeCandidateKey(x) { return `${x.day || ''}|${x.kind || ''}|${x.episodeKey || ''}|${x.sourceMessageId || ''}`; }
function storedEpisodeCandidates() {
  try {
    const data = JSON.parse(localStorage.getItem(EPISODE_PENDING_KEY) || '[]');
    return Array.isArray(data) ? data.filter(x => x && x.sourceMessageId && x.episodeKey).slice(-20) : [];
  } catch { return []; }
}
function queueEpisodeCandidates(items = []) {
  if (!Array.isArray(items) || !items.length) return;
  try {
    const map = new Map(storedEpisodeCandidates().map(x => [episodeCandidateKey(x), x]));
    for (const item of items.slice(0, 4)) if (item?.sourceMessageId && item?.episodeKey) map.set(episodeCandidateKey(item), item);
    localStorage.setItem(EPISODE_PENDING_KEY, JSON.stringify([...map.values()].slice(-20)));
  } catch (error) { dbg(`episode retry queue unavailable: ${error?.message || error}`); }
}
async function flushEpisodeCandidates() {
  if (episodeCaptureBusy) return;
  const all = storedEpisodeCandidates();
  if (!all.length) return;
  episodeCaptureBusy = true;
  try {
    const batch = all.slice(0, 10);
    const response = await fetchWithTimeout('/api/memory', {
      method: 'POST', headers: authenticatedHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ action: 'episode_capture_retry', candidates: batch })
    }, 14_000);
    if (!response.ok) return;
    const result = await response.json();
    const attempted = new Set(batch.map(episodeCandidateKey));
    const rest = storedEpisodeCandidates().filter(x => !attempted.has(episodeCandidateKey(x)));
    const pending = Array.isArray(result?.pending) ? result.pending : batch;
    const merged = new Map([...rest, ...pending].map(x => [episodeCandidateKey(x), x]));
    try {
      if (merged.size) localStorage.setItem(EPISODE_PENDING_KEY, JSON.stringify([...merged.values()].slice(-20)));
      else localStorage.removeItem(EPISODE_PENDING_KEY);
    } catch (error) { dbg(`episode queue update failed: ${error?.message || error}`); }
    dbg(`episode retry: saved=${Number(result?.saved)||0}; pending=${pending.length}; rejected=${Number(result?.dropped)||0}`);
  } catch (error) {
    dbg(`episode retry deferred: ${error?.message || error}`);
  } finally { episodeCaptureBusy = false; }
}
setTimeout(() => { void flushEpisodeCandidates(); }, 25_000);
setInterval(() => { void flushEpisodeCandidates(); }, 45_000);

async function analyzeConversationForMemory(userText, assistantText, jobId = '') {
  try {
    const existingMemory = await buildMemoryPayload();
    const res = await fetchWithTimeout('/api/memory', {
      method: 'POST',
      headers: authenticatedHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ userText, assistantText, existingMemory: existingMemory || undefined,
        recentHistory: history.filter(item => ['user','assistant'].includes(item?.role) && ['text','voice'].includes(item?.kind || 'text') && item?.status === 'complete')
          .slice(-28).map(item => ({ id: String(item.id || '').slice(0, 145), ts: Number(item.ts)||0, role: item.role, content: String(item.content || '').slice(0, 650) })) })
    }, 25_000);
    if (res.status === 401) return { ok: false, code: 'UNAUTHORIZED' };
    if (!res.ok) return { ok: false, code: 'MEMORY_HTTP_ERROR' };
    const extracted = await res.json();
    if (extracted?.warning) return { ok: false, code: extracted.warning };
    if (extracted?.episodeCapture?.attempted > 0) dbg(`episodic memory: saved=${extracted.episodeCapture.saved||0}; pending=${extracted.episodeCapture.deferred||0}`);
    if (Array.isArray(extracted?.pendingEpisodes) && extracted.pendingEpisodes.length) {
      queueEpisodeCandidates(extracted.pendingEpisodes);
      void flushEpisodeCandidates();
    }
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

// Snapshot only stable memories and backfill archived first-person reports.
// Neither operation wakes Rin, sends chat messages, or changes Cognitive Kernel state.
const cloudMemorySync=createCloudMemorySync({
  getDiary:async()=>{const lib=await ensureMemoryReady();return lib?.loadDiary?.()||null;},
  headers:()=>authenticatedHeaders({'Content-Type':'application/json'}),
  storage:localStorage,log:msg=>dbg(msg),restoreActionLedger:true
});
setTimeout(()=>{void cloudMemorySync.sync();void cloudMemorySync.backfill();},15_000);
setInterval(()=>{void cloudMemorySync.sync();void cloudMemorySync.backfill();},180_000);

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
    closenessMode: sceneControl?.closenessMode || data?.mind?.closenessMode || 'everyday',
    closenessFocus: sceneControl?.closenessFocus || data?.mind?.closenessFocus || 'none',
    closenessMove: sceneControl?.closenessMove || data?.mind?.closenessMove || 'none',
    closenessTurns: Number(sceneControl?.closenessTurns || 0),
    closenessThreadChars: Number(sceneControl?.closenessThreadChars || 0),
    motifRepeat: Number(sceneControl?.motifRepeat || 0),
    motifPressure: Number(sceneControl?.motifPressure ?? fallbackNoveltyPressure),
    frameAlignment: sceneControl?.frameAlignment || data?.mind?.frameAlignment || '-',
    proactiveHandoff: sceneControl?.proactiveHandoff || '-',
    literalCorrection: sceneControl?.literalCorrection || data?.mind?.literalCorrection || 'none',
    referenceAnchor: sceneControl?.referenceAnchor || data?.mind?.referenceAnchor || '-',
    temporalGap: sceneControl?.temporalGapMinutes ?? null,
    relationalRupturePhase: sceneControl?.relationalRupturePhase || committed?.conversationState?.relationalIntegrity?.rupture?.phase || 'none',
    relationalRuptureAffected: sceneControl?.relationalRuptureAffected || committed?.conversationState?.relationalIntegrity?.rupture?.affected || 'none',
    relationalPressure: sceneControl?.relationalPressure || committed?.conversationState?.relationalIntegrity?.pressure?.signal || 'none',
    relationalBoundaries: Number(sceneControl?.relationalBoundaries ?? (committed?.conversationState?.relationalIntegrity?.boundaries || []).filter(b=>b.status==='active').length),
    temporalResume: sceneControl?.temporalResumed === true,
    temporalPeriodShift: sceneControl?.temporalPeriodShift || 'none',
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
    sceneClosureStrong: Boolean(sceneControl?.sceneClosureStrong ?? data?.cognition?.behaviorState?.sceneClosure?.strong),
    sceneClosureSoft: Boolean(sceneControl?.sceneClosureSoft ?? data?.cognition?.behaviorState?.sceneClosure?.soft),
    sceneClosureKind: sceneControl?.sceneClosureKind || data?.cognition?.behaviorState?.sceneClosure?.kind || 'none',
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

let lastActionDebugMarker='';
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


  if (committed?.applied) {
    const action=committed.innerLife?.personalActions?.at(-1);
    if(action && Number(action.updatedAt)>=Number(action.decidedAt)) {
      const marker=`${action.id}/${action.updatedAt}`;
      if(marker!==lastActionDebugMarker) {
        lastActionDebugMarker=marker;
        dbg(`personal action: kind=${action.kind}; status=${action.status}; goal=${action.goal}; outcome=${action.outcome?.code||'-'}; source=simulated_character_world`);
      }
    }
  }
  if (committed?.mood) {
    const questionReason = String(decision?.question?.reason || '-').replace(/\s+/g, ' ').trim().slice(0, 120);
    const questionPressure = String(data?.cognition?.reciprocity?.reciprocalQuestionReason || '-').replace(/\s+/g, ' ').trim().slice(0, 120);
    const snapshot = buildTurnDebugSnapshot(data, committed);
    dbg(`turn state committed: rev=${committed.conversationState?.revision || 0}; mood=${committed.mood.label}; emotion=${committed.conversationState?.emotionalState?.primary?.type || 'none'}; momentum=${committed.conversationState?.emotionalState?.momentum?.direction || 'steady'}; intent=${snapshot.intent?.status || 'none'}:${snapshot.intent?.goal || '-'}; intentKind=${snapshot.kind}; intentPhase=${snapshot.phase}; intentOp=${snapshot.operation}; intentAge=${snapshot.age}; intentProgress=${snapshot.progress ?? '-'}; intentEngagement=${snapshot.engagement ?? '-'}; intentSaturation=${snapshot.saturation ?? '-'}; intentSimilarity=${snapshot.similarity}; sceneMotif=${snapshot.sceneMotif}; closeness=${snapshot.closenessMode}/${snapshot.closenessFocus}/${snapshot.closenessMove}; closenessTurns=${snapshot.closenessTurns}; closenessThreadChars=${snapshot.closenessThreadChars}; motifRepeat=${snapshot.motifRepeat}; motifPressure=${snapshot.motifPressure}; frameAlignment=${snapshot.frameAlignment}; handoff=${snapshot.proactiveHandoff}; literalCorrection=${snapshot.literalCorrection}; temporalGap=${snapshot.temporalGap ?? '-'}; rupture=${snapshot.relationalRuptureAffected || 'none'}:${snapshot.relationalRupturePhase || 'none'}; relPressure=${snapshot.relationalPressure || 'none'}; relBoundaries=${snapshot.relationalBoundaries || 0}; temporalResume=${snapshot.temporalResume ? 'yes' : 'no'}; temporalPeriodShift=${snapshot.temporalPeriodShift}; referenceAnchor=${String(snapshot.referenceAnchor || '-').replace(/\s+/g, ' ').slice(0, 80)}; lifeDomain=${snapshot.lifeDomain}; lifeMotif=${snapshot.lifeMotif}; lifeRepeat=${snapshot.lifeMotifAppearances}; lifeNovelty=${snapshot.lifeNoveltyPressure}; lifeEnergy=${snapshot.lifeEnergy}; mentalLoad=${snapshot.mentalLoad}; needQuiet=${snapshot.needForQuiet}; desireShare=${snapshot.desireToShare}; dayType=${snapshot.dayType}; workMode=${snapshot.workMode}; sleep=${snapshot.sleepPhase}; sleepDebt=${snapshot.sleepDebtMinutes}; sleepInterrupt=${snapshot.sleepInterruptions}; lateChat=${snapshot.lateConversationMinutes}; wakeReason=${snapshot.wakeReason}; activitySetting=${snapshot.activitySetting}; weatherGrounded=${snapshot.weatherGrounded ? 'yes' : 'no'}; contact=${snapshot.contactStance}; selfDisclosure=${snapshot.selfStateDisclosure}; relSafety=${snapshot.relationalSafety}; statePressure=${snapshot.relationalStatePressure}; quietPresence=${snapshot.quietPresencePreferred ? 'yes' : 'no'}; shareOpportunity=${snapshot.disclosureOpportunity ? 'yes' : 'no'}; responseDepth=${snapshot.responseDepth}; depthLock=${snapshot.responseShortLock}; messageShape=${snapshot.messageShape}; shapeLock=${snapshot.responseSingleLock}; vocative=${String(snapshot.vocativeUsed || '-').replace(/\s+/g, ' ').slice(0, 48)}/${snapshot.vocativeUsedClass}; vocPressure=${snapshot.vocativePressure}; vocRecent=${snapshot.vocativeRecent6}/6; vocStreak=${snapshot.vocativeStreak}; vocGap=${snapshot.vocativeTurnsSinceAny}; vocCooldown=${snapshot.vocativeAnyGapRemaining}/${snapshot.vocativeClassGapRemaining}/${snapshot.vocativeExactGapRemaining}; vocLast=${String(snapshot.vocativeLastExact || '-').replace(/\s+/g, ' ').slice(0, 48)}/${snapshot.vocativeLastClass}; vocAvoid=${snapshot.vocativeStrongAvoid ? 'yes' : 'no'}; vocDirect=${snapshot.vocativeDirectRequest ? 'yes' : 'no'}; vocOverride=${snapshot.vocativeOverride ? 'yes' : 'no'}; commitment=${snapshot.commitmentAction}/${snapshot.commitmentConflict}:${String(snapshot.commitmentSubject || '-').replace(/\s+/g, ' ').slice(0, 72)}; commitmentRequested=${snapshot.commitmentRequestedAction}; commitmentHorizon=${snapshot.commitmentHorizon}; activeCommitments=${snapshot.activeCommitments}; callback=${snapshot.futureCallbackDetected ? 'new' : 'carry'}:${snapshot.futureCallbackCue}:${String(snapshot.futureCallbackSubject || '-').replace(/\s+/g, ' ').slice(0, 72)}; callbackActive=${snapshot.futureCallbackActive}; callbackResolved=${String(snapshot.futureCallbackResolvedId || '-').slice(-12)}; closure=${snapshot.sceneClosureStrong ? 'strong' : snapshot.sceneClosureSoft ? 'soft' : 'no'}:${snapshot.sceneClosureKind}; symbolCandidate=${snapshot.sharedSymbolCandidateId}@${snapshot.sharedSymbolCandidateActivation}${snapshot.sharedSymbolCandidateDirectRecall ? ':direct' : ''}; sharedSymbol=${snapshot.sharedSymbolId}/${snapshot.sharedSymbolExpression}; symbolActivation=${snapshot.sharedSymbolActivation}; symbolRepeat=${snapshot.sharedSymbolRepeat}; reciprocityPressure=${snapshot.reciprocityPressure}; reciprocityOpportunity=${snapshot.reciprocityOpportunity ? 'yes' : 'no'}; reciprocityAnchor=${String(snapshot.reciprocityAnchor || '-').replace(/\s+/g, ' ').slice(0, 80)}; action=${decision?.act || 'respond_personally'}; q=${decision?.question?.mode || 'none'}:${questionReason}; qPressure=${questionPressure}`);
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
const cloudArchive=createCloudArchive({headers:()=>authenticatedHeaders(),log:line=>dbg(line)});
function saveHistory(h){
  const ok = saveChatHistory(h, localStorage);
  if (!ok) dbg('history save failed: storage quota or unavailable');
  if (ok) cloudArchive.enqueue(h);
  return ok;
}

// Cloud pages are scanned for genuinely missing rows. A pre-cloud sticker can be
// older than recent text, so do not use the earliest local timestamp as the cursor:
// there may be archived text *between* locally retained visual events.
let archiveCursor=null;
let archiveHasMore=false;
let archivePrefetchedPages=[];
let archivePendingPage=null;
let archiveLoadButton=null;
let archiveLoading=false;

function renderedArchiveIds() {
  return new Set([...chatEl.querySelectorAll('.message-row[data-message-id]')].map(row=>row.dataset.messageId));
}
function archiveDisplayable(message) {
  return message && message.kind!=='silence' &&
    !(message.role==='assistant' && ['text','voice'].includes(message.kind) && isInternalNonverbalMetaText(message.content));
}
async function discoverUnseenArchivedPage(){
  const known=renderedArchiveIds();
  archivePendingPage=null;
  while(archivePrefetchedPages.length || (archiveHasMore && archiveCursor)){
    // Prefetched pages were read during initial repair. Their cursor must NOT
    // rewind the live cloud cursor, or manual paging would repeat pages.
    const prefetched=archivePrefetchedPages.shift();
    const page=prefetched || await cloudArchive.page(archiveCursor);
    if(!page) { archiveHasMore=false; return false; }
    if(!prefetched){ archiveCursor=page.cursor; archiveHasMore=page.hasMore; }
    if(page.messages.some(m=>archiveDisplayable(m) && !known.has(m.id))){
      archivePendingPage=page;
      return true;
    }
  }
  return false;
}

// Insert a newly fetched archived message at its actual chronological location,
// not necessarily at the top: old visual-only local history can span missing text.
function placeArchivedRow(row, message){
  const rows=[...chatEl.querySelectorAll('.message-row[data-message-id]')];
  const ts=Number(message.ts);
  const id=String(message.id);
  const next=rows.find(other=>other!==row && (Number(other.dataset.messageTs)>ts ||
    (Number(other.dataset.messageTs)===ts && String(other.dataset.messageId).localeCompare(id)>0)));
  if(next) chatEl.insertBefore(row,next);
  else chatEl.appendChild(row);
}

function addArchiveLoadButton(){
  if(!archivePendingPage || archiveLoadButton) return;
  const btn=document.createElement('button');
  btn.type='button';
  btn.className='archive-load-earlier';
  btn.textContent='Показать предыдущую часть архива';
  btn.setAttribute('aria-label','Загрузить недостающие сообщения из облака');
  chatEl.prepend(btn);
  archiveLoadButton=btn;
  btn.addEventListener('click',async()=>{
    if(archiveLoading) return;
    archiveLoading=true;
    btn.disabled=true;
    btn.textContent='Загрузка архива…';
    if(!archivePendingPage){
      try { if(!await discoverUnseenArchivedPage()) { btn.remove();archiveLoadButton=null;return; } }
      catch(error){dbg(`archive paging retry failed: ${error?.message || error}`);btn.textContent='Повторить загрузку архива';return;}
      finally {if(archiveLoadButton)btn.disabled=false;archiveLoading=false;}
      // The user can explicitly tap again after the retry discovers an unseen page.
      return;
    }
    // Anchor a specific visible row rather than preserving only total scrollHeight:
    // a loaded page can fill chronological gaps between locally cached stickers.
    const anchor=[...chatEl.querySelectorAll('.message-row[data-message-id]')]
      .find(row=>row.getBoundingClientRect().bottom>chatEl.getBoundingClientRect().top);
    const before=anchor?.getBoundingClientRect().top;
    try{
      const page=archivePendingPage;
      archivePendingPage=null;
      const known=renderedArchiveIds();
      const added=[];
      for(const message of page.messages){
        if(!archiveDisplayable(message) || !message.id || known.has(message.id)) continue;
        const row=await renderStoredMessage(message);
        if(row){ placeArchivedRow(row,message); added.push(message);known.add(message.id); }
      }
      // Keep loaded records in RAM for replies, selection and copy; localStorage
      // remains a bounded cache and does not overwrite the immutable cloud archive.
      history=mergeArchiveHistory(history,page.messages);
      refreshChatDayDividers();
      if(anchor && before!==undefined) chatEl.scrollTop+=anchor.getBoundingClientRect().top-before;
      btn.textContent=`Загружено сообщений: ${added.length}`;
      if(await discoverUnseenArchivedPage()){
        btn.textContent='Показать предыдущую часть архива';
      }else{
        btn.remove();archiveLoadButton=null;
      }
    }catch(error){
      dbg(`archive older page failed: ${error?.message || error}`);
      btn.textContent='Повторить загрузку архива';
    }finally{
      archiveLoading=false;
      if(archiveLoadButton)btn.disabled=false;
    }
  });
}

// Day boundaries are presentation only; no synthetic messages are added to
// dialogue history, cognition, the database or the backup format.
let dayRefreshPending=false;
function refreshChatDayDividers(){
  const wasNearBottom=chatViewport.isNearBottom();
  const anchor=wasNearBottom?null:[...chatEl.querySelectorAll('.message-row[data-message-id]')]
    .find(row=>row.getBoundingClientRect().bottom>chatEl.getBoundingClientRect().top);
  const topBefore=anchor?.getBoundingClientRect().top;
  for(const divider of chatEl.querySelectorAll('.rin-day-divider')) divider.remove();
  let lastDay=null;
  const now=Date.now();
  for(const row of [...chatEl.querySelectorAll('.message-row[data-message-id]')]){
    const day=localDayKey(row.dataset.messageTs);
    if(!day || day===lastDay) continue;
    const divider=document.createElement('div');
    divider.className='rin-day-divider';
    divider.setAttribute('role','separator');
    divider.setAttribute('aria-label',chatDayLabel(row.dataset.messageTs,now));
    const chip=document.createElement('span');
    chip.textContent=chatDayLabel(row.dataset.messageTs,now);
    divider.appendChild(chip);
    row.before(divider);
    lastDay=day;
  }
  if(wasNearBottom) chatViewport.requestScrollToBottom({force:true});
  else if(anchor && topBefore!==undefined) chatEl.scrollTop+=anchor.getBoundingClientRect().top-topBefore;
}
function scheduleChatDayRefresh(){
  if(dayRefreshPending) return;
  dayRefreshPending=true;
  queueMicrotask(()=>{dayRefreshPending=false;refreshChatDayDividers();});
}
const dayObserver=new MutationObserver(mutations=>{
  if(mutations.some(m=>[...m.addedNodes,...m.removedNodes].some(n=>n.nodeType===1 && n.classList?.contains('message-row'))))
    scheduleChatDayRefresh();
});
dayObserver.observe(chatEl,{childList:true});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)scheduleChatDayRefresh();});
window.addEventListener('pageshow',()=>scheduleChatDayRefresh());
function scheduleNextCalendarDayRefresh(){
  const next=new Date();
  next.setHours(24,0,0,150);
  setTimeout(()=>{scheduleChatDayRefresh();scheduleNextCalendarDayRefresh();},Math.max(1000,next.getTime()-Date.now()));
}
scheduleNextCalendarDayRefresh();


/* === Web Push: minimal background context, local memory remains authoritative === */
let pushController = null;
async function pushSnapshot() {
  if (activeRequests > 0 || hasBlockingTurn(history)) return null;
  await memoryJobRunner.drain();
  const [memory,activeProfile] = await Promise.all([buildMemoryPayload(),ensureActiveProfile()]);
  if (!memory || !activeProfile) return null;
  return {
    history: toApiHistory(history).slice(-35), memory, profile: activeProfile,
    env: currentEnv || {}, sticker: stickerClientPreferences(),
    initiation: (() => {try {return JSON.parse(localStorage.getItem('rin-init-state-v2') || '{}');} catch {return {};}})()
  };
}
async function acceptBackgroundDelivery(pending) {
  if (!pending?.id || !pending?.requestId || !pending?.deliveryPlan) return false;
  if (activeRequests > 0 || hasBlockingTurn(history)) return false;
  // Retry-safe: a lost acknowledgement must not create the message or evolve state twice.
  if (history.some(message=>message.requestId===pending.requestId && message.role==='assistant' && message.status==='complete')) {
    return history.filter(message=>message.requestId===pending.requestId && message.role==='assistant').every(message=>message.status==='complete');
  }
  const sinceGeneration = history.some(message=> message?.role==='user' && Number(message.ts || 0) > Number(pending.sourceLastTs || 0));
  const prepared = await prepareAssistantDelivery({data:{deliveryPlan:pending.deliveryPlan, stateTransition:pending.stateTransition},requestId:pending.requestId,userText:'',proactiveType:pending.proactiveType||'scheduled'});
  if (prepared.type === 'silence') return false;
  // Commit the actual text first, then the cognitive transition, then render.
  // Restore the original server timestamp rather than the time the PWA was opened.
  for (const [index,segment] of (prepared.segments || []).entries()) {if(segment.message)segment.message.ts=Number(pending.createdAt || Date.now()) + index;}
  if (!persistPreparedDelivery(prepared)) return false;
  const memoryModule = await ensureMemoryReady();
  try {
    if (!sinceGeneration) {
      const schedule = await ensureRuntimeSchedule();
      await refreshRinEnv({refreshWeather:false});
      const freshInnerLife = await memoryModule?.prepareInnerLife?.(currentEnv || {},'',schedule?.innerLife||{},{history:toApiHistory(history)});
      await commitSuccessfulTurnState({memoryModule,requestId:pending.requestId,data:{stateTransition:pending.stateTransition,turnDecision:null},preparedInnerLife:freshInnerLife || pending.innerLife});
      void cloudMemorySync.sync();
    } else dbg('background message arrived after newer user interaction; stale stateTransition intentionally skipped');
    await deliverCommittedAssistantTurn(prepared);
    if (!initiationState.recordAttempt(pending.dateKey,pending.windowId)) dbg('background initiation attempt sync failed');
    if (!initiationState.recordSent(pending.dateKey)) dbg('background initiation counter sync failed');
    dbg(`background delivery committed: request=${pending.requestId}; id=${pending.id}`);
    return true;
  } catch(error) {dbg(`background delivery local commit failed: ${error?.message||error}`);return false;}
}
function refreshPushButtons() {
  const connected = Boolean(pushController?.isEnabled());
  const on = document.getElementById('pushEnable');
  const off = document.getElementById('pushDisable');
  const test = document.getElementById('pushTest');
  if (on) on.disabled=connected;
  if (off) off.disabled=!connected;
  if (test) test.disabled=!connected;
}
async function initPushController() {
  pushController = createPushController({
    getSnapshot:pushSnapshot,acceptDelivery:acceptBackgroundDelivery,
    log:value=>dbg(value),
    onStatus:message=>{const el=document.getElementById('pushStatus');if(el)el.textContent=message;refreshPushButtons();}
  });
  const enable=document.getElementById('pushEnable');
  const disable=document.getElementById('pushDisable');
  const testButton=document.getElementById('pushTest');
  enable?.addEventListener('click',()=>{void pushController.enableFromClick().finally(refreshPushButtons);});
  disable?.addEventListener('click',()=>{void pushController.disable().finally(refreshPushButtons);});
  testButton?.addEventListener('click',()=>{void pushController.test();});
  navigator.serviceWorker?.addEventListener?.('message',event=>{if(event.data?.type==='rin-push-delivery')void pushController.pull();});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void pushController.pull().then(()=>pushController.sync());});
  window.addEventListener('online',()=>{void pushController.pull().then(()=>pushController.sync());});
  await pushController.initialize();
  refreshPushButtons();
  setInterval(()=>{void pushController.pull().then(()=>pushController.sync());},65_000);
}
function queuePushSnapshotSync() {
  if (pushController?.isEnabled()) void pushController.sync();
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
function updateStickerProbabilityHint(){
  const hint = document.getElementById('stickerProbHint');
  if (!hint) return;
  const percent = Math.max(0, Math.min(100, Number(stickerProb?.value ?? lsStickerProb()) || 0));
  const intensity = percent === 0 ? 'стикеры отключены'
    : percent < 21 ? 'редкие жесты'
    : percent < 50 ? 'сдержанная выразительность'
    : percent < 80 ? 'более активная выразительность'
    : 'очень активная выразительность';
  hint.textContent = percent === 0
    ? '0% — в умном режиме стикеры отключены.'
    : `${percent}% — ${intensity}. Чем выше процент, тем охотнее Рин выбирает уместные стикеры; это не вероятность отправки и не обязанность.`;
}
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
  updateStickerProbabilityHint();
  stickerProb.oninput = () => {
    safeLocalSet(LS_STICKER_PROB, String(stickerProb.value));
    if (stickerProbVal) stickerProbVal.textContent = `${stickerProb.value}%`;
    updateStickerProbabilityHint();
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

/* — Архив: безопасный перенос Safari → установленное PWA — */
const backupExportButton = document.getElementById('backupExport');
const backupDownloadLink = document.getElementById('backupDownload');
let backupDownloadUrl = '';
const backupImportInput = document.getElementById('backupImport');
const backupStatus = document.getElementById('backupStatus');
let backupBusy = false;
function setBackupStatus(message) {
  if (backupStatus) backupStatus.textContent = message;
}
function setBackupBusy(value) {
  backupBusy = Boolean(value);
  if (backupExportButton) backupExportButton.disabled = backupBusy;
  if (backupImportInput) backupImportInput.disabled = backupBusy;
}
function requestBackupPassword({repeat=false}={}) {
  const dialog=document.getElementById('backupPasswordDialog');
  const form=document.getElementById('backupPasswordForm');
  const password=document.getElementById('backupPassword');
  const confirmation=document.getElementById('backupPasswordRepeat');
  const label=document.getElementById('backupPasswordRepeatLabel');
  const error=document.getElementById('backupPasswordError');
  const cancel=document.getElementById('backupPasswordCancel');
  if(!dialog?.showModal||!form||!password||!confirmation)return Promise.reject(new Error('BACKUP_DIALOG_UNAVAILABLE'));
  password.value='';confirmation.value='';error.textContent='';
  confirmation.hidden=!repeat;label.hidden=!repeat;
  confirmation.required=repeat;
  dialog.showModal();
  password.focus();
  return new Promise(resolve=>{
    let completed=false;
    const finish=value=>{
      if(completed)return;completed=true;
      form.removeEventListener('submit',submit);cancel.removeEventListener('click',abort);
      dialog.removeEventListener('close',closed);
      password.value='';confirmation.value='';
      if(dialog.open)dialog.close();
      resolve(value);
    };
    const abort=()=>finish(null);
    const closed=()=>finish(null);
    const submit=event=>{
      event.preventDefault();
      if(password.value.length<12){error.textContent='Используй не менее 12 символов.';return;}
      if(repeat && password.value!==confirmation.value){error.textContent='Пароли не совпадают.';return;}
      finish(password.value);
    };
    form.addEventListener('submit',submit);
    cancel.addEventListener('click',abort);
    dialog.addEventListener('close',closed);
  });
}
if (backupExportButton) {
  backupExportButton.addEventListener('click', async () => {
    if (backupBusy) return;
    setBackupBusy(true);
    try {
      const password=await requestBackupPassword({repeat:true});
      if(!password){setBackupStatus('Создание копии отменено.');return;}
      const backup = await createBackup({ storage: localStorage, wallpaperStore, password });
      const url = URL.createObjectURL(new Blob([backup.json], { type: 'application/json;charset=utf-8' }));
      if (backupDownloadUrl) URL.revokeObjectURL(backupDownloadUrl);
      backupDownloadUrl = url;
      if (backupDownloadLink) {
        backupDownloadLink.href = url;
        backupDownloadLink.download = backup.filename;
        backupDownloadLink.hidden = false;
      }
      // iOS may require a second, direct tap to save an asynchronously prepared file.
      setBackupStatus(`Копия подготовлена: ${backup.summary.messages} сообщений. Нажми «Скачать готовый файл» и сохрани его в «Файлы» на iPhone.`);
    } catch (error) {
      dbg(`backup export failed: ${error?.message || 'unknown'}`);
      setBackupStatus('Не удалось создать копию. Проверь доступность хранилища и повтори.');
    } finally { setBackupBusy(false); }
  });
}
if (backupImportInput) {
  backupImportInput.addEventListener('change', async () => {
    const file = backupImportInput.files?.[0];
    if (!file || backupBusy) return;
    setBackupBusy(true);
    try {
      if (file.size > MAX_BACKUP_IMPORT_BYTES) throw new Error('BACKUP_SIZE_INVALID');
      const raw=await file.text();
      let parsedHeader;try{parsedHeader=JSON.parse(raw);}catch{throw new Error('BACKUP_JSON_INVALID');}
      const password=parsedHeader?.version===1?undefined:await requestBackupPassword();
      if(parsedHeader?.version!==1 && !password){setBackupStatus('Восстановление отменено.');return;}
      const backup = await parseBackup(raw,{password});
      const summary = backup.summary;
      const date = new Date(backup.createdAt).toLocaleString('ru-RU');
      if (!confirm(`Восстановить резервную копию от ${date}?\n\nСообщений: ${summary.messages}\nЗаписей хранилища: ${summary.keys}\nОбои: ${summary.wallpaper ? 'есть' : 'нет'}\n\nТекущая переписка и память на ЭТОМ устройстве будут заменены. Сессия входа не меняется.`)) {
        setBackupStatus('Восстановление отменено. Данные не изменены.');
        return;
      }
      await restoreBackup(backup, { storage: localStorage, wallpaperStore });
      setBackupStatus('Данные восстановлены. Перезагрузка приложения…');
      window.location.reload();
    } catch (error) {
      dbg(`backup restore failed: ${error?.message || 'unknown'}`);
      setBackupStatus(error?.message === 'BACKUP_ROLLBACK_FAILED'
        ? 'Ошибка восстановления и отката. Не закрывай приложение; сохрани журнал и резервный файл.'
        : 'Не удалось восстановить данные. Файл повреждён, несовместим или недостаточно места.');
    } finally {
      backupImportInput.value = '';
      setBackupBusy(false);
    }
  });
}

const logoutButton=document.getElementById('securityLogout');
logoutButton?.addEventListener('click',async()=>{
  if(!confirm('Завершить сессию на этом устройстве? Переписка и память сохранятся.'))return;
  logoutButton.disabled=true;
  const status=document.getElementById('securityLogoutStatus');
  try{
    const response=await fetchWithTimeout('/api/login',{
      method:'POST',headers:authenticatedHeaders({'Content-Type':'application/json'}),
      body:JSON.stringify({action:'logout'}),cache:'no-store'
    },12000);
    if(!response.ok)throw new Error('LOGOUT_FAILED');
    setCsrfToken('');
    window.location.replace('/login.html');
  }catch{
    if(status)status.textContent='Не удалось завершить сеанс. Проверь подключение и повтори.';
    logoutButton.disabled=false;
  }
});

/* — Сброс — */
if (resetApp){
  resetApp.onclick=async()=>{
    if (!confirm('Удалить ЛОКАЛЬНУЮ историю, память, профиль, настройки и кэш на этом устройстве?\n\nЕсли подключён облачный архив, он НЕ будет удалён и переписка может снова появиться после перезапуска. PIN входа будет сохранён.')) return;
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
  // The 34px selection gutter can rewrap hundreds of message bubbles.
  // Preserve the last message when at the bottom, or the visible anchor row
  // when selecting from somewhere higher in the conversation.
  preserveChatScrollDuringLayout(chatEl, () => {
    chatEl.classList.toggle('is-selecting', messageSelectionActive);
    formEl.classList.toggle('is-selecting', messageSelectionActive);
    if (messageSelectionBar) messageSelectionBar.hidden = !messageSelectionActive;
    if (messageSelectionCount) messageSelectionCount.textContent = String(selectedMessageIds.size);
    if (copySelectedMessages) copySelectedMessages.disabled = selectedMessageIds.size === 0;

    for (const row of chatEl.querySelectorAll('.message-row[data-message-id]')) {
      row.classList.toggle('is-selected', selectedMessageIds.has(row.dataset.messageId));
    }
  });
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
    replyPreviewThumb.src = stickerDisplayUrl(snapshot.stickerSrc);
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
    thumb.src = stickerDisplayUrl(normalized.stickerSrc);
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
  if (message?.ts && Number.isFinite(Number(message.ts))) row.dataset.messageTs=String(message.ts);
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
  row.dataset.messageTs=String(ts);
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

// Use a new URL once to invalidate sticker copies cached by older PWA versions.
// Vercel serves WebP stickers with no-store after this update; future replacements
// therefore do not need another URL version. Stored sticker paths remain unchanged.
const STICKER_IMAGE_CACHE_REV = '2026-10-18-sticker-identity-refresh';
function stickerDisplayUrl(src) {
  const pathname = String(src || '');
  return /^\/stickers\/[a-z0-9_]+\.webp$/i.test(pathname)
    ? `${pathname}?v=${STICKER_IMAGE_CACHE_REV}`
    : pathname;
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
    row.dataset.messageTs=String(ts);
    decorateMessageRow(row, bubble, options.message || null, options);
    chatEl.appendChild(row);
    image.onload = () => { row.classList.remove('sticker-loading'); chatViewport.requestScrollToBottom({ force: options.forceScroll !== false }); resolve(row); };
    image.onerror = () => { dbg(`sticker asset failed: ${src}`); row.remove(); resolve(null); };
    image.src = stickerDisplayUrl(src);
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
  row.dataset.messageTs=String(ts);
  decorateMessageRow(row, wrap, options.message || null, options);
  chatEl.appendChild(row);
  chatViewport.requestScrollToBottom({ force: options.forceScroll !== false });

  const audio=new Audio(audioUrl || undefined);
  let audioReady=Boolean(audioUrl);
  let pendingArchive=null;
  const ownedUrls=new Set();
  if (audioUrl?.startsWith('blob:')) ownedUrls.add(audioUrl);
  async function ensureSource(){
    if (audioReady) return true;
    if (!options.message?.media?.archived) return false;
    if (pendingArchive) return pendingArchive;
    pendingArchive=(async()=>{
      try {
        const response=await fetchWithTimeout(`/api/archive-media?id=${encodeURIComponent(options.message.id)}`,{
          headers:authenticatedHeaders(),cache:'no-store'
        },20000);
        if (!response.ok) throw new Error(`audio_http_${response.status}`);
        const blobUrl=URL.createObjectURL(await response.blob());
        ownedUrls.add(blobUrl);
        audio.src=blobUrl;
        audioReady=true;
        return true;
      } catch(error) {
        dbg(`archive voice playback unavailable: ${error?.message || error}`);
        return false;
      } finally {
        pendingArchive=null;
      }
    })();
    return pendingArchive;
  }
  voicePlayer.register({
    audio, bubble:wrap, playButton:btn, wave, durationNode:dur,
    ensureSource,
    sourceId:options.message?.id || `${ts}:${text}`,
    releaseSource:()=>{ for(const url of ownedUrls) URL.revokeObjectURL(url); ownedUrls.clear(); }
  });
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
window.addEventListener('pagehide', event => {
  presence.dispose();
  // Safari can restore a page from BFCache: keep its blob: URLs valid.
  if (event.persisted) voicePlayer.close();
  else voicePlayer.dispose();
}, { once: true });



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
  if (['voice','text'].includes(message.kind) && message.media?.archived) {
    return addVoiceBubble(null,message.content,message.role,message.ts,{message,forceScroll:false});
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
  const originalLocalHistory=history.slice();
  const firstArchivePage=await cloudArchive.start();
  if (firstArchivePage) {
    // An older cache retained separate 140-text/40-sticker quotas. Fetch enough
    // consecutive cloud events to reconstruct the newest unified 180-event slice,
    // even if those missing text events had already been evicted locally.
    const recent=await collectRecentArchiveWindow(
      firstArchivePage, cursor=>cloudArchive.page(cursor), CHAT_HISTORY_CACHE_LIMIT
    );
    archiveCursor=recent.cursor;
    archiveHasMore=recent.hasMore;
    history=normalizeStoredHistory(mergeArchiveHistory(originalLocalHistory,recent.messages));
    saveChatHistory(history,localStorage);
    // Preserve every still-available local event for archival migration, even
    // if it did not fit into the refreshed on-device cache.
    cloudArchive.enqueue(originalLocalHistory);
    archivePrefetchedPages=recent.pages;
    if(recent.error) dbg(`recent archive hydration incomplete: ${recent.error}`);
    dbg(`cloud archive ready; recent=${recent.messages.length}; local=${history.length}; older=${archiveHasMore?'yes':'no'}`);
  }
  for (const message of history) await renderStoredMessage(message);
  refreshChatDayDividers();
  if(firstArchivePage){
    try { if(await discoverUnseenArchivedPage()) addArchiveLoadButton(); }
    catch(error){dbg(`archive paging probe deferred: ${error?.message || error}`);}
  }
  chatViewport.requestScrollToBottom({ force: true });
  await resumePendingAssistantDeliveries();
  resolveChatReady?.(true);
  resolveChatReady = null;
  await initPushController();
  if (!history.length) await greet();

  setInterval(refreshRinEnv, WEATHER_REFRESH_MS);
  if (initiationPolicy) {
    setInterval(() => { if (!pushController?.isEnabled()) void tryInitiateBySchedule(); }, initiationPolicy.pollIntervalMs);
    if (!pushController?.isEnabled()) void tryInitiateBySchedule();
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

// The voice is expressive only when Rin already has a clear emotional state.
// Never infer voice tags from user text and never insert the tags into chat history.
function ttsEmotionFromTurn(data = null) {
  const primary = data?.stateTransition?.emotionalState?.primary
    || data?.affectiveTurn?.emotionalState?.primary
    || data?.cognition?.emotion?.primary;
  const type = String(primary?.type || '').trim().toLowerCase();
  const intensity = Number(primary?.intensity);
  if (!type || !Number.isFinite(intensity) || intensity < 35) return null;
  return { type, intensity: Math.max(0, Math.min(100, intensity)) };
}

async function getTTSUrl(text, data = null, messageId = '') {
  try {
    const response = await fetchWithTimeout('/api/tts', {
      method: 'POST',
      headers: authenticatedHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ text, emotion: ttsEmotionFromTurn(data), messageId })
    }, 25_000);
    if (response.status === 401) return null;
    if (!response.ok) return null;
    const archived=response.headers.get('X-Rin-Audio-Archived')==='1';
    if (!archived && cloudArchive.isEnabled()) dbg(`voice generated but not archived: ${messageId}`);
    return {url:URL.createObjectURL(await response.blob()),archived};
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
  }, 52_000);
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

async function prepareAssistantDelivery({ data, requestId, userText = '', proactiveType = null } = {}) {
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
      proactiveType,
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
      const audioData = shouldVoiceFor(text) ? await getTTSUrl(text, data, segmentId) : null;
      const audioUrl=audioData?.url || null;
      const message = createChatMessage({
        id: segmentId,
        role: 'assistant',
        kind: 'text',
        status: 'pending',
        content: text,
        ...(audioData?.archived ? {media:{archived:true,type:'audio'}} : {}),
        requestId,
      proactiveType,
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
      proactiveType,
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
        requestId: segment.message.requestId, proactiveType: segment.message.proactiveType, turnId: segment.message.turnId, deliveryId: segment.message.deliveryId,
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

async function deliverCommittedAssistantTurn(prepared, { presenceTurn = null, scheduler = null, startIndex = 0, denseConversation = false, timing = null } = {}) {
  if (prepared?.type === 'silence') {
    const message = prepared.silenceMessage;
    if (message) updateMessage(history, message.id, { status: 'complete', errorCode: null });
    saveHistory(history);
    return 'silence';
  }

  let lastKind = null;
  let typingRow = null;
  let activeSegmentIsVoice = false;
  const setPresence = mode => {
    if (mode === 'typing') {
      if (activeSegmentIsVoice) presence.setRecording(presenceTurn);
      else presence.setTyping(presenceTurn);
      typingRow = setTypingRow(typingRow, 'typing');
    } else {
      presence.setOnline(presenceTurn);
      typingRow = setTypingRow(typingRow, 'online');
    }
  };

  for (let index = Math.max(0, startIndex); index < prepared.segments.length; index += 1) {
    const segment = prepared.segments[index];
    activeSegmentIsVoice = Boolean(segment?.audioUrl);
    if (index > startIndex && scheduler) {
      const between = await scheduler.waitBetweenSegments({ nextSegment: segment, denseConversation, onPresence: setPresence, shouldCancel: () => false });
      if (timing) {
        timing.segmentGapMs = Number(timing.segmentGapMs || 0) + Number(between?.gap || 0);
        timing.interComposeMs = Number(timing.interComposeMs || 0) + Number(between?.composeDelay || 0);
      }
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
    ? `; model=${data?.model?.mind || '-'}; reasoning=${metrics?.reasoningEffort || '-'}; mindCalls=${Number(metrics?.calls?.mind || 0)}; tokens=${Number(metrics?.inputTokens || 0)}/${Number(metrics?.outputTokens || 0)}/${Number(metrics?.totalTokens || 0)}; cached=${Number(metrics?.cachedInputTokens || 0)}; cacheWrite=${Number(metrics?.cacheWriteTokens || 0)}; reasoningTokens=${Number(metrics?.reasoningTokens || 0)}; semanticRetries=${Number(metrics?.semanticRetries || 0)}; transport=${Number(metrics?.calls?.transportAttempts || 0)}; modelFallback=${metrics?.modelFallback === true ? 'yes' : 'no'}; fallbackReason=${String(metrics?.fallbackReason || '-')}; validationHard=${Array.isArray(metrics?.validationHardReasons) ? metrics.validationHardReasons.join(',').slice(0, 140) || '-' : '-'}; recall=${String(metrics?.recallStatus || '-')}; recallMs=${Number(metrics?.recallMs || 0)}; recallCount=${Number(metrics?.recallCount || 0)}; recallSources=${Array.isArray(metrics?.recallSourceIds) ? metrics.recallSourceIds.slice(0, 3).map(id => String(id).slice(0, 120)).join(',') || '-' : '-'}; intentOp=${snapshot.operation}; intentKind=${snapshot.kind}; intentPhase=${snapshot.phase}; intentAge=${snapshot.age}; intentProgress=${snapshot.progress ?? '-'}; intentEngagement=${snapshot.engagement ?? '-'}; intentSaturation=${snapshot.saturation ?? '-'}; intentSimilarity=${snapshot.similarity}; sceneMotif=${snapshot.sceneMotif}; closeness=${snapshot.closenessMode}/${snapshot.closenessFocus}/${snapshot.closenessMove}; closenessTurns=${snapshot.closenessTurns}; closenessThreadChars=${snapshot.closenessThreadChars}; motifRepeat=${snapshot.motifRepeat}; motifPressure=${snapshot.motifPressure}; frameAlignment=${snapshot.frameAlignment}; handoff=${snapshot.proactiveHandoff}; literalCorrection=${snapshot.literalCorrection}; temporalGap=${snapshot.temporalGap ?? '-'}; rupture=${snapshot.relationalRuptureAffected || 'none'}:${snapshot.relationalRupturePhase || 'none'}; relPressure=${snapshot.relationalPressure || 'none'}; relBoundaries=${snapshot.relationalBoundaries || 0}; temporalResume=${snapshot.temporalResume ? 'yes' : 'no'}; temporalPeriodShift=${snapshot.temporalPeriodShift}; referenceAnchor=${String(snapshot.referenceAnchor || '-').replace(/\s+/g, ' ').slice(0, 80)}; lifeDomain=${snapshot.lifeDomain}; lifeMotif=${snapshot.lifeMotif}; lifeRepeat=${snapshot.lifeMotifAppearances}; lifeNovelty=${snapshot.lifeNoveltyPressure}; responseDepth=${snapshot.responseDepth}; depthLock=${snapshot.responseShortLock}; messageShape=${snapshot.messageShape}; shapeLock=${snapshot.responseSingleLock}; vocative=${String(snapshot.vocativeUsed || '-').replace(/\s+/g, ' ').slice(0, 48)}/${snapshot.vocativeUsedClass}; vocPressure=${snapshot.vocativePressure}; vocRecent=${snapshot.vocativeRecent6}/6; vocStreak=${snapshot.vocativeStreak}; vocGap=${snapshot.vocativeTurnsSinceAny}; vocCooldown=${snapshot.vocativeAnyGapRemaining}/${snapshot.vocativeClassGapRemaining}/${snapshot.vocativeExactGapRemaining}; vocLast=${String(snapshot.vocativeLastExact || '-').replace(/\s+/g, ' ').slice(0, 48)}/${snapshot.vocativeLastClass}; vocAvoid=${snapshot.vocativeStrongAvoid ? 'yes' : 'no'}; vocDirect=${snapshot.vocativeDirectRequest ? 'yes' : 'no'}; vocOverride=${snapshot.vocativeOverride ? 'yes' : 'no'}; commitment=${snapshot.commitmentAction}/${snapshot.commitmentConflict}:${String(snapshot.commitmentSubject || '-').replace(/\s+/g, ' ').slice(0, 72)}; commitmentRequested=${snapshot.commitmentRequestedAction}; commitmentHorizon=${snapshot.commitmentHorizon}; activeCommitments=${snapshot.activeCommitments}; callback=${snapshot.futureCallbackDetected ? 'new' : 'carry'}:${snapshot.futureCallbackCue}:${String(snapshot.futureCallbackSubject || '-').replace(/\s+/g, ' ').slice(0, 72)}; callbackActive=${snapshot.futureCallbackActive}; callbackResolved=${String(snapshot.futureCallbackResolvedId || '-').slice(-12)}; closure=${snapshot.sceneClosureStrong ? 'strong' : snapshot.sceneClosureSoft ? 'soft' : 'no'}:${snapshot.sceneClosureKind}; symbolCandidate=${snapshot.sharedSymbolCandidateId}@${snapshot.sharedSymbolCandidateActivation}${snapshot.sharedSymbolCandidateDirectRecall ? ':direct' : ''}; sharedSymbol=${snapshot.sharedSymbolId}/${snapshot.sharedSymbolExpression}; symbolActivation=${snapshot.sharedSymbolActivation}; symbolRepeat=${snapshot.sharedSymbolRepeat}; reciprocityPressure=${snapshot.reciprocityPressure}; reciprocityOpportunity=${snapshot.reciprocityOpportunity ? 'yes' : 'no'}; reciprocityAnchor=${String(snapshot.reciprocityAnchor || '-').replace(/\s+/g, ' ').slice(0, 80)}; shortTerm=${Number(metrics?.shortTermExchanges || 0)}ex/${Number(metrics?.shortTermSpeakerTurns || 0)}turns/${Number(metrics?.shortTermChars || 0)}c; exprPressure=${Number(metrics?.expressionPressure || 0)}; exprMoves=${String(metrics?.expressionRepeatedMoves || '-').slice(0, 120)}; sceneActions=${Number(metrics?.sceneActionCount || 0)}; cacheMode=${metrics?.cacheMode || '-'}; cachePrefixChars=${Number(metrics?.cachePrefixChars || 0)}; cacheKey=${String(metrics?.cacheKey || '-').slice(-12)}; serverMs=${Number(metrics?.serverMs || 0)}; modelMs=${Number(metrics?.modelMs || 0)}`
    : '';
  return `; stickerMode=${state?.mode || '-'}; stickerTarget=${state?.targetPercent ?? '-'}; stickerPropensity=${Number(state?.propensity ?? 0).toFixed(2)}; stickerAvail=${state?.available === true ? 'yes' : 'no'}:${state?.reason || '-'}; stickerHard=${state?.hardAvailable === true ? 'yes' : 'no'}:${state?.hardReason || '-'}; stickerBudget=${budget}; stickerTurns=${state?.semanticAssistantTurns ?? '-'}; stickerGap=${state?.turnsSinceSticker ?? '-'}/${state?.requiredGapTurns ?? '-'}; stickerCooldown=${state?.cooldownRemainingTurns ?? '-'}; stickerGapOk=${state?.gapSatisfied === true ? 'yes' : 'no'}; stickerLastTurn=${String(state?.lastStickerTurnKey || '-').slice(-18)}; stickerIntent=${stickerSegment?.stickerIntent || '-'}; stickerAsset=${stickerSegment?.sticker?.id || '-'}${tokenSummary}`;
}

function updatePresenceForDelivery(presenceTurn, mode, typingRowRef, recording = false) {
  if (mode === 'typing') {
    if (recording) presence.setRecording(presenceTurn);
    else presence.setTyping(presenceTurn);
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
  let firstSegmentIsVoice = false;
  const onPresence = mode => updatePresenceForDelivery(presenceTurn, mode, typingRowRef, firstSegmentIsVoice);

  try {
    await memoryJobRunner.drain();
    const memoryModule = await ensureMemoryReady();
    const schedule = await ensureRuntimeSchedule();
    await refreshRinEnv({ refreshWeather: environmentIsStale(schedule) });
    const preparedInnerLife = await memoryModule?.prepareInnerLife?.(currentEnv || {}, '', schedule?.innerLife || {}, {history:toApiHistory(history)});
    const [memory, activeProfile] = await Promise.all([
      buildMemoryPayload({ innerLifeOverride: preparedInnerLife }),
      ensureActiveProfile()
    ]);
    if (memory?.conversationState?.relationalIntegrity?.contactBoundary?.active === true) return false;
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
        weatherEvidence: verifiedWeatherEvidence(currentEnv),
        followThrough: selfFollowThrough(history, Date.now(), schedule?.timezone || 'Europe/Moscow'),
        sticker: stickerClientPreferences()
      }
    });
    let data = {};
    try { data = await response.json(); } catch {}
    if (response.status === 401) {
      setCsrfToken('');
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

    preparedDelivery = await prepareAssistantDelivery({ data, requestId, userText: '', proactiveType: type });
    firstSegmentIsVoice = Boolean(preparedDelivery?.segments?.[0]?.audioUrl);
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
    queuePushSnapshotSync();
  }
}

async function tryInitiateBySchedule() {
  if (pushController?.isEnabled()) return false;
  if (!canAutoInitiate({ history, greetingActive, activeRequests })) return false;
  const savedMemory = await buildMemoryPayload();
  if (savedMemory?.conversationState?.relationalIntegrity?.contactBoundary?.active === true) return false;
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
  const turnStartedAt = Date.now();
  let requestStartedAt = 0;
  let requestMs = 0;
  let waitResult = null;
  const deliveryTiming = { segmentGapMs: 0, interComposeMs: 0 };
  const typingRowRef = { current: null };
  const presenceTurn = presence.beginTurn({ userInitiated: true });
  const denseConversation = presence.getSnapshot().dense === true;
  const finishPresence = () => {
    if (presenceFinished) return;
    presenceFinished = true;
    if (typingRowRef.current?.isConnected) typingRowRef.current.remove();
    typingRowRef.current = null;
    presence.finishTurn(presenceTurn);
  };
  let firstSegmentIsVoice = false;
  const onPresence = mode => updatePresenceForDelivery(presenceTurn, mode, typingRowRef, firstSegmentIsVoice);

  try {
    await memoryJobRunner.drain();
    const schedule = await ensureRuntimeSchedule();
    const envIntent = environmentIntent(combinedUserText);
    const asksWeather = envIntent === 'weather' || weatherRefreshIntent(combinedUserText, history);
    await refreshRinEnv({ refreshWeather: asksWeather || environmentIsStale(schedule), strictWeather: asksWeather });
    const memoryModule = await ensureMemoryReady();
    const preparedInnerLife = await memoryModule?.prepareInnerLife?.(currentEnv || {}, combinedUserText, schedule?.innerLife || {}, {history:toApiHistory(history)});
    const [memory, activeProfile] = await Promise.all([
      buildMemoryPayload({ innerLifeOverride: preparedInnerLife }),
      ensureActiveProfile()
    ]);
    requestStartedAt = Date.now();
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
        weatherIntent: asksWeather,
        weatherEvidence: verifiedWeatherEvidence(currentEnv),
        followThrough: selfFollowThrough(history, Date.now(), schedule?.timezone || 'Europe/Moscow'),
        sticker: stickerClientPreferences()
      }
    });
    let data = {};
    try { data = await response.json(); } catch {}
    requestMs = requestStartedAt ? Math.max(0, Date.now() - requestStartedAt) : 0;
    if (response.status === 401) {
      setCsrfToken('');
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
      error.httpStatus = Number(response.status) || null;
      error.serverDiagnostics = data?.diagnostics && typeof data.diagnostics === 'object' ? data.diagnostics : null;
      error.requestMs = requestMs;
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
    firstSegmentIsVoice = Boolean(preparedDelivery?.segments?.[0]?.audioUrl);
    if (inputEpoch !== epochAtStart) {
      requeueInterruptedBatch(ids);
      dbg(`prepared turn superseded before human delay: request=${requestId}`);
      return;
    }

    waitResult = preparedDelivery.type === 'silence'
      ? await humanDeliveryScheduler.waitBeforeSilence({
          userChars: combinedUserText.length,
          messageCount: messages.length,
          denseConversation,
          onPresence,
          onRead: () => markUserBatchRead(ids),
          shouldCancel: () => inputEpoch !== epochAtStart
        })
      : await humanDeliveryScheduler.waitBeforeFirstSegment({
          userChars: combinedUserText.length,
          messageCount: messages.length,
          firstSegment: preparedDelivery.segments[0],
          denseConversation,
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
    void cloudMemorySync.sync();
    markUserBatchComplete(ids);

    const kind = await deliverCommittedAssistantTurn(preparedDelivery, {
      presenceTurn,
      scheduler: humanDeliveryScheduler,
      denseConversation,
      timing: deliveryTiming
    });
    saveHistory(history);
    finishPresence();

    const memoryText = assistantMemoryText(preparedDelivery);
    if (memoryText && shouldAnalyzeConversationForMemory(combinedUserText)) {
      enqueueMemoryJob({ id: requestId, userText: combinedUserText, assistantText: memoryText }, localStorage);
       void cloudMemorySync.sync();
      void memoryJobRunner.drain();
    }
    const totalVisibleMs = Math.max(0, Date.now() - turnStartedAt);
    dbg(`reply complete: request=${requestId}; kind=${kind}; segments=${preparedDelivery.segments?.length || 0}; build=${RIN_BUILD_VERSION}${stickerDebugSummary(data, committedState)}; requestMs=${requestMs}; readDelayMs=${Number(waitResult?.readDelay || 0)}; composeDelayMs=${Number(waitResult?.composeDelay || 0)}; segmentGapMs=${Number(deliveryTiming.segmentGapMs || 0)}; interComposeMs=${Number(deliveryTiming.interComposeMs || 0)}; totalVisibleMs=${totalVisibleMs}; denseTiming=${denseConversation ? 'yes' : 'no'}`);
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
    const failedRequestMs = Number(error?.requestMs || 0) || (requestStartedAt ? Math.max(0, Date.now() - requestStartedAt) : 0);
    if (failedRequestMs) diagnostics.push(`requestMs=${failedRequestMs}`);
    if (Number.isFinite(Number(error?.httpStatus))) diagnostics.push(`http=${Number(error.httpStatus)}`);
    if (Number.isFinite(Number(error?.serverDiagnostics?.serverMs))) diagnostics.push(`serverMs=${Number(error.serverDiagnostics.serverMs)}`);
    if (Number.isFinite(Number(error?.serverDiagnostics?.modelMs))) diagnostics.push(`modelMs=${Number(error.serverDiagnostics.modelMs)}`);
    if (error?.serverDiagnostics?.stage) diagnostics.push(`stage=${String(error.serverDiagnostics.stage).slice(0, 40)}`);
    if (error?.message && !['Upstream timeout'].includes(String(error.message))) diagnostics.push(`error=${String(error.message).replace(/\s+/g, ' ').slice(0, 100)}`);
    if (Number.isFinite(Number(error?.attempts))) diagnostics.push(`attempts=${Number(error.attempts)}`);
    if (error?.validationClass) diagnostics.push(`class=${String(error.validationClass).slice(0, 80)}`);
    if (Array.isArray(error?.warnings) && error.warnings.length) diagnostics.push(`warnings=${error.warnings.join('|')}`);
    if (Array.isArray(error?.hardWarnings) && error.hardWarnings.length) diagnostics.push(`hard=${error.hardWarnings.join('|')}`);
    if (Array.isArray(error?.rewriteableWarnings) && error.rewriteableWarnings.length) diagnostics.push(`rewriteable=${error.rewriteableWarnings.join('|')}`);
    dbg(`chat request failed: request=${requestId}; code=${code}${diagnostics.length ? `; ${diagnostics.join('; ')}` : ''}`);
  } finally {
    activeRequests = Math.max(0, activeRequests - 1);
    finishPresence();
    queuePushSnapshotSync();
  }
}


function environmentIsStale(schedule = null) {
  const maxAgeMinutes = Math.max(5, Number(schedule?.weatherGrounding?.refreshMaxAgeMinutes || 20));
  const weatherTs = Number(currentEnv?._weatherTs || 0);
  return !Number.isFinite(weatherTs) || weatherTs <= 0 || Date.now() - weatherTs >= maxAgeMinutes * 60000;
}

async function refreshRinEnv({ refreshWeather = true, strictWeather = false } = {}) {
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
      } else if (strictWeather) {
        // Explicit weather questions cannot silently reuse an older snapshot.
        env.weather = null;
        env._weatherTs = 0;
      }
    }
    currentEnv = env;
  } catch (error) {
    dbg('refresh env failed: ' + (error?.message || error));
  }
}
