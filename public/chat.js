/* chat.js — логика Рин WebApp */
const STORAGE_KEY = 'rin-history-v2';
const DAILY_INIT_KEY = 'rin-init-count';
const SETTINGS_KEY = 'rin-settings-v1';

const chatEl = document.getElementById('chat');
const formEl = document.getElementById('form');
const inputEl = document.getElementById('input');
const peerStatus = document.getElementById('peerStatus');

// === SETTINGS ===
const settingsToggle = document.getElementById('settingsToggle');
const settingsPanel = document.getElementById('settingsPanel');
const closeSettings = document.getElementById('closeSettings');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');

const themeBtn = document.getElementById('themeToggle');
const wallpaperFile = document.getElementById('wallpaperFile');
const wallpaperClear = document.getElementById('wallpaperClear');
const wallpaperOpacity = document.getElementById('wallpaperOpacity');

const stickerProb = document.getElementById('stickerProb');
const stickerProbVal = document.getElementById('stickerProbVal');
const stickerMode = document.getElementById('stickerMode');
const stickerSafe = document.getElementById('stickerSafe');

const voiceEnabled = document.getElementById('voiceEnabled');
const voiceRate = document.getElementById('voiceRate');
const voiceRateVal = document.getElementById('voiceRateVal');

const resetApp = document.getElementById('resetApp');

// === STATE ===
let persona = null, phrases = null, schedule = null, stickers = null;
let history = [];
let chainStickerCount = 0;
let settings = loadSettings();

// === HELPERS ===
function nowLocal(){ return new Date(); }
function fmtDateKey(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function fmtTime(d){ return d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}); }

function loadHistory(){ try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; } }
function saveHistory(h){ localStorage.setItem(STORAGE_KEY, JSON.stringify(h.slice(-80))); }

function loadSettings(){ try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { return {}; } }
function saveSettings(){ localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }

// === UI SETTINGS PANEL ===
settingsToggle.onclick = () => settingsPanel.classList.remove('hidden');
closeSettings.onclick = closeSettingsBtn.onclick = () => settingsPanel.classList.add('hidden');

themeBtn.onclick = () => {
  const isDark = document.documentElement.classList.contains('theme-dark');
  const next = isDark ? 'theme-light' : 'theme-dark';
  window.__rinSetTheme(next);
};

wallpaperFile.onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    settings.wallpaper = reader.result;
    saveSettings();
    applyWallpaper();
  };
  reader.readAsDataURL(file);
};
wallpaperClear.onclick = () => {
  delete settings.wallpaper;
  saveSettings();
  applyWallpaper();
};
wallpaperOpacity.oninput = () => {
  settings.wallpaperOpacity = wallpaperOpacity.value;
  saveSettings();
  applyWallpaper();
};

stickerProb.oninput = () => {
  stickerProbVal.textContent = stickerProb.value+'%';
  settings.stickerProb = parseInt(stickerProb.value,10);
  saveSettings();
};
stickerMode.onchange = () => { settings.stickerMode = stickerMode.value; saveSettings(); };
stickerSafe.onchange = () => { settings.stickerSafe = stickerSafe.checked; saveSettings(); };

voiceEnabled.onchange = () => { settings.voiceEnabled = voiceEnabled.checked; saveSettings(); };
voiceRate.oninput = () => {
  voiceRateVal.textContent = voiceRate.value+'%';
  settings.voiceRate = parseInt(voiceRate.value,10);
  saveSettings();
};

resetApp.onclick = () => {
  if (confirm('Сбросить все данные и настройки?')) {
    localStorage.clear();
    location.reload();
  }
};

