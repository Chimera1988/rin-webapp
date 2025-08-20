/* public/chat.js — фронт чата Рин, согласованный с твоим index.html */

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

/* Данные */
const resetApp      = document.getElementById('resetApp');

/* state */
let persona=null, phrases=null, schedule=null, stickers=null;
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

/* — Обои — применяем CSS‑переменные (см. style.css) — */
function applyWallpaper(){
  const data = localStorage.getItem(LS_WP_DATA) || '';
  const op   = +(localStorage.getItem(LS_WP_OPACITY) || '90') / 100;

  // ❗ Используем те же имена, что в style.css
  document.documentElement.style.setProperty('--wallpaper-url', data ? `url("${data}")` : 'none');
  document.documentElement.style.setProperty('--wallpaper-opacity', String(op));

  if (wpOpacity) wpOpacity.value = Math.round(op * 100);
}
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

/* — Стикеры — */
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
    // не трогаем PIN и тему, но чистим пользовательские настройки
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

/* === Стикеры === */
function weightedPick(arr){ const sum=arr.reduce((s,a)=>s+(a.weight||1),0); let r=Math.random()*sum; for(const a of arr){ r-= (a.weight||1); if(r<=0) return a; } return arr[0]; }
function hourMood(){ const h=new Date().getHours(); if(h>=6&&h<12)return'morning'; if(h>=12&&h<18)return'day'; if(h>=18&&h<23)return'evening'; return'night'; }

function shouldShowSticker(userText, replyText){
  if (lsStickerMode()==='off') return false;
  const base = (lsStickerProb()/100);
  const KEY_FLIRT=/(обним|поцел|скуч|нрав|хочу тебя|рядом|люблю|неж)/i;
  if (userText && KEY_FLIRT.test(userText)) return true;
  return Math.random()<base;
}

function pickStickerSmart(replyText, windowPool, userText){
  if (!stickers || stickers._schema!=='v2') return null;
  const list = stickers.stickers||[];
  if (!list.length) return null;

  const DISCOURAGE=/(тяжел|тяжёл|груст|больно|тревог|сложно|проблем|помоги|совет|план|границ)/i;
  const KEY_FLIRT=/(обним|поцел|скуч|нрав|хочу тебя|рядом|люблю|неж)/i;

  if (lsStickerSafe() && (userText && DISCOURAGE.test(userText))) return null;

  if (lsStickerMode()==='keywords'){
    const pool = (userText?userText:replyText)||'';
    const hit = list.filter(s=> (s.keywords||[]).some(k=>new RegExp(k,'i').test(pool)));
    return hit.length?weightedPick(hit):null;
  }

  // smart
  if (userText && KEY_FLIRT.test(userText)) {
    const hit = list.filter(s=> (s.keywords||[]).some(k=>new RegExp(k,'i').test(userText)));
    if (hit.length) return weightedPick(hit);
    const romantic=list.filter(s=> (s.moods||[]).some(m=>['tender','romantic','shy','cosy','playful'].includes(m)));
    if (romantic.length) return weightedPick(romantic);
  }

  if (replyText){
    const byKw=list.filter(s=>(s.keywords||[]).some(k=>new RegExp(k,'i').test(replyText)));
    if (byKw.length) return weightedPick(byKw);
  }

  const tMood = windowPool || hourMood();
  const def = stickers.defaults?.byTime?.[tMood];
  if (def && Math.random() < (def.p ?? 0.1)) {
    const pool = list.filter(s => (s.moods||[]).some(m => def.moods.includes(m)));
    if (pool.length) return weightedPick(pool);
  }

  if (replyText && KEY_FLIRT.test(replyText)){
    const pool=list.filter(s=> (s.moods||[]).some(m=>['romantic','playful','cosy','tender','shy'].includes(m)));
    if (pool.length && Math.random()<0.35) return weightedPick(pool);
  }

  return null;
}

function addStickerBubble(src, who='assistant'){
  const row=document.createElement('div');
  row.className='row '+(who==='user'?'me':'her');
  const timeStr=fmtTime(new Date());

  if (who==='user'){
    row.innerHTML=`<div class="bubble me sticker-only">
      <img class="sticker" src="${src}" alt="sticker"/>
      <span class="bubble-time">${timeStr}</span>
    </div>`;
  } else {
    row.innerHTML=`<img class="avatar small" src="/avatar.jpg" alt="Рин"/>
      <div class="bubble her sticker-only">
        <img class="sticker" src="${src}" alt="sticker"/>
        <span class="bubble-time">${timeStr}</span>
      </div>`;
  }
  chatEl.appendChild(row);
  chatEl.scrollTop=chatEl.scrollHeight;
  return row;
}

