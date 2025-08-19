/* ============================
   RIN — public/chat.js
   ============================ */

const STORAGE_KEY    = 'rin-history-v2';
const DAILY_INIT_KEY = 'rin-init-count';

const chatEl     = document.getElementById('chat');
const formEl     = document.getElementById('form');
const inputEl    = document.getElementById('input');
const peerStatus = document.getElementById('peerStatus');

/* ====== Настройки (панель) ====== */
const settingsBtn      = document.getElementById('settingsToggle');
const settingsPanel    = document.getElementById('settingsPanel');
const closeSettingsBtn = document.getElementById('closeSettings');
const themeToggleBtn   = document.getElementById('themeToggle');
const resetBtn         = document.getElementById('resetApp');

settingsBtn.addEventListener('click', () => settingsPanel.classList.remove('hidden'));
closeSettingsBtn.addEventListener('click', () => settingsPanel.classList.add('hidden'));

themeToggleBtn.addEventListener('click', () => {
  const isDark = document.documentElement.classList.contains('theme-dark');
  const next = isDark ? 'theme-light' : 'theme-dark';
  window.__rinSetTheme(next);
  alert('Тема переключена на: ' + (next === 'theme-dark' ? 'тёмную' : 'светлую'));
});

resetBtn.addEventListener('click', () => {
  if (confirm('Очистить историю и данные?')) {
    localStorage.clear();
    location.reload();
  }
});

/* ====== Глобальные данные ====== */
let persona = null, phrases = null, schedule = null, stickers = null;
let history = [];
let chainStickerCount = 0;

/* ====== Утилиты ====== */
const nowLocal   = () => new Date();
const fmtDateKey = (d) => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const fmtTime    = (d) => d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});

function loadHistory(){ try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; } }
function saveHistory(h){ localStorage.setItem(STORAGE_KEY, JSON.stringify(h.slice(-60))); }

function getInitCountFor(dateKey){ const data = JSON.parse(localStorage.getItem(DAILY_INIT_KEY) || '{}'); return data[dateKey] || 0; }
function bumpInitCount(dateKey){ const data = JSON.parse(localStorage.getItem(DAILY_INIT_KEY) || '{}'); data[dateKey] = (data[dateKey] || 0) + 1; localStorage.setItem(DAILY_INIT_KEY, JSON.stringify(data)); }

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

/* ====== Разметка чат‑сообщений ====== */
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

/* ============================
   СТИКЕРЫ: триггеры и выбор
   ============================ */

// Ключевые триггеры (рус/транслит, несколько форм одного слова)
const KEY_ROMANCE_RE = /(поцел\w*|обним\w*|любл\w*|скуч\w*|рядом|ласк\w*)/i;
const KEY_NEG_RE     = /(злюсь|злой|зла|сердит|раздраж|бесит|груст|плохо|тревог|расстро|больно|обидно|устал|выгорел)/i;

function shouldShowSticker(userText='', replyText='') {
  // Романтика — всегда; иначе 30%
  if (KEY_ROMANCE_RE.test(userText) || KEY_ROMANCE_RE.test(replyText)) return true;
  return Math.random() < 0.30;
}

/**
 * Умный подбор стикера:
 *  - романтические ключи → романтика/нежность;
 *  - негатив → спокойные/поддерживающие;
 *  - иначе — по времени суток/keywords;
 *  - в позитивных контекстах исключаем angry/skeptical и т.п.
 */
function pickStickerSmart(replyText, windowPool, userText, opts = {}) {
  if (!stickers || stickers._schema !== 'v2' || !Array.isArray(stickers.stickers)) return null;
  const list = stickers.stickers;
  if (!list.length) return null;

  const BAD_MOODS   = ['angry','skeptical','sad','frustrated'];
  const hasNegative = KEY_NEG_RE.test(userText || '') || KEY_NEG_RE.test(replyText || '');
  const forcePositive = !!opts.forcePositive;

  // «Безопасный» пул (не даём строгие/скептичные в тёплом контексте)
  const safeList = (!hasNegative || forcePositive)
    ? list.filter(s => !BAD_MOODS.some(m => (s.moods||[]).includes(m)))
    : list;

  const byMood = (moods) => safeList.filter(s => (s.moods||[]).some(m => moods.includes(m)));
  const byKw   = (text)  => safeList.filter(s => (s.keywords||[]).some(k => new RegExp(k,'i').test(text)));

  // 1) РОМАНТИКА: keywords → романтичный пул
  if (KEY_ROMANCE_RE.test(userText || '') || KEY_ROMANCE_RE.test(replyText || '')) {
    const hit = byKw(userText || replyText || '');
    if (hit.length) return weightedPick(hit);
    const romanticPool = byMood(['romantic','tender','cosy','playful','shy','warm','soft','smile','happy']);
    if (romanticPool.length) return weightedPick(romanticPool);
  }

  // 2) Негатив — поддерживающие/спокойные
  if (hasNegative) {
    const calm = byMood(['support','calm','cosy','tender','smile','warm','soft']);
    if (calm.length) return weightedPick(calm);
  }

  // 3) Совпадение по keywords из ответа
  if (replyText) {
    const hitR = byKw(replyText);
    if (hitR.length) return weightedPick(hitR);
  }

  // 4) По времени суток
  const tMood = windowPool || hourMood();
  const def = stickers.defaults?.byTime?.[tMood];
  if (def && Math.random() < (def.p ?? 0.25)) {
    const pool = byMood(def.moods || []);
    if (pool.length) return weightedPick(pool);
  }

  // 5) Мягкий fallback — только тёплые
  const fallback = byMood(['happy','smile','cosy','romantic','tender','playful','shy','warm','soft']);
  return fallback.length ? weightedPick(fallback) : null;
}

