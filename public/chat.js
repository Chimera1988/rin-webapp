/* public/chat.js — фронт чата Рин с поддержкой TTS и длинного режима */

const STORAGE_KEY     = 'rin-history-v2';
const DAILY_INIT_KEY  = 'rin-init-count';
const SPEAK_KEY       = 'rin-speak';         // "1" — озвучивать короткие реплики
const THEME_KEY       = 'rin-theme';

const chatEl     = document.getElementById('chat');
const formEl     = document.getElementById('form');
const inputEl    = document.getElementById('input');
const peerStatus = document.getElementById('peerStatus');
const themeBtn   = document.getElementById('themeToggle');
const settingsBtn= document.getElementById('btnSettings'); // если есть шестерёнка
const speakTgl   = document.getElementById('speakToggle'); // чекбокс в настройках (если добавлен в index.html)
const resetBtn   = document.getElementById('resetAll');    // кнопка «Сбросить» (если добавлена в index.html)

let persona = null, phrases = null, schedule = null, stickers = null;
let history = [];
let chainStickerCount = 0;

/* ——— helpers ——— */
const nowLocal = () => new Date();
const fmtDateKey = (d) => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const fmtTime = (d) => d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});

function loadHistory(){ try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; } }
function saveHistory(h){ localStorage.setItem(STORAGE_KEY, JSON.stringify(h.slice(-60))); }

function getInitCountFor(dateKey){
  const data = JSON.parse(localStorage.getItem(DAILY_INIT_KEY) || '{}');
  return data[dateKey] || 0;
}
function bumpInitCount(dateKey){
  const data = JSON.parse(localStorage.getItem(DAILY_INIT_KEY) || '{}');
  data[dateKey] = (data[dateKey] || 0) + 1;
  localStorage.setItem(DAILY_INIT_KEY, JSON.stringify(data));
}

function getSpeakOn(){ return localStorage.getItem(SPEAK_KEY) === '1'; }
function setSpeakOn(v){ localStorage.setItem(SPEAK_KEY, v ? '1' : '0'); if (speakTgl) speakTgl.checked = v; }

/* ——— UI: тема ——— */
if (themeBtn) {
  themeBtn.addEventListener('click', () => {
    const isDark = document.documentElement.classList.contains('theme-dark');
    const next = isDark ? 'theme-light' : 'theme-dark';
    document.documentElement.classList.remove('theme-dark','theme-light');
    document.documentElement.classList.add(next);
    localStorage.setItem(THEME_KEY, next);
    themeBtn.textContent = next === 'theme-dark' ? '☾' : '☀︎';
  });
  themeBtn.textContent = document.documentElement.classList.contains('theme-dark') ? '☾' : '☀︎';
}

/* ——— UI: настройки (если разметка есть) ——— */
if (speakTgl) {
  speakTgl.checked = getSpeakOn();
  speakTgl.addEventListener('change', () => setSpeakOn(speakTgl.checked));
}
if (resetBtn) {
  resetBtn.addEventListener('click', () => {
    if (!confirm('Сбросить историю чата, настройки и кэш?')) return;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(DAILY_INIT_KEY);
    // не трогаем PIN и тему
    chatEl.innerHTML = '';
    history = [];
    greet();
  });
}

/* ——— рисование пузырей ——— */
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
  msg.textContent = text;

  const timeEl = document.createElement('span');
  timeEl.className = 'bubble-time';
  timeEl.textContent = fmtTime(dateObj);

  wrap.appendChild(msg);
  wrap.appendChild(timeEl);
  row.appendChild(wrap);
  chatEl.appendChild(row);
  chatEl.scrollTop = chatEl.scrollHeight;
}

function addTyping(){
  const row = document.createElement('div');
  row.className = 'row her typing-row';
  row.innerHTML = `<img class="avatar small" src="/avatar.jpg" alt="Рин" />
    <div class="bubble her typing"><span></span><span></span><span></span></div>`;
  chatEl.appendChild(row);
  chatEl.scrollTop = chatEl.scrollHeight;
  return row;
}