/* === INIT === */
(async function init(){
  try{
    const [p1,p2,p3,p4]=await Promise.all([
      fetch('/data/rin_persona.json').then(r=>r.json()).catch(()=>null),
      fetch('/data/rin_phrases.json').then(r=>r.json()).catch(()=>null),
      fetch('/data/rin_schedule.json').then(r=>r.json()).catch(()=>null),
      fetch('/data/rin_stickers.json?v=5').then(r=>r.json()).catch(()=>null)
    ]);
    persona=p1; phrases=p2; schedule=p3; stickers=p4;
  }catch(e){ console.warn('JSON load error',e); }

  history=loadHistory();
  if (history.length){
    for (const m of history) addBubble(m.content, m.role==='user'?'user':'assistant', m.ts);
  } else {
    greet();
  }

  // карусель статуса
  setInterval(()=>{ peerStatus.textContent = Math.random()<0.85?'онлайн':'была недавно'; },15000);

  // планировщик авто‑инициаций
  setInterval(tryInitiateBySchedule, 60_000);
  tryInitiateBySchedule();
})();

function greet(){
  const greeting='Привет, это я — Рин. Хочешь, буду рядом и помогу разобрать мысли? 🌸';
  addBubble(greeting,'assistant');
  const st=pickStickerSmart(greeting,'morning','');
  if (st && shouldShowSticker('',greeting)) addStickerBubble(st.src,'assistant');
  history.push({role:'assistant',content:greeting,ts:Date.now()});
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

async function tryInitiateBySchedule(){
  if (!schedule || !phrases) return;
  const d=nowLocal(); const dateKey=fmtDateKey(d);
  const lastKey=Object.keys(JSON.parse(localStorage.getItem(DAILY_INIT_KEY)||'{}')).pop();
  if (lastKey && lastKey!==dateKey){ localStorage.setItem(DAILY_INIT_KEY, JSON.stringify({})); chainStickerCount=0; }

  if (getInitCountFor(dateKey) >= (schedule.max_daily_initiations||2)) return;

  const win=(schedule.windows||[]).find(w=>inWindow(d,w.from,w.to) && Math.random()<(w.probability||0.5));
  if (!win) return;

  const last=history[history.length-1];
  if (last && last.role==='assistant' && d - new Date(last.ts||Date.now()) < 15*60*1000) return;

  const pool = phrases[win.pool] ? win.pool : 'morning';
  const text = pick(phrases[pool] || phrases.morning);

  peerStatus.textContent='печатает…';
  const trow=addTyping();
  setTimeout(()=>{
    trow.remove(); peerStatus.textContent='онлайн';
    addBubble(text,'assistant');
    const st=pickStickerSmart(text,win.pool,'');
    if (st && shouldShowSticker('',text)) addStickerBubble(st.src,'assistant');
    history.push({role:'assistant',content:text,ts:Date.now()});
    saveHistory(history); bumpInitCount(dateKey);
    maybeSpeak(text); // короткая озвучка
  }, 1200+Math.random()*1200);
}

/* === Отправка === */
formEl.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const text=inputEl.value.trim();
  if (!text) return;

  addBubble(text,'user');
  history.push({role:'user',content:text,ts:Date.now()});
  saveHistory(history);
  inputEl.value=''; inputEl.focus();

  peerStatus.textContent='печатает…';
  const typingRow=addTyping();

  try{
    const res=await fetch('/api/chat',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ history, pin: localStorage.getItem('rin-pin') })
    });
    const data=await res.json();
    typingRow.remove();

    if (!res.ok) throw new Error(data?.detail || data?.error || ('HTTP '+res.status));

    if (data.long){
      const prev=peerStatus.textContent; peerStatus.textContent='📖 рассказывает…';
      setTimeout(()=>{ peerStatus.textContent=prev||'онлайн'; }, 2500);
    } else peerStatus.textContent='онлайн';

    addBubble(data.reply,'assistant');

    const st=pickStickerSmart(data.reply,null,text);
    if (st && shouldShowSticker(text,data.reply)) addStickerBubble(st.src,'assistant');

    history.push({role:'assistant',content:data.reply,ts:Date.now()});
    saveHistory(history);

    maybeSpeak(data.reply);
  }catch(err){
    typingRow.remove(); peerStatus.textContent='онлайн';
    addBubble('Ой… связь шалит. '+(err?.message||''),'assistant');
  }
});

/* === Озвучка: короткие фразы, c шансом из настроек === */
async function maybeSpeak(text){
  if (!lsSpeakEnabled()) return;
  const rate = lsSpeakRate()/100;     // 0..0.5
  if (Math.random()>rate) return;
  const t=(text||'').replace(/\s+/g,' ').trim();
  if (!t || t.length>180) return;

  try{
   const r = await fetch('/api/tts', {
   method: 'POST',
   headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({ text: t })
  });
    if (!r.ok) return;
    const blob=await r.blob();
    const url=URL.createObjectURL(blob);
    const audio=new Audio(url);
    audio.play().catch(()=>{});
    audio.onended=()=>URL.revokeObjectURL(url);
  }catch{}
}