/* ====== Вставка стикера ====== */
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

/* ============================
   Инициализация
   ============================ */
(async function init(){
  try {
    const [p1, p2, p3, p4] = await Promise.all([
      fetch('/data/rin_persona.json').then(r=>r.json()),
      fetch('/data/rin_phrases.json?v=2025-03-05').then(r=>r.json()),
      fetch('/data/rin_schedule.json').then(r=>r.json()),
      fetch('/data/rin_stickers.json?v=2025-03-05').then(r=>r.json())
    ]);
    persona = p1; phrases = p2; schedule = p3; stickers = p4;
  } catch (e) { console.warn('Не удалось загрузить JSON', e); }

  history = loadHistory();
  if (history.length) {
    for (const m of history) {
      addBubble(m.content, m.role === 'user' ? 'user' : 'assistant', m.ts);
    }
  } else {
    const greeting = 'Привет, это я — Рин. Хочешь, буду рядом и помогу разобрать мысли? 🌸';
    addBubble(greeting, 'assistant');

    // На приветствии — только тёплые (никаких строгих/скептических)
    const st = pickStickerSmart(greeting, 'morning', '', { forcePositive: true });
    if (shouldShowSticker('', greeting) && st) {
      addStickerBubble(st.src, 'assistant');
      chainStickerCount++;
    }

    history.push({ role:'assistant', content:greeting, ts: Date.now() });
    saveHistory(history);
  }

  // Псевдо‑статус
  setInterval(()=>{
    const r = Math.random();
    peerStatus.textContent = r < 0.85 ? 'онлайн' : 'была недавно';
  }, 15000);

  // Автоинициативы по расписанию
  setInterval(tryInitiateBySchedule, 60 * 1000);
  tryInitiateBySchedule();
})();

/* ====== Инициативы по расписанию ====== */
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

  // Смена дня — сбрасываем счётчик инициатив и серию стикеров
  const lastKeyInStore = Object.keys(JSON.parse(localStorage.getItem(DAILY_INIT_KEY) || '{}')).pop();
  if (lastKeyInStore && lastKeyInStore !== dateKey) {
    localStorage.setItem(DAILY_INIT_KEY, JSON.stringify({}));
    chainStickerCount = 0;
  }

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

    const st = pickStickerSmart(text, win.pool, '', { forcePositive: true });
    if (shouldShowSticker('', text) && st) {
      addStickerBubble(st.src, 'assistant');
      chainStickerCount++;
    }

    history.push({ role:'assistant', content:text, ts: Date.now() });
    saveHistory(history);
    bumpInitCount(fmtDateKey(d));
  }, 1200 + Math.random()*1200);
}

/* ====== Обработчик отправки ====== */
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
    peerStatus.textContent = 'онлайн';

    addBubble(data.reply, 'assistant');

    let st = pickStickerSmart(data.reply, null, text, { forcePositive: false });
    if (shouldShowSticker(text, data.reply)) {
      if (!st && stickers && stickers.stickers) {
        // подстраховка: если ничего не подобралось, берём тёплые
        const fb = stickers.stickers.filter(s => (s.moods||[]).some(m =>
          ['romantic','tender','cosy','smile','happy','shy','warm','soft'].includes(m)
        ));
        st = fb.length ? weightedPick(fb) : null;
      }
      if (st) { addStickerBubble(st.src, 'assistant'); chainStickerCount++; }
    }

    history.push({ role:'assistant', content:data.reply, ts: Date.now() });
    saveHistory(history);

  } catch (err) {
    typingRow.remove();
    peerStatus.textContent = 'онлайн';
    addBubble('Ой… связь шалит. ' + (err?.message || ''), 'assistant');
  }
});

/* ====== Скролл на дно при наборе (мобайл) ====== */
(function () {
  function keepBottom(){ setTimeout(() => { chatEl.scrollTop = chatEl.scrollHeight; }, 50); }
  inputEl.addEventListener('focus', keepBottom);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', keepBottom);
    window.visualViewport.addEventListener('scroll', keepBottom);
  }
})();
