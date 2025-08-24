/* public/chat.js — фронт чата Рин, согласованный с твоим index.html (профиль из persona_ui/rin_memory) */

const STORAGE_KEY    = 'rin-history-v2';
const DAILY_INIT_KEY = 'rin-init-count';
const THEME_KEY      = 'rin-theme';

/* настройки, что храним в LS */
const LS_STICKER_PROB   = 'rin-sticker-prob';    // 0..50 (%)
const LS_STICKER_MODE   = 'rin-sticker-mode';    // smart | keywords | off
const LS_STICKER_SAFE   = 'rin-sticker-safe';    // '1' | '0'
const LS_SPEAK_ENABLED  = 'rin-speak-enabled';   // '1' | '0'
const LS_SPEAK_RATE     = 'rin-speak-rate';      // 0..50 (%)
const LS_WP_DATA        = 'rin-wallpaper-data';  // dataURL
const LS_WP_OPACITY     = 'rin-wallpaper-opacity'; // 0..100

/* DOM */
const chatEl        = document.getElementById('chat');
const formEl        = document.getElementById('form');
const inputEl       = document.getElementById('input');
const peerStatus    = document.getElementById('peerStatus');

const settingsToggle= document.getElementById('settingsToggle');
const settingsPanel = document.getElementById('settingsPanel');
const closeSettings = document.getElementById('closeSettings');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');

const themeToggle   = document.getElementById('themeToggle');

/* Обои */
const wpFile        = document.getElementById('wallpaperFile');
const wpClear       = document.getElementById('wallpaperClear');
const wpOpacity     = document.getElementById('wallpaperOpacity');

/* Стикеры */
const stickerProb   = document.getElementById('stickerProb');
const stickerProbVal= document.getElementById('stickerProbVal');
const stickerMode   = document.getElementById('stickerMode');
const stickerSafe   = document.getElementById('stickerSafe');

/* Голос */
const voiceEnabled  = document.getElementById('voiceEnabled');
const voiceRate     = document.getElementById('voiceRate');
const voiceRateVal  = document.getElementById('voiceRateVal');

/* === Окружение Рин (время/сезон/погода) === */
const RIN_TZ     = 'Asia/Tokyo';
const RIN_CITY   = 'Kanazawa';
const RIN_COUNTRY= 'JP';
const WEATHER_REFRESH_MS = 20 * 60 * 1000; // раз в 20 минут

function nowInTz(tz){
  try { return new Date(new Date().toLocaleString('en-US', { timeZone: tz })); }
  catch { return new Date(); }
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
  const month= env?.month || '';
  const season = env?.season || '';
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
  const add = pod==='ночь' ? ' Сейчас поздно и тихо.' :
              pod==='вечер'? ' Вечера тут обычно мягкие и спокойные.' :
              pod==='утро' ? ' Утро часто выходит ясным.' : '';
  return `Сейчас в ${city} ${season || month}.${add ? (' '+add) : ''}`.trim();
}

let currentEnv = null;
async function refreshRinEnv(){
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
  return env;
}

/* Данные */
const resetApp      = document.getElementById('resetApp');

/* state */
let profile = null;         // новый профиль из persona_ui / rin_memory
let stickers = null;

let history=[];
let chainStickerCount=0;

/* utils */
const nowLocal=()=>new Date();
const fmtDateKey=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const fmtTime=d=>d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});