/* ——— наклейки ——— */
function weightedPick(arr){
  const total = arr.reduce((s,a)=>s+(a.weight||1),0);
  let r = Math.random()*total;
  for (const a of arr){ r -= (a.weight||1); if (r <= 0) return a; }
  return arr[0];
}
function hourMood(){
  const h = new Date().getHours();
  if (h >= 6 && h < 12) return 'morning';
  if (h >= 12 && h < 18) return 'day';
  if (h >= 18 && h < 23) return 'evening';
  return 'night';
}
function shouldShowSticker(userText, replyText){
  const KEY_FLIRT = /(обним|поцел|скуч|нрав|хочу тебя|рядом|люблю|неж)/i;
  if (userText && KEY_FLIRT.test(userText)) return true;
  return Math.random() < 0.30;
}
function pickStickerSmart(replyText, windowPool, userText) {
  if (!stickers || stickers._schema !== 'v2') return null;
  const list = stickers.stickers || [];
  if (!list.length) return null;

  const DISCOURAGE = /(тяжел|тяжёл|груст|больно|тревог|сложно|проблем|помоги|совет|план|границ)/i;
  const KEY_FLIRT = /(обним|поцел|скуч|нрав|хочу тебя|рядом|люблю|неж)/i;

  if (userText && KEY_FLIRT.test(userText)) {
    const hit = list.filter(s => (s.keywords||[]).some(k => new RegExp(k,'i').test(userText)));
    if (hit.length) return weightedPick(hit);
    const romanticPool = list.filter(s => (s.moods||[]).some(m => ['tender','romantic','shy','cosy','playful'].includes(m)));
    if (romanticPool.length) return weightedPick(romanticPool);
  }

  if (userText && DISCOURAGE.test(userText)) return null;

  if (replyText){
    const hitKw = list.filter(s => (s.keywords||[]).some(k => new RegExp(k,'i').test(replyText)));
    if (hitKw.length) return weightedPick(hitKw);
  }

  const tMood = windowPool || hourMood();
  const def = stickers.defaults?.byTime?.[tMood];
  if (def && Math.random() < (def.p ?? 0.1)) {
    const pool = list.filter(s => (s.moods||[]).some(m => def.moods.includes(m)));
    if (pool.length) return weightedPick(pool);
  }

  if (replyText && KEY_FLIRT.test(replyText)) {
    const pool = list.filter(s => (s.moods||[]).some(m => ['romantic','playful','cosy','tender','shy'].includes(m)));
    if (pool.length && Math.random() < 0.35) return weightedPick(pool);
  }

  return null;
}

function addStickerBubble(src, who='assistant') {
  const row = document.createElement('div');
  row.className = 'row ' + (who === 'user' ? 'me' : 'her');
  const timeStr = fmtTime(new Date());

  if (who === 'user') {
    row.innerHTML = `
      <div class="bubble me sticker-only">
        <img class="sticker" src="${src}" alt="sticker"/>
        <span class="bubble-time">${timeStr}</span>
      </div>`;
  } else {
    row.innerHTML = `
      <img class="avatar small" src="/avatar.jpg" alt="Рин" />
      <div class="bubble her sticker-only">
        <img class="sticker" src="${src}" alt="sticker"/>
        <span class="bubble-time">${timeStr}</span>
      </div>`;
  }

  chatEl.appendChild(row);
  chatEl.scrollTop = chatEl.scrollHeight;
  return row;
}

/* ——— init ——— */
(async function init(){
  try {
    const [p1, p2, p3, p4] = await Promise.all([
      fetch('/data/rin_persona.json').then(r=>r.json()).catch(()=>null),
      fetch('/data/rin_phrases.json').then(r=>r.json()).catch(()=>null),
      fetch('/data/rin_schedule.json').then(r=>r.json()).catch(()=>null),
      fetch('/data/rin_stickers.json?v=4').then(r=>r.json()).catch(()=>null)
    ]);
    persona = p1; phrases = p2; schedule = p3; stickers = p4;
  } catch(e){ console.warn('Не удалось загрузить JSON', e); }

  history = loadHistory();
  if (history.length) {
    for (const m of history) addBubble(m.content, m.role === 'user' ? 'user' : 'assistant', m.ts);
  } else {
    greet();
  }

  // фоновая карусель статуса
  setInterval(()=>{
    const r = Math.random();
    peerStatus.textContent = r < 0.85 ? 'онлайн' : 'была недавно';
  }, 15000);

  // планировщик самостартов
  setInterval(tryInitiateBySchedule, 60 * 1000);
  tryInitiateBySchedule();
})();

function greet(){
  const greeting = 'Привет, это я — Рин. Хочешь, буду рядом и помогу разобрать мысли? 🌸';
  addBubble(greeting, 'assistant');
  const st = pickStickerSmart(greeting, 'morning', '');
  if (st && shouldShowSticker('', greeting)) { addStickerBubble(st.src, 'assistant'); chainStickerCount++; }
  history.push({ role:'assistant', content:greeting, ts: Date.now() });
  saveHistory(history);
}