// === APPLY SETTINGS ===
function applyWallpaper(){
  if (settings.wallpaper){
    chatEl.style.backgroundImage = `url(${settings.wallpaper})`;
    chatEl.style.backgroundSize = 'cover';
    chatEl.style.backgroundPosition = 'center';
    chatEl.style.backgroundRepeat = 'no-repeat';
    chatEl.style.opacity = (settings.wallpaperOpacity||90)/100;
  } else {
    chatEl.style.backgroundImage = '';
    chatEl.style.opacity = 1;
  }
}
function applySettingsUI(){
  stickerProb.value = settings.stickerProb ?? 30;
  stickerProbVal.textContent = (settings.stickerProb ?? 30)+'%';
  stickerMode.value = settings.stickerMode || 'smart';
  stickerSafe.checked = settings.stickerSafe || false;
  voiceEnabled.checked = settings.voiceEnabled || false;
  voiceRate.value = settings.voiceRate ?? 20;
  voiceRateVal.textContent = (settings.voiceRate ?? 20)+'%';
  wallpaperOpacity.value = settings.wallpaperOpacity ?? 90;
  applyWallpaper();
}
applySettingsUI();

// === BUBBLES ===
function addBubble(text, who='assistant', ts = Date.now()){
  const dateObj = new Date(ts);
  const row = document.createElement('div');
  row.className = 'row ' + (who === 'user' ? 'me' : 'her');

  if (who !== 'user') {
    const ava = document.createElement('img');
    ava.className = 'avatar small';
    ava.src = '/avatar.jpg';
    ava.alt = 'Рин';
    row.appendChild(ava);
  } else {
    const spacer = document.createElement('div');
    spacer.className = 'avatar small spacer';
    row.appendChild(spacer);
  }

  const wrap = document.createElement('div');
  wrap.className = 'bubble ' + (who === 'user' ? 'me' : 'her');

  const msg = document.createElement('span');
  msg.textContent = text.replace(/\?{2,}/g,'?'); // фикс "???" стиля

  const timeEl = document.createElement('span');
  timeEl.className = 'bubble-time';
  timeEl.textContent = fmtTime(dateObj);

  wrap.appendChild(msg);
  wrap.appendChild(timeEl);
  row.appendChild(wrap);
  chatEl.appendChild(row);
  chatEl.scrollTop = chatEl.scrollHeight;

  // озвучка (короткие ответы)
  if (who==='assistant' && settings.voiceEnabled && Math.random() < (settings.voiceRate||20)/100) {
    speakTTS(text);
  }
}

function addStickerBubble(src, who='assistant'){
  const row = document.createElement('div');
  row.className = 'row ' + (who==='user' ? 'me' : 'her');
  const timeStr = fmtTime(new Date());
  if (who==='user'){
    row.innerHTML = `<div class="bubble me sticker-only"><img class="sticker" src="${src}" alt="sticker"/><span class="bubble-time">${timeStr}</span></div>`;
  } else {
    row.innerHTML = `<img class="avatar small" src="/avatar.jpg" alt="Рин"/><div class="bubble her sticker-only"><img class="sticker" src="${src}" alt="sticker"/><span class="bubble-time">${timeStr}</span></div>`;
  }
  chatEl.appendChild(row);
  chatEl.scrollTop = chatEl.scrollHeight;
}

// === TTS (OpenAI) ===
async function speakTTS(text){
  try{
    const res = await fetch("/api/tts", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ text })
    });
    if(!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.play();
  }catch(e){ console.warn("TTS error",e); }
}

// === INIT ===
(async function init(){
  try {
    const [p1,p2,p3,p4] = await Promise.all([
      fetch('/data/rin_persona.json').then(r=>r.json()),
      fetch('/data/rin_phrases.json').then(r=>r.json()),
      fetch('/data/rin_schedule.json').then(r=>r.json()),
      fetch('/data/rin_stickers.json').then(r=>r.json())
    ]);
    persona=p1; phrases=p2; schedule=p3; stickers=p4;
  } catch(e){ console.warn("Не удалось загрузить JSON",e); }

  history=loadHistory();
  if(history.length){
    for(const m of history){
      addBubble(m.content, m.role==='user'?'user':'assistant', m.ts);
    }
  } else {
    const greeting="Привет, это я — Рин 🌸 рада снова тебя видеть.";
    addBubble(greeting,'assistant');
    history.push({ role:'assistant', content:greeting, ts:Date.now() });
    saveHistory(history);
  }
})();