function loadHistory(){ try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');}catch{return[];} }
function saveHistory(h){ localStorage.setItem(STORAGE_KEY, JSON.stringify(h.slice(-60))); }

function getInitCountFor(k){ const m=JSON.parse(localStorage.getItem(DAILY_INIT_KEY)||'{}'); return m[k]||0; }
function bumpInitCount(k){ const m=JSON.parse(localStorage.getItem(DAILY_INIT_KEY)||'{}'); m[k]=(m[k]||0)+1; localStorage.setItem(DAILY_INIT_KEY, JSON.stringify(m)); }

/* === UI: SETTINGS === */
function openSettings(){ settingsPanel.classList.remove('hidden'); }
function closeSettingsPanel(){ settingsPanel.classList.add('hidden'); }

if (settingsToggle){ settingsToggle.onclick=openSettings; }
if (closeSettings){ closeSettings.onclick=closeSettingsPanel; }
if (closeSettingsBtn){ closeSettingsBtn.onclick=closeSettingsPanel; }

/* — Тема — */
if (themeToggle){
  themeToggle.onclick=()=>{
    const isDark=document.documentElement.classList.contains('theme-dark');
    const next=isDark?'theme-light':'theme-dark';
    document.documentElement.classList.remove('theme-dark','theme-light');
    document.documentElement.classList.add(next);
    localStorage.setItem(THEME_KEY,next);
  };
}

/* — Обои — */
function applyWallpaper(){
  const data = localStorage.getItem(LS_WP_DATA) || '';
  const op   = +(localStorage.getItem(LS_WP_OPACITY) || '90') / 100;

  document.documentElement.style.setProperty('--wallpaper-url', data ? `url("${data}")` : 'none');
  document.documentElement.style.setProperty('--wallpaper-opacity', String(op));

  if (wpOpacity) wpOpacity.value = Math.round(op * 100);
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

/* — Стикеры: вероятность/режимы — */
function lsStickerProb(){ return +(localStorage.getItem(LS_STICKER_PROB) || '30'); } // %
function lsStickerMode(){ return localStorage.getItem(LS_STICKER_MODE) || 'smart'; }
function lsStickerSafe(){ return localStorage.getItem(LS_STICKER_SAFE)==='1'; }

if (stickerProb){
  stickerProb.value = String(lsStickerProb());
  if (stickerProbVal) stickerProbVal.textContent = `${stickerProb.value}%`;
  stickerProb.oninput = () => {
    localStorage.setItem(LS_STICKER_PROB, String(stickerProb.value));
    if (stickerProbVal) stickerProbVal.textContent = `${stickerProb.value}%`;
  };
}
if (stickerMode){
  stickerMode.value = lsStickerMode();
  stickerMode.onchange = ()=>localStorage.setItem(LS_STICKER_MODE, stickerMode.value);
}
if (stickerSafe){
  stickerSafe.checked = lsStickerSafe();
  stickerSafe.onchange = ()=>localStorage.setItem(LS_STICKER_SAFE, stickerSafe.checked?'1':'0');
}

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
    [LS_STICKER_PROB,LS_STICKER_MODE,LS_STICKER_SAFE,LS_SPEAK_ENABLED,LS_SPEAK_RATE,LS_WP_DATA,LS_WP_OPACITY].forEach(k=>localStorage.removeItem(k));
    chatEl.innerHTML='';
    history=[];
    applyWallpaper();
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

/* === Стикеры: утилиты === */
function weightedPick(arr){ const sum=arr.reduce((s,a)=>s+(a.weight||1),0); let r=Math.random()*sum; for(const a of arr){ r-= (a.weight||1); if(r<=0) return a; } return arr[0]; }
function hourMood(){ const h=new Date().getHours(); if(h>=6&&h<12)return'morning'; if(h>=12&&h<18)return'day'; if(h>=18&&h<23)return'evening'; return'night'; }

function shouldShowSticker(userText, replyText){
  if (lsStickerMode()==='off') return false;
  const base = (lsStickerProb()/100);
  const KEY_FLIRT=/(обним|поцел|скуч|нрав|хочу тебя|рядом|люблю|неж|kiss)/i;
  if (userText && KEY_FLIRT.test(userText)) return true;
  return Math.random()<base;
}

/* — Подписи к стикерам (анти-повтор) — */
let _captionBuf = [];
function _pickNoRepeat(options, buf = _captionBuf, maxBuf = 6){
  if (!Array.isArray(options) || !options.length) return '';
  const pool = options.filter(x => !buf.includes(x));
  const base = (pool.length ? pool : options);
  const pick = base[Math.floor(Math.random() * base.length)];
  buf.push(pick); if (buf.length > maxBuf) buf.shift();
  return pick;
}
function buildStickerCaption(st, { userText='', replyText='' } = {}){
  const t  = `${userText} ${replyText}`.toLowerCase();
  const m  = (st.moods || []);
  const kw = (st.keywords || []);
  const has = re => re.test(t);
  const kwHas = re => kw.some(k => re.test(String(k)));

  const tpl = {
    romantic_kiss: [
      'Отправляю тебе поцелуй — бережно и по-настоящему. 💋',
      'Вот мой маленький поцелуй — грейся. 💋',
      'Слова лишние — просто поцелуй. 💋'
    ],
    romantic_hug: [
      'Иди сюда — вот моё тёплое объятие. 🤍',
      'Обнимаю крепко-нежно — держи. 🤍',
      'Хочется прижаться и не отпускать. 🤍'
    ],
    romantic_soft: [
      'Немного нежности между строк. ✨',
      'Чуть-чуть тепла — держи. ✨',
      'Тихое, тёплое чувство — делюсь. ✨'
    ],
    playful: [
      'Чуточку игривости. 😊',
      'Пусть будет немного шалости. 😊',
      'Немного озорства — для улыбки. 😊'
    ],
    cat: [
      'Кототерапия на сегодня. 🐾',
      'Отправляю усатую поддержку. 🐾',
      'Пусть этот котик скажет за меня больше. 🐾'
    ],
    comfort: [
      'Я рядом — тихо, бережно, без лишних слов. 🌙',
      'Держу тебя мысленно за руку. 🌙',
      'Пусть станет чуток спокойнее. 🌙'
    ],
    congrats: [
      'Горжусь тобой — это здорово! 🎉',
      'Маленькая победа заслуживает стикера. 🎉',
      'Пусть удача задержится подольше. 🎉'
    ],
    morning: [
      'На удачное утро — тёплый знак. ☀️',
      'Пусть день начнётся мягко. ☀️',
      'Доброе утро между строк. ☀️'
    ],
    night: [
      'На спокойную ночь — немного нежности. 🌙',
      'Пусть сны будут добрыми. 🌙',
      'Тишины и тепла на вечер. 🌙'
    ],
    default_: [
      'Вот маленький знак внимания. ✨',
      'Немного тепла — просто так. ✨',
      'Пусть это вызовет улыбку. ✨'
    ]
  };

  if (has(/поцел|kiss/i) || kwHas(/поцел|kiss/i)) return _pickNoRepeat(tpl.romantic_kiss);
  if (has(/обним|обними|обнимаш/i) || kwHas(/обним/i)) return _pickNoRepeat(tpl.romantic_hug);
  if (has(/кот(ик)?|cat/i) || kwHas(/кот|cat/i)) return _pickNoRepeat(tpl.cat);
  if (has(/поздрав|ура|молодец|получилось|сделал|сделала|успех/i)) return _pickNoRepeat(tpl.congrats);
  if (has(/груст|тяжел|тяжёл|тревог|беспок|устал|устала|сложно|болит/i)) return _pickNoRepeat(tpl.comfort);
  if (m.includes('playful') || has(/улыб|шут|игрив|хихи|ха-ха/i)) return _pickNoRepeat(tpl.playful);
  if (m.some(x=>['romantic','tender','shy','cosy','playful'].includes(x))) return _pickNoRepeat(tpl.romantic_soft);

  const h = new Date().getHours();
  if (h>=6 && h<11) return _pickNoRepeat(tpl.morning);
  if (h>=22 || h<2) return _pickNoRepeat(tpl.night);

  return _pickNoRepeat(tpl.default_);
}

/* — умный выбор стикера: блокируем романтику без повода — */
function pickStickerSmart(replyText, windowPool, userText){
  if (!stickers || stickers._schema!=='v2') return null;
  const list = stickers.stickers||[];
  if (!list.length) return null;

  const DISCOURAGE=/(тяжел|тяжёл|груст|больно|тревог|сложно|проблем|помоги|совет|план|границ)/i;
  const KEY_FLIRT=/(обним|поцел|скуч|нрав|хочу тебя|рядом|люблю|неж|kiss)/i;

  if (lsStickerSafe() && (userText && DISCOURAGE.test(userText))) return null;

  const textPool = (userText?userText+' ':'') + (replyText||'');
  const romanticContext = KEY_FLIRT.test(textPool);

  if (lsStickerMode()==='keywords'){
    const hit = list.filter(s=> (s.keywords||[]).some(k=>new RegExp(k,'i').test(textPool)));
    const safeHit = hit.filter(s=>{
      const isRom = (s.moods||[]).some(m=>['romantic','tender','shy','cosy','playful'].includes(m));
      return romanticContext || !isRom;
    });
    return (safeHit.length?weightedPick(safeHit):null);
  }

  if (romanticContext){
    const hit = list.filter(s=> (s.keywords||[]).some(k=>new RegExp(k,'i').test(textPool)));
    if (hit.length) return weightedPick(hit);
    const romantic=list.filter(s=> (s.moods||[]).some(m=>['tender','romantic','shy','cosy','playful'].includes(m)));
    if (romantic.length) return weightedPick(romantic);
  }

  if (replyText){
    const byKw=list.filter(s=>(s.keywords||[]).some(k=>new RegExp(k,'i').test(replyText)));
    const safe = byKw.filter(s=>{
      const isRom = (s.moods||[]).some(m=>['romantic','tender','shy','cosy','playful'].includes(m));
      return romanticContext || !isRom;
    });
    if (safe.length) return weightedPick(safe);
  }

  const tMood = windowPool || hourMood();
  const def = stickers.defaults?.byTime?.[tMood];
  if (def && Math.random() < (def.p ?? 0.1)) {
    const pool = list.filter(s => (s.moods||[]).some(m => def.moods.includes(m)));
    const safe = pool.filter(s=>{
      const isRom = (s.moods||[]).some(m=>['romantic','tender','shy','cosy','playful'].includes(m));
      return romanticContext || !isRom;
    });
    if (safe.length) return weightedPick(safe);
  }

  return null;
}

function addStickerBubble(src, who='assistant', caption=''){
  if (caption && who !== 'user') {
    addBubble(caption, 'assistant');
  } else if (caption && who === 'user') {
    addBubble(caption, 'user');
  }

  const row = document.createElement('div');
  row.className = 'row ' + (who==='user' ? 'me' : 'her');
  const timeStr = fmtTime(new Date());

  if (who === 'user') {
    row.innerHTML = `<div class="bubble me sticker-only">
        <img class="sticker" src="${src}" alt="стикер"/>
        <span class="bubble-time">${timeStr}</span>
      </div>`;
  } else {
    row.innerHTML = `<img class="avatar small" src="/avatar.jpg" alt="Рин"/>
      <div class="bubble her sticker-only">
        <img class="sticker" src="${src}" alt="стикер"/>
        <span class="bubble-time">${timeStr}</span>
      </div>`;
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
  };

  btn.onclick=()=>{
    if (audio.paused){
      audio.play().then(()=>{
        btn.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
      }).catch(()=>{});
    } else {
      audio.pause();
      btn.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';
    }
  };

  audio.onended=()=>{
    btn.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';
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
    // 1) профиль персонажа доступен из persona_ui bootstrap:
    profile = window.RIN_PROFILE || null;

    // 2) стикеры — как и раньше из JSON
    stickers = await fetch('/data/rin_stickers.json?v=5').then(r=>r.json()).catch(()=>null);

    // 3) окружение
    await refreshRinEnv();
    setInterval(refreshRinEnv, WEATHER_REFRESH_MS);
  }catch(e){ console.warn('init error',e); }

  // подхватываем обновления профиля из редактора
  window.addEventListener('rin:profile-updated', (ev)=>{
    profile = ev.detail || profile;
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

  let greeting = null;
  const starters = Array.isArray(profile?.starters) ? profile.starters : [];

  if (starters.length){
    greeting = starters[Math.floor(Math.random()*starters.length)];
  }
  if (!greeting){
    // очень короткий аккуратный фолбэк
    const pod = currentEnv?.partOfDay || 'сейчас';
    greeting = (pod==='утро') ? 'Доброе утро. Как ты?' :
               (pod==='вечер') ? 'Добрый вечер. Как твой день?' :
               (pod==='ночь') ? 'Тихая ночь тут… ты как?' :
               'Привет. Как ты?';
  }

  addBubble(greeting,'assistant');

  const st = pickStickerSmart(greeting, pool, '');
  if (st && shouldShowSticker('', greeting)){
    const cap = buildStickerCaption(st, { replyText: greeting });
    addStickerBubble(st.src, 'assistant', cap);
  }

  history.push({ role:'assistant', content:greeting, ts:Date.now() });
  saveHistory(history);
}

function inWindow(local,from,to){
  const [fh,fm]=from.split(':').map(Number);
  const [th,tm]=to.split(':').map(Number);
  const min=local.getHours()*60+local.getMinutes();
  const a=fh*60+fm, b=th*60+tm;
  return min>=a && min<=b;
}
function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

/* === Voice-only шанс === */
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

/* === Автоинициации (используем profile.initiation) === */
async function tryInitiateBySchedule(){
  if (!profile) return;

  const d=nowLocal();
  const dateKey=fmtDateKey(d);
  const lastKey=Object.keys(JSON.parse(localStorage.getItem(DAILY_INIT_KEY)||'{}')).pop();
  if (lastKey && lastKey!==dateKey){
    localStorage.setItem(DAILY_INIT_KEY, JSON.stringify({}));
    chainStickerCount=0;
  }

  const maxDaily = Math.max(0, Number(profile?.initiation?.max_per_day ?? 2));
  if (getInitCountFor(dateKey) >= maxDaily) return;

  const windows = Array.isArray(profile?.initiation?.windows) ? profile.initiation.windows : [];
  const win = windows.find(w => inWindow(d, w.from, w.to) && Math.random() < (w.probability ?? 0.5));
  if (!win) return;

  const last=history[history.length-1];
  if (last && last.role==='assistant' && d - new Date(last.ts||Date.now()) < 15*60*1000) return;

  // текст для инициативы — берём случайную фразу из starters
  let text = null;
  const starters = Array.isArray(profile?.starters) ? profile.starters : [];
  if (starters.length) text = pick(starters);

  // если в профиле нет стартовых фраз — тихий выход
  if (!text) return;

  peerStatus.textContent='печатает…';
  const trow=addTyping();
  setTimeout(async ()=>{
    trow.remove(); peerStatus.textContent='онлайн';

    let voiced=false;
    if (shouldVoiceFor(text)){
      const url = await getTTSUrl(text);
      if (url){
        addVoiceBubble(url, text, 'assistant');
        voiced=true;
      }
    }
    if (!voiced){
      addBubble(text,'assistant');
    }

    const st=pickStickerSmart(text, win.pool || null, '');
    if (st && shouldShowSticker('',text)){
      const cap = buildStickerCaption(st,{ replyText:text });
      addStickerBubble(st.src,'assistant', cap);
    }
    history.push({role:'assistant',content:text,ts:Date.now()});
    saveHistory(history); bumpInitCount(dateKey);
  }, 900+Math.random()*900);
}

/* === Отправка (локальные «маленькие» ответы + запрос к модели) === */
formEl.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const text = (inputEl.value || '').trim();
  if (!text) return;

  addBubble(text,'user');
  history.push({role:'user',content:text,ts:Date.now()});
  saveHistory(history);
  inputEl.value=''; inputEl.focus();

  const t = text.toLowerCase();

  // A) smalltalk (мягкий, без «рассказов из прошлого»)
  const RE_SMALLTALK = /(как (дела|ты)|как день|как прош(е|ё)л день|что (делаешь|сейчас)|чем занята|чем занимаешься|ты где|как настроени|как самочувств)/i;

  // B) погода
  const RE_WEATHER   = /(какая (у тебя )?погода|что там с погодой|на улице (у тебя )?(холодно|тепло|жарко|дождь|снег)|как (у тебя )?на улице)/i;

  function composeTimeMood(env){
    if (!env) return '';
    const parts = [];
    if (env.partOfDay && env.rinHuman){
      parts.push(`${env.partOfDay} у меня (${env.rinHuman} по Канадзаве)`);
    }
    if (env.month && env.season){
      parts.push(`${env.month}, ${env.season}`);
    }
    return parts.join('; ');
  }
  function composeWeatherMood(env){
    const w = env?.weather;
    if (!w) return '';
    const bits = [];
    if (typeof w.temp === 'number') bits.push(`${w.temp}°C`);
    if (w.desc) bits.push(w.desc);
    return bits.length ? `Сейчас в Канадзаве ${bits.join(', ')}.` : '';
  }
  function pickSmallTalkPhrase(){
    const starters = Array.isArray(profile?.starters) ? profile.starters : [];
    if (!starters.length) return '';
    return starters[Math.floor(Math.random()*starters.length)];
  }

  // 1) smalltalk
  if (RE_SMALLTALK.test(t)) {
    const env = currentEnv || null;
    const timeMood = composeTimeMood(env);
    const weatherMood = (Math.random()<0.7) ? composeWeatherMood(env) : '';
    const filler = pickSmallTalkPhrase();

    const pieces = [];
    if (timeMood) pieces.push(timeMood + '.');
    if (weatherMood) pieces.push(weatherMood);
    if (filler) pieces.push(filler);

    // женский род для Рин, обращение к пользователю — мужской
    const tail = Math.random()<0.5
      ? 'Рада, что ты написал — с тобой момент теплее.'
      : 'Рядом с тобой как-то спокойнее.';

    const reply = [pieces.join(' '), tail].filter(Boolean).join(' ');

    let voiced=false;
    if (shouldVoiceFor(reply)){
      const url=await getTTSUrl(reply);
      if (url){ addVoiceBubble(url, reply, 'assistant'); voiced=true; }
    }
    if (!voiced) addBubble(reply,'assistant');

    const st = pickStickerSmart(reply, null, text);
    if (st && shouldShowSticker(text, reply)){
      const cap = buildStickerCaption(st,{ userText:text, replyText:reply });
      addStickerBubble(st.src,'assistant', cap);
    }

    history.push({role:'assistant',content:reply,ts:Date.now()});
    saveHistory(history);
    return;
  }

  // 2) погода
  if (RE_WEATHER.test(t)) {
    const env = currentEnv || null;
    const head = 'Смотрю в окно и на термометр…';
    const w = composeWeatherMood(env) || 'Пока без сюрпризов: спокойно.';
    const extra = pickSmallTalkPhrase();
    const reply = [head, w, extra].filter(Boolean).join(' ');

    let voiced=false;
    if (shouldVoiceFor(reply)){
      const url=await getTTSUrl(reply);
      if (url){ addVoiceBubble(url, reply, 'assistant'); voiced=true; }
    }
    if (!voiced) addBubble(reply,'assistant');

    const st = pickStickerSmart(reply, null, text);
    if (st && shouldShowSticker(text, reply)){
      const cap = buildStickerCaption(st,{ userText:text, replyText:reply });
      addStickerBubble(st.src,'assistant', cap);
    }

    history.push({role:'assistant',content:reply,ts:Date.now()});
    saveHistory(history);
    return;
  }

  // 3) обычный путь → к модели (env+профиль передаются на сервер)
  peerStatus.textContent='печатает…';
  const typingRow=addTyping();

  try{
    const res=await fetch('/api/chat',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        history,
        pin: localStorage.getItem('rin-pin'),
        env: currentEnv || undefined,
        profile: profile || undefined,   // <— важное добавление
        client: {
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
          sentAt: Date.now()
        }
      })
    });
    const data=await res.json();
    typingRow.remove();

    if (!res.ok) throw new Error(data?.detail || data?.error || ('HTTP '+res.status));

    if (data.long){
      const prev=peerStatus.textContent; peerStatus.textContent='📖 рассказывает…';
      setTimeout(()=>{ peerStatus.textContent=prev||'онлайн'; }, 2500);
    } else peerStatus.textContent='онлайн';

    let voiced=false;
    if (shouldVoiceFor(data.reply)){
      const url=await getTTSUrl(data.reply);
      if (url){ addVoiceBubble(url, data.reply, 'assistant'); voiced=true; }
    }
    if (!voiced){
      addBubble(data.reply,'assistant');
    }

    const st=pickStickerSmart(data.reply,null,text);
    if (st && shouldShowSticker(text,data.reply)){
      const cap = buildStickerCaption(st,{ userText:text, replyText:data.reply });
      addStickerBubble(st.src,'assistant', cap);
    }

    history.push({role:'assistant',content:data.reply,ts:Date.now()});
    saveHistory(history);
  }catch(err){
    typingRow.remove(); peerStatus.textContent='онлайн';
    addBubble('Ой… связь шалит. '+(err?.message||''),'assistant');
  }
});

/* совместимость: старый maybeSpeak больше не используется */
async function maybeSpeak(_text){ return false; }