function inWindow(local, fromHHMM, toHHMM){
  const [fh, fm] = fromHHMM.split(':').map(Number);
  const [th, tm] = toHHMM.split(':').map(Number);
  const min = local.getHours()*60 + local.getMinutes();
  const a = fh*60+fm, b = th*60+tm;
  return min >= a && min <= b;
}
function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

async function tryInitiateBySchedule(){
  if (!schedule || !phrases) return;
  const d = nowLocal(); const dateKey = fmtDateKey(d);
  const lastKeyInStore = Object.keys(JSON.parse(localStorage.getItem(DAILY_INIT_KEY) || '{}')).pop();
  if (lastKeyInStore && lastKeyInStore !== dateKey) { localStorage.setItem(DAILY_INIT_KEY, JSON.stringify({})); chainStickerCount = 0; }
  const count = getInitCountFor(dateKey);
  if (count >= (schedule.max_daily_initiations || 2)) return;

  const win = (schedule.windows || []).find(w => inWindow(d, w.from, w.to) && Math.random() < (w.probability || 0.5));
  if (!win) return;

  const last = history[history.length-1];
  if (last && last.role === 'assistant' && d - new Date(last.ts || Date.now()) < 15*60*1000) return;

  const pool = phrases[win.pool] ? win.pool : 'morning';
  let text = pick(phrases[pool] || phrases.morning);

  peerStatus.textContent = 'печатает…';
  const trow = addTyping();
  setTimeout(async () => {
    trow.remove();
    peerStatus.textContent = 'онлайн';
    addBubble(text, 'assistant');
    const st = pickStickerSmart(text, win.pool, '');
    if (st && shouldShowSticker('', text)) { addStickerBubble(st.src, 'assistant'); chainStickerCount++; }
    history.push({ role:'assistant', content:text, ts: Date.now() });
    saveHistory(history);
    bumpInitCount(dateKey);

    maybeSpeak(text); // озвучка автосообщений, если короткие
  }, 1200 + Math.random()*1200);
}

/* ——— отправка ——— */
formEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;

  addBubble(text, 'user');
  history.push({ role: 'user', content: text, ts: Date.now() });
  saveHistory(history);
  inputEl.value = '';
  inputEl.focus();

  peerStatus.textContent = 'печатает…';
  const typingRow = addTyping();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ history, pin: localStorage.getItem('rin-pin') })
    });
    const data = await res.json();
    typingRow.remove();

    if (!res.ok) throw new Error(data?.detail || data?.error || ('HTTP ' + res.status));

    // короткая индикация длинного режима
    if (data.long) {
      const prev = peerStatus.textContent;
      peerStatus.textContent = '📖 рассказывает…';
      setTimeout(() => { peerStatus.textContent = prev || 'онлайн'; }, 2500);
    } else {
      peerStatus.textContent = 'онлайн';
    }

    addBubble(data.reply, 'assistant');

    const st = pickStickerSmart(data.reply, null, text);
    if (st && shouldShowSticker(text, data.reply)) { addStickerBubble(st.src, 'assistant'); chainStickerCount++; }

    history.push({ role:'assistant', content:data.reply, ts: Date.now() });
    saveHistory(history);

    maybeSpeak(data.reply); // озвучка ответа
  } catch (err) {
    typingRow.remove();
    peerStatus.textContent = 'онлайн';
    addBubble('Ой… связь шалит. ' + (err?.message || ''), 'assistant');
  }
});

/* ——— озвучка коротких реплик через /api/tts ——— */
async function maybeSpeak(text){
  if (!getSpeakOn()) return;
  const t = (text || '').replace(/\s+/g,' ').trim();
  if (!t) return;
  if (t.length > 180) return; // только короткие фразы

  try {
    const r = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ text: t })
    });
    if (!r.ok) return;
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.play().catch(()=>{ /* игнор, если авто‑плей запрещён */ });
    audio.onended = () => URL.revokeObjectURL(url);
  } catch { /* no-op */ }
}

/* ——— удерживаем скролл у низа при вводе (iOS) ——— */
(function () {
  function keepBottom(){ setTimeout(() => { chatEl.scrollTop = chatEl.scrollHeight; }, 50); }
  inputEl.addEventListener('focus', keepBottom);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', keepBottom);
    window.visualViewport.addEventListener('scroll', keepBottom);
  }
})();
