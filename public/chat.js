/* =========================
   Рин — фронтенд логика чата
   ========================= */

/* ---------- UI refs ---------- */
const chatEl  = document.getElementById('chat');
const formEl  = document.getElementById('form');
const inputEl = document.getElementById('input');
const peerStatus = document.getElementById('peerStatus');
const themeBtn = document.getElementById('themeToggle');

/* ---------- Theme toggle ---------- */
(function initThemeToggle(){
  if (!themeBtn) return;
  themeBtn.addEventListener('click', () => {
    const isDark = document.documentElement.classList.contains('theme-dark');
    const next = isDark ? 'theme-light' : 'theme-dark';
    window.__rinSetTheme(next);
    themeBtn.textContent = next === 'theme-dark' ? '☾' : '☀︎';
  });
  themeBtn.textContent = document.documentElement.classList.contains('theme-dark') ? '☾' : '☀︎';
})();

/* ---------- State ---------- */
const STORAGE_KEY = 'rin-history-v2';
const DAILY_INIT_KEY = 'rin-init-count';
let persona = null, phrases = null, schedule = null, stickers = null, backstory = null;
let history = [];
let chainStickerCount = 0;

/* ---------- Utils ---------- */
const nowLocal = () => new Date();
const fmtTime = (d) => d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
function loadHistory(){ try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; } }
function saveHistory(h){ localStorage.setItem(STORAGE_KEY, JSON.stringify(h.slice(-60))); }
function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

/* ---------- Bubbles ---------- */
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

/* ---------- Stickers ---------- */
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
  return Math.random() < 0.30; // 30%
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

/* ---------- Backstory helpers ---------- */
function getEraFromText(t=''){
  t = t.toLowerCase();
  if (/детств|маленьк|садик|обон|бабушк/.test(t)) return 'Детство';
  if (/школ|однокласс|учеб|учител|экзам|кассет|плеер/.test(t)) return 'Школьные годы';
  if (/университ|институт|общежит|студент|кафедр|icq|аськ/.test(t)) return 'Юность и университет';
  if (/работ|квартир|издательств|переводчик|взросл/.test(t)) return 'Взрослая жизнь';
  if (/сейчас|ныне|сегодня|202\d|202[0-5]/.test(t)) return 'Настоящее';
  return null;
}
function getCategoryFromText(t=''){
  t = t.toLowerCase();
  if (/мечт|мечтал|мечтаешь/.test(t)) return 'мечты';
  if (/страх|боял|пугал/.test(t)) return 'страхи';
  if (/воспоминан|помнишь|вспомни/.test(t)) return 'воспоминания';
  if (/занимал|делал|увлечен|хобб|чем занимал/.test(t)) return 'занятия';
  if (/друз|подруг|компан/.test(t)) return 'друзья';
  if (/любов|отношен|роман|чувств/.test(t)) return 'любовь';
  if (/учеб|урок|экзам|учител/.test(t)) return 'занятия';
  return null;
}
function pickBackstorySnippet(userText, force=false){
  if (!backstory?.chapters?.length) return null;

  // Спец-вопрос про имя
  if (/как ты меня называешь|моё японское имя|японск.*имя|как ты меня зовёшь/i.test(userText)) {
    const meta = backstory.meta;
    return `Ты для меня — ${meta.nickname_for_you}. Полное имя, которое я придумала для тебя: ${meta.secret_name_for_you}.`;
  }

  const era = getEraFromText(userText);
  const cat = getCategoryFromText(userText);

  let chapter = null;
  if (era) chapter = backstory.chapters.find(c => c.title === era);

  if (!chapter && cat) {
    const fallback = (cat === 'занятия' && /учеб/.test(userText)) ? 'Школьные годы' : 'Настоящее';
    chapter = backstory.chapters.find(c => c.title === fallback) || backstory.chapters[backstory.chapters.length-1];
  }

  // без явного запроса — 15% шанс мягко вставить «настоящее»
  if (!chapter && !cat && !force) {
    if (Math.random() < 0.15) {
      const ch = backstory.chapters.find(c => c.title === 'Настоящее') || backstory.chapters[backstory.chapters.length-1];
      const arr = ch.sections['воспоминания'] || [];
      if (arr.length) return pick(arr);
    }
    return null;
  }

  chapter = chapter || backstory.chapters[0];
  const sections = chapter.sections || {};

  let pool = null;
  if (cat && sections[cat]?.length) {
    pool = sections[cat];
  } else {
    pool = sections['воспоминания'] || sections['мечты'] || sections['занятия'] || sections['друзья'] || sections['любовь'] || sections['страхи'];
  }

  if (!pool || !pool.length) return null;
  return pick(pool);
}

/* ---------- Phrases + backstory авто-подмешивание ---------- */
function pickPhraseFromPhrases(poolName){
  const arr = phrases?.[poolName];
  if (!Array.isArray(arr) || !arr.length) return null;
  return pick(arr);
}
function pickBackstoryForDaypart(poolName){
  if (!backstory?.chapters?.length) return null;
  const prefer = (poolName === 'evening' || poolName === 'night') ? ['мечты','воспоминания'] : ['воспоминания','занятия'];
  const chapters = [...backstory.chapters];
  const nowCh = chapters.find(c => c.title === 'Настоящее');
  const pickCh = (Math.random() < 0.6 && nowCh) ? nowCh : pick(chapters);
  for (const cat of prefer){
    const pool = pickCh.sections?.[cat];
    if (pool && pool.length) return pick(pool);
  }
  return null;
}
function pickPhrase(poolName){
  const useBackstory = Math.random() < 0.10; // базовый шанс заменить фразу кусочком биографии
  if (useBackstory){
    const mem = pickBackstoryForDaypart(poolName);
    if (mem) return mem;
  }
  return pickPhraseFromPhrases(poolName) || pickBackstoryForDaypart(poolName) || '';
}

/* ---------- Schedule helpers ---------- */
function inWindow(local, fromHHMM, toHHMM){
  const [fh, fm] = fromHHMM.split(':').map(Number);
  const [th, tm] = toHHMM.split(':').map(Number);
  const min = local.getHours()*60 + local.getMinutes();
  const a = fh*60+fm, b = th*60+tm;
  return min >= a && min <= b;
}

async function tryInitiateBySchedule(){
  if (!schedule) return;
  const d = nowLocal();
  const dateKey = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  const store = JSON.parse(localStorage.getItem(DAILY_INIT_KEY) || '{}');
  const lastKey = Object.keys(store).pop();
  if (lastKey && lastKey !== dateKey) { localStorage.setItem(DAILY_INIT_KEY, JSON.stringify({})); chainStickerCount = 0; }
  const count = (JSON.parse(localStorage.getItem(DAILY_INIT_KEY) || '{}')[dateKey] || 0);
  if (count >= (schedule.max_daily_initiations || 2)) return;

  const win = (schedule.windows || []).find(w => inWindow(d, w.from, w.to) && Math.random() < (w.probability || 0.5));
  if (!win) return;

  const last = history[history.length-1];
  if (last && last.role === 'assistant' && d - new Date(last.ts || Date.now()) < 15*60*1000) return;

  const pool = phrases?.[win.pool] ? win.pool : 'morning';
  let text = pickPhrase(pool);

  // шанс дополнить мягким воспоминанием
  if (Math.random() < 0.20) {
    const mem = pickBackstoryForDaypart(pool);
    if (mem) text += (text ? ' ' : '') + mem;
  }

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
    const data = JSON.parse(localStorage.getItem(DAILY_INIT_KEY) || '{}');
    data[dateKey] = (data[dateKey] || 0) + 1;
    localStorage.setItem(DAILY_INIT_KEY, JSON.stringify(data));
  }, 900 + Math.random()*900);
}

/* ---------- Init ---------- */
(async function init(){
  try {
    const [p1, p2, p3, p4, p5] = await Promise.all([
      fetch('/data/rin_persona.json').then(r=>r.json()),
      fetch('/data/rin_phrases.json?v=20250303').then(r=>r.json()),
      fetch('/data/rin_schedule.json').then(r=>r.json()),
      fetch('/data/rin_stickers.json?v=20250303').then(r=>r.json()),
      fetch('/data/rin_backstory.json?v=20250303').then(r=>r.json()),
    ]);
    persona = p1; phrases = p2; schedule = p3; stickers = p4; backstory = p5;
  } catch (e) {
    console.warn('Не удалось загрузить JSON', e);
  }

  history = loadHistory();
  if (history.length) {
    for (const m of history) addBubble(m.content, m.role === 'user' ? 'user' : 'assistant', m.ts);
  } else {
    const greeting = pickPhrase('morning') || "Привет, Хикари. Я заварила чай и уселась у окна — расскажи, как ты сегодня?";
    addBubble(greeting, 'assistant');
    const st = pickStickerSmart(greeting, 'morning', '');
    if (st && shouldShowSticker('', greeting)) { addStickerBubble(st.src, 'assistant'); chainStickerCount++; }
    history.push({ role:'assistant', content:greeting, ts: Date.now() });
    saveHistory(history);
  }

  // инициативы по расписанию
  setInterval(tryInitiateBySchedule, 60*1000);
  tryInitiateBySchedule();

  // лёгкое «мигание» статуса
  setInterval(()=>{
    const r = Math.random();
    peerStatus.textContent = r < 0.85 ? 'онлайн' : 'была недавно';
  }, 15000);
})();

/* ---------- Submit ---------- */
formEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  const userText = inputEl.value.trim();
  if (!userText) return;

  addBubble(userText, 'user');
  history.push({ role: 'user', content: userText, ts: Date.now() });
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

    // Ответ модели
    let reply = data.reply;

    // Прямые вопросы про бэкстори
    const directAsk = /(воспоминани|помнишь|вспомни|о чём ты мечтал|мечтал|мечтаешь|чего ты боял|бояла|страх)/i.test(userText);
    const mem = pickBackstorySnippet(userText, directAsk);
    if (mem) {
      reply += (reply.endsWith('.') || reply.endsWith('!') || reply.endsWith('?') ? ' ' : ' — ') + mem;
    } else if (Math.random() < 0.15) {
      const m2 = pickBackstoryForDaypart(hourMood());
      if (m2) reply += ' ' + m2;
    }

    addBubble(reply, 'assistant');

    const st = pickStickerSmart(reply, null, userText);
    if (st && shouldShowSticker(userText, reply)) { addStickerBubble(st.src, 'assistant'); chainStickerCount++; }

    history.push({ role:'assistant', content:reply, ts: Date.now() });
    saveHistory(history);

  } catch (err) {
    typingRow.remove();
    peerStatus.textContent = 'онлайн';
    addBubble('Ой… связь шалит. ' + (err?.message || ''), 'assistant');
  }
});

/* ---------- iOS клавиатура: держим скролл внизу ---------- */
(function () {
  function keepBottom(){ setTimeout(() => { chatEl.scrollTop = chatEl.scrollHeight; }, 50); }
  inputEl.addEventListener('focus', keepBottom);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', keepBottom);
    window.visualViewport.addEventListener('scroll', keepBottom);
  }
})();
